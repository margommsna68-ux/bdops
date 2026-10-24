import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand} from '../business-management/idempotency';
import {authorizeVM,type VMReader} from './repository';
import {assertScopedVmIds,hasServerScope,sdkWhere,serverWhere,vmWhere} from '../permissions/server-scope';
import {authorizeSdkCodes,denyScopedSdkHistory} from './sdk-scope';
import {parseSdkPaste,normalizeSdk} from './sdk-parse';
import {planPlacement,applyPlacement} from './sdk-store';
export interface SdkPreviewRow {line:number;server:string|null;vm:string;vmId:string|null;current:string|null;next:string|null;outcome:'READY'|'SKIP'|'ERROR';message:string;expectedRevision:number|null}
export interface SdkPreview {rows:SdkPreviewRow[];ready:number;skipped:number;errors:number}
export interface SdkItem {vmId:string;sdk:string|null;expectedRevision:number;clear?:boolean}
const MAX_ROWS=1000;
type ManagedVM=Prisma.VirtualMachineGetPayload<{include:{server:true}}>;
async function visibleCodes(scope:ActorScope,codes:(string|null)[],db:VMReader){
  if(!hasServerScope(scope))return null;
  return new Set((await db.sdkRecord.findMany({where:{projectId:scope.projectId,code:{in:codes.filter((code):code is string=>!!code)},...sdkWhere(scope)},select:{code:true}})).map(r=>r.code));
}
async function activeVMs(scope:ActorScope,db:VMReader){
  const vms=await db.virtualMachine.findMany({where:{managed:true,...vmWhere(scope),archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},include:{server:true}});
  const visible=await visibleCodes(scope,vms.map(v=>v.sdkId),db);
  return vms.map(v=>visible&&v.sdkId&&!visible.has(v.sdkId)?{...v,sdkId:null}:v);
}
const location=(vm:{code:string;server:{code:string}})=>vm.server.code+' / '+vm.code;
// Older paste endpoints (sdkPreview / sdkApply): same rule as the SDK cell and Kho SDK (sdk-store.ts). A code on another VM is
// never taken; a stored, never-linked code may be used; linked / unconfirmed codes are refused.
async function holder(sdk:string,vm:ManagedVM,scope:ActorScope,db:VMReader){
  const r=await planPlacement(db,scope.projectId,{...vm,operation:null},sdk,null,scope);return 'error' in r?r.error:null;
}
export async function previewSdkUpdate(scope:ActorScope,input:{text:string;serverId?:string},db:PrismaClient=prisma):Promise<SdkPreview>{
  scope=await authorizeVM(scope,'ASSIGN',db);if(input.text.length>200000)throw new ProxyDomainError('INVALID_INPUT','Dán tối đa 1000 dòng mỗi đợt');
  const parsed=parseSdkPaste(input.text);if(!parsed.length||parsed.length>MAX_ROWS)throw new ProxyDomainError('INVALID_INPUT','Dán từ 1 đến 1000 dòng mỗi đợt');
  const vms=await activeVMs(scope,db),selected=input.serverId?vms.find(v=>v.serverId===input.serverId)?.server||await db.server.findFirst({where:{AND:[{id:input.serverId},serverWhere(scope)],projectId:scope.projectId,managed:true,archivedAt:null}}):null;
  if(input.serverId&&!selected)throw new ProxyDomainError('NOT_FOUND','Server không thuộc dự án này hoặc đã ẩn');
  const byKey=new Map<string,ManagedVM>();for(const vm of vms)byKey.set(vm.server.code.toLowerCase()+'\u0000'+vm.code.toLowerCase(),vm);
  const serverCodes=new Set(vms.map(v=>v.server.code.toLowerCase()));if(selected)serverCodes.add(selected.code.toLowerCase());
  const counts=new Map<string,number>();for(const row of parsed)if(row.sdk)counts.set(row.sdk,(counts.get(row.sdk)||0)+1);
  const rows:SdkPreviewRow[]=[];
  for(const row of parsed){
    const serverCode=row.server??selected?.code??null,base:SdkPreviewRow={line:row.line,server:serverCode,vm:row.vm,vmId:null,current:null,next:row.sdk,outcome:'ERROR',message:'',expectedRevision:null};
    if(row.issue==='TOO_MANY_COLUMNS'){rows.push({...base,message:'Dòng có quá nhiều cột; dùng Server | VM | SDK'});continue;}
    if(!serverCode){rows.push({...base,message:'Chọn server hoặc dán kèm cột server'});continue;}
    if(!serverCodes.has(serverCode.toLowerCase())){rows.push({...base,message:'Không tìm thấy server '+serverCode});continue;}
    const vm=byKey.get(serverCode.toLowerCase()+'\u0000'+row.vm.toLowerCase());
    if(!vm){rows.push({...base,message:'Không tìm thấy VM '+row.vm+' trong '+serverCode});continue;}
    const found={...base,server:vm.server.code,vm:vm.code,vmId:vm.id,current:vm.sdkId,expectedRevision:vm.revision};
    if(row.issue==='BLANK'){rows.push({...found,outcome:'SKIP',message:'Giữ nguyên: ô SDK trống'});continue;}
    if(row.issue==='INVALID_SDK'){rows.push({...found,message:'Mã SDK không hợp lệ'});continue;}
    if((counts.get(row.sdk!)||0)>1){rows.push({...found,message:'Trùng trong danh sách dán'});continue;}
    if(row.sdk===vm.sdkId){rows.push({...found,outcome:'SKIP',message:'Giữ nguyên: cùng SDK hiện tại'});continue;}
    const taken=await holder(row.sdk!,vm,scope,db);if(taken){rows.push({...found,message:taken});continue;}
    rows.push({...found,outcome:'READY',message:vm.sdkId?'Đổi SDK':'Ghi SDK mới'});
  }
  return {rows,ready:rows.filter(r=>r.outcome==='READY').length,skipped:rows.filter(r=>r.outcome==='SKIP').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
}
export async function applySdkUpdate(scope:ActorScope,input:{key:string;items:SdkItem[]},db:PrismaClient=prisma){
  if(!input.items.length||input.items.length>MAX_ROWS||new Set(input.items.map(i=>i.vmId)).size!==input.items.length)throw new ProxyDomainError('INVALID_INPUT','Mỗi VM một dòng, tối đa 1000 VM mỗi đợt');
  for(const item of input.items){
    if(item.clear){if(item.sdk!==null)throw new ProxyDomainError('INVALID_INPUT');continue;}
    if(item.sdk===null||normalizeSdk(item.sdk)!==item.sdk)throw new ProxyDomainError('INVALID_INPUT','Mã SDK không hợp lệ (8–128 ký tự chữ/số/._:-)');
  }
  const sdks=input.items.filter(i=>i.sdk).map(i=>i.sdk!);if(new Set(sdks).size!==sdks.length)throw new ProxyDomainError('DUPLICATE_INPUT','Một SDK xuất hiện ở nhiều dòng');
  const result=await runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_SDK_RECORD',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true,authorize:tx=>authorizeSdkCodes(tx,scope,sdks)},async(tx,images,current)=>{
    current=await authorizeVM(current,'ASSIGN',tx);
    await assertScopedVmIds(tx,current,input.items.map(i=>i.vmId));
    const rows:{vmId:string;location:string;previous:string|null;next:string|null}[]=[];const now=new Date();
    for(const item of input.items){
      const vm=await tx.virtualMachine.findFirst({where:{id:item.vmId,managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},include:{server:true}});
      if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không thuộc dự án này hoặc đã ẩn');
      if(vm.revision!==item.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW',`${location(vm)} vừa được thay đổi; kiểm tra lại trước khi lưu`);
      const planned=await planPlacement(tx,scope.projectId,{...vm,operation:null},item.clear?null:item.sdk,null,current);
      if('error' in planned)throw new ProxyDomainError(planned.code,planned.error+' ('+location(vm)+')');
      const r=await applyPlacement(tx,{projectId:scope.projectId,actorId:current.userId,images,now,via:item.clear?'Gỡ SDK':'Dán SDK'},{...vm,operation:null},planned.plan,{});
      if(r.changed)rows.push({vmId:vm.id,location:location(vm),previous:vm.sdkId,next:item.clear?null:item.sdk});
    }
    return {updated:rows.length,rows};
  },db);
  scope=await authorizeVM(scope,'READ',db);await assertScopedVmIds(db,scope,result.rows.map(r=>r.vmId));
  const visible=await visibleCodes(scope,result.rows.flatMap(r=>[r.previous,r.next]),db);
  return visible?{...result,rows:result.rows.map(r=>({...r,previous:r.previous&&visible.has(r.previous)?r.previous:null,next:r.next&&visible.has(r.next)?r.next:null}))}:result;
}
export async function readSdkHistory(scope:ActorScope,vmId:string,db:PrismaClient=prisma){
  scope=await authorizeVM(scope,'READ',db);
  await assertScopedVmIds(db,scope,[vmId]);denyScopedSdkHistory(scope);
  const vm=await db.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId:scope.projectId,managed:true}},select:{id:true}});if(!vm)throw new ProxyDomainError('NOT_FOUND');
  const rows=await db.vMSdkHistory.findMany({where:{vmId,projectId:scope.projectId},orderBy:[{recordedAt:'desc'},{id:'desc'}],take:200});
  const users=await db.user.findMany({where:{id:{in:Array.from(new Set(rows.map(r=>r.actorId)))}},select:{id:true,name:true,username:true}});
  return rows.map(r=>({id:r.id,previousSdk:r.previousSdk,newSdk:r.newSdk,note:r.note,recordedAt:r.recordedAt.toISOString(),actor:users.find(u=>u.id===r.actorId)?.name||users.find(u=>u.id===r.actorId)?.username||'Tài khoản cũ'}));
}
