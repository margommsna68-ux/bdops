import type {FleetCommand,Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {withProxyTransaction} from '../proxy-management/transaction';
import {lockCashProject} from '../business-management/cash-lock';
import {businessHash} from '../business-management/idempotency';
import {assertOpsToken,currentOpsAuth} from '../ops-api/context';
import {authorizeVM} from '../vm-management/repository';
import {assertScopedTargets,serverWhere} from '../permissions/server-scope';
import {FleetCreate,FleetClaim,FleetStep,FleetComplete,FleetFence,FleetIdentity,FleetList,FleetControl,FleetAction,FleetNativeAuthorization,READ_ACTIONS,type CreateInput} from './schema';
import type {z} from 'zod';
import {ACTIVE,TERMINAL,LEASE_MS,MAX_EVENTS,requesterAuth,workerAuth,binding,checkFence,conflict,invalid} from './guards';
import {machineUuid} from '../dashboard/scan';
import {assertInfrastructureAction} from '../permissions/infrastructure';
import {currentTelegramDelegation,telegramTransaction,assertTelegramContextCurrent,assertTelegramProof,recordTelegramProof} from './telegram-delegation';

export function commandView(c:FleetCommand){
 const now=new Date(),state=c.state==='DISPATCHED'&&c.leaseUntil&&c.leaseUntil<=now?'UNKNOWN':['QUEUED','CLAIMED'].includes(c.state)&&c.expiresAt<=now?'EXPIRED':c.state;
 return {
 operationId:c.operationId,projectId:c.projectId,serverId:c.serverId,serverUuid:c.serverUuid,vmId:c.vmId,vmCode:c.vmCode,machineUuid:c.machineUuid,
 expectedCycle:c.expectedCycle,expectedVmRevision:c.expectedVmRevision,configurationId:c.configurationId,action:c.action,state,
 createdAt:c.createdAt.toISOString(),expiresAt:c.expiresAt.toISOString(),workerId:c.workerId,leaseEpoch:c.leaseEpoch,leaseUntil:c.leaseUntil?.toISOString()??null,
 dispatchedAt:c.dispatchedAt?.toISOString()??null,cancelRequestedAt:c.cancelRequestedAt?.toISOString()??null,result:c.result,
};}
function publicEvent<T extends {kind:string;detail:Prisma.JsonValue;createdAt:Date}>(e:T){return {...e,detail:e.kind==='TELEGRAM_BINDING'?{delegated:true}:e.detail,createdAt:e.createdAt.toISOString()};}
function dispatchPermit(c:FleetCommand){
 const v=commandView(c);
 return {operationId:v.operationId,projectId:v.projectId,serverId:v.serverId,serverUuid:v.serverUuid,vmId:v.vmId,vmCode:v.vmCode,machineUuid:v.machineUuid,expectedCycle:v.expectedCycle,expectedVmRevision:v.expectedVmRevision,configurationId:v.configurationId,action:v.action,leaseEpoch:v.leaseEpoch,leaseUntil:v.leaseUntil,expiresAt:v.expiresAt};
}
export function nativeCommandHash(p:Omit<ReturnType<typeof dispatchPermit>,'leaseEpoch'|'leaseUntil'>){
 const value={operationId:p.operationId,projectId:p.projectId,serverId:p.serverId,serverUuid:p.serverUuid,vmId:p.vmId,vmCode:p.vmCode,machineUuid:p.machineUuid,expectedCycle:p.expectedCycle,expectedVmRevision:p.expectedVmRevision,configurationId:p.configurationId,action:p.action,expiresAt:p.expiresAt};
 return businessHash(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)));
}
async function transaction<T>(scope:ActorScope,db:PrismaClient,fn:(tx:Prisma.TransactionClient)=>Promise<T>){
 return withProxyTransaction(async tx=>{
  await lockCashProject(tx,scope.projectId);
  if(currentTelegramDelegation())await telegramTransaction(tx,scope);else await assertOpsToken(tx,scope);
  const result=await fn(tx);assertTelegramContextCurrent(tx);return result;
 },db);
}
function project(scope:ActorScope,projectId:string){if(scope.projectId!==projectId)throw new ProxyDomainError('NOT_FOUND');}
async function load(tx:Prisma.TransactionClient,scope:ActorScope,operationId:string,write=false){
 const current=await authorizeVM(scope,write?'ASSIGN':'READ',tx);
 const c=await tx.fleetCommand.findFirst({where:{operationId,projectId:scope.projectId}});if(!c)throw new ProxyDomainError('NOT_FOUND');
 await assertScopedTargets(tx,current,{serverId:c.serverId});
 if(currentTelegramDelegation()){await telegramTransaction(tx,scope,{serverId:c.serverId,vmId:c.vmId});if(c.source==='TELEGRAM')await assertTelegramProof(tx,c);}
 return c;
}
async function eventsCapacity(tx:Prisma.TransactionClient,operationId:string){if(await tx.fleetCommandEvent.count({where:{operationId}})>=MAX_EVENTS)throw conflict('Nhật ký tiến độ đã đủ; dùng hoàn tất / đối soát');}
async function refreshExpired(tx:Prisma.TransactionClient,projectId:string,serverId?:string){
 const now=new Date(),base={projectId,...(serverId?{serverId}:{})};
 await tx.fleetCommand.updateMany({where:{...base,state:{in:['QUEUED','CLAIMED']},expiresAt:{lte:now}},data:{state:'EXPIRED',leaseUntil:null}});
 await tx.fleetCommand.updateMany({where:{...base,state:'DISPATCHED',leaseUntil:{lte:now}},data:{state:'UNKNOWN'}});
}
export async function createFleetCommand(scope:ActorScope,raw:unknown,db:PrismaClient=prisma,caller:{tokenId?:string;source?:'WEB'|'OPS'|'TELEGRAM'}={}){
 const b=FleetCreate.parse(raw);project(scope,b.projectId);
 return transaction(scope,db,async tx=>{
  if(currentTelegramDelegation()&&caller.source!=='TELEGRAM')throw new ProxyDomainError('FORBIDDEN');
  await requesterAuth(tx,{...b,requesterId:scope.userId,requesterTokenId:caller.tokenId??null,source:caller.source},caller.source==='TELEGRAM');
  const hash=businessHash({body:b,requesterId:scope.userId});
  const prior=await tx.fleetCommand.findUnique({where:{operationId:b.operationId}});
  if(prior){if(prior.projectId!==scope.projectId||prior.requesterId!==scope.userId)throw new ProxyDomainError('NOT_FOUND');if(prior.requestHash!==hash)throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');if(caller.source==='TELEGRAM'){if(prior.source!=='TELEGRAM')throw new ProxyDomainError('FORBIDDEN');await assertTelegramProof(tx,prior);}return commandView(prior);}
  const captured=await binding(tx,b);await refreshExpired(tx,scope.projectId,b.serverId);
  if(await tx.fleetCommand.count({where:{projectId:scope.projectId,state:{in:ACTIVE}}})>=1000)throw conflict('Hàng đợi điều khiển đã đầy');
  if(await tx.fleetCommand.findFirst({where:{projectId:scope.projectId,vmId:b.vmId,state:{in:ACTIVE}},select:{operationId:true}}))throw conflict('VM còn lệnh đang chạy / chưa rõ kết quả');
  const c=await tx.fleetCommand.create({data:{operationId:b.operationId,projectId:b.projectId,serverId:b.serverId,vmId:b.vmId,...captured,machineUuid:b.machineUuid,expectedCycle:b.expectedCycle,expectedVmRevision:b.expectedVmRevision,configurationId:b.configurationId,action:b.action,source:caller.source??'WEB',requesterId:scope.userId,requesterTokenId:caller.tokenId??null,requestHash:hash,expiresAt:new Date(Date.now()+b.ttlSeconds*1000)}});
  if(c.source==='TELEGRAM')await recordTelegramProof(tx,c);
  return commandView(c);
 });
}
export async function claimFleetCommand(scope:ActorScope,raw:unknown,db:PrismaClient=prisma){
 const b=FleetClaim.parse(raw);project(scope,b.projectId);
 return transaction(scope,db,async tx=>{
  await workerAuth(tx,scope,b.serverId);await refreshExpired(tx,scope.projectId,b.serverId);const now=new Date();
  const candidates=await tx.fleetCommand.findMany({where:{projectId:scope.projectId,serverId:b.serverId,state:{in:['QUEUED','CLAIMED','UNKNOWN']},OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},orderBy:[{createdAt:'asc'},{operationId:'asc'}],take:50});
  for(const c of candidates){
   const reconciliationOnly=c.state==='UNKNOWN';
   if(!reconciliationOnly){try{await requesterAuth(tx,c);await binding(tx,c,c);}catch(e){if(!(e instanceof ProxyDomainError))throw e;await tx.fleetCommand.update({where:{operationId:c.operationId},data:{state:'REFUSED',leaseUntil:null}});continue;}}
   const claimed=await tx.fleetCommand.update({where:{operationId:c.operationId},data:{state:reconciliationOnly?'UNKNOWN':'CLAIMED',workerId:b.workerId,workerUserId:scope.userId,leaseEpoch:{increment:1},leaseUntil:new Date(now.getTime()+LEASE_MS)}});
   return {command:commandView(claimed),reconciliationOnly};
  }return {command:null,reconciliationOnly:false};
 });
}
export async function renewFleetCommand(scope:ActorScope,raw:unknown,db:PrismaClient=prisma){
 const b=FleetFence.parse(raw);project(scope,b.projectId);
 return transaction(scope,db,async tx=>{const c=await load(tx,scope,b.operationId,true);checkFence(c,b.workerId,scope.userId,b.leaseEpoch);
  if(TERMINAL.includes(c.state))throw conflict();
  if(!c.dispatchedAt){if(c.expiresAt<=new Date()||c.cancelRequestedAt)throw conflict();await requesterAuth(tx,c);await binding(tx,c,c);}
  return commandView(await tx.fleetCommand.update({where:{operationId:c.operationId},data:{leaseUntil:new Date(Date.now()+LEASE_MS)}}));
 });
}
export async function stepFleetCommand(scope:ActorScope,raw:unknown,db:PrismaClient=prisma){
 const b=FleetStep.parse(raw);project(scope,b.projectId);const hash=businessHash(b);
 return transaction(scope,db,async tx=>{
  const c=await load(tx,scope,b.operationId,true);
  const prior=await tx.fleetCommandEvent.findUnique({where:{operationId_eventId:{operationId:b.operationId,eventId:b.stepId}}});
  if(prior){if(prior.kind!==b.phase||prior.requestHash!==hash)throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');checkFence(c,b.workerId,scope.userId,b.leaseEpoch);return {command:commandView(c),permit:null};}
  checkFence(c,b.workerId,scope.userId,b.leaseEpoch);if(TERMINAL.includes(c.state))throw conflict();
  let next=c;
  if(b.phase==='DISPATCH'){
   if(c.state!=='CLAIMED'||c.dispatchedAt||c.cancelRequestedAt||c.expiresAt<=new Date())throw conflict('Không được phát lại lệnh đã gửi / hết hạn / đã yêu cầu huỷ');
   await requesterAuth(tx,c);await binding(tx,c,c);
   next=await tx.fleetCommand.update({where:{operationId:c.operationId},data:{state:'DISPATCHED',dispatchedAt:new Date()}});
  }
  await eventsCapacity(tx,c.operationId);
  await tx.fleetCommandEvent.create({data:{operationId:c.operationId,eventId:b.stepId,kind:b.phase,requestHash:hash,detail:{code:b.code??'RECEIVED',leaseEpoch:b.leaseEpoch}}});
  return {command:commandView(next),permit:b.phase==='DISPATCH'?dispatchPermit(next):null};
 });
}
export async function authorizeNativeFleetCommand(scope:ActorScope,raw:unknown,db:PrismaClient=prisma){
 const b=FleetNativeAuthorization.parse(raw);project(scope,b.projectId);
 // Only an authenticated native backcall using the existing ops worker credential may authorize an effect.
 // This is intentionally absent from tRPC and Telegram. A prior dispatch permit or caller flag is insufficient.
 const nativeAuth=currentOpsAuth();
 if(nativeAuth?.operation!=='VM_OPS')throw new ProxyDomainError('FORBIDDEN','Cần credential worker được xác thực');
 return transaction(scope,db,async tx=>{
  const c=await load(tx,scope,b.operationId,true);await workerAuth(tx,scope,c.serverId);checkFence(c,b.workerId,scope.userId,b.leaseEpoch);
  if(c.state!=='DISPATCHED'||!c.dispatchedAt||c.cancelRequestedAt||c.expiresAt<=new Date())throw conflict('Không còn quyền bắt đầu hiệu ứng native');
  await requesterAuth(tx,c);await binding(tx,c,c);
  const permit=dispatchPermit(c),requestHash=nativeCommandHash(permit);
  if(b.requestHash!==requestHash||b.serverUuid!==c.serverUuid||b.machineUuid!==c.machineUuid||b.action!==c.action||b.expectedCycle!==c.expectedCycle||b.expectedVmRevision!==c.expectedVmRevision||b.configurationId!==c.configurationId)throw invalid('Authorization không khớp lệnh native');
  if(await tx.fleetCommandEvent.findFirst({where:{operationId:c.operationId,kind:'NATIVE_AUTH'},select:{eventId:true}}))throw conflict('Đã cấp authorization native; chỉ đối soát, không cấp lại');
  await eventsCapacity(tx,c.operationId);
  // Both token rows are already locked by assertOpsToken/requesterAuth. Time can
  // still pass during binding reads: proof must not outlive either credential.
  const tokenIds=[...new Set([nativeAuth.tokenId,...(c.requesterTokenId?[c.requesterTokenId]:[])])];
  const tokens=await tx.opsToken.findMany({where:{id:{in:tokenIds}},select:{expiresAt:true}});
  const authorizedAt=new Date();
  if(tokens.length!==tokenIds.length)throw new ProxyDomainError('FORBIDDEN');
  if(tokens.some(t=>t.expiresAt<=authorizedAt))throw new ProxyDomainError('FORBIDDEN','Token đã hết hạn','TOKEN_EXPIRED');
  const validUntil=new Date(Math.min(authorizedAt.getTime()+2000,c.leaseUntil!.getTime(),c.expiresAt.getTime(),...tokens.map(t=>t.expiresAt.getTime())));
  if(validUntil<=authorizedAt)throw conflict();
  await tx.fleetCommandEvent.create({data:{operationId:c.operationId,eventId:b.authorizationId,kind:'NATIVE_AUTH',requestHash:businessHash(b),detail:{requestHash,workerId:b.workerId,leaseEpoch:b.leaseEpoch,authorizedAt:authorizedAt.toISOString(),validUntil:validUntil.toISOString()}}});
  return {authorizationId:b.authorizationId,requestHash,authorizedAt:authorizedAt.toISOString(),validUntil:validUntil.toISOString(),permit};
 });
}
/** What counts as a verified success per action (AE summary codes from the protocol-2 catalogue). */
export function verifiedSuccess(c:Pick<FleetCommand,'action'|'machineUuid'>,e:z.infer<typeof FleetComplete>['evidence']){
 const d=e.detail;
 switch(c.action){
  case 'START_VM':return e.vmState==='RUNNING';
  case 'SHUTDOWN_VM':case 'POWER_OFF_VM':return e.vmState==='POWERED_OFF';
  case 'CHECK_HEALTH':return e.vmState!=='UNKNOWN';
  case 'CHECK_PROXY':return !!d&&['IP_OK','IP_ISSUES','PROXY_POOL','PROXY_ONLINE','PROXY_OFFLINE'].includes(d.code);
  case 'REPLACE_PROXY':return !!d&&d.code==='REPLACED'&&e.vmState==='RUNNING';
  case 'RECREATE_VM':return !!d&&d.code==='RECREATED'&&!!d.newMachineUuid&&d.newMachineUuid!==c.machineUuid;
  case 'READ_SDK':return !!d&&d.code==='DONE'&&!!d.sdkTail;
  default:return false;
 }
}
export async function completeFleetCommand(scope:ActorScope,raw:unknown,db:PrismaClient=prisma){
 const b=FleetComplete.parse(raw);project(scope,b.projectId);const hash=businessHash(b);
 return transaction(scope,db,async tx=>{
  const c=await load(tx,scope,b.operationId,true);
  const prior=await tx.fleetCommandEvent.findUnique({where:{operationId_eventId:{operationId:b.operationId,eventId:b.completionId}}});
  if(prior){if(prior.kind!=='COMPLETE'||prior.requestHash!==hash)throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');if(c.workerId!==b.workerId||c.workerUserId!==scope.userId||c.leaseEpoch!==b.leaseEpoch)throw conflict();return commandView(c);}
  checkFence(c,b.workerId,scope.userId,b.leaseEpoch);
  if(!c.dispatchedAt||!['DISPATCHED','UNKNOWN'].includes(c.state))throw conflict('Chưa có mốc gửi AE; không nhận kết quả thực thi');
  const e=b.evidence,t=Date.parse(e.observedAt);
  if(e.operationId!==c.operationId||e.aeOperationId!==c.operationId||e.machineUuid!==c.machineUuid||t<c.dispatchedAt.getTime()||t>Date.now())throw invalid('Bằng chứng không khớp lệnh / UUID / thời gian');
  if(b.outcome!=='UNKNOWN'&&!e.verified)throw invalid('Kết quả chưa được xác minh');
  if(b.outcome==='UNKNOWN')await eventsCapacity(tx,c.operationId);
  if(b.outcome==='SUCCEEDED'&&!verifiedSuccess(c,e))throw invalid('Bằng chứng không xác minh thành công của lệnh '+c.action);
  const next=await tx.fleetCommand.update({where:{operationId:c.operationId},data:{state:b.outcome,completedAt:b.outcome==='UNKNOWN'?null:new Date(),result:{outcome:b.outcome,evidence:e}}});
  // Completion remains possible when the bounded progress budget is exhausted.
  await tx.fleetCommandEvent.create({data:{operationId:c.operationId,eventId:b.completionId,kind:'COMPLETE',requestHash:hash,detail:{outcome:b.outcome,evidence:e}}});
  return commandView(next);
 });
}
export async function cancelFleetCommand(scope:ActorScope,raw:unknown,db:PrismaClient=prisma){
 const b=FleetIdentity.parse(raw);project(scope,b.projectId);
 return transaction(scope,db,async tx=>{
  const c=await load(tx,scope,b.operationId,true);
  if(c.requesterId!==scope.userId)await authorizeVM(scope,'MANAGE',tx);
  if(TERMINAL.includes(c.state)||c.cancelRequestedAt)return commandView(c);
  const state=c.dispatchedAt?c.state:c.expiresAt<=new Date()?'EXPIRED':'CANCELLED';
  await tx.auditLog.create({data:{projectId:scope.projectId,userId:scope.userId,action:'FLEET_CANCEL',entity:'FleetCommand',entityId:c.operationId,changes:{state,requestedOnly:!!c.dispatchedAt}}});
  return commandView(await tx.fleetCommand.update({where:{operationId:c.operationId},data:{state,cancelRequestedAt:new Date(),...(c.dispatchedAt?{}:{leaseUntil:null})}}));
 });
}
export async function readFleetCommand(scope:ActorScope,raw:unknown,db:PrismaClient=prisma){
 const b=FleetIdentity.parse(raw);project(scope,b.projectId);
 return transaction(scope,db,async tx=>{
  const c=await load(tx,scope,b.operationId),events=await tx.fleetCommandEvent.findMany({where:{operationId:c.operationId},orderBy:[{createdAt:'asc'},{eventId:'asc'}],take:MAX_EVENTS+1,select:{eventId:true,kind:true,detail:true,createdAt:true}});
  return {...commandView(c),events:events.map(publicEvent)};
 });
}
export async function listFleetCommands(scope:ActorScope,raw:unknown,db:PrismaClient=prisma){
 const b=FleetList.parse(raw);project(scope,b.projectId);
 return transaction(scope,db,async tx=>{
  const current=await authorizeVM(scope,'READ',tx);if(b.serverId)await assertScopedTargets(tx,current,{serverId:b.serverId});
  const dual=await telegramTransaction(tx,scope,b.serverId?{serverId:b.serverId}:{});
  const servers=await tx.server.findMany({where:{projectId:scope.projectId,AND:[serverWhere(current),...(dual?[serverWhere(dual.bridgeScope)]:[])],...(b.serverId?{id:b.serverId}:{})},select:{id:true}});
  const items=await tx.fleetCommand.findMany({where:{projectId:scope.projectId,serverId:{in:servers.map(s=>s.id)}},orderBy:[{createdAt:'desc'},{operationId:'asc'}],take:100});return {items:items.map(commandView)};
 });
}

export async function readFleetControl(scope:ActorScope,raw:unknown,db:PrismaClient=prisma){
 const b=FleetControl.parse(raw);project(scope,b.projectId);
 return transaction(scope,db,async tx=>{
  await telegramTransaction(tx,scope,{serverId:b.serverId,vmId:b.vmId});
  const current=await authorizeVM(scope,'READ',tx);await assertScopedTargets(tx,current,{serverId:b.serverId,vmId:b.vmId});
  const vm=await tx.virtualMachine.findFirst({where:{id:b.vmId,serverId:b.serverId,managed:true,server:{projectId:b.projectId,managed:true}},select:{notes:true,revision:true,desiredConfigurationId:true,operation:{select:{cycle:true}}}});
  if(!vm)throw new ProxyDomainError('NOT_FOUND');
  let capability:{binding:Omit<CreateInput,'operationId'|'action'|'ttlSeconds'>;actions:CreateInput['action'][]}|null=null;
  const uuid=machineUuid(vm.notes);
  if(uuid){
   const captured={...b,machineUuid:uuid,expectedCycle:vm.operation?.cycle??1,expectedVmRevision:vm.revision,configurationId:vm.desiredConfigurationId};
   try{
    await binding(tx,captured);
    const actions:CreateInput['action'][]=[];
    for(const action of FleetAction.options){
     try{assertInfrastructureAction(current,READ_ACTIONS.includes(action)?'ASSIGN':'MANAGE');await binding(tx,{...captured,action});actions.push(action);}
     catch(e){if(!(e instanceof ProxyDomainError))throw e;}
    }
    if(actions.length)capability={binding:captured,actions};
   }catch(e){if(!(e instanceof ProxyDomainError))throw e;}
  }
  let assign=false,manage=false;
  try{assertInfrastructureAction(current,'ASSIGN');assign=true;}catch(e){if(!(e instanceof ProxyDomainError))throw e;}
  try{assertInfrastructureAction(current,'MANAGE');manage=true;}catch(e){if(!(e instanceof ProxyDomainError))throw e;}
  const rows=await tx.fleetCommand.findMany({where:{projectId:b.projectId,serverId:b.serverId,vmId:b.vmId},orderBy:[{createdAt:'desc'},{operationId:'asc'}],take:20,include:{events:{orderBy:{createdAt:'desc'},take:5,select:{eventId:true,kind:true,detail:true,createdAt:true}}}});
  return {userId:scope.userId,capability,items:rows.map(c=>({...commandView(c),canCancel:assign&&(manage||c.requesterId===scope.userId)&&!TERMINAL.includes(commandView(c).state)&&!c.cancelRequestedAt,events:c.events.map(publicEvent)}))};
 });
}
