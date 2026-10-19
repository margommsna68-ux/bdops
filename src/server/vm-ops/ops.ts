import type {Prisma,PrismaClient,VmOpsStatus} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt} from '@/lib/encryption';
import {VM_OPS,VM_OPS_STATUSES,opsLabel,requestMoney} from '@/lib/vm-ops';
import {ProxyDomainError,isShared,type ActorScope} from '../proxy-management/types';
import {decodeEndpoint} from '../proxy-management/repository';
import {runBusinessCommand,type BusinessCollector} from '../business-management/idempotency';
import {authorizeVM} from '../vm-management/repository';
import {vmHash,type ConfigurationSnapshot} from '../vm-management/types';
import {releaseForRecreate} from '../vm-management/sdk-store';
import {currentProxyOf,loadChangeVM,markVmBlocked} from '../vm-management/proxy-change';
import {assertInfrastructureAction} from '../permissions/infrastructure';
const canBlock=(scope:ActorScope)=>{try{assertInfrastructureAction(scope,'BLOCK');return true;}catch{return false;}};
// VM operating state and rounds (owner brief 18/10/2026).
// - The main status is what a person / AI recorded. Recording SDK, assigning an account or confirming a proxy never sets it.
// - Every command names the round it was meant for (expectedCycle); a command prepared for an older round is refused, so an old
//   AI command never changes the new round.
// - "Ghi nhận đã tạo lại VM" records a recreation that was really done: same VM id / server / code, a new round, the old round
//   kept (VmCycle), its EarnApp closed (never back to NEW), the current SDK leaves the position (Kho SDK if never linked, history if linked), a still valid proxy kept for the
//   position as a new plan (the old confirmation belongs to the old round and is never shown as current). Allowed when the payout of the
//   current round has been received in full (and not used for a recreation yet), or when the EarnApp is permanently suspended.
type Tx=Prisma.TransactionClient;
export const opsInclude={server:{select:{code:true,archivedAt:true}},operation:true} as const;
async function vmFor(tx:Tx,projectId:string,vmId:string){return tx.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId,managed:true}},include:opsInclude});}
const where=(vm:{code:string;server:{code:string}})=>vm.server.code+' / '+vm.code;
export const staleCycle=(cycle:number)=>'VM đã sang lượt '+cycle+'; lệnh này dành cho lượt cũ. Tải lại rồi làm theo lượt hiện hành';
// The operating row of a VM (created with round 1 on its first record).
async function ensureOps(tx:Tx,images:BusinessCollector,projectId:string,vmId:string){
  const row=await tx.vmOperation.findUnique({where:{vmId}});if(row){await images.remember('VM_OPS',row.id);return row;}
  const created=await tx.vmOperation.create({data:{projectId,vmId}});await images.remember('VM_OPS',created.id,true);return created;
}
export interface StatusItem {vmId:string;status:VmOpsStatus;expectedCycle:number}
export async function setVmStatus(scope:ActorScope,input:{key:string;items:StatusItem[];note?:string|null},db:PrismaClient=prisma){
  if(!input.items.length||input.items.length>1000||new Set(input.items.map(i=>i.vmId)).size!==input.items.length)throw new ProxyDomainError('INVALID_INPUT','Mỗi VM một dòng, tối đa 1000 VM');
  if(input.items.some(i=>!VM_OPS_STATUSES.includes(i.status as never)))throw new ProxyDomainError('INVALID_INPUT','Trạng thái không hợp lệ');
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_STATUS',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    const infra=await authorizeVM(current,'ASSIGN',tx),now=new Date();
    const rows:{vmId:string;where:string;outcome:'APPLIED'|'SKIP'|'ERROR';message:string;status:VmOpsStatus|null;cycle:number|null}[]=[];
    for(const item of input.items){
      const vm=await vmFor(tx,scope.projectId,item.vmId);
      if(!vm){rows.push({vmId:item.vmId,where:'',outcome:'ERROR',message:'VM không thuộc dự án này',status:null,cycle:null});continue;}
      const cycle=vm.operation?.cycle??1,base={vmId:vm.id,where:where(vm)};
      if(vm.archivedAt||vm.server.archivedAt){rows.push({...base,outcome:'ERROR',message:'Bản ghi VM đã xoá khỏi web; khôi phục trước khi ghi tình trạng',status:vm.operation?.status??null,cycle});continue;}
      if(cycle!==item.expectedCycle){rows.push({...base,outcome:'ERROR',message:staleCycle(cycle),status:vm.operation?.status??null,cycle});continue;}
      if(vm.operation?.status===item.status){rows.push({...base,outcome:'SKIP',message:'Giữ nguyên '+opsLabel(item.status),status:item.status,cycle});continue;}
      // "Blocked" at the VM is the current proxy reported BLOCKED in Kho proxy too (BLOCK right), one fact on both pages; the status
      // before it is remembered for the replacement (owner decision 19/10/2026).
      if(item.status==='PROXY_BLOCKED'){
        const change=await loadChangeVM(tx,vm.id),cur=currentProxyOf(change);
        if(!cur.endpointId){rows.push({...base,outcome:'ERROR',message:cur.review?'VM có proxy cần đối chiếu; chọn proxy đang dùng ở ô Proxy trước khi báo Blocked':'VM chưa có proxy; không có proxy nào để báo Blocked',status:vm.operation?.status??null,cycle});continue;}
        if(!canBlock(infra)){rows.push({...base,outcome:'ERROR',message:'Cần quyền Báo BLOCKED proxy để ghi Blocked',status:vm.operation?.status??null,cycle});continue;}
        const endpoint=await tx.proxyIP.findUniqueOrThrow({where:{id:cur.endpointId}});
        if(endpoint.inventoryState!=='BLOCKED'){
          if(endpoint.retiredAt||!['NEW','LIVE'].includes(endpoint.inventoryState)){rows.push({...base,outcome:'ERROR',message:'Proxy đang '+endpoint.inventoryState+'; không báo BLOCKED được',status:vm.operation?.status??null,cycle});continue;}
          await images.remember('ENDPOINT',endpoint.id);
          await tx.proxyIP.update({where:{id:endpoint.id},data:{inventoryState:'BLOCKED',status:'BLOCKED',statusAt:now,revision:{increment:1}}});
          if(endpoint.identityId)await tx.proxyStatusEvent.create({data:{projectId:scope.projectId,identityId:endpoint.identityId,endpointId:endpoint.id,ip:endpoint.host!,kind:'BLOCKED',occurredAt:now,actorId:current.userId,reason:'Báo tại '+where(vm)}});
        }
        const r=await markVmBlocked(tx,images,{projectId:scope.projectId,actorId:current.userId,now,via:'Server/VM'},vm.id,endpoint.id,(input.note?.trim()?input.note.trim()+' · ':'')+'Proxy '+endpoint.host+(endpoint.port?':'+endpoint.port:'')+' BLOCKED');
        rows.push({...base,outcome:'APPLIED',message:r==='KEPT'?'Proxy '+endpoint.host+' đã BLOCKED; giữ tình trạng '+opsLabel(vm.operation?.status??null):opsLabel(vm.operation?.status??null)+' → Blocked (proxy '+endpoint.host+' BLOCKED)',status:r==='KEPT'?vm.operation?.status??null:'PROXY_BLOCKED',cycle});continue;
      }
      const ops=await ensureOps(tx,images,scope.projectId,vm.id);
      // A status chosen by a person replaces a pending Blocked: the replacement will then keep this newer decision.
      await tx.vmOperation.update({where:{id:ops.id},data:{status:item.status,statusAt:now,statusById:current.userId,blockedFrom:null,blockedFromKnown:false,blockedEndpointId:null,blockedCycle:null,blockedAt:null,revision:{increment:1}}});
      await tx.vmOpsEvent.create({data:{projectId:scope.projectId,vmId:vm.id,cycle,kind:'STATUS',fromStatus:ops.status,toStatus:item.status,note:input.note?.trim().slice(0,500)||null,actorId:current.userId}});
      rows.push({...base,outcome:'APPLIED',message:opsLabel(ops.status)+' → '+VM_OPS[item.status].label,status:item.status,cycle});
    }
    return {rows,applied:rows.filter(r=>r.outcome==='APPLIED').length,skipped:rows.filter(r=>r.outcome==='SKIP').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
  },db);
}
// Payout state of the current round of a VM (no amounts here: the money itself is shown only with the finance rights).
export async function currentRoundPayout(tx:Tx|PrismaClient,projectId:string,vm:{id:string;operation:{cycle:number}|null}){
  const earnApp=await tx.earnAppAccount.findFirst({where:{vmId:vm.id,projectId},include:{payoutRequest:{include:{receipts:{select:{amount:true,currency:true,confirmed:true,failed:true,voidedAt:true}}}}}});
  const r=earnApp?.payoutRequest;if(!earnApp||!r||r.cycle!==(vm.operation?.cycle??1)||r.vmId!==vm.id)return {earnApp,request:null,money:null};
  return {earnApp,request:r,money:moneyOfRequest(r)};
}
export function moneyOfRequest(r:{amount:Prisma.Decimal;currency:string;state:string;settledAt:Date|null;shortfall:Prisma.Decimal|null;consumedAt:Date|null;receipts:{amount:Prisma.Decimal;currency:string;confirmed:boolean;failed:boolean;voidedAt:Date|null}[]}){
  return requestMoney({amount:r.amount.toString(),currency:r.currency,state:r.state,settledAt:r.settledAt?.toISOString()??null,shortfall:r.shortfall?.toString()??null,consumedAt:r.consumedAt?.toISOString()??null,receipts:r.receipts.map(x=>({amount:x.amount.toString(),currency:x.currency,confirmed:x.confirmed,failed:x.failed,voided:!!x.voidedAt}))});
}
// A proxy kept for the position on a recreation: still ours (TUT or shared), current stock, not BLOCKED / replaced / retired.
export function keepable(endpoint:{retiredAt:Date|null;inventoryState:string;inventoryKey:string|null;identity:{owner:string;subgroup:string|null}|null}|null){
  if(!endpoint)return 'Không có proxy';
  if(endpoint.retiredAt||!['NEW','LIVE'].includes(endpoint.inventoryState))return endpoint.inventoryState==='BLOCKED'?'Proxy đang BLOCKED: thay qua luồng thay proxy':'Proxy không còn đủ điều kiện ('+endpoint.inventoryState+')';
  if(!endpoint.identity||(endpoint.identity.owner!=='SELF'&&!isShared(endpoint.identity.owner as never,endpoint.identity.subgroup as never)))return 'Proxy không thuộc TUT / Chung mooon–Genjy';
  if(!endpoint.inventoryKey)return 'Proxy thiếu khoá kho';
  return null;
}
export async function recordRecreated(scope:ActorScope,input:{key:string;vmId:string;expectedCycle:number;note?:string|null},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_RECREATE',module:'INFRASTRUCTURE',reversible:false},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const vm=await tx.virtualMachine.findFirst({where:{id:input.vmId,managed:true,server:{projectId:scope.projectId,managed:true}},include:{...opsInclude,installedConfiguration:{include:{endpoint:{include:{identity:true}}}},desiredConfiguration:{include:{endpoint:{include:{identity:true}},task:true}}}});
    if(!vm)throw new ProxyDomainError('NOT_FOUND');
    if(vm.archivedAt||vm.server.archivedAt)throw new ProxyDomainError('INVALID_INPUT','Bản ghi VM đã xoá khỏi web; khôi phục trước');
    const cycle=vm.operation?.cycle??1;if(cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle));
    const {earnApp,request,money}=await currentRoundPayout(tx,scope.projectId,vm);
    const paid=!!request&&money?.phase==='RECEIVED'&&!request.consumedAt,sus=vm.operation?.status==='SUSPENDED';
    if(!paid&&!sus){
      const why=!earnApp?'VM chưa có tài khoản EarnApp ở lượt này':!request?'Chưa có yêu cầu rút cho lượt này':request.consumedAt?'Khoản nhận này đã dùng để tạo lại VM':money?.phase==='WAITING'?'Tiền chưa về đủ PP (còn chờ)':money?.phase==='REVIEW'?'Tiền về cần đối chiếu trước':'Yêu cầu rút đang '+(request.state==='FAILED'?'thất bại':'huỷ');
      throw new ProxyDomainError('INVALID_INPUT',why+'. Chỉ ghi tạo lại khi tiền đã về đủ PP, hoặc khi EarnApp bị SUS');
    }
    const reason=paid?'PAYOUT_RECEIVED':'SUSPENDED',now=new Date();
    // Proxy for the next round. Install evidence belongs to its round (review 19/10/2026): the old round's configurations stay as
    // history (CONFIRMED / CANCELLED rows, ids kept in VmCycle), the VM no longer points at them, and nothing planned or started on
    // the old machine can be confirmed for the new one. The proxy of the position (the pending plan, else the installed one) is kept
    // as a NEW plan of the new round when still valid; otherwise it stays on the VM as "giữ để kiểm tra" for the replacement flow.
    let proxyKept:string|null=null,proxyNote:string,keptHold:string|null=null,keptConfig:string|null=null;
    const installed=vm.installedConfiguration,pending=vm.desiredConfiguration&&vm.desiredConfiguration.id!==vm.installedConfigurationId?vm.desiredConfiguration:null,position=pending??installed;
    const holds=await tx.vMProxyAllocation.findMany({where:{vmId:vm.id,releasedAt:null}});
    await images.remember('VM',vm.id);
    if(pending){
      await images.remember('VM_CONFIG',pending.id);await tx.vMConfiguration.update({where:{id:pending.id},data:{status:'CANCELLED',revision:{increment:1}}});
      if(pending.task&&['PENDING','IN_PROGRESS'].includes(pending.task.status)){await images.remember('VM_TASK',pending.task.id);await tx.vMTask.update({where:{id:pending.task.id},data:{status:'CANCELLED'}});}
    }
    if(!position)proxyNote='VM chưa có proxy được giao';
    else{
      const endpoint=position.endpoint,blocked=endpoint?.inventoryState==='BLOCKED'&&!endpoint.retiredAt,why=blocked?null:keepable(endpoint),hold=endpoint?holds.find(h=>h.endpointId===endpoint.id&&h.role!=='UNCERTAIN'):undefined,proxy=endpoint?decodeEndpoint(endpoint):null;
      if(why||!endpoint||!hold||!proxy||proxy.format!=='FULL')proxyNote=(why||'Proxy không còn được giữ đúng máy')+'; giữ trên VM để kiểm tra / thay, chưa giao lại';
      else{
        const snapshot:ConfigurationSnapshot={proxy,packageCode:endpoint.packageCode,identityId:endpoint.identity!.id,endpointRevision:endpoint.revision,server:vm.server.code,vm:vm.code};
        await images.remember('ENDPOINT',endpoint.id);
        const config=await tx.vMConfiguration.create({data:{projectId:scope.projectId,vmId:vm.id,version:vm.configurationSequence+1,endpointId:endpoint.id,snapshotCipher:encrypt(JSON.stringify(snapshot)),configurationHash:vmHash(snapshot),createdById:current.userId}});await images.remember('VM_CONFIG',config.id,true);
        await images.remember('VM_ALLOCATION',hold.id);await tx.vMProxyAllocation.update({where:{id:hold.id},data:{role:'DESIRED',configurationId:config.id,revision:{increment:1}}});
        await tx.proxyIP.update({where:{id:endpoint.id},data:{revision:{increment:1}}});
        keptHold=hold.id;keptConfig=config.id;proxyKept=blocked?null:endpoint.id;proxyNote=blocked?'Proxy '+proxy.ip+' đang BLOCKED: vẫn ở vị trí và vẫn phải thay (bấm ô Proxy)':'Giữ proxy '+proxy.ip+' cho vị trí ở lượt mới (gán là xong, không có bước cài)';
      }
    }
    // Whatever else was installed or started on the old machine is not an installation of the new round: it stays on the VM as
    // "giữ để kiểm tra" (a BLOCKED proxy then goes through the replacement flow); nothing is returned to NEW here.
    for(const h of holds)if(h.id!==keptHold&&h.role!=='UNCERTAIN'){await images.remember('VM_ALLOCATION',h.id);await tx.vMProxyAllocation.update({where:{id:h.id},data:{role:'UNCERTAIN',revision:{increment:1}}});}
    await tx.virtualMachine.update({where:{id:vm.id},data:{desiredConfigurationId:keptConfig,installedConfigurationId:null,...(keptConfig?{configurationSequence:{increment:1}}:{})}});
    await tx.virtualMachine.update({where:{id:vm.id},data:{revision:{increment:1}}});
    // The old round.
    const closed=await tx.vmCycle.create({data:{projectId:scope.projectId,vmId:vm.id,number:cycle,reason,earnAppId:earnApp?.id??null,loginId:earnApp?.loginId??null,paypalEmailId:earnApp?.paypalEmailId??null,sdkId:vm.sdkId,status:vm.operation?.status??null,desiredConfigurationId:vm.desiredConfigurationId,installedConfigurationId:vm.installedConfigurationId,proxyKept,payoutRequestId:paid?request!.id:null,note:input.note?.trim().slice(0,500)||null,closedById:current.userId}});
    await images.remember('VM_CYCLE',closed.id,true);
    if(paid){await images.remember('PAYOUT_REQUEST',request!.id);await tx.earnPayoutRequest.update({where:{id:request!.id},data:{consumedAt:now,revision:{increment:1},history:[...(request!.history as Prisma.JsonArray),{at:now.toISOString(),by:current.userId,kind:'CONSUMED',what:'Dùng để ghi tạo lại VM (đóng lượt '+cycle+')'}]}});}
    if(earnApp){
      await images.remember('EARNAPP',earnApp.id);await tx.earnAppAccount.update({where:{id:earnApp.id},data:{vmId:null,closedAt:now,closedReason:paid?'RECREATED':'SUSPENDED',revision:{increment:1}}});
      for(const o of await tx.earnAppPayout.findMany({where:{earnAppId:earnApp.id,endedAt:null}})){await images.remember('PAYOUT',o.id);await tx.earnAppPayout.update({where:{id:o.id},data:{endedAt:now}});}
      await images.remember('GMAIL',earnApp.loginId);await tx.gmailAccount.update({where:{id:earnApp.loginId},data:{revision:{increment:1}}});
    }
    // The real machine gets a new SDK: the current code leaves the position (back to Kho SDK if never linked, history if linked).
    const sdkLeft=await releaseForRecreate(tx,images,scope.projectId,current.userId,vm,cycle);
    const ops=await ensureOps(tx,images,scope.projectId,vm.id);
    await tx.vmOperation.update({where:{id:ops.id},data:{cycle:cycle+1,status:'NEW_VM',statusAt:now,statusById:current.userId,blockedFrom:null,blockedFromKnown:false,blockedEndpointId:null,blockedCycle:null,blockedAt:null,revision:{increment:1}}});
    await tx.vmOpsEvent.create({data:{projectId:scope.projectId,vmId:vm.id,cycle:cycle+1,kind:'RECREATE',fromStatus:ops.status,toStatus:'NEW_VM',note:input.note?.trim().slice(0,500)||null,detail:{closedCycle:cycle,reason,proxy:proxyNote,earnAppClosed:!!earnApp,sdkMoved:!!sdkLeft},actorId:current.userId}});
    return {vmId:vm.id,where:where(vm),cycle:cycle+1,reason,proxy:proxyNote,proxyKept:!!proxyKept};
  },db);
}
