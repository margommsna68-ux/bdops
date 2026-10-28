import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {opsLabel} from '@/lib/vm-ops';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand,type BusinessCollector} from '../business-management/idempotency';
import {authorizeVM} from '../vm-management/repository';
import {assertScopedVmIds} from '../permissions/server-scope';
import {applyVmStatus,currentRoundPayout,opsInclude,staleCycle} from './ops';
import {historyEntry} from './payout';
import {voidInTx} from './payout-fix';
// "EarnApp bị SUS" (owner 28/10/2026, spec section 3 + addition 1). One command, one transaction, whichever way SUS is chosen (button,
// status cell, bulk status, AI vms/{id}/status):
// - the request of the current round: SENT / UNKNOWN and not received in full → LOST_SUS ("Mất do SUS", lostAmount = the open part,
//   never waiting, never received); still PREPARING → removed as mistaken (void snapshot; its held email goes back to stock, the
//   members of a merged preparation are taken out first); received / to reconcile → kept as it is; no request → nothing;
// - the EarnApp's receiving email (and the request's email once sent / unconfirmed) leaves the stock for good (archivedAt); an email
//   only held by a preparation is never archived; the PayPal book does not change;
// - the VM gets status SUSPENDED through the normal status write (VmOpsEvent); the EarnApp itself closes at the recreation (as before).
// A merged primary that was sent keeps its members: they find the primary SUS (memberOf → primarySus) and go to "Chờ tạo lại" too.
type Tx=Prisma.TransactionClient;
const REASON='EarnApp bị SUS';
const vi=(v:string)=>{const [i,d='00']=v.split('.');return i.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+d;};
export interface SuspendClosure {request:{id:string;outcome:'LOST'|'VOIDED'}|null;requestId:string|null;lostAmount:string|null;currency:string|null;archivedEmailIds:string[]}
/** The closing part of a SUS inside the caller's transaction (the caller writes the status with applyVmStatus afterwards). */
export async function closeSuspendedInTx(tx:Tx,images:BusinessCollector,ctx:{projectId:string;actorId:string;scope:ActorScope},vm:{id:string;operation:{cycle:number}|null}):Promise<SuspendClosure>{
  const now=new Date(),{earnApp,request,money}=await currentRoundPayout(tx,ctx.projectId,vm);
  let outcome:'LOST'|'VOIDED'|null=null,lostAmount:string|null=null;const archive:string[]=[];
  if(request&&request.state==='REQUESTED'){
    if(request.submission==='PREPARING'){
      // The request first: an undo brings it back (with its members) before the members are put back as active.
      await images.remember('PAYOUT_REQUEST',request.id);
      const members=await tx.earnPayoutMember.findMany({where:{requestId:request.id,removedAt:null}});
      if(members.length){
        await assertScopedVmIds(tx,ctx.scope,members.map(m=>m.vmId));
        for(const m of members){await images.remember('PAYOUT_MEMBER',m.id);await tx.earnPayoutMember.update({where:{id:m.id},data:{removedAt:now,removedById:ctx.actorId,revision:{increment:1}}});}
        const where=await tx.virtualMachine.findMany({where:{id:{in:members.map(m=>m.vmId)}},select:{code:true,server:{select:{code:true}}}});
        await tx.earnPayoutRequest.update({where:{id:request.id},data:{revision:{increment:1},history:[...(request.history as Prisma.JsonArray),historyEntry(ctx.actorId,'MEMBERS','Bỏ gộp '+where.map(v=>v.server.code+' / '+v.code).join(', ')+' ('+REASON+')')]}});
      }
      await voidInTx(tx,images,{projectId:ctx.projectId,actorId:ctx.actorId},{id:request.id},REASON);
      outcome='VOIDED';
    }else{
      archive.push(request.paypalEmailId);
      await images.remember('PAYOUT_REQUEST',request.id);
      if(money?.phase==='WAITING'){
        outcome='LOST';lostAmount=money.remaining;
        await tx.earnPayoutRequest.update({where:{id:request.id},data:{state:'LOST_SUS',lostAmount,lostAt:now,revision:{increment:1},
          history:[...(request.history as Prisma.JsonArray),historyEntry(ctx.actorId,'SUS',REASON+': mất '+vi(lostAmount)+' '+request.currency+(money.received!=='0.00'?' (đã về '+vi(money.received)+')':''))]}});
      }else{
        await tx.earnPayoutRequest.update({where:{id:request.id},data:{revision:{increment:1},
          history:[...(request.history as Prisma.JsonArray),historyEntry(ctx.actorId,'SUS',REASON+': không mất tiền ('+(money?.phase==='RECEIVED'?'đã về đủ':'tiền về cần đối chiếu')+')')]}});
      }
    }
  }
  // The receiving email of the EarnApp (read after a void, which gives a mistaken preparation's email back to stock).
  if(earnApp){const ea=await tx.earnAppAccount.findUnique({where:{id:earnApp.id},select:{paypalEmailId:true}});if(ea?.paypalEmailId)archive.unshift(ea.paypalEmailId);}
  const archivedEmailIds:string[]=[];
  for(const id of [...new Set(archive)]){
    const email=await tx.payPalEmail.findFirst({where:{id,projectId:ctx.projectId},select:{id:true,archivedAt:true,paypalId:true}});
    if(!email||email.archivedAt)continue;
    await images.remember('PAYPAL_EMAIL',email.id);await tx.payPalEmail.update({where:{id:email.id},data:{archivedAt:now,revision:{increment:1}}});
    await images.remember('PAYPAL',email.paypalId);await tx.payPalAccount.update({where:{id:email.paypalId},data:{revision:{increment:1}}});
    archivedEmailIds.push(email.id);
  }
  return {request:request&&outcome?{id:request.id,outcome}:null,requestId:request?.id??null,lostAmount,currency:request?.currency??null,archivedEmailIds};
}
/** What the STATUS event of a SUS keeps (the reason of the archived emails: "EarnApp SUS"). */
export function susDetail(c:SuspendClosure):Prisma.InputJsonObject{
  return {sus:{requestId:c.requestId,outcome:c.request?.outcome??null,lostAmount:c.lostAmount,currency:c.currency,archivedEmailIds:c.archivedEmailIds,emailReason:'EarnApp SUS'}};
}
export interface SuspendInput {key:string;vmId:string;expectedCycle:number;expectedVmRevision?:number;note?:string|null}
/** The "EarnApp bị SUS" button / AI command. Already SUS → nothing written (no journal). */
export async function markEarnAppSuspended(scope:ActorScope,input:SuspendInput,db:PrismaClient=prisma,opts:{operator?:boolean}={}){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_SUSPEND',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    const infra=await authorizeVM(current,'ASSIGN',tx);
    const vm=await tx.virtualMachine.findFirst({where:{id:input.vmId,managed:true,server:{projectId:scope.projectId,managed:true}},include:opsInclude});
    if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không thuộc dự án này','NOT_FOUND');
    await assertScopedVmIds(tx,infra,[vm.id]);
    if(vm.archivedAt||vm.server.archivedAt)throw new ProxyDomainError('INVALID_INPUT','Bản ghi VM đã xoá khỏi web; khôi phục trước khi ghi tình trạng','VALIDATION');
    const cycle=vm.operation?.cycle??1;
    if(cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle),'CYCLE_CHANGED',{cycle});
    if(input.expectedVmRevision!==undefined&&vm.revision!==input.expectedVmRevision)throw new ProxyDomainError('STALE_PREVIEW','VM vừa được sửa; tải lại','REVISION_CONFLICT',{vmRevision:vm.revision});
    const current_=await currentRoundPayout(tx,scope.projectId,vm);
    if(vm.operation?.status==='SUSPENDED')return {vmId:vm.id,cycle,changed:false,request:{id:current_.request?.id??null,outcome:null,lostAmount:null},archivedEmailIds:[] as string[]};
    // An AI operator never leaves New VM / "Chờ áp dụng proxy" with a plain status (as setVmStatus); SUS is no exception.
    if(opts.operator&&vm.operation?.status&&['NEW_VM','PROXY_PENDING'].includes(vm.operation.status))throw new ProxyDomainError('INVALID_INPUT',opsLabel(vm.operation.status)+' chỉ kết thúc qua việc đã nhận (finish-prepare / finish-proxy)','VALIDATION');
    const closed=await closeSuspendedInTx(tx,images,{projectId:scope.projectId,actorId:current.userId,scope:infra},vm);
    await applyVmStatus(tx,images,{projectId:scope.projectId,actorId:current.userId,now:new Date(),operator:!!opts.operator},vm,'SUSPENDED',input.note??null,susDetail(closed));
    return {vmId:vm.id,cycle,changed:true,request:{id:closed.requestId,outcome:closed.request?.outcome??null,lostAmount:closed.lostAmount},archivedEmailIds:closed.archivedEmailIds};
  },db);
}
