import {assertScopedVmIds,assertScopedEndpointIds,hasServerScope} from '@/server/permissions/server-scope';
import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand} from '../business-management/idempotency';
import {getManualInventory} from '../proxy-management/repository';
import {assignableReason,endpointInclude,type EndpointRow} from '../proxy-management/edits';
import {authorizeVM,type VMReader} from './repository';
import {matchProxy,proxyEndpoints} from './bulk';
import {assignProxyToVm,blockedSource,currentProxyOf,loadChangeVM} from './proxy-change';
import {VM_OPS} from '@/lib/vm-ops';
// "Thay proxy" at the Server/VM Proxy cell (owner decision 19/10/2026): pick a proxy of the stock or paste one, checked while choosing,
// one Áp dụng. The same core as the registry and Dán bảng; the same eligibility as a hand-picked allocation (TUT or Chung
// mooon–Genjy, NEW, known package, never installed elsewhere before, never Genjy riêng). A proxy used by another VM is never taken
// silently. Choosing the current proxy again is no change. The VM status set Blocked for the old proxy comes back on success.
export interface ProxyChangeCheck {outcome:'READY'|'SKIP'|'ERROR';message:string;endpointId:string|null;label:string|null;state:string|null;restore:string|null}
const at=(vm:{code:string;server:{code:string}})=>vm.server.code+'/'+vm.code;
const label=(e:{host:string|null;port:number|null})=>e.host+(e.port?':'+e.port:'');
async function judge(db:VMReader,projectId:string,vmId:string,pick:{endpointId?:string;text?:string}):Promise<ProxyChangeCheck>{
  const vm=await db.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId,managed:true}},include:{server:true,desiredConfiguration:true,installedConfiguration:true,allocations:{where:{releasedAt:null}},operation:true}});
  const none={endpointId:null,label:null,state:null,restore:null};
  if(!vm)return {...none,outcome:'ERROR',message:'VM không thuộc dự án này'};
  if(vm.archivedAt||vm.server.archivedAt)return {...none,outcome:'ERROR',message:'VM đã xoá; khôi phục trước khi đổi proxy'};
  let endpoint:EndpointRow|undefined;
  if(pick.endpointId)endpoint=await db.proxyIP.findFirst({where:{id:pick.endpointId,projectId},include:endpointInclude}) as EndpointRow|undefined??undefined;
  else{const text=(pick.text||'').trim();if(!text)return {...none,outcome:'ERROR',message:'Chọn proxy trong kho hoặc dán IP / IP:port / IP:port:user:pass'};const m=matchProxy(text,await proxyEndpoints(projectId,db));if(!m.endpoint)return {...none,outcome:'ERROR',message:m.error+(m.error?.startsWith('Không tìm thấy')?'. Proxy nhà cung cấp vừa replace: dùng "Nhận replace"':'')};endpoint=m.endpoint;}
  if(!endpoint)return {...none,outcome:'ERROR',message:'Không tìm thấy proxy trong kho'};
  const base={endpointId:endpoint.id,label:label(endpoint),state:endpoint.inventoryState,restore:null as string|null},cur=currentProxyOf(vm);
  if(cur.endpointId===endpoint.id)return {...base,outcome:'SKIP',message:'Đang là proxy hiện tại của VM; không đổi'};
  const mine=cur.candidates.includes(endpoint.id);
  const elsewhere=endpoint.allocations.find(a=>a.vmId!==vm.id)??null;
  if(elsewhere)return {...base,outcome:'ERROR',message:'Proxy đang dùng ở '+at(elsewhere.vm)+'; web không lấy ngầm. Bỏ gán ở đó trước'};
  if(endpoint.vm&&endpoint.vm.id!==vm.id)return {...base,outcome:'ERROR',message:'Proxy đang ghi ở '+at(endpoint.vm)+'; bỏ gán ở đó trước'};
  const reason=assignableReason(endpoint);if(reason)return {...base,outcome:'ERROR',message:endpoint.inventoryState==='BLOCKED'?'Proxy đang BLOCKED; chọn proxy khác':reason.message};
  if(!mine){
    const pool=await getManualInventory(projectId,db as PrismaClient);
    if(!pool.some(p=>p.endpointId===endpoint!.id))return {...base,outcome:'ERROR',message:endpoint.inventoryState==='LIVE'?'Proxy đang LIVE (ghi là đang dùng); chọn proxy NEW trong kho':'Proxy chưa đủ điều kiện cấp VM (cần NEW, có gói, chưa từng cài ở máy khác, không phải Genjy riêng)'};
  }
  const back=await blockedSource(db,vm.id,vm.operation,cur.candidates.filter(id=>id!==endpoint!.id)),restore=back?VM_OPS.PROXY_PENDING.label:null; // 21/10/2026: a replaced Blocked waits for the machine, never back to OK directly
  return {...base,restore,outcome:'READY',message:(cur.review?'Chọn proxy này làm proxy đang dùng; các proxy cần đối chiếu rời VM':cur.endpointId?'Thay proxy':'Gán proxy')+(restore?'; tình trạng VM thành '+restore+' (máy thật cần áp dụng và kiểm tra)':'; máy thật cần áp dụng proxy mới')};
}
export async function checkVmProxyChange(scope:ActorScope,input:{vmId:string;endpointId?:string;text?:string},db:PrismaClient=prisma){
  scope=await authorizeVM(scope,'ASSIGN',db);
  await assertScopedVmIds(db,scope,[input.vmId]);
  if(input.endpointId)await assertScopedEndpointIds(db,scope,[input.endpointId],{write:true});
  if(hasServerScope(scope)&&!input.endpointId)throw new ProxyDomainError('FORBIDDEN','Chọn proxy đã được giao trong phạm vi máy chủ');
  return judge(db,scope.projectId,input.vmId,input);
}
export async function changeVmProxy(scope:ActorScope,input:{key:string;vmId:string;expectedVmRevision:number;expectedCycle:number;endpointId:string},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_PROXY_CHANGE',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true,authorize:async tx=>{const current=await authorizeVM(scope,'ASSIGN',tx);await assertScopedVmIds(tx,current,[input.vmId]);await assertScopedEndpointIds(tx,current,[input.endpointId],{write:true});return current;}},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const vm=await loadChangeVM(tx,input.vmId);if(vm.server.projectId!==scope.projectId)throw new ProxyDomainError('NOT_FOUND');
    const cycle=vm.operation?.cycle??1;
    if(cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW','VM đã sang lượt '+cycle+'; tải lại rồi chọn lại');
    if(vm.revision!==input.expectedVmRevision)throw new ProxyDomainError('STALE_PREVIEW',at(vm)+' vừa được thay đổi (có thể người khác vừa đổi proxy); tải lại để xem proxy hiện tại');
    const check=await judge(tx,scope.projectId,vm.id,{endpointId:input.endpointId});
    if(check.outcome==='ERROR')throw new ProxyDomainError('INVALID_INPUT',check.message);
    if(check.outcome==='SKIP')return {changed:false,message:check.message,proxy:check.label};
    const r=await assignProxyToVm(tx,images,{projectId:scope.projectId,actorId:current.userId,now:new Date(),via:'Ô Proxy Server/VM'},vm.id,input.endpointId);
    const after=await tx.vmOperation.findUnique({where:{vmId:vm.id}});
    return {changed:r.changed,message:'Đã đổi sang '+check.label+(check.restore?' · tình trạng '+(after?.status?VM_OPS[after.status].label:'Chưa ghi'):''),proxy:check.label};
  },db);
}
