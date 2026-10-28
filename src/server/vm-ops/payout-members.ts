import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {assertScopedVmIds} from '../permissions/server-scope';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand,type BusinessCollector} from '../business-management/idempotency';
import {ledgerAmount} from '../business-management/paypal-ledger';
import {event} from '../vm-management/sdk-list';
import {where} from '../vm-management/sdk-store';
import {moneyOfRequest} from './ops';
// Merged EarnApp payout (owner brief 27/10/2026). The owner / AI merged the SDKs of several VMs into ONE EarnApp account (the account
// of the request's own VM, "VM chính") to withdraw once. The other VMs are members of that request in their round:
// - a VM is in at most one open request per round (its own, or as a member of one); FAILED / CANCELLED frees the members;
// - members are added while the request is open and not received in full (the web is often written after EarnApp), removed only
//   while it is PREPARING; every change bumps the request revision and is in its history;
// - once the request is seen sent on EarnApp, the current SDK of the primary and of every member is "Đã dùng" for the primary account;
// - money stays on the request (counted once); the member share is a reference only, never income.
type Tx=Prisma.TransactionClient;
export interface MemberInput {vmId:string;expectedCycle:number;expectedVmRevision?:number;shareAmount?:string|null}
type RequestRef={id:string;vmId:string;cycle:number;earnAppId:string;state:string;submission:string;consumedAt:Date|null;history:Prisma.JsonValue;revision:number};
const vmSelect={id:true,code:true,revision:true,archivedAt:true,server:{select:{code:true,archivedAt:true}},operation:{select:{cycle:true}}} as const;
const historyLine=(by:string,what:string)=>({at:new Date().toISOString(),by,kind:'MEMBERS',what});
/** The open request this VM is in for its round: its own request (not failed / cancelled) or an active member row of one. */
export async function openPayoutOf(tx:Tx|PrismaClient,projectId:string,vmId:string,cycle:number,exceptRequestId?:string):Promise<{requestId:string;where:string}|null>{
  const not=exceptRequestId?{id:{not:exceptRequestId}}:{};
  const own=await tx.earnPayoutRequest.findFirst({where:{projectId,vmId,cycle,state:'REQUESTED',...not},select:{id:true,vmId:true}});
  const member=own?null:await tx.earnPayoutMember.findFirst({where:{projectId,vmId,cycle,removedAt:null,request:{state:'REQUESTED',...not}},select:{request:{select:{id:true,vmId:true}}}});
  const r=own??member?.request;if(!r)return null;
  const vm=await tx.virtualMachine.findUnique({where:{id:r.vmId},select:{code:true,server:{select:{code:true}}}});
  return {requestId:r.id,where:vm?where(vm):r.vmId};
}
async function primaryWhere(tx:Tx,request:{vmId:string}){const vm=await tx.virtualMachine.findUnique({where:{id:request.vmId},select:{code:true,server:{select:{code:true}}}});return vm?where(vm):request.vmId;}
function assertAttachable(r:RequestRef,money:ReturnType<typeof moneyOfRequest>){
  if(r.state!=='REQUESTED'||r.consumedAt||money.phase==='RECEIVED')throw new ProxyDomainError('INVALID_INPUT','Lệnh rút đã về đủ / đã dùng / đã huỷ; không gắn thêm VM','VALIDATION');
}
/**
 * Validates and attaches members to an open request (inside the caller's transaction). A VM already a member of this request is kept
 * as it is (nothing written); the primary VM itself, a repeated VM, a VM of another round or a VM in another open request is refused.
 * Writes the history line and bumps the request revision when something was added. Links SDKs when the request is already sent.
 */
export async function attachMembers(tx:Tx,images:BusinessCollector,ctx:{projectId:string;actorId:string;scope:ActorScope},request:RequestRef,members:MemberInput[]):Promise<{id:string;vmId:string;where:string}[]>{
  if(!members.length)return [];
  const full=await tx.earnPayoutRequest.findUniqueOrThrow({where:{id:request.id},include:{receipts:{select:{amount:true,currency:true,confirmed:true,failed:true,voidedAt:true}}}});
  assertAttachable(request,moneyOfRequest(full));
  const ids=members.map(m=>m.vmId);if(new Set(ids).size!==ids.length)throw new ProxyDomainError('INVALID_INPUT','Một VM chỉ ghi một lần trong lệnh gộp','VALIDATION');
  if(ids.includes(request.vmId))throw new ProxyDomainError('INVALID_INPUT','VM chính đã là VM của lệnh rút; chỉ gộp thêm các VM khác','VALIDATION');
  await assertScopedVmIds(tx,ctx.scope,ids);
  const existing=await tx.earnPayoutMember.findMany({where:{requestId:request.id,removedAt:null},select:{vmId:true,cycle:true}});
  const created:{id:string;vmId:string;where:string}[]=[];
  for(const m of members){
    const vm=await tx.virtualMachine.findFirst({where:{id:m.vmId,managed:true,server:{projectId:ctx.projectId,managed:true}},select:vmSelect});
    if(!vm||vm.archivedAt||vm.server.archivedAt)throw new ProxyDomainError('NOT_FOUND','VM gộp không còn hoạt động','NOT_FOUND');
    const cycle=vm.operation?.cycle??1,here=where(vm);
    if(cycle!==m.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',here+' đã sang lượt '+cycle+'; tải lại','CYCLE_CHANGED',{vmId:vm.id,cycle});
    if(m.expectedVmRevision!==undefined&&vm.revision!==m.expectedVmRevision)throw new ProxyDomainError('STALE_PREVIEW',here+' vừa được sửa; tải lại','REVISION_CONFLICT',{vmId:vm.id,vmRevision:vm.revision});
    if(existing.some(e=>e.vmId===vm.id&&e.cycle===cycle))continue;
    const other=await openPayoutOf(tx,ctx.projectId,vm.id,cycle,request.id);
    if(other)throw new ProxyDomainError('INVALID_INPUT','VM '+here+' đang trong lệnh rút khác ('+other.where+')','DUPLICATE',{vmId:vm.id,withdrawalId:other.requestId});
    // Reference share: the current SDK's money read on THIS VM in THIS round (or the amount typed); never a figure from elsewhere.
    const sdk=await tx.sdkRecord.findFirst({where:{projectId:ctx.projectId,vmId:vm.id},select:{id:true,amount:true,amountVmId:true,amountCycle:true,amountObservedAt:true,amountAt:true}});
    const bound=sdk&&sdk.amount!=null&&sdk.amountVmId===vm.id&&sdk.amountCycle===cycle;
    const share=m.shareAmount!=null&&m.shareAmount!==''?ledgerAmount(m.shareAmount,'Đóng góp tham khảo'):bound?sdk!.amount!.toDecimalPlaces(2):null;
    const row=await tx.earnPayoutMember.create({data:{projectId:ctx.projectId,requestId:request.id,vmId:vm.id,cycle,sdkId:sdk?.id??null,shareAmount:share,shareObservedAt:m.shareAmount?null:bound?sdk!.amountObservedAt??sdk!.amountAt:null,createdById:ctx.actorId}});
    await images.remember('PAYOUT_MEMBER',row.id,true);
    created.push({id:row.id,vmId:vm.id,where:here});
  }
  if(!created.length)return created;
  await images.remember('PAYOUT_REQUEST',request.id);
  const after=await tx.earnPayoutRequest.update({where:{id:request.id},data:{revision:{increment:1},history:[...(full.history as Prisma.JsonArray),historyLine(ctx.actorId,'Gộp thêm '+created.map(c=>c.where).join(', ')+' vào lệnh rút')]}});
  request.revision=after.revision;request.history=after.history;
  if(request.submission==='SENT')await linkMergedSdks(tx,images,ctx,request.id);
  return created;
}
/**
 * The request was seen sent on EarnApp: the merged SDKs are now used for the primary account (final, as "Đã dùng"). Only for a merged
 * request (≥ 1 active member): the current SDK of the primary VM and the SDK each member had when it was attached. Already used → kept.
 */
export async function linkMergedSdks(tx:Tx,images:BusinessCollector,ctx:{projectId:string;actorId:string},requestId:string):Promise<number>{
  const r=await tx.earnPayoutRequest.findUniqueOrThrow({where:{id:requestId},include:{members:{where:{removedAt:null}}}});
  if(!r.members.length)return 0;
  const primary=await tx.sdkRecord.findFirst({where:{projectId:ctx.projectId,vmId:r.vmId},select:{id:true}});
  const targets=[...(primary?[{sdkId:primary.id,vmId:r.vmId,cycle:r.cycle}]:[]),...r.members.filter(m=>m.sdkId).map(m=>({sdkId:m.sdkId!,vmId:m.vmId,cycle:m.cycle}))];
  const now=new Date();let n=0;
  for(const t of targets){
    const rec=await tx.sdkRecord.findFirst({where:{id:t.sdkId,projectId:ctx.projectId}});if(!rec||rec.linkState==='LINKED')continue;
    await images.remember('SDK',rec.id);
    const u=await tx.sdkRecord.updateMany({where:{id:rec.id,revision:rec.revision},data:{linkState:'LINKED',linkedEarnAppId:r.earnAppId,linkedVmId:t.vmId,linkedCycle:t.cycle,linkedAt:now,linkedById:ctx.actorId,...(rec.linkState==='UNCONFIRMED'?{confirmedAt:now,confirmedById:ctx.actorId}:{}),revision:{increment:1}}});
    if(u.count!==1)throw new ProxyDomainError('STALE_PREVIEW','SDK '+rec.code+' vừa được người khác thay đổi; tải lại','REVISION_CONFLICT');
    const vm=await tx.virtualMachine.findUnique({where:{id:t.vmId},select:{code:true,server:{select:{code:true}}}});
    await event(tx,{projectId:ctx.projectId,actorId:ctx.actorId,images,now,via:'Rút gộp'},rec.id,'USED',{toVmId:t.vmId,toLabel:vm?where(vm):null,detail:{cycle:t.cycle,account:r.earnAppId,merged:true,requestId:r.id,wasUnconfirmed:rec.linkState==='UNCONFIRMED'}});
    n++;
  }
  return n;
}
/**
 * Reopening a failed / cancelled request (RETRY, or undo of FAILED / CANCELLED): every VM of the request (its own VM and the active
 * members) must still be free; one may have joined another request meanwhile (review 27/10/2026).
 */
export async function assertMembersFree(tx:Tx,projectId:string,requestId:string){
  const r=await tx.earnPayoutRequest.findUniqueOrThrow({where:{id:requestId},select:{vmId:true,cycle:true}});
  const own=await openPayoutOf(tx,projectId,r.vmId,r.cycle,requestId);
  if(own)throw new ProxyDomainError('INVALID_INPUT','VM của lệnh rút này đang trong lệnh rút khác ('+own.where+'); không mở lại lệnh này','DUPLICATE',{vmId:r.vmId,withdrawalId:own.requestId});
  const members=await tx.earnPayoutMember.findMany({where:{requestId,removedAt:null},select:{vmId:true,cycle:true}});
  for(const m of members){
    const vm=await tx.virtualMachine.findUnique({where:{id:m.vmId},select:{code:true,archivedAt:true,server:{select:{code:true}},operation:{select:{cycle:true}}}});
    const here=vm?where(vm):m.vmId;
    if(!vm||vm.archivedAt||(vm.operation?.cycle??1)!==m.cycle)throw new ProxyDomainError('INVALID_INPUT','VM gộp '+here+' đã sang lượt mới hoặc đã xoá; không gửi lại lệnh gộp này','CYCLE_CHANGED');
    const other=await openPayoutOf(tx,projectId,m.vmId,m.cycle,requestId);
    if(other)throw new ProxyDomainError('INVALID_INPUT','VM gộp '+here+' đang trong lệnh rút khác ('+other.where+'); không gửi lại lệnh gộp này','DUPLICATE',{vmId:m.vmId,withdrawalId:other.requestId});
  }
}
// Rights: the same as recording a request sent / unknown (managers, or the narrow EARN_PAYOUT); checked inside the transaction.
async function authorizePayout(scope:ActorScope,tx:Tx){
  const {payoutRights}=await import('./payout');const r=await payoutRights(scope,tx);
  if(!(r.writeMoney||r.payout))throw new ProxyDomainError('FORBIDDEN','Gộp VM vào lệnh rút cần quyền ghi Tiền vào PayPal hoặc quyền "Chuẩn bị rút EarnApp"');
  return r.current;
}
async function loadOpen(tx:Tx,projectId:string,requestId:string,expectedRevision:number){
  const r=await tx.earnPayoutRequest.findFirst({where:{id:requestId,projectId}});if(!r)throw new ProxyDomainError('NOT_FOUND',undefined,'NOT_FOUND');
  if(r.revision!==expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','Yêu cầu rút vừa được sửa; tải lại','REVISION_CONFLICT',{requestRevision:r.revision});
  // The request must still be the open one of its VM and round (never a merge onto an old account's request).
  const ops=await tx.vmOperation.findUnique({where:{vmId:r.vmId},select:{cycle:true}}),ea=await tx.earnAppAccount.findUnique({where:{id:r.earnAppId},select:{vmId:true,closedAt:true}});
  if((ops?.cycle??1)!==r.cycle||ea?.vmId!==r.vmId||ea.closedAt)throw new ProxyDomainError('STALE_PREVIEW','VM chính đã đổi tài khoản EarnApp hoặc sang lượt mới; không gộp vào lệnh cũ','CYCLE_CHANGED');
  return r;
}
export async function addPayoutMembers(scope:ActorScope,input:{key:string;requestId:string;expectedRevision:number;members:MemberInput[]},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_PAYOUT_MEMBERS',module:'FUNDS',skipJournalWhenUnchanged:true,authorize:tx=>authorizePayout(scope,tx)},async(tx,images,current)=>{
    if(!input.members.length||input.members.length>100)throw new ProxyDomainError('INVALID_INPUT','Chọn 1–100 VM để gộp','VALIDATION');
    const r=await loadOpen(tx,scope.projectId,input.requestId,input.expectedRevision);
    const added=await attachMembers(tx,images,{projectId:scope.projectId,actorId:current.userId,scope:current},r,input.members);
    return {requestId:r.id,revision:r.revision,primary:await primaryWhere(tx,r),added:added.map(a=>({vmId:a.vmId,where:a.where}))};
  },db);
}
export async function removePayoutMember(scope:ActorScope,input:{key:string;requestId:string;expectedRevision:number;vmId:string},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_PAYOUT_MEMBERS',module:'FUNDS',skipJournalWhenUnchanged:true,authorize:tx=>authorizePayout(scope,tx)},async(tx,images,current)=>{
    const r=await loadOpen(tx,scope.projectId,input.requestId,input.expectedRevision);
    if(r.submission!=='PREPARING'||r.state!=='REQUESTED')throw new ProxyDomainError('INVALID_INPUT','Chỉ bỏ gộp khi lệnh rút còn ở bước Chuẩn bị (chưa bấm rút trên EarnApp)','VALIDATION');
    const m=await tx.earnPayoutMember.findFirst({where:{requestId:r.id,vmId:input.vmId,removedAt:null}});
    if(!m)return {requestId:r.id,revision:r.revision,removed:false};
    await assertScopedVmIds(tx,current,[m.vmId]);
    await images.remember('PAYOUT_MEMBER',m.id);await images.remember('PAYOUT_REQUEST',r.id);
    await tx.earnPayoutMember.update({where:{id:m.id},data:{removedAt:new Date(),removedById:current.userId,revision:{increment:1}}});
    const vm=await tx.virtualMachine.findUnique({where:{id:m.vmId},select:{code:true,server:{select:{code:true}}}});
    const after=await tx.earnPayoutRequest.update({where:{id:r.id},data:{revision:{increment:1},history:[...(r.history as Prisma.JsonArray),historyLine(current.userId,'Bỏ gộp '+(vm?where(vm):m.vmId))]}});
    return {requestId:r.id,revision:after.revision,removed:true};
  },db);
}
/**
 * The merged payout this VM is a member of in this round (active row of a request that is not failed / cancelled), with its money and
 * whether the primary account went SUS (owner 27/10/2026: then the money is never counted as received, and every member may be
 * recreated as SUSPENDED like the primary). A request lost to SUS (LOST_SUS, 28/10/2026) keeps its members: they follow the primary.
 */
export async function memberOf(tx:Tx|PrismaClient,projectId:string,vmId:string,cycle:number){
  // A live request wins over one lost to SUS: a member of a LOST_SUS request may have joined another merged payout of the same round
  // meanwhile (openPayoutOf counts only REQUESTED), and that payout must be the one its recreation waits for / consumes.
  const find=(state:'REQUESTED'|'LOST_SUS')=>tx.earnPayoutMember.findFirst({where:{projectId,vmId,cycle,removedAt:null,request:{state}},orderBy:{createdAt:'desc'},include:{request:{include:{receipts:{select:{amount:true,currency:true,confirmed:true,failed:true,voidedAt:true}},earnApp:{select:{closedReason:true}}}}}});
  const member=await find('REQUESTED')??await find('LOST_SUS');
  if(!member)return null;
  const r=member.request,ops=await tx.vmOperation.findUnique({where:{vmId:r.vmId},select:{cycle:true,status:true}});
  // LOST_SUS is the SUS fact itself: it holds even if the primary's status was changed afterwards (OFF / OK) without undoing the SUS.
  const primarySus=r.state==='LOST_SUS'||r.earnApp.closedReason==='SUSPENDED'||(ops?.status==='SUSPENDED'&&ops.cycle===r.cycle);
  const vm=await tx.virtualMachine.findUnique({where:{id:r.vmId},select:{code:true,server:{select:{code:true}}}});
  return {member,request:r,money:moneyOfRequest(r),primarySus,primaryWhere:vm?where(vm):r.vmId};
}
