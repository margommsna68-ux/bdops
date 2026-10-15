import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand} from '../business-management/idempotency';
import {authorizeVM,type VMReader} from './repository';
import {parseSdkPaste,normalizeSdk} from './sdk-parse';
export interface SdkPreviewRow {line:number;server:string|null;vm:string;vmId:string|null;current:string|null;next:string|null;outcome:'READY'|'SKIP'|'ERROR';message:string;expectedRevision:number|null}
export interface SdkPreview {rows:SdkPreviewRow[];ready:number;skipped:number;errors:number}
export interface SdkItem {vmId:string;sdk:string|null;expectedRevision:number;clear?:boolean}
const MAX_ROWS=1000;
type ManagedVM=Prisma.VirtualMachineGetPayload<{include:{server:true}}>;
async function activeVMs(projectId:string,db:VMReader){return db.virtualMachine.findMany({where:{managed:true,archivedAt:null,server:{projectId,managed:true,archivedAt:null}},include:{server:true}});}
const location=(vm:{code:string;server:{code:string}})=>vm.server.code+' / '+vm.code;
/** Another active managed VM already holds this SDK. Cross-project holders are reported without naming them. */
async function holder(sdk:string,exceptVmId:string,projectId:string,db:VMReader){
  const vm=await db.virtualMachine.findFirst({where:{sdkId:sdk,managed:true,archivedAt:null,id:{not:exceptVmId}},include:{server:{select:{code:true,projectId:true}}}});
  if(!vm)return null;return vm.server.projectId===projectId?`SDK đang thuộc ${location(vm)}`:'SDK đang thuộc một VM ở dự án khác';
}
export async function previewSdkUpdate(scope:ActorScope,input:{text:string;serverId?:string},db:PrismaClient=prisma):Promise<SdkPreview>{
  await authorizeVM(scope,'ASSIGN',db);if(input.text.length>200000)throw new ProxyDomainError('INVALID_INPUT','Dán tối đa 1000 dòng mỗi đợt');
  const parsed=parseSdkPaste(input.text);if(!parsed.length||parsed.length>MAX_ROWS)throw new ProxyDomainError('INVALID_INPUT','Dán từ 1 đến 1000 dòng mỗi đợt');
  const vms=await activeVMs(scope.projectId,db),selected=input.serverId?vms.find(v=>v.serverId===input.serverId)?.server||await db.server.findFirst({where:{id:input.serverId,projectId:scope.projectId,managed:true,archivedAt:null}}):null;
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
    const taken=await holder(row.sdk!,vm.id,scope.projectId,db);if(taken){rows.push({...found,message:taken});continue;}
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
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_SDK_RECORD',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    const rows:{vmId:string;location:string;previous:string|null;next:string|null}[]=[];const now=new Date();
    for(const item of input.items){
      const vm=await tx.virtualMachine.findFirst({where:{id:item.vmId,managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},include:{server:true}});
      if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không thuộc dự án này hoặc đã ẩn');
      if(vm.revision!==item.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW',`${location(vm)} vừa được thay đổi; kiểm tra lại trước khi lưu`);
      if(item.sdk===vm.sdkId)continue;
      if(item.sdk){const taken=await holder(item.sdk,vm.id,scope.projectId,tx);if(taken)throw new ProxyDomainError('OWNER_CONFLICT',`${taken}; xóa ở máy cũ trước khi ghi cho ${location(vm)}`);}
      await images.remember('VM_SDK',vm.id);
      await tx.virtualMachine.update({where:{id:vm.id},data:{sdkId:item.sdk,sdkRecordedAt:now,sdkRecordedById:current.userId,revision:{increment:1}}});
      await tx.vMSdkHistory.create({data:{projectId:scope.projectId,vmId:vm.id,previousSdk:vm.sdkId,newSdk:item.sdk,actorId:current.userId,recordedAt:now,note:item.clear?'Xóa SDK':null}});
      rows.push({vmId:vm.id,location:location(vm),previous:vm.sdkId,next:item.sdk});
    }
    return {updated:rows.length,rows};
  },db);
}
export async function readSdkHistory(scope:ActorScope,vmId:string,db:PrismaClient=prisma){
  await authorizeVM(scope,'READ',db);
  const vm=await db.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId:scope.projectId,managed:true}},select:{id:true}});if(!vm)throw new ProxyDomainError('NOT_FOUND');
  const rows=await db.vMSdkHistory.findMany({where:{vmId,projectId:scope.projectId},orderBy:[{recordedAt:'desc'},{id:'desc'}],take:200});
  const users=await db.user.findMany({where:{id:{in:Array.from(new Set(rows.map(r=>r.actorId)))}},select:{id:true,name:true,username:true}});
  return rows.map(r=>({id:r.id,previousSdk:r.previousSdk,newSdk:r.newSdk,note:r.note,recordedAt:r.recordedAt.toISOString(),actor:users.find(u=>u.id===r.actorId)?.name||users.find(u=>u.id===r.actorId)?.username||'Tài khoản cũ'}));
}
