import type {Prisma,VmOpsStatus} from '@prisma/client';
import {encrypt} from '@/lib/encryption';
import {decodeEndpoint} from '../proxy-management/repository';
import {syncAssignmentState} from '../proxy-management/assignment-state';
import {ProxyDomainError} from '../proxy-management/types';
import type {ResourceImage} from '../operation-history/snapshot';
import {vmHash,type ConfigurationSnapshot} from './types';
import {VM_OPS} from '@/lib/vm-ops';
// Owner decision 19/10/2026 (REPLACES the install-confirmation flow): assigning a proxy to a VM records the proxy the VM uses on the
// web. There is no "start install" / "confirm installed" step any more; the VM's current proxy is its assigned (desired) configuration,
// or, for older data, its single confirmed one. Older install data stays as history; nothing is back-filled as "installed".
// Every way of changing a VM's proxy goes through assignProxyToVm, inside the caller's transaction: the Server/VM cell, Dán bảng,
// the registry, a provider replacement received in Kho proxy, and a recreation that keeps the proxy.
type Tx=Prisma.TransactionClient;
export interface Collector {remember:(resource:ResourceImage['resource'],id:string,created?:boolean)=>Promise<void>}
export interface ChangeCtx {projectId:string;actorId:string;now:Date;via:string}
const vmInclude={server:true,desiredConfiguration:{include:{endpoint:true}},installedConfiguration:{include:{endpoint:true}},allocations:{where:{releasedAt:null},include:{endpoint:true}},operation:true} as const;
export type ChangeVM=Prisma.VirtualMachineGetPayload<{include:typeof vmInclude}>;
export const loadChangeVM=(tx:Tx,vmId:string)=>tx.virtualMachine.findUniqueOrThrow({where:{id:vmId},include:vmInclude});
const label=(e:{host:string|null;port:number|null}|null|undefined)=>e?e.host+(e.port?':'+e.port:''):'—';
/**
 * The proxy a VM uses now. One clear position (an assigned configuration, or only a confirmed one, with no other hold) is the current
 * proxy. An assigned configuration next to a different confirmed one, or a "Giữ để kiểm tra" hold, is kept for review: the web never
 * guesses which one is in use.
 */
export function currentProxyOf(vm:{desiredConfiguration:{endpointId:string|null}|null;installedConfiguration:{endpointId:string|null}|null;allocations:{endpointId:string;role:string}[]}){
  const d=vm.desiredConfiguration?.endpointId??null,i=vm.installedConfiguration?.endpointId??null,uncertain=vm.allocations.filter(a=>a.role==='UNCERTAIN').map(a=>a.endpointId);
  const ids=Array.from(new Set([d,i,...uncertain].filter((x):x is string=>!!x)));
  if(!ids.length)return {endpointId:null as string|null,review:false,candidates:[] as string[]};
  if(ids.length===1&&!uncertain.length)return {endpointId:ids[0],review:false,candidates:ids};
  return {endpointId:null,review:true,candidates:ids};
}
async function event(tx:Tx,ctx:ChangeCtx,endpoint:{id:string;identityId:string|null;host:string|null},kind:'ASSIGNED'|'RELEASED',reason:string){
  if(!endpoint.identityId||!endpoint.host)return;
  await tx.proxyStatusEvent.create({data:{projectId:ctx.projectId,identityId:endpoint.identityId,endpointId:endpoint.id,ip:endpoint.host,kind,occurredAt:ctx.now,actorId:ctx.actorId,reason:reason.slice(0,300)}});
}
/**
 * Make `endpointId` the current proxy of the VM in one step: every other position of the VM is released (a released good proxy goes
 * back to stock by the NEW / LIVE rule, a BLOCKED one stays BLOCKED for the provider), the chosen proxy gets a fresh assigned
 * configuration and becomes LIVE. Choosing the current proxy again writes nothing. The caller has checked rights, project, revisions
 * and that the proxy may be placed (eligibility, not held by another VM). SDK, EarnApp, PayPal and the VM round are never touched.
 * The VM status set "Blocked" for one of the released proxies is restored (restoreAfterBlocked).
 */
export async function assignProxyToVm(tx:Tx,images:Collector,ctx:ChangeCtx,vmId:string,endpointId:string){
  const vm=await loadChangeVM(tx,vmId),cur=currentProxyOf(vm);
  if(cur.endpointId===endpointId)return {changed:false,from:[] as string[],vm};
  const endpoint=await tx.proxyIP.findFirstOrThrow({where:{id:endpointId,projectId:ctx.projectId}}),proxy=decodeEndpoint(endpoint);
  if(!proxy||proxy.format!=='FULL'||!endpoint.inventoryKey||!endpoint.identityId)throw new ProxyDomainError('INVALID_INPUT','Proxy chưa đủ điều kiện (cần đủ IP:port:user:pass)');
  await images.remember('VM',vm.id);await images.remember('ENDPOINT',endpoint.id);
  const here=vm.server.code+'/'+vm.code,from=cur.candidates.filter(id=>id!==endpointId);
  // Keep the chosen proxy's assigned configuration when it already is the VM's one (an older confirmed copy is released).
  const keep=vm.desiredConfiguration?.endpointId===endpointId?vm.desiredConfiguration:null;
  for(const hold of vm.allocations){
    if(keep&&hold.configurationId===keep.id)continue;
    await images.remember('VM_ALLOCATION',hold.id);await images.remember('ENDPOINT',hold.endpointId);
    await tx.vMProxyAllocation.update({where:{id:hold.id},data:{releasedAt:ctx.now,releaseReason:'Thay proxy · '+ctx.via,revision:{increment:1}}});
    await tx.proxyIP.update({where:{id:hold.endpointId},data:{revision:{increment:1}}});
    await syncAssignmentState(tx,hold.endpointId,{released:true});
    if(hold.endpointId!==endpointId)await event(tx,ctx,hold.endpoint,'RELEASED','Rời '+here+' (thay bằng '+label(endpoint)+')');
  }
  // Configurations stay as history: an unfinished plan is cancelled, a confirmed one keeps its status.
  const old=vm.desiredConfiguration;
  if(old&&!keep&&old.id!==vm.installedConfigurationId){await images.remember('VM_CONFIG',old.id);await tx.vMConfiguration.update({where:{id:old.id},data:{status:'CANCELLED',revision:{increment:1}}});}
  for(const task of await tx.vMTask.findMany({where:{vmId:vm.id,status:{in:['PENDING','IN_PROGRESS']}}})){await images.remember('VM_TASK',task.id);await tx.vMTask.update({where:{id:task.id},data:{status:'CANCELLED'}});}
  let configId=keep?.id??null;
  if(!keep){
    const snapshot:ConfigurationSnapshot={proxy,packageCode:endpoint.packageCode,identityId:endpoint.identityId,endpointRevision:endpoint.revision,server:vm.server.code,vm:vm.code};
    const config=await tx.vMConfiguration.create({data:{projectId:ctx.projectId,vmId:vm.id,version:vm.configurationSequence+1,endpointId:endpoint.id,snapshotCipher:encrypt(JSON.stringify(snapshot)),configurationHash:vmHash(snapshot),createdById:ctx.actorId}});
    await images.remember('VM_CONFIG',config.id,true);configId=config.id;
    const hold=await tx.vMProxyAllocation.create({data:{projectId:ctx.projectId,vmId:vm.id,endpointId:endpoint.id,configurationId:config.id,allocationKey:endpoint.inventoryKey,role:'DESIRED',createdById:ctx.actorId}});
    await images.remember('VM_ALLOCATION',hold.id,true);
  }
  await tx.virtualMachine.update({where:{id:vm.id},data:{desiredConfigurationId:configId,installedConfigurationId:null,proxyId:null,proxySlotState:'FULL',...(keep?{}:{configurationSequence:{increment:1}}),revision:{increment:1}}});
  await tx.proxyIP.update({where:{id:endpoint.id},data:{revision:{increment:1}}});await syncAssignmentState(tx,endpoint.id);
  await event(tx,ctx,endpoint,'ASSIGNED','Dùng cho '+here+(from.length?' (thay '+from.length+' proxy cũ)':''));
  await restoreAfterBlocked(tx,images,ctx,vm,from);
  return {changed:true,from,vm};
}
// ─── Blocked and the VM status (owner decision 19/10/2026) ────────────────────────────────────────────────────────────────────
// A proxy reported BLOCKED (in Kho proxy or by choosing "Blocked" at the VM) sets the VM using it to "Blocked" and remembers the
// status before it, for that VM, round and proxy. Replacing the proxy brings the remembered status back, only while the VM still
// carries the Blocked of that same proxy and round; a status chosen by a person meanwhile is kept. SUS / OFF VM / Earn-VM lỗi /
// VM deleted are never overwritten by Blocked (the proxy cell still shows it).
const KEEP:VmOpsStatus[]=['SUSPENDED','OFF','EARN_ERROR','DELETED'];
const opsLabel=(s:VmOpsStatus|null|undefined)=>s?VM_OPS[s].label:'Chưa ghi';
async function ensureOps(tx:Tx,images:Collector,projectId:string,vmId:string){
  const row=await tx.vmOperation.findUnique({where:{vmId}});if(row){await images.remember('VM_OPS',row.id);return row;}
  const created=await tx.vmOperation.create({data:{projectId,vmId}});await images.remember('VM_OPS',created.id,true);return created;
}
/** Set "Blocked" on the VM that uses `endpointId` (its current proxy), remembering the status before it. Returns what happened. */
export async function markVmBlocked(tx:Tx,images:Collector,ctx:ChangeCtx,vmId:string,endpointId:string,note:string){
  const ops=await ensureOps(tx,images,ctx.projectId,vmId),cycle=ops.cycle;
  if(ops.status&&KEEP.includes(ops.status))return 'KEPT' as const;
  if(ops.status==='PROXY_BLOCKED'){
    if(ops.blockedEndpointId&&ops.blockedCycle===cycle)return 'REPEAT' as const; // a repeated report never overwrites the first mark
    // Blocked chosen before this rule: the status before it comes from this round's history, never guessed as OK.
    const last=await tx.vmOpsEvent.findFirst({where:{vmId,cycle,kind:{in:['STATUS','RECREATE','UNDO']},toStatus:'PROXY_BLOCKED'},orderBy:{createdAt:'desc'}});
    await tx.vmOperation.update({where:{id:ops.id},data:{blockedFrom:last?.fromStatus??null,blockedFromKnown:!!last,blockedEndpointId:endpointId,blockedCycle:cycle,blockedAt:ctx.now,revision:{increment:1}}});
    return 'REPEAT' as const;
  }
  await tx.vmOperation.update({where:{id:ops.id},data:{status:'PROXY_BLOCKED',statusAt:ctx.now,statusById:ctx.actorId,blockedFrom:ops.status,blockedFromKnown:true,blockedEndpointId:endpointId,blockedCycle:cycle,blockedAt:ctx.now,revision:{increment:1}}});
  await tx.vmOpsEvent.create({data:{projectId:ctx.projectId,vmId,cycle,kind:'STATUS',fromStatus:ops.status,toStatus:'PROXY_BLOCKED',note:note.slice(0,500),actorId:ctx.actorId}});
  return 'MARKED' as const;
}
/** Mark the VMs whose current proxy is `endpointId` as Blocked (the registry reported it BLOCKED). */
export async function markUsersBlocked(tx:Tx,images:Collector,ctx:ChangeCtx,endpointId:string,note:string){
  const holds=await tx.vMProxyAllocation.findMany({where:{endpointId,releasedAt:null,role:{in:['DESIRED','INSTALLED']},vm:{managed:true,archivedAt:null}},select:{vmId:true}});
  const out:{vmId:string;result:string}[]=[];
  for(const vmId of Array.from(new Set(holds.map(h=>h.vmId)))){const vm=await loadChangeVM(tx,vmId);if(currentProxyOf(vm).endpointId!==endpointId)continue;out.push({vmId,result:await markVmBlocked(tx,images,ctx,vmId,endpointId,note)});}
  return out;
}
/** After the proxies `oldIds` left the VM: bring back the status before Blocked when the VM still carries that Blocked. */
export async function restoreAfterBlocked(tx:Tx,images:Collector,ctx:ChangeCtx,vm:{id:string;operation:{id:string;cycle:number;status:VmOpsStatus|null;blockedEndpointId:string|null;blockedCycle:number|null}|null},oldIds:string[]){
  const ops=vm.operation;if(!ops?.blockedEndpointId||!oldIds.includes(ops.blockedEndpointId))return null;
  const row=await tx.vmOperation.findUniqueOrThrow({where:{id:ops.id}});await images.remember('VM_OPS',row.id);
  const clear={blockedFrom:null,blockedFromKnown:false,blockedEndpointId:null,blockedCycle:null,blockedAt:null};
  if(row.status!=='PROXY_BLOCKED'||row.blockedCycle!==row.cycle){await tx.vmOperation.update({where:{id:row.id},data:{...clear,revision:{increment:1}}});return {kept:row.status};}
  const to=row.blockedFromKnown?row.blockedFrom:null;
  await tx.vmOperation.update({where:{id:row.id},data:{...clear,status:to,statusAt:ctx.now,statusById:ctx.actorId,revision:{increment:1}}});
  await tx.vmOpsEvent.create({data:{projectId:ctx.projectId,vmId:vm.id,cycle:row.cycle,kind:'STATUS',fromStatus:'PROXY_BLOCKED',toStatus:to,note:row.blockedFromKnown?'Đã thay proxy · trở về '+opsLabel(to)+' (tình trạng trước Blocked)':'Đã thay proxy · không xác định được tình trạng trước Blocked trong lịch sử lượt này nên để Chưa ghi',actorId:ctx.actorId}});
  return {restored:to};
}
