import type {Prisma,PrismaClient,VmJob,VmOpsStatus} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {VM_OPS,opsLabel} from '@/lib/vm-ops';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {decodeEndpoint} from '../proxy-management/repository';
import {runBusinessCommand} from '../business-management/idempotency';
import {loadInfrastructureScope,assertInfrastructureAction} from '../permissions/infrastructure';
import {assertOpsToken} from '../ops-api/context';
import {authorizeVM} from '../vm-management/repository';
import {currentProxyOf,pendingApply} from '../vm-management/proxy-change';
import {saveVmSdk} from '../vm-management/sdk-store';
import {normalizeSdk} from '../vm-management/sdk-parse';
import {blockCurrentProxy,staleCycle} from './ops';
// Work on a real machine by an AI operator / person (owner brief 21/10/2026). MoneyToHome never reaches the machine itself: the operator
// does the work (AE Mini Tool) and records here what it observed, through the same services as the web.
// - A job = one VM taken in hand: kind PREPARE (New VM: create the machine, apply the proxy, install EarnApp + Firefox, record the SDK
//   of this install, check, then "Chưa nối"), PROXY_APPLY (apply the proxy now assigned on the web, check, record the result) or CHECK.
// - At most one ACTIVE job per VM that has not expired; taking it locks the VM's status row, so two operators cannot both take it.
//   An expired job is released; taking the VM again returns the step, machine and SDK of the unfinished attempt (resume), so the
//   operator checks the real machine before doing anything twice. A web key never proves a machine action ran only once.
// - A job's result never overwrites a status somebody else chose after it was taken (statusRevision), never confirms a proxy
//   configuration other than the one it fetched (configurationId) and never finishes a preparation without the SDK of this install.
// - Jobs are not a schedule: they exist only because someone took a VM in hand.
type Tx=Prisma.TransactionClient;
export const JOB_KINDS=['PREPARE','PROXY_APPLY','CHECK'] as const;
export type JobKind=typeof JOB_KINDS[number];
const TTL_DEFAULT=60,TTL_MAX=240,STEP=/^[A-Z][A-Z0-9_]{1,39}$/;
export interface OpsCaller {tokenId?:string|null;tokenLabel?:string|null}
const conflict=(message:string,details?:Record<string,unknown>)=>new ProxyDomainError('STALE_PREVIEW',message,'REVISION_CONFLICT',details);
const invalid=(message:string,details?:Record<string,unknown>)=>new ProxyDomainError('INVALID_INPUT',message,'VALIDATION',details);
const jobVmInclude={server:{select:{code:true,archivedAt:true}},operation:true,desiredConfiguration:{include:{endpoint:true}},installedConfiguration:{include:{endpoint:true}},allocations:{where:{releasedAt:null},select:{endpointId:true,role:true}}} as const;
type JobVm=Prisma.VirtualMachineGetPayload<{include:typeof jobVmInclude}>;
const where=(vm:{code:string;server:{code:string}})=>vm.server.code+' / '+vm.code;
async function loadVm(tx:Tx|PrismaClient,projectId:string,vmId:string):Promise<JobVm>{
  const vm=await tx.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId,managed:true}},include:jobVmInclude});
  if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không thuộc dự án này','NOT_FOUND');
  if(vm.archivedAt||vm.server.archivedAt)throw invalid(where(vm)+' đã xoá khỏi web; không nhận việc');
  return vm;
}
/** The VM's current proxy configuration (the one its current proxy belongs to), or null when it has none / needs review. */
export function currentConfiguration(vm:JobVm){
  const cur=currentProxyOf(vm);if(!cur.endpointId)return {config:null,review:cur.review};
  const c=[vm.desiredConfiguration,vm.installedConfiguration].find(x=>x&&x.endpointId===cur.endpointId)??null;
  return {config:c,review:false};
}
/** The status row of the VM, locked for this transaction (created empty when the VM never had one). */
async function lockOps(tx:Tx,projectId:string,vmId:string){
  await tx.vmOperation.upsert({where:{vmId},create:{projectId,vmId},update:{}});
  await tx.$queryRaw`SELECT "id" FROM "VmOperation" WHERE "vmId"=${vmId} FOR UPDATE`;
  return tx.vmOperation.findUniqueOrThrow({where:{vmId}});
}
async function expire(tx:Tx,vmId:string,now:Date){await tx.vmJob.updateMany({where:{vmId,state:'ACTIVE',expiresAt:{lte:now}},data:{state:'RELEASED',result:'EXPIRED',finishedAt:now}});}
/** The caller's own active job, locked; anything else (expired, released, another operator or token, another VM) is refused. */
async function ownJob(tx:Tx,projectId:string,userId:string,caller:OpsCaller,jobId:string,vmId?:string){
  const [row]=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "VmJob" WHERE "id"=${jobId} AND "projectId"=${projectId} FOR UPDATE`;
  if(!row)throw new ProxyDomainError('NOT_FOUND','Không có việc này trong dự án','NOT_FOUND');
  const job=await tx.vmJob.findUniqueOrThrow({where:{id:jobId}});
  if(vmId&&job.vmId!==vmId)throw invalid('Việc này thuộc VM khác');
  if(job.claimedById!==userId||(job.tokenId??null)!==(caller.tokenId??null))throw new ProxyDomainError('FORBIDDEN','Việc này do người / token khác nhận');
  if(job.state!=='ACTIVE')throw conflict('Việc này đã '+(job.state==='DONE'?'hoàn tất':'được nhả'+(job.result==='EXPIRED'?' (hết hạn)':''))+'; nhận lại VM nếu cần làm tiếp');
  if(job.expiresAt.getTime()<=Date.now()){await tx.vmJob.update({where:{id:job.id},data:{state:'RELEASED',result:'EXPIRED',finishedAt:new Date()}});throw conflict('Việc đã hết hạn; nhận lại VM (kiểm tra máy thật trước khi làm tiếp)');}
  return job;
}
const iso=(d:Date|null|undefined)=>d?d.toISOString():null;
function vmState(vm:JobVm,ops:{cycle:number;status:VmOpsStatus|null;revision:number;proxyPendingConfigId:string|null}|null){
  const {config,review}=currentConfiguration(vm);
  return {vmId:vm.id,code:vm.code,serverCode:vm.server.code,cycle:ops?.cycle??1,status:ops?.status??null,statusLabel:opsLabel(ops?.status??null),statusRevision:ops?.revision??0,
    vmRevision:vm.revision,configurationId:config?.id??null,proxyReview:review,pendingConfigurationId:pendingApply({desiredConfigurationId:vm.desiredConfigurationId,operation:ops?{proxyPendingConfigId:ops.proxyPendingConfigId}:null})};
}
export function jobView(job:VmJob,extra:{sdkCode?:string|null}={}){
  return {id:job.id,vmId:job.vmId,cycle:job.cycle,kind:job.kind,state:job.state,claimedAt:job.claimedAt.toISOString(),expiresAt:job.expiresAt.toISOString(),step:job.step,stepNote:job.stepNote,stepAt:iso(job.stepAt),
    machineRef:job.machineRef,configurationId:job.configurationId,sdkId:job.sdkId,sdkCode:extra.sdkCode??null,resumeOf:job.resumeOf,result:job.result,finishedAt:iso(job.finishedAt),statusRevision:job.statusRevision};
}
async function jobEvent(tx:Tx,projectId:string,actorId:string,job:{vmId:string;cycle:number;id:string;kind:string},note:string,caller:OpsCaller,detail:Record<string,unknown>={}){
  await tx.vmOpsEvent.create({data:{projectId,vmId:job.vmId,cycle:job.cycle,kind:'JOB',note:note.slice(0,500),detail:{jobId:job.id,jobKind:job.kind,...(caller.tokenLabel?{token:caller.tokenLabel}:{}),...detail} as Prisma.InputJsonValue,actorId}});
}
// ─── Take / step / release ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function claimVmJob(scope:ActorScope,input:{key:string;vmId:string;expectedCycle:number;kind:JobKind;ttlMinutes?:number|null},db:PrismaClient=prisma,caller:OpsCaller={}){
  if(!JOB_KINDS.includes(input.kind))throw invalid('Loại việc không hợp lệ');
  const ttl=Math.min(TTL_MAX,Math.max(5,Math.floor(input.ttlMinutes??TTL_DEFAULT)));
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_JOB_CLAIM',module:'INFRASTRUCTURE',reversible:false},async(tx,_images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const vm=await loadVm(tx,scope.projectId,input.vmId),ops=await lockOps(tx,scope.projectId,vm.id),now=new Date();
    if(ops.cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(ops.cycle),'CYCLE_CHANGED');
    const state=vmState(vm,ops);
    if(input.kind==='PREPARE'&&ops.status!=='NEW_VM')throw conflict(where(vm)+' đang '+opsLabel(ops.status)+', không phải New VM; không nhận việc chuẩn bị máy mới');
    if(input.kind==='PROXY_APPLY'&&!state.pendingConfigurationId&&ops.status!=='PROXY_PENDING')throw conflict(where(vm)+' không có proxy mới chờ áp dụng');
    await expire(tx,vm.id,now);
    const active=await tx.vmJob.findFirst({where:{vmId:vm.id,state:'ACTIVE'}});
    if(active){
      const mine=active.claimedById===current.userId&&(active.tokenId??null)===(caller.tokenId??null);
      if(!mine||active.kind!==input.kind||active.cycle!==ops.cycle)throw conflict(where(vm)+' đang có việc '+active.kind+' của '+(mine?'chính bạn (loại khác)':'người / AI khác')+' đến '+active.expiresAt.toISOString()+'; không nhận chồng',{busy:{kind:active.kind,expiresAt:active.expiresAt.toISOString(),mine}});
      const kept=await tx.vmJob.update({where:{id:active.id},data:{expiresAt:new Date(now.getTime()+ttl*60000),revision:{increment:1}}});
      return {job:jobView(kept),vm:state,resumed:false,already:true};
    }
    // The unfinished attempt of the same kind in this round (released / expired): its step, machine and SDK come back for the check.
    const prev=await tx.vmJob.findFirst({where:{vmId:vm.id,cycle:ops.cycle,kind:input.kind,state:'RELEASED'},orderBy:{claimedAt:'desc'}});
    const resume=prev&&!(await tx.vmJob.findFirst({where:{vmId:vm.id,cycle:ops.cycle,kind:input.kind,state:'DONE',claimedAt:{gt:prev.claimedAt}},select:{id:true}}))?prev:null;
    const job=await tx.vmJob.create({data:{projectId:scope.projectId,vmId:vm.id,cycle:ops.cycle,kind:input.kind,claimedById:current.userId,tokenId:caller.tokenId??null,claimedAt:now,expiresAt:new Date(now.getTime()+ttl*60000),statusRevision:ops.revision,
      ...(resume?{resumeOf:resume.resumeOf??resume.id,step:resume.step,stepNote:resume.stepNote,stepAt:resume.stepAt,machineRef:resume.machineRef,sdkId:resume.sdkId,configurationId:resume.configurationId}:{})}});
    await jobEvent(tx,scope.projectId,current.userId,job,'Nhận việc '+job.kind+(resume?' (tiếp tục lần làm dở: bước '+(resume.step??'—')+(resume.machineRef?', máy '+resume.machineRef:'')+')':''),caller);
    const sdk=job.sdkId?await tx.sdkRecord.findUnique({where:{id:job.sdkId},select:{code:true}}):null;
    return {job:jobView(job,{sdkCode:sdk?.code}),vm:state,resumed:!!resume,already:false};
  },db);
}
export async function stepVmJob(scope:ActorScope,input:{key:string;jobId:string;step:string;note?:string|null;machineRef?:string|null;ttlMinutes?:number|null},db:PrismaClient=prisma,caller:OpsCaller={}){
  if(!STEP.test(input.step))throw invalid('Bước viết HOA, chữ / số / _ (ví dụ MACHINE_CREATED, SDK_SAVED, BLOCKED_ON)');
  if(input.machineRef!=null&&!/^[\w .:#@()\/-]{1,120}$/.test(input.machineRef))throw invalid('Tên máy không hợp lệ (tối đa 120 ký tự)');
  const ttl=Math.min(TTL_MAX,Math.max(5,Math.floor(input.ttlMinutes??TTL_DEFAULT)));
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_JOB_STEP',module:'INFRASTRUCTURE',reversible:false},async(tx,_images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const job=await ownJob(tx,scope.projectId,current.userId,caller,input.jobId),now=new Date();
    // The machine of a job is fixed once known: a different one means another machine, never silently swapped.
    if(input.machineRef&&job.machineRef&&job.machineRef!==input.machineRef)throw conflict('Việc này đã ghi máy '+job.machineRef+'; không đổi sang máy khác. Kiểm tra máy thật, báo cần kiểm tra nếu không chắc');
    const updated=await tx.vmJob.update({where:{id:job.id},data:{step:input.step,stepNote:input.note?.trim().slice(0,500)||null,stepAt:now,expiresAt:new Date(now.getTime()+ttl*60000),...(input.machineRef?{machineRef:input.machineRef}:{}),revision:{increment:1}}});
    await jobEvent(tx,scope.projectId,current.userId,job,'Bước '+input.step+(input.note?.trim()?': '+input.note.trim():''),caller,input.machineRef?{machineRef:input.machineRef}:{});
    return {job:jobView(updated)};
  },db);
}
export async function releaseVmJob(scope:ActorScope,input:{key:string;jobId:string;note?:string|null},db:PrismaClient=prisma,caller:OpsCaller={}){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_JOB_RELEASE',module:'INFRASTRUCTURE',reversible:false},async(tx,_images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const job=await ownJob(tx,scope.projectId,current.userId,caller,input.jobId),now=new Date();
    const updated=await tx.vmJob.update({where:{id:job.id},data:{state:'RELEASED',result:'RELEASED',finishedAt:now,stepNote:input.note?.trim().slice(0,500)||job.stepNote,revision:{increment:1}}});
    await jobEvent(tx,scope.projectId,current.userId,job,'Nhả việc ở bước '+(job.step??'—')+(input.note?.trim()?': '+input.note.trim():''),caller);
    return {job:jobView(updated)};
  },db);
}
// ─── Full proxy of the VM in hand ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The full proxy (IP:port:user:pass) of the current configuration of the one VM the caller has an active job on: right
 * VM_PROXY_FOR_OPS (or ADMIN), never another VM, never the registry. The configuration is remembered on the job (what may later be
 * confirmed as applied) and the read is audited without the credentials.
 */
export async function proxyForJob(scope:ActorScope,input:{vmId:string;jobId:string;expectedCycle:number},db:PrismaClient=prisma,caller:OpsCaller={}){
  return db.$transaction(async tx=>{
    const current=await loadInfrastructureScope(tx,scope.userId,scope.projectId);assertInfrastructureAction(current,'ASSIGN');
    if(current.businessMode!=='PROXY_VM')throw new ProxyDomainError('FORBIDDEN');
    if(current.role!=='ADMIN'&&!current.capabilities.includes('VM_PROXY_FOR_OPS'))throw new ProxyDomainError('FORBIDDEN','Cần quyền "Lấy proxy của VM đang xử lý (AI)"');
    await assertOpsToken(tx,scope);
    const job=await ownJob(tx,scope.projectId,current.userId,caller,input.jobId,input.vmId);
    const vm=await loadVm(tx,scope.projectId,input.vmId),cycle=vm.operation?.cycle??1;
    if(cycle!==input.expectedCycle||job.cycle!==cycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle),'CYCLE_CHANGED');
    const {config,review}=currentConfiguration(vm);
    if(!config?.endpoint)throw conflict(review?where(vm)+' có proxy cần đối chiếu; chủ chọn proxy đang dùng ở ô Proxy trước':where(vm)+' chưa được gán proxy trên web');
    const p=decodeEndpoint(config.endpoint);
    if(!p||p.format!=='FULL')throw conflict('Proxy của '+where(vm)+' chưa đủ IP:port:user:pass');
    await tx.vmJob.update({where:{id:job.id},data:{configurationId:config.id,revision:{increment:1}}});
    await tx.auditLog.create({data:{projectId:scope.projectId,userId:current.userId,action:'VM_PROXY_FOR_OPS',entity:'VirtualMachine',entityId:vm.id,changes:{jobId:job.id,endpointId:config.endpointId,configurationId:config.id,host:config.endpoint.host,port:config.endpoint.port,...(caller.tokenLabel?{token:caller.tokenLabel}:{})}}});
    return {vmId:vm.id,cycle,configurationId:config.id,endpointId:config.endpointId,proxy:{host:p.ip,port:p.port,username:p.username,password:p.password}};
  });
}
// ─── SDK of this install ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Record the SDK read from the machine for the VM in hand: the shared SDK service makes it the VM's current code and puts it in its list
 * (codes of another VM, used or unconfirmed codes are refused as on the web). A code already stored on the web before this attempt
 * started is not the SDK of this install and is refused; the same code again is a read-back (nothing new written).
 */
export async function recordJobSdk(scope:ActorScope,input:{key:string;vmId:string;jobId:string;expectedCycle:number;expectedVmRevision:number;code:string},db:PrismaClient=prisma,caller:OpsCaller={}){
  const code=normalizeSdk(input.code);if(!code)throw invalid('Mã SDK không hợp lệ (8–128 ký tự chữ/số/._:-)');
  const pre=await db.$transaction(async tx=>{
    const job=await ownJob(tx,scope.projectId,scope.userId,caller,input.jobId,input.vmId);
    const start=job.resumeOf?(await tx.vmJob.findUnique({where:{id:job.resumeOf},select:{claimedAt:true}}))?.claimedAt??job.claimedAt:job.claimedAt;
    const existing=await tx.sdkRecord.findFirst({where:{projectId:scope.projectId,code}});
    if(existing&&existing.createdAt<start&&existing.id!==job.sdkId)throw invalid('SDK '+code+' đã có trên web từ trước lần cài này; mỗi lần cài EarnApp phải ghi SDK mới lấy từ máy');
    return {existing};
  });
  const saved=await saveVmSdk(scope,{key:input.key,vmId:input.vmId,expectedCycle:input.expectedCycle,expectedVmRevision:input.expectedVmRevision,code,expectedSdkRevision:pre.existing&&pre.existing.vmId===input.vmId?pre.existing.revision:null},db);
  const sdk=(saved as {sdk?:{id:string;code:string;revision:number}|null}).sdk;
  if(!sdk||sdk.code!==code)throw conflict('Web chưa lưu SDK '+code+' làm mã hiện hành của VM; đọc lại VM rồi thử lại');
  return db.$transaction(async tx=>{
    const job=await ownJob(tx,scope.projectId,scope.userId,caller,input.jobId,input.vmId);
    const fresh=await tx.sdkRecord.findUniqueOrThrow({where:{id:sdk.id}});
    if(fresh.vmId!==input.vmId||fresh.holderVmId!==input.vmId)throw conflict('SDK '+code+' không còn là mã hiện hành của VM; đọc lại');
    const same=job.sdkId===sdk.id;
    if(!same){await tx.vmJob.update({where:{id:job.id},data:{sdkId:sdk.id,revision:{increment:1}}});await jobEvent(tx,scope.projectId,scope.userId,job,'Ghi SDK của lần cài này: '+code,caller,{sdkId:sdk.id});}
    return {changed:!!(saved as {changed?:boolean}).changed,readBack:same,sdk:{id:fresh.id,code:fresh.code,revision:fresh.revision,linkState:fresh.linkState,current:true,inList:true},jobId:job.id};
  });
}
// ─── Finish ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PrepareChecks {machine:boolean;proxy:boolean;internet:boolean;earnapp:boolean;firefox:boolean}
const CHECK_LABEL:Record<keyof PrepareChecks,string>={machine:'máy chạy',proxy:'máy dùng đúng proxy',internet:'internet qua proxy',earnapp:'EarnApp chạy',firefox:'Firefox cài xong'};
/**
 * New VM → Chưa nối, only when: the job is the caller's PREPARE job of the current round, the VM is still New VM and its status was not
 * changed by someone else since it was taken, the SDK recorded in this attempt is the VM's current code (in its list, unused), the
 * proxy applied is the VM's current configuration and the one the job fetched, and every check passed. Otherwise New VM stays and the
 * reason comes back; the job stays open to finish later.
 */
export async function finishPrepareJob(scope:ActorScope,input:{key:string;jobId:string;configurationId:string;checks:PrepareChecks;note?:string|null},db:PrismaClient=prisma,caller:OpsCaller={}){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_PREPARE_DONE',module:'INFRASTRUCTURE',reversible:false},async(tx,_images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const job=await ownJob(tx,scope.projectId,current.userId,caller,input.jobId);
    if(job.kind!=='PREPARE')throw invalid('Việc này không phải chuẩn bị New VM');
    const vm=await loadVm(tx,scope.projectId,job.vmId),ops=await lockOps(tx,scope.projectId,vm.id);
    if(ops.cycle!==job.cycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(ops.cycle),'CYCLE_CHANGED');
    if(ops.status!=='NEW_VM'||ops.revision!==job.statusRevision)throw conflict('Tình trạng đã đổi thành '+opsLabel(ops.status)+' sau khi nhận việc; không ghi đè');
    const missing=(Object.keys(CHECK_LABEL) as (keyof PrepareChecks)[]).filter(k=>input.checks?.[k]!==true);
    if(missing.length)throw invalid('Chưa đạt: '+missing.map(k=>CHECK_LABEL[k]).join(', ')+'; giữ New VM. Ghi bước đang vướng rồi xử lý tiếp',{failed:missing});
    const sdk=job.sdkId?await tx.sdkRecord.findUnique({where:{id:job.sdkId}}):null;
    if(!sdk||sdk.vmId!==vm.id||sdk.holderVmId!==vm.id||sdk.linkState!=='UNLINKED')throw invalid('Chưa có SDK của lần cài này được lưu làm mã hiện hành của VM; ghi SDK (vms/{id}/sdk) và đọc lại trước khi hoàn tất. Giữ New VM');
    const {config}=currentConfiguration(vm);
    if(!config)throw invalid(where(vm)+' chưa có proxy hiện hành trên web');
    if(config.id!==input.configurationId||job.configurationId!==config.id)throw conflict('Proxy trên web đã đổi (hoặc chưa lấy proxy cho việc này); lấy proxy mới, áp dụng lên máy rồi hoàn tất',{currentConfigurationId:config.id});
    const now=new Date();
    await tx.vmOperation.update({where:{id:ops.id},data:{status:'NOT_LINKED',statusAt:now,statusById:current.userId,revision:{increment:1},proxyAppliedConfigId:config.id,proxyAppliedAt:now,proxyAppliedById:current.userId,
      ...(ops.proxyPendingConfigId===config.id||!pendingApply({desiredConfigurationId:vm.desiredConfigurationId,operation:ops})?{proxyPendingConfigId:null,proxyPendingAt:null}:{})}});
    await tx.vmOpsEvent.create({data:{projectId:scope.projectId,vmId:vm.id,cycle:ops.cycle,kind:'STATUS',fromStatus:'NEW_VM',toStatus:'NOT_LINKED',note:('Chuẩn bị xong: SDK '+sdk.code+', proxy '+config.endpoint!.host+(input.note?.trim()?' · '+input.note.trim():'')).slice(0,500),detail:{jobId:job.id,machineRef:job.machineRef,checks:input.checks as unknown as Prisma.InputJsonValue,...(caller.tokenLabel?{token:caller.tokenLabel}:{})},actorId:current.userId}});
    const done=await tx.vmJob.update({where:{id:job.id},data:{state:'DONE',result:'NOT_LINKED',finishedAt:now,step:'DONE',stepAt:now,revision:{increment:1}}});
    return {job:jobView(done,{sdkCode:sdk.code}),recorded:{vmId:vm.id,cycle:ops.cycle,status:'NOT_LINKED',statusLabel:VM_OPS.NOT_LINKED.label,sdkCode:sdk.code,configurationId:config.id,machineRef:job.machineRef}};
  },db);
}
export const APPLY_RESULTS=['OK','NOT_LINKED','EARN_ERROR','PROXY_BLOCKED'] as const;
const KEEP_ON_APPLY:VmOpsStatus[]=['OFF','SUSPENDED','DELETED','MAIL_LOGGED','NEW_VM'];
/**
 * The proxy now assigned on the web was applied on the machine and checked: the apply mark goes; the status becomes the observed result
 * when the VM was waiting for it (Chờ áp dụng proxy / Blocked / a working status), never over OFF / SUS / VM deleted / Đã login mail /
 * New VM, never over a status chosen by someone else after the job was taken, and never for a configuration other than the current one
 * (the owner replaced the proxy again meanwhile → refused). PROXY_BLOCKED reports the CURRENT proxy blocked (same rule as the web).
 */
export async function finishProxyJob(scope:ActorScope,input:{key:string;jobId:string;configurationId:string;result:typeof APPLY_RESULTS[number];note?:string|null},db:PrismaClient=prisma,caller:OpsCaller={}){
  if(!APPLY_RESULTS.includes(input.result))throw invalid('Kết quả phải là OK, NOT_LINKED, EARN_ERROR hoặc PROXY_BLOCKED');
  if((input.result==='EARN_ERROR'||input.result==='PROXY_BLOCKED')&&!input.note?.trim())throw invalid('Ghi lý do / căn cứ khi không đạt');
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_PROXY_APPLIED',module:'INFRASTRUCTURE',reversible:false},async(tx,images,current)=>{
    const infra=await authorizeVM(current,'ASSIGN',tx);
    const job=await ownJob(tx,scope.projectId,current.userId,caller,input.jobId);
    if(job.kind!=='PROXY_APPLY'&&job.kind!=='CHECK')throw invalid('Việc chuẩn bị New VM kết thúc bằng finish-prepare');
    const vm=await loadVm(tx,scope.projectId,job.vmId),ops=await lockOps(tx,scope.projectId,vm.id);
    if(ops.cycle!==job.cycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(ops.cycle),'CYCLE_CHANGED');
    if(ops.revision!==job.statusRevision)throw conflict('Tình trạng đã đổi thành '+opsLabel(ops.status)+' sau khi nhận việc; không ghi đè');
    const {config}=currentConfiguration(vm);
    if(!config||config.id!==input.configurationId||job.configurationId!==config.id)throw conflict('Proxy trên web đã đổi sau khi lấy (hoặc chưa lấy proxy cho việc này); kết quả lần trước không xác nhận cấu hình mới. Lấy proxy mới và làm lại',{currentConfigurationId:config?.id??null});
    const now=new Date(),was=ops.status;let status:VmOpsStatus|null=was,message:string;
    if(input.result==='PROXY_BLOCKED'){
      const r=await blockCurrentProxy(tx,images,{projectId:scope.projectId,actorId:current.userId,now,canBlock:(()=>{try{assertInfrastructureAction(infra,'BLOCK');return true;}catch{return false;}})()},vm,config.endpointId,input.note??null);
      if(r.outcome==='ERROR')throw invalid(r.message);status=r.status;message=r.message;
    }else if(was&&KEEP_ON_APPLY.includes(was)){message='Đã áp dụng proxy; giữ tình trạng '+opsLabel(was);}
    else{
      status=input.result;message=opsLabel(was)+' → '+VM_OPS[input.result].label;
      if(was!==input.result){
        await tx.vmOperation.update({where:{id:ops.id},data:{status:input.result,statusAt:now,statusById:current.userId,blockedFrom:null,blockedFromKnown:false,blockedEndpointId:null,blockedCycle:null,blockedAt:null,revision:{increment:1}}});
        await tx.vmOpsEvent.create({data:{projectId:scope.projectId,vmId:vm.id,cycle:ops.cycle,kind:'STATUS',fromStatus:was,toStatus:input.result,note:('Đã áp dụng proxy '+config.endpoint!.host+' trên máy'+(input.note?.trim()?' · '+input.note.trim():'')).slice(0,500),detail:{jobId:job.id,...(caller.tokenLabel?{token:caller.tokenLabel}:{})},actorId:current.userId}});
      }
    }
    // Applied on the machine (also when it then turned out blocked): the apply mark of this configuration goes.
    await tx.vmOperation.update({where:{id:ops.id},data:{proxyAppliedConfigId:config.id,proxyAppliedAt:now,proxyAppliedById:current.userId,...(ops.proxyPendingConfigId===config.id?{proxyPendingConfigId:null,proxyPendingAt:null}:{})}});
    const done=await tx.vmJob.update({where:{id:job.id},data:{state:'DONE',result:input.result,finishedAt:now,step:'DONE',stepAt:now,revision:{increment:1}}});
    await jobEvent(tx,scope.projectId,current.userId,job,'Áp dụng proxy xong: '+message,caller);
    return {job:jobView(done),recorded:{vmId:vm.id,cycle:ops.cycle,result:input.result,status,statusLabel:opsLabel(status),configurationId:config.id,message}};
  },db);
}
// ─── Notes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** An operating note in the VM history (who, token, when); the owner's VM note is never touched. */
export async function addVmOpsNote(scope:ActorScope,input:{key:string;vmId:string;expectedCycle:number;note:string;jobId?:string|null},db:PrismaClient=prisma,caller:OpsCaller={},redact:(t:string)=>string=t=>t){
  const note=redact(String(input.note??'').trim()).slice(0,500);if(!note)throw invalid('Ghi chú trống');
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_OPS_NOTE',module:'INFRASTRUCTURE',reversible:false},async(tx,_images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const vm=await loadVm(tx,scope.projectId,input.vmId),cycle=vm.operation?.cycle??1;
    if(cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle),'CYCLE_CHANGED');
    const ev=await tx.vmOpsEvent.create({data:{projectId:scope.projectId,vmId:vm.id,cycle,kind:'NOTE',note,detail:{...(input.jobId?{jobId:input.jobId}:{}),...(caller.tokenLabel?{token:caller.tokenLabel}:{})},actorId:current.userId}});
    return {recorded:{noteId:ev.id,vmId:vm.id,cycle,note,recordedAt:ev.createdAt.toISOString()}};
  },db);
}
/** Active (unexpired) jobs of the given VMs, for the Server / VM table. */
export async function activeJobs(db:PrismaClient|Tx,projectId:string,vmIds:string[]){
  if(!vmIds.length)return new Map<string,{kind:string;expiresAt:string;step:string|null;by:string|null;token:string|null}>();
  const rows=await db.vmJob.findMany({where:{projectId,vmId:{in:vmIds},state:'ACTIVE',expiresAt:{gt:new Date()}}});
  const users=await db.user.findMany({where:{id:{in:Array.from(new Set(rows.map(r=>r.claimedById)))}},select:{id:true,name:true,username:true}});
  const tokens=await db.opsToken.findMany({where:{id:{in:rows.map(r=>r.tokenId).filter((x):x is string=>!!x)}},select:{id:true,name:true}});
  return new Map(rows.map(r=>[r.vmId,{kind:r.kind,expiresAt:r.expiresAt.toISOString(),step:r.step,by:(()=>{const u=users.find(u=>u.id===r.claimedById);return u?u.name||u.username:null;})(),token:tokens.find(t=>t.id===r.tokenId)?.name??null}]));
}
