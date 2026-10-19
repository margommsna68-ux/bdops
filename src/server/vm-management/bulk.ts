import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand} from '../business-management/idempotency';
import {decodeEndpoint} from '../proxy-management/repository';
import {fullProxy,parseProxy} from '../proxy-management/parse';
import {syncAssignmentState} from '../proxy-management/assignment-state';
import {assignableReason,endpointInclude,occupantOf,placeOnVm,vmInclude,type EndpointRow,type VMRow} from '../proxy-management/edits';
import {authorizeVM,type VMReader} from './repository';
import {normalizeSdk} from './sdk-parse';
import {planPlacement,applyPlacement,checkInfo,infoChanges,staleSdk,type SdkInfo} from './sdk-store';
import {parseSdkAmount,formatSdkAmount,SDK_NOTE_MAX} from '@/lib/sdk-money';
// "Dán bảng" and the bulk bar on Server/VM: one kind of update per batch (SDK, proxy, existing Gmail or note), matched by server + VM
// code (never by line order). Preview reports every line; apply re-checks every row inside one transaction, saves the rows that are
// still valid and reports the rest one by one. A retry of the same list finds the saved rows unchanged ("giữ nguyên") and writes nothing.
export type BulkKind='SDK'|'PROXY'|'GMAIL'|'NOTE';
export interface BulkRow {line:number;server:string|null;vm:string;vmId:string|null;before:string|null;after:string|null;value:string|null;outcome:'READY'|'SKIP'|'ERROR';message:string;expectedRevision:number|null;
  /** SDK only: money / note of the target code (undefined = keep, null = clear with "-") and the old → new text shown at the line. */
  amount?:string|null;note?:string|null;info?:string|null;
  /** SDK only: revision of the stored target code at the check (null = not stored); apply refuses the line when it changed. */
  expectedSdkRevision?:number|null}
export interface BulkPreview {kind:BulkKind;rows:BulkRow[];ready:number;skipped:number;errors:number}
export interface BulkApplyRow {line:number;vmId:string;server:string;vm:string;outcome:'APPLIED'|'SKIP'|'ERROR';message:string}
export const CLEAR_TOKEN='-';
// Gmail per VM became the EarnApp account (login + PayPal) with its own checks: Dán bảng → Tài khoản / accountStore.linkApply.
function refuseGmail(kind:BulkKind){if(kind==='GMAIL') throw new ProxyDomainError('INVALID_INPUT','Gán tài khoản dùng Dán bảng → Tài khoản (Server | VM | Tài khoản | Mã PP)');}
const MAX_ROWS=1000,NOTE_MAX=1000;
const RIGHT:Record<BulkKind,'ASSIGN'|'MANAGE'>={SDK:'ASSIGN',PROXY:'ASSIGN',GMAIL:'ASSIGN',NOTE:'MANAGE'};
type Line={line:number;server:string|null;vm:string;value:string;extra:boolean;amount?:string;note?:string};
const HEADER=/^(server|vm|máy|mã vm|sdk|proxy|gmail|email|ghi chú|note|giá trị)$/i;
// Cells split on tab or "|". With a server chosen: VM | value (a leading server cell equal to that server is accepted too); without: Server | VM | value.
// Notes may contain "|": everything after the key cells is the value. SDK also accepts spaces between cells like the SDK paste.
export function parseBulkLines(kind:BulkKind,text:string,serverCode:string|null):Line[]{
  const out:Line[]=[];
  text.replace(/\r/g,'').split('\n').forEach((raw,index)=>{
    if(!raw.trim()) return;
    let cells=raw.includes('\t')?raw.split('\t'):raw.includes('|')?raw.split('|'):kind==='SDK'||kind==='PROXY'||kind==='GMAIL'?raw.trim().split(/\s+/):[raw];
    cells=cells.map(c=>c.trim());
    if(index===0&&cells.length>=2&&cells.every(c=>!c||HEADER.test(c))) return;
    const keyed=serverCode?(cells.length>=3&&cells[0].toLowerCase()===serverCode.toLowerCase()?1:0):1;
    const server=serverCode?(keyed?cells[0]:serverCode):cells[0]??'';
    const vm=cells[keyed]??'',rest=cells.slice(keyed+1);
    const value=kind==='NOTE'?rest.join(' | ').trim():rest[0]??'';
    // SDK lines may carry the code's money and note: VM | SDK | Tiền tích luỹ USD | Ghi chú (the note may contain "|").
    if(kind==='SDK'){const sep=raw.includes('	')||raw.includes('|')?' | ':' ';out.push({line:index+1,server:server||null,vm,value,extra:false,amount:rest[1]??'',note:rest.slice(2).join(sep).trim()});return;}
    out.push({line:index+1,server:server||null,vm,value,extra:kind!=='NOTE'&&rest.length>1});
  });
  return out;
}
type ActiveVM=VMRow&{gmailId:string|null;sdkId:string|null;notes:string|null};
async function activeVMs(projectId:string,db:VMReader){return await db.virtualMachine.findMany({where:{managed:true,archivedAt:null,server:{projectId,managed:true,archivedAt:null}},include:vmInclude}) as ActiveVM[];}
const at=(vm:{code:string;server:{code:string}})=>vm.server.code+'/'+vm.code;
// Current value of a VM for the chosen kind, shown as "cũ".
function shown(kind:BulkKind,vm:ActiveVM,gmails:Map<string,string>,occupant:string|null){
  if(kind==='SDK') return vm.sdkId;if(kind==='NOTE') return vm.notes;if(kind==='GMAIL') return vm.gmailId?gmails.get(vm.gmailId)||'(Gmail đã lưu trữ)':null;return occupant;
}
// Proxy lookup like the registry paste: IP, IP:port or the full proxy; current rows only (replaced/voided/retired never match).
export async function proxyEndpoints(projectId:string,db:VMReader){return await db.proxyIP.findMany({where:{projectId,identityId:{not:null},retiredAt:null,inventoryState:{notIn:['REPLACED','VOID']}},include:endpointInclude}) as EndpointRow[];}
export function matchProxy(text:string,endpoints:EndpointRow[]):{endpoint?:EndpointRow;error?:string}{
  const ipPort=/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(text.trim()); // IP:port as it often sits in the Sheet
  let proxy:{ip:string;port:number|null;format:string;username?:string|null;password?:string|null};
  if(ipPort) proxy={ip:ipPort[1],port:Number(ipPort[2]),format:'BARE'};else try{proxy=parseProxy(text);}catch{return {error:'Proxy không hợp lệ (dán IP, IP:port hoặc IP:port:user:pass)'};}
  const found=endpoints.filter(e=>e.identity!.ip===proxy.ip&&(proxy.port===null||e.port===proxy.port)&&(proxy.format!=='FULL'||(()=>{const d=decodeEndpoint(e);return d?.format==='FULL'&&fullProxy(d)===fullProxy(proxy as Parameters<typeof fullProxy>[0]);})()));
  if(!found.length) return {error:'Không tìm thấy proxy trong kho'};if(found.length>1) return {error:'IP có nhiều proxy; dán đầy đủ IP:port:user:pass'};return {endpoint:found[0]};
}
const label=(e:EndpointRow)=>e.identity!.ip+(e.port?':'+e.port:'');
// Why this proxy cannot go onto this VM now (null = it can). Never takes a proxy away from another VM and never replaces a proxy on the VM.
function proxyIssue(e:EndpointRow,vm:VMRow):{skip?:string;error?:string}|null{
  if(e.allocations.some(a=>a.vmId===vm.id)||e.vm?.id===vm.id) return {skip:'Đã ở VM này'};
  const eligible=assignableReason(e);if(eligible) return {error:eligible.message};
  const elsewhere=e.allocations[0]?at(e.allocations[0].vm):e.vm?at(e.vm):null;
  if(elsewhere) return {error:'Proxy đang ở '+elsewhere+'; bỏ gán ở đó trước, web không tự chuyển'};
  const who=occupantOf(vm,e.id);if(who) return {error:'VM đang có proxy '+who+'; đổi proxy ở menu ⋯ của VM'};
  return null;
}
// Money / note cells of an SDK line: blank keeps, "-" clears, anything else is checked like the SDK cell.
function sdkCells(l:Line):{info:SdkInfo}|{error:string}{
  const a=(l.amount||'').trim(),n=(l.note||'').trim(),info:SdkInfo={};
  if(a){if(a===CLEAR_TOKEN)info.amount=null;else{const r=parseSdkAmount(a);if('error' in r)return {error:'Tiền tích luỹ: '+r.error};info.amount=r.value;}}
  if(n){if(n.length>SDK_NOTE_MAX)return {error:'Ghi chú SDK tối đa '+SDK_NOTE_MAX+' ký tự'};info.note=n===CLEAR_TOKEN?null:n;}
  return {info};
}
function infoText(ch:ReturnType<typeof infoChanges>){
  const parts:string[]=[];if(ch.amount)parts.push('Tiền '+(formatSdkAmount(ch.amount.from)||'chưa ghi')+' → '+(formatSdkAmount(ch.amount.to)||'xoá'));if(ch.note)parts.push('Ghi chú '+(ch.note.from?'"'+ch.note.from.slice(0,40)+'"':'trống')+' → '+(ch.note.to?'"'+ch.note.to.slice(0,40)+'"':'xoá'));
  return parts.join(' · ')||null;
}
export async function previewVmBulk(scope:ActorScope,input:{kind:BulkKind;serverId?:string;text?:string;items?:{vmId:string;value:string}[]},db:PrismaClient=prisma):Promise<BulkPreview>{
  const kind=input.kind;if(!RIGHT[kind]||(input.text===undefined)===(input.items===undefined)) throw new ProxyDomainError('INVALID_INPUT');
  refuseGmail(kind);
  await authorizeVM(scope,RIGHT[kind],db);
  const vms=await activeVMs(scope.projectId,db),server=input.serverId?await db.server.findFirst({where:{id:input.serverId,projectId:scope.projectId,managed:true,archivedAt:null}}):null;
  if(input.serverId&&!server) throw new ProxyDomainError('NOT_FOUND','Server không thuộc dự án này hoặc đã xoá');
  const byId=new Map(vms.map(v=>[v.id,v])),byKey=new Map(vms.map(v=>[v.server.code.toLowerCase()+'\u0000'+v.code.toLowerCase(),v])),servers=new Set(vms.map(v=>v.server.code.toLowerCase()));if(server) servers.add(server.code.toLowerCase());
  let lines:Line[];
  if(input.items){if(!input.items.length||input.items.length>MAX_ROWS) throw new ProxyDomainError('INVALID_INPUT','Từ 1 đến 1000 VM mỗi đợt');lines=input.items.map((i,n)=>{const vm=byId.get(i.vmId);return {line:n+1,server:vm?.server.code??null,vm:vm?.code??i.vmId,value:i.value,extra:false};});}
  else{if((input.text||'').length>200000) throw new ProxyDomainError('INVALID_INPUT','Dán tối đa 1000 dòng mỗi đợt');lines=parseBulkLines(kind,input.text||'',server?.code||null);if(!lines.length||lines.length>MAX_ROWS) throw new ProxyDomainError('INVALID_INPUT','Dán từ 1 đến 1000 dòng mỗi đợt');}
  const [gmailRows,endpoints]=await Promise.all([kind==='GMAIL'?db.gmailAccount.findMany({where:{projectId:scope.projectId,archivedAt:null},select:{id:true,email:true}}):Promise.resolve([]),kind==='PROXY'?proxyEndpoints(scope.projectId,db):Promise.resolve([] as EndpointRow[])]);
  const gmails=new Map(gmailRows.map(g=>[g.id,g.email])),gmailByEmail=new Map(gmailRows.map(g=>[g.email.toLowerCase(),g]));
  if(kind==='GMAIL'){const bound=Array.from(new Set(vms.map(v=>v.gmailId).filter((s):s is string=>!!s&&!gmails.has(s))));if(bound.length) for(const g of await db.gmailAccount.findMany({where:{id:{in:bound}},select:{id:true,email:true}})) gmails.set(g.id,g.email+' (đã lưu trữ)');}
  // Resolve each line to a VM first so repeats can be reported on every line involved (never "last line wins").
  const resolved=lines.map(l=>{const vm=input.items?byId.get(input.items[l.line-1].vmId):l.server?byKey.get(l.server.toLowerCase()+'\u0000'+l.vm.toLowerCase()):undefined;return {l,vm};});
  const vmLines=new Map<string,number[]>();for(const r of resolved) if(r.vm) vmLines.set(r.vm.id,[...(vmLines.get(r.vm.id)||[]),r.l.line]);
  const valueKey=(r:{l:Line})=>{const v=r.l.value.trim();if(!v||v===CLEAR_TOKEN) return null;if(kind==='SDK') return normalizeSdk(v);if(kind==='PROXY'){const m=matchProxy(v,endpoints);return m.endpoint?.id||null;}return null;};
  const valueLines=new Map<string,number[]>();for(const r of resolved){const k=valueKey(r);if(k) valueLines.set(k,[...(valueLines.get(k)||[]),r.l.line]);}
  const rows:BulkRow[]=[];
  for(const {l,vm} of resolved){
    const base:BulkRow={line:l.line,server:l.server,vm:l.vm,vmId:null,before:null,after:l.value||null,value:null,outcome:'ERROR',message:'',expectedRevision:null};
    if(l.extra){rows.push({...base,message:'Dòng có quá nhiều cột; dùng '+(server?'VM | giá trị':'Server | VM | giá trị')});continue;}
    if(!vm){rows.push({...base,message:!l.server?'Chọn server hoặc dán kèm cột server':!servers.has(l.server.toLowerCase())?'Không tìm thấy server '+l.server:'Không tìm thấy VM '+l.vm+' trên '+l.server+' (máy đã xoá không nhận cập nhật)'});continue;}
    const occupant=kind==='PROXY'?occupantOf(vm):null;
    const found={...base,server:vm.server.code,vm:vm.code,vmId:vm.id,before:shown(kind,vm,gmails,occupant),expectedRevision:vm.revision};
    const repeats=vmLines.get(vm.id)!;if(repeats.length>1){rows.push({...found,message:'VM lặp ở dòng '+repeats.filter(n=>n!==l.line).join(', ')+'; giữ một dòng'});continue;}
    const raw=l.value.trim();
    if(!raw){rows.push({...found,outcome:'SKIP',message:'Ô trống: giữ nguyên'});continue;}
    const clear=raw===CLEAR_TOKEN;
    if(clear){
      if(kind==='PROXY'){rows.push({...found,message:'Bỏ gán proxy ở menu ⋯ của VM; Dán bảng chỉ giao proxy'});continue;}
      if(found.before===null){rows.push({...found,after:null,outcome:'SKIP',message:'Đang trống; giữ nguyên'});continue;}
      rows.push({...found,after:null,value:null,outcome:'READY',message:kind==='SDK'?'Gỡ SDK khỏi VM (mã vẫn giữ trong kho / lịch sử)':'Xoá giá trị'});continue;
    }
    const twice=(k:string|null)=>{const n=k?valueLines.get(k):undefined;return n&&n.length>1?n.filter(x=>x!==l.line):null;};
    if(kind==='SDK'){
      const sdk=normalizeSdk(raw);if(!sdk){rows.push({...found,message:'Mã SDK không hợp lệ (8–128 ký tự chữ/số/._:-)'});continue;}
      const other=twice(sdk);if(other){rows.push({...found,after:sdk,message:'Cùng SDK với dòng '+other.join(', ')+'; mỗi SDK một VM'});continue;}
      const cell=sdkCells(l);if('error' in cell){rows.push({...found,after:sdk,message:cell.error});continue;}
      const planned=await planPlacement(db,scope.projectId,{...vm,operation:null},sdk);if('error' in planned){rows.push({...found,after:sdk,message:planned.error});continue;}
      const {plan}=planned,record=plan.kind==='SAME'?plan.current:plan.target,ch=infoChanges(record,cell.info),info=infoText(ch);
      if(plan.kind==='SAME'&&!ch.amount&&!ch.note){rows.push({...found,after:sdk,outcome:'SKIP',message:'Giữ nguyên: cùng SDK hiện tại'});continue;}
      rows.push({...found,after:sdk,value:sdk,outcome:'READY',...cell.info,info,expectedSdkRevision:record?.revision??null,message:plan.kind==='SAME'?'Cập nhật tiền / ghi chú SDK':plan.kind==='PLACE'?'Dùng SDK trong kho':vm.sdkId?'Đổi SDK (mã cũ giữ lại)':'Ghi SDK mới'});
    }else if(kind==='NOTE'){
      if(raw.length>NOTE_MAX){rows.push({...found,message:'Ghi chú tối đa '+NOTE_MAX+' ký tự'});continue;}
      if(raw===(vm.notes||'').trim()){rows.push({...found,after:raw,outcome:'SKIP',message:'Giữ nguyên: cùng ghi chú'});continue;}
      rows.push({...found,after:raw,value:raw,outcome:'READY',message:vm.notes?'Đổi ghi chú':'Thêm ghi chú'});
    }else if(kind==='GMAIL'){
      const g=gmailByEmail.get(raw.toLowerCase());if(!g){rows.push({...found,message:'Gmail chưa có trong dự án; thêm ở Tài khoản trước (không tự tạo)'});continue;}
      if(vm.gmailId===g.id){rows.push({...found,after:g.email,outcome:'SKIP',message:'Giữ nguyên: đã liên kết Gmail này'});continue;}
      rows.push({...found,after:g.email,value:g.id,outcome:'READY',message:vm.gmailId?'Đổi Gmail của VM':'Liên kết Gmail'});
    }else{
      const m=matchProxy(raw,endpoints);if(!m.endpoint){rows.push({...found,message:m.error!});continue;}
      const e=m.endpoint,after=label(e),other=twice(e.id);if(other){rows.push({...found,after,message:'Cùng proxy với dòng '+other.join(', ')+'; mỗi proxy một VM'});continue;}
      const issue=proxyIssue(e,vm);if(issue?.skip){rows.push({...found,after,outcome:'SKIP',message:issue.skip});continue;}if(issue?.error){rows.push({...found,after,message:issue.error});continue;}
      rows.push({...found,after,value:e.id,outcome:'READY',message:'Gán proxy; VM dùng ngay'});
    }
  }
  return {kind,rows,ready:rows.filter(r=>r.outcome==='READY').length,skipped:rows.filter(r=>r.outcome==='SKIP').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
}
export async function applyVmBulk(scope:ActorScope,input:{kind:BulkKind;key:string;items:{line:number;vmId:string;expectedRevision:number;expectedSdkRevision?:number|null;value:string|null;amount?:string|null;note?:string|null}[]},db:PrismaClient=prisma){
  refuseGmail(input.kind);
  const kind=input.kind;if(!RIGHT[kind]||!input.items.length||input.items.length>MAX_ROWS||new Set(input.items.map(i=>i.vmId)).size!==input.items.length) throw new ProxyDomainError('INVALID_INPUT','Mỗi VM một dòng, tối đa 1000 VM mỗi đợt');
  for(const i of input.items){
    if(kind==='SDK'&&i.value!==null&&normalizeSdk(i.value)!==i.value) throw new ProxyDomainError('INVALID_INPUT','Mã SDK không hợp lệ');
    if(kind==='NOTE'&&i.value!==null&&(!i.value.trim()||i.value.length>NOTE_MAX)) throw new ProxyDomainError('INVALID_INPUT','Ghi chú tối đa '+NOTE_MAX+' ký tự');
    if(kind==='PROXY'&&!i.value) throw new ProxyDomainError('INVALID_INPUT');
  }
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_BULK_'+kind,module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    await authorizeVM(current,RIGHT[kind],tx);
    const rows:BulkApplyRow[]=[],now=new Date(),usedSdk=new Map<string,string>(),usedProxy=new Set<string>();
    for(const item of [...input.items].sort((a,b)=>a.line-b.line)){
      const vm=await tx.virtualMachine.findFirst({where:{id:item.vmId,managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},include:vmInclude}) as ActiveVM|null;
      const row=(outcome:BulkApplyRow['outcome'],message:string)=>rows.push({line:item.line,vmId:item.vmId,server:vm?.server.code||'',vm:vm?.code||'',outcome,message});
      if(!vm){row('ERROR','VM không còn hoạt động (đã xoá hoặc không thuộc dự án)');continue;}
      if(vm.revision!==item.expectedRevision){row('ERROR','VM vừa được thay đổi sau khi xem trước; kiểm tra lại dòng này');continue;}
      if(kind==='SDK'){
        if(item.value){const dup=usedSdk.get(item.value);if(dup){row('ERROR','Cùng SDK với '+dup);continue;}usedSdk.set(item.value,at(vm));}
        let info:SdkInfo;try{info=checkInfo({amount:item.amount,note:item.note});}catch(e){row('ERROR',e instanceof Error?e.message.replace(/^[A-Z_]+: /,''):'Tiền / ghi chú không hợp lệ');continue;}
        const planned=await planPlacement(tx,scope.projectId,{...vm,operation:null},item.value);if('error' in planned){row('ERROR',planned.error);continue;}
        const stale=staleSdk(planned.plan,item.expectedSdkRevision);if(stale){row('ERROR',stale);continue;}
        const r=await applyPlacement(tx,{projectId:scope.projectId,actorId:current.userId,images,now,via:'Dán bảng'},{...vm,operation:null},planned.plan,info);
        row(r.changed?'APPLIED':'SKIP',r.message);
      }else if(kind==='NOTE'){
        const next=item.value?.trim()||null;if(next===(vm.notes?.trim()||null)){row('SKIP','Giữ nguyên');continue;}
        await images.remember('VM',vm.id);await tx.virtualMachine.update({where:{id:vm.id},data:{notes:next,revision:{increment:1}}});row('APPLIED',next?'Đã lưu ghi chú':'Đã xoá ghi chú');
      }else if(kind==='GMAIL'){
        if(item.value===vm.gmailId){row('SKIP','Giữ nguyên');continue;}
        if(item.value&&!await tx.gmailAccount.findFirst({where:{id:item.value,projectId:scope.projectId,archivedAt:null},select:{id:true}})){row('ERROR','Gmail không còn trong dự án');continue;}
        await images.remember('VM_BINDING',vm.id);for(const id of Array.from(new Set([vm.gmailId,item.value].filter((s):s is string=>!!s)))){await images.remember('GMAIL',id);await tx.gmailAccount.update({where:{id},data:{revision:{increment:1}}});}
        await tx.virtualMachine.update({where:{id:vm.id},data:{gmailId:item.value,revision:{increment:1}}});row('APPLIED',item.value?'Đã liên kết Gmail':'Đã bỏ liên kết Gmail');
      }else{
        const endpoint=await tx.proxyIP.findFirst({where:{id:item.value!,projectId:scope.projectId},include:endpointInclude}) as EndpointRow|null;
        if(!endpoint||endpoint.retiredAt||['REPLACED','VOID'].includes(endpoint.inventoryState)){row('ERROR','Proxy không còn trong kho hiện tại');continue;}
        if(usedProxy.has(endpoint.id)){row('ERROR','Proxy đã được giao ở dòng khác trong đợt này');continue;}
        const issue=proxyIssue(endpoint,vm);if(issue?.skip){row('SKIP',issue.skip);continue;}if(issue?.error){row('ERROR',issue.error);continue;}
        usedProxy.add(endpoint.id);await images.remember('ENDPOINT',endpoint.id);
        await placeOnVm(tx,images,current,endpoint,vm,now);
        await tx.proxyIP.update({where:{id:endpoint.id},data:{revision:{increment:1}}});await syncAssignmentState(tx,endpoint.id);
        row('APPLIED','Đã gán '+label(endpoint));
      }
    }
    rows.sort((a,b)=>a.line-b.line);
    return {rows,applied:rows.filter(r=>r.outcome==='APPLIED').length,skipped:rows.filter(r=>r.outcome==='SKIP').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
  },db);
}
export type BulkApplyResult=Awaited<ReturnType<typeof applyVmBulk>>;
