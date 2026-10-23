import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {maskSdk} from '@/lib/sdk-mask';
import {isShared,ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {getManualInventory} from '../proxy-management/repository';
import {runBusinessCommand} from '../business-management/idempotency';
import {authorizeVM} from '../vm-management/repository';
import {assignProxyToVm,currentProxyOf,loadChangeVM} from '../vm-management/proxy-change';
import {placeVmSdk,refusalOf} from '../vm-management/sdk-store';
import {linkSdkForAi} from './sdk-link';
import {jobEvent,ownJob,type OpsCaller} from '../vm-ops/jobs';
import {staleCycle} from '../vm-ops/ops';
// Proxy and SDK stock for an AI operator (design 23/10/2026 sections B and C). Pure services; the ops API wires them (api.ts).
// - The AI works only on the VM it has in hand (its own ACTIVE job of this token, same VM, same round) and only with the rules of the
//   web: a proxy is placed through assignProxyToVm (the single assignment path: configuration, hold, release of the old one, NEW / LIVE,
//   "Chờ áp dụng proxy" after a Blocked, the apply mark), an SDK through placeVmSdk ("Dùng SDK trong kho") and linkVmSdkIn ("Đã nối").
// - FREE = exactly what the web would hand out by hand (getManualInventory: TUT or Chung mooon–Genjy, NEW, with a package, full
//   credentials, never installed elsewhere, not held by any VM). Genjy riêng and BLOCKED are never chosen.
// - Two commands at once never take the same proxy: the chosen ProxyIP row is locked (FOR UPDATE; a pick iterates the candidates with
//   FOR UPDATE SKIP LOCKED) inside the serializable command transaction, and the choice is checked again on the locked row.
// - Nothing secret leaves: proxy lists carry host / port only (never user / pass), SDK answers carry the masked code only.
type Tx=Prisma.TransactionClient;
type Reader=PrismaClient|Tx;
export type AiProxyGroup='TUT'|'SHARED'|'GENJY'|'OTHER';
export type AiProxyState='FREE'|'ASSIGNED'|'BLOCKED'|'OTHER';
export interface AiProxyItem {id:string;host:string;port:number;packageCode:string|null;group:AiProxyGroup;inventoryState:string;state:AiProxyState;vm:{vmId:string;serverCode:string;vmCode:string}|null;revision:number}
export interface AiProxyFilter {state?:'FREE'|'ASSIGNED'|'BLOCKED'|null;group?:'TUT'|'SHARED'|null;packageCode?:string|null;limit:number;cursor?:string|null}
const groupOf=(identity:{owner:string;subgroup:string|null}|null):AiProxyGroup=>!identity?'OTHER':identity.owner==='SELF'?'TUT':isShared(identity.owner,identity.subgroup)?'SHARED':identity.owner==='GENJY'?'GENJY':'OTHER';
const conflict=(message:string,details?:Record<string,unknown>)=>new ProxyDomainError('STALE_PREVIEW',message,'REVISION_CONFLICT',details);
const cycleChanged=(cycle:number)=>new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle),'CYCLE_CHANGED');
const invalid=(message:string,details?:Record<string,unknown>)=>new ProxyDomainError('INVALID_INPUT',message,'VALIDATION',details);
const at=(vm:{code:string;server:{code:string}})=>vm.server.code+'/'+vm.code;
/** A row lock on a row another command just changed (SQLSTATE 40001 through a raw query) is a serialization failure: let the
 *  command transaction restart with a fresh snapshot (withProxyTransaction retries P2034), like a Prisma query would. */
async function locked<T>(fn:()=>Promise<T>):Promise<T>{
  try{return await fn();}
  catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2010'&&String((e.meta as {code?:unknown}|undefined)?.code)==='40001')throw new Prisma.PrismaClientKnownRequestError('Serialization failure while locking the proxy row',{code:'P2034',clientVersion:e.clientVersion,meta:e.meta});throw e;}
}
// ─── GET proxies ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The project's proxy stock as the AI may see it: host / port / package / group / state and the VM position, never credentials.
 * FREE is exactly the set getManualInventory returns (what the web hands out by hand); ASSIGNED = an active hold on a VM;
 * BLOCKED = inventory state BLOCKED; everything else (LIVE without a VM, Genjy riêng, quarantined, replaced…) is OTHER.
 * Pages: a stable order (host, port, id); the cursor is the last id of the page.
 */
export async function listAiProxies(db:Reader,projectId:string,filter:AiProxyFilter):Promise<{items:AiProxyItem[];nextCursor:string|null}>{
  if(!Number.isInteger(filter.limit)||filter.limit<1||filter.limit>200)throw invalid('limit từ 1 đến 200');
  if(filter.state&&!['FREE','ASSIGNED','BLOCKED'].includes(filter.state))throw invalid('state phải là FREE, ASSIGNED hoặc BLOCKED');
  if(filter.group&&!['TUT','SHARED'].includes(filter.group))throw invalid('group phải là TUT hoặc SHARED');
  const [rows,pool]=await Promise.all([
    db.proxyIP.findMany({where:{projectId,identityId:{not:null},retiredAt:null},select:{id:true,host:true,port:true,packageCode:true,inventoryState:true,revision:true,identity:{select:{owner:true,subgroup:true}},
      allocations:{where:{releasedAt:null},select:{role:true,vm:{select:{id:true,code:true,server:{select:{code:true}}}}},orderBy:{createdAt:'asc'}}},orderBy:[{host:'asc'},{port:'asc'},{id:'asc'}]}),
    getManualInventory(projectId,db),
  ]);
  const free=new Set(pool.map(p=>p.endpointId));
  const items:AiProxyItem[]=rows.flatMap(r=>{
    if(!r.host||!r.port)return [];
    const hold=r.allocations.find(a=>a.role==='DESIRED'||a.role==='INSTALLED')??r.allocations[0]??null;
    const state:AiProxyState=r.inventoryState==='BLOCKED'?'BLOCKED':hold?'ASSIGNED':free.has(r.id)?'FREE':'OTHER';
    return [{id:r.id,host:r.host,port:r.port,packageCode:r.packageCode,group:groupOf(r.identity),inventoryState:r.inventoryState,state,vm:hold?{vmId:hold.vm.id,serverCode:hold.vm.server.code,vmCode:hold.vm.code}:null,revision:r.revision}];
  }).filter(i=>(!filter.state||i.state===filter.state)&&(!filter.group||i.group===filter.group)&&(!filter.packageCode||i.packageCode===filter.packageCode));
  let start=0;
  if(filter.cursor){const index=items.findIndex(i=>i.id===filter.cursor);if(index<0)throw new ProxyDomainError('STALE_PREVIEW','Danh sách đã thay đổi; đọc lại từ đầu');start=index+1;}
  const page=items.slice(start,start+filter.limit);
  return {items:page,nextCursor:start+filter.limit<items.length&&page.length?page[page.length-1].id:null};
}
// ─── POST vms/{id}/proxy-assign ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface AiProxyAssignInput {key:string;vmId:string;expectedCycle:number;expectedVmRevision:number;jobId:string;proxyId?:string|null;pick?:{group:'TUT'|'SHARED';packageCode?:string|null}|null}
export interface AiProxyAssignResult extends Record<string,unknown> {changed:boolean;configurationId:string|null;endpointId:string;host:string;port:number;packageCode:string|null;group:AiProxyGroup;from:string[]}
const freeInclude={identity:{select:{owner:true,subgroup:true,ownerDecidedAt:true,sourceRefs:{select:{owner:true}}}},allocations:{where:{releasedAt:null},select:{vm:{select:{code:true,server:{select:{code:true}}}}}},vm:{select:{code:true,server:{select:{code:true}}}}} as const;
/**
 * The locked endpoint must be FREE now: the refusal names the reason the web would give (Genjy riêng / not TUT or Chung / BLOCKED /
 * held by a VM / otherwise not eligible). `pool` = getManualInventory of this transaction when the caller already read it.
 */
async function assertFree(tx:Tx,projectId:string,endpointId:string,pool?:{endpointId:string}[]){
  const e=await tx.proxyIP.findFirst({where:{id:endpointId,projectId},include:freeInclude});
  if(!e)throw new ProxyDomainError('NOT_FOUND','Không có proxy này trong dự án','NOT_FOUND');
  const shared=isShared(e.identity?.owner,e.identity?.subgroup);
  if(!shared&&(e.identity?.owner==='GENJY'||(!e.identity?.ownerDecidedAt&&e.identity?.sourceRefs.some(s=>s.owner==='GENJY'))))throw new ProxyDomainError('OWNER_CONFLICT','Proxy Genjy riêng không gán vào VM');
  if(!shared&&e.identity?.owner!=='SELF')throw new ProxyDomainError('OWNER_CONFLICT','Chỉ proxy TUT hoặc nhóm chung mới được gán VM');
  if(e.inventoryState==='BLOCKED')throw invalid('Proxy đang BLOCKED; chọn proxy khác');
  const hold=e.allocations[0];if(hold)throw invalid('Proxy đang dùng ở '+at(hold.vm)+'; web không lấy ngầm. Bỏ gán ở đó trước');
  if(e.vm)throw invalid('Proxy đang ghi ở '+at(e.vm)+'; bỏ gán ở đó trước');
  const list=pool??await getManualInventory(projectId,tx);
  if(!list.some(p=>p.endpointId===e.id))throw invalid(e.inventoryState==='LIVE'?'Proxy đang LIVE (ghi là đang dùng); chọn proxy NEW trong kho':'Proxy chưa đủ điều kiện cấp VM (cần NEW, có gói, đủ user/pass, chưa từng cài ở máy khác, không phải Genjy riêng)');
  return e;
}
/**
 * Give the VM in hand a FREE proxy: the one named (`proxyId`) or the next FREE one of a group / package (`pick`). One command, one
 * transaction: the token and rights, the caller's own ACTIVE job on this VM and round, the VM revision, the lock on the endpoint
 * row, the FREE check on the locked row, then assignProxyToVm (the web's own path). The proxy already on the VM = no change.
 */
export async function assignAiProxy(scope:ActorScope,input:AiProxyAssignInput,db:PrismaClient=prisma,caller:OpsCaller={}){
  const proxyId=input.proxyId||null,pick=input.pick??null;
  if(!!proxyId===!!pick)throw invalid('Gửi proxyId hoặc pick (group TUT / SHARED, package tuỳ chọn), không cả hai, không bỏ trống');
  if(pick&&!['TUT','SHARED'].includes(pick.group))throw invalid('pick.group phải là TUT hoặc SHARED');
  const request={vmId:input.vmId,expectedCycle:input.expectedCycle,expectedVmRevision:input.expectedVmRevision,jobId:input.jobId,proxyId,pick:pick?{group:pick.group,packageCode:pick.packageCode||null}:null};
  return runBusinessCommand(scope,{key:input.key,payload:request,kind:'AI_PROXY_ASSIGN',module:'INFRASTRUCTURE',reversible:false},async(tx,images,current):Promise<AiProxyAssignResult>=>{
    await authorizeVM(current,'ASSIGN',tx);
    const job=await ownJob(tx,scope.projectId,current.userId,caller,input.jobId,input.vmId);
    if(job.cycle!==input.expectedCycle)throw cycleChanged(job.cycle);
    const vm=await loadChangeVM(tx,input.vmId);
    if(vm.server.projectId!==scope.projectId||!vm.managed)throw new ProxyDomainError('NOT_FOUND','VM không thuộc dự án này','NOT_FOUND');
    if(vm.archivedAt||vm.server.archivedAt)throw invalid(at(vm)+' đã xoá khỏi web; không gán proxy');
    const cycle=vm.operation?.cycle??1;if(cycle!==input.expectedCycle)throw cycleChanged(cycle);
    if(vm.revision!==input.expectedVmRevision)throw conflict(at(vm)+' vừa được thay đổi (có thể người khác vừa đổi proxy); đọc lại VM rồi gửi lại',{current:{vmId:vm.id,revision:vm.revision}});
    const cur=currentProxyOf(vm);
    const view=async(endpointId:string,changed:boolean,from:string[],configurationId:string|null):Promise<AiProxyAssignResult>=>{
      const e=await tx.proxyIP.findUniqueOrThrow({where:{id:endpointId},select:{host:true,port:true,packageCode:true,identity:{select:{owner:true,subgroup:true}}}});
      return {changed,configurationId,endpointId,host:e.host??'',port:e.port??0,packageCode:e.packageCode,group:groupOf(e.identity),from};
    };
    let endpointId:string;
    if(proxyId){
      // Lock the named row first: a concurrent command on the same proxy waits here and then sees it held (or restarts on a
      // serialization failure and sees it held), so exactly one VM gets it.
      const [row]=await locked(()=>tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "ProxyIP" WHERE "id"=${proxyId} AND "projectId"=${scope.projectId} FOR UPDATE`);
      if(!row)throw new ProxyDomainError('NOT_FOUND','Không có proxy này trong dự án','NOT_FOUND');
      if(cur.endpointId===proxyId){
        const config=[vm.desiredConfiguration,vm.installedConfiguration].find(c=>c&&c.endpointId===proxyId)??null;
        return view(proxyId,false,[],config?.id??null);
      }
      await assertFree(tx,scope.projectId,proxyId);
      endpointId=proxyId;
    }else{
      const pool=(await getManualInventory(scope.projectId,tx)).filter(p=>!!p.shared===(pick!.group==='SHARED'));
      let ids=pool.map(p=>p.endpointId);
      if(pick!.packageCode)ids=(await tx.proxyIP.findMany({where:{id:{in:ids},packageCode:pick!.packageCode},select:{id:true}})).map(r=>r.id);
      const none='Kho không còn proxy FREE nhóm '+(pick!.group==='SHARED'?'Chung mooon–Genjy':'TUT')+(pick!.packageCode?' gói '+pick!.packageCode:'');
      if(!ids.length)throw invalid(none);
      // The next free candidate not held by another command at this moment (two parallel picks never take the same row).
      const [row]=await locked(()=>tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT "id" FROM "ProxyIP" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "host","port","id" FOR UPDATE SKIP LOCKED LIMIT 1`));
      if(!row)throw invalid(none+' (các proxy còn lại đang được lệnh khác giữ); thử lại sau');
      await assertFree(tx,scope.projectId,row.id,pool);
      endpointId=row.id;
    }
    const r=await assignProxyToVm(tx,images,{projectId:scope.projectId,actorId:current.userId,now:new Date(),via:'AI · '+(caller.tokenLabel??'ops')},vm.id,endpointId);
    const after=await tx.virtualMachine.findUniqueOrThrow({where:{id:vm.id},select:{desiredConfigurationId:true}});
    const out=await view(endpointId,r.changed,r.from,after.desiredConfigurationId);
    await jobEvent(tx,scope.projectId,current.userId,job,'Gán proxy từ kho: '+out.host+':'+out.port+(r.from.length?' (thay '+r.from.length+' proxy cũ)':''),caller,{endpointId,configurationId:out.configurationId});
    return out;
  },db);
}
// ─── POST vms/{id}/sdk-assign ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface AiSdkAssignInput {key:string;vmId:string;expectedCycle:number;expectedVmRevision:number;jobId:string;sdkId:string;expectedSdkRevision:number}
async function vmLabel(tx:Tx,vmId:string){const v=await tx.virtualMachine.findUnique({where:{id:vmId},select:{code:true,server:{select:{code:true}}}});return v?at(v):'VM khác';}
/**
 * "Dùng SDK trong kho" by the AI: a stored UNLINKED code that sits in no VM's list, or already in this VM's list, becomes the VM's
 * current SDK through placeVmSdk (the previous unlinked current code stays in the VM's list; no money / note). LINKED, UNCONFIRMED
 * and codes of another VM are refused. The answer carries the masked code only.
 */
export async function assignAiSdk(scope:ActorScope,input:AiSdkAssignInput,db:PrismaClient=prisma,caller:OpsCaller={}){
  const request={vmId:input.vmId,expectedCycle:input.expectedCycle,expectedVmRevision:input.expectedVmRevision,jobId:input.jobId,sdkId:input.sdkId,expectedSdkRevision:input.expectedSdkRevision};
  return runBusinessCommand(scope,{key:input.key,payload:request,kind:'AI_SDK_ASSIGN',module:'INFRASTRUCTURE',reversible:false},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const job=await ownJob(tx,scope.projectId,current.userId,caller,input.jobId,input.vmId);
    if(job.cycle!==input.expectedCycle)throw cycleChanged(job.cycle);
    const vm=await tx.virtualMachine.findFirst({where:{id:input.vmId,managed:true,server:{projectId:scope.projectId,managed:true}},select:{id:true,code:true,revision:true,server:{select:{code:true}},operation:{select:{cycle:true}}}});
    if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không thuộc dự án này','NOT_FOUND');
    const cycle=vm.operation?.cycle??1;if(cycle!==input.expectedCycle)throw cycleChanged(cycle);
    if(vm.revision!==input.expectedVmRevision)throw conflict(at(vm)+' vừa được thay đổi; đọc lại VM rồi gửi lại',{current:{vmId:vm.id,revision:vm.revision}});
    const rec=await tx.sdkRecord.findFirst({where:{id:input.sdkId,projectId:scope.projectId}});
    if(!rec)throw new ProxyDomainError('NOT_FOUND','Không có mã SDK này trong dự án','NOT_FOUND');
    const refusal=refusalOf(rec);if(refusal)throw new ProxyDomainError('OWNER_CONFLICT',refusal.split(rec.code).join(maskSdk(rec.code)??'…'));
    const holder=rec.holderVmId??rec.vmId;
    if(holder&&holder!==input.vmId)throw new ProxyDomainError('OWNER_CONFLICT','SDK '+maskSdk(rec.code)+' đang ở '+await vmLabel(tx,holder)+'; AI chỉ dùng mã trong kho hoặc trong danh sách của chính VM, không lấy mã của VM khác');
    if(rec.revision!==input.expectedSdkRevision)throw conflict('SDK '+maskSdk(rec.code)+' vừa thay đổi; đọc lại (GET sdks) rồi gửi lại',{sdk:{sdkId:rec.id,revision:rec.revision}});
    const previous=await tx.sdkRecord.findUnique({where:{vmId:input.vmId},select:{id:true}});
    const saved=await placeVmSdk(tx,images,current,{vmId:input.vmId,expectedCycle:input.expectedCycle,expectedVmRevision:input.expectedVmRevision,code:rec.code,expectedSdkRevision:input.expectedSdkRevision},{});
    const fresh=await tx.sdkRecord.findUniqueOrThrow({where:{id:rec.id}});
    if(!saved.sdk||saved.sdk.id!==rec.id||fresh.vmId!==input.vmId||fresh.holderVmId!==input.vmId)throw conflict('Web chưa lưu SDK này làm mã hiện hành của VM; đọc lại VM rồi thử lại');
    if(saved.changed)await jobEvent(tx,scope.projectId,current.userId,job,'Dùng SDK trong kho: '+maskSdk(rec.code)+(previous&&previous.id!==rec.id?' (mã cũ vẫn trong danh sách SDK của VM)':''),caller,{sdkId:rec.id});
    const message=saved.changed?'Đã dùng SDK trong kho làm mã hiện hành của VM'+(previous&&previous.id!==rec.id?'; mã cũ vẫn trong danh sách SDK của VM':''):'Giữ nguyên: đã là mã hiện hành của VM';
    return {changed:saved.changed,message,sdk:{id:fresh.id,revision:fresh.revision,linkState:fresh.linkState},maskedCode:maskSdk(fresh.code)};
  },db);
}
// ─── POST vms/{id}/sdk-linked ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface AiSdkLinkInput {key:string;vmId:string;expectedCycle:number;jobId:string;sdkId:string;expectedSdkRevision:number;accountId:string;evidence:string}
/**
 * "Đã nối EarnApp" recorded by the AI: the VM's current SDK linked to the VM's current open EarnApp account (`accountId`), with the
 * existing rules (linkVmSdkIn: VM, round, SDK + revision, account, LINKED is final) plus the caller's own job and an operating note with
 * the evidence in the VM history. Replay answers the first acknowledgement; "already linked to this account" is no change and no note.
 */
export async function linkAiSdk(scope:ActorScope,input:AiSdkLinkInput,db:PrismaClient=prisma,caller:OpsCaller={}){
  const evidence=String(input.evidence??'').trim().slice(0,500);if(!evidence)throw invalid('Ghi căn cứ (evidence): đã đăng nhập / đăng ký EarnApp thành công ở đâu, lúc nào');
  const request={vmId:input.vmId,expectedCycle:input.expectedCycle,jobId:input.jobId,sdkId:input.sdkId,expectedSdkRevision:input.expectedSdkRevision,accountId:input.accountId,evidence};
  return runBusinessCommand(scope,{key:input.key,payload:request,kind:'AI_SDK_LINK',module:'INFRASTRUCTURE',reversible:false},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const job=await ownJob(tx,scope.projectId,current.userId,caller,input.jobId,input.vmId);
    if(job.cycle!==input.expectedCycle)throw cycleChanged(job.cycle);
    const ops=await tx.vmOperation.findUnique({where:{vmId:input.vmId},select:{cycle:true}}),cycle=ops?.cycle??1;
    if(cycle!==input.expectedCycle)throw cycleChanged(cycle);
    const r=await linkSdkForAi(tx,images,current,{vmId:input.vmId,sdkId:input.sdkId,expectedSdkRevision:input.expectedSdkRevision,earnAppId:input.accountId,expectedCycle:input.expectedCycle});
    const sdk=await tx.sdkRecord.findUniqueOrThrow({where:{id:input.sdkId}}),masked=maskSdk(sdk.code)??'…';
    if(r.changed){
      await tx.vmOpsEvent.create({data:{projectId:scope.projectId,vmId:input.vmId,cycle,kind:'NOTE',note:('Đã nối EarnApp (SDK '+masked+'): '+evidence).slice(0,500),detail:{jobId:job.id,sdkId:sdk.id,earnAppId:input.accountId,...(caller.tokenLabel?{token:caller.tokenLabel}:{})},actorId:current.userId}});
      await jobEvent(tx,scope.projectId,current.userId,job,'Ghi SDK '+masked+' đã nối EarnApp',caller,{sdkId:sdk.id,earnAppId:input.accountId});
    }
    return {changed:r.changed,message:r.message.split(sdk.code).join(masked),sdk:{id:sdk.id,revision:sdk.revision,linkState:sdk.linkState},maskedCode:masked};
  },db);
}
