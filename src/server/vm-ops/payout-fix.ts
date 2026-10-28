import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand,type BusinessCollector} from '../business-management/idempotency';
import {ledgerAmount} from '../business-management/paypal-ledger';
import {dayDate,dayText} from '../business-management/money';
import {authorizeVM} from '../vm-management/repository';
import {activeVM,checkLink,emailFor,writeLink} from '../account-store/links';
import {historyEntry,payoutRights,requestInclude} from './payout';
import {assertPayoutDailySlot,consumePayoutDailySlotOn,payoutDay} from './payout-daily';
// Fixing a mistaken EarnApp payout request (owner 28/10/2026, "Sửa sai"): edit (email / amount / date / reference), unsend ("Bỏ Đã rút":
// back to a preparation that holds its email) and void ("Xoá ghi nhầm": a full snapshot is kept in EarnPayoutRequestVoid, then the row is
// removed so the EarnApp can withdraw again).
// - A mistaken receiving email goes back to stock only while no money was ever recorded on it for this EarnApp (any FundTransaction,
//   voided ones included); this replaces the 18/10/2026 "an email given to an EarnApp is never released" for mistakes only.
// - Taking a new email is one conditional write (nobody else may hold / use it) inside the project-locked serializable command, so two
//   people / AI never get the same email.
// - Every command leaves a history line (who, when, before → after).
type Tx=Prisma.TransactionClient;
const NO_FIX='Sửa / bỏ "Đã rút" / xoá yêu cầu rút cần quyền ghi Tiền vào PayPal hoặc quyền "Chuẩn bị rút EarnApp"';
const authorizer=(scope:ActorScope)=>async(tx:Tx)=>{const r=await payoutRights(scope,tx);if(!(r.writeMoney||r.payout))throw new ProxyDomainError('FORBIDDEN',NO_FIX);return r.current;};
const HAS_MONEY='Email đã nhận tiền, không đổi được';
interface RequestIdentity {requestId:string;expectedRevision:number;vmId:string;expectedCycle:number;earnAppId:string}
/** The request as the form saw it, still the open one of its VM, round and EarnApp (as updatePayoutRequest checks). */
async function loadCurrent(tx:Tx,projectId:string,input:RequestIdentity){
  const r=await tx.earnPayoutRequest.findFirst({where:{id:input.requestId,projectId},include:requestInclude});if(!r)throw new ProxyDomainError('NOT_FOUND','Yêu cầu rút không còn (có thể đã xoá)','NOT_FOUND');
  if(r.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','Yêu cầu rút vừa được sửa; tải lại','REVISION_CONFLICT',{requestRevision:r.revision});
  const mismatch='Yêu cầu rút này không thuộc VM / lượt / EarnApp đang mở trên form; tải lại';
  if(input.vmId!==r.vmId)throw new ProxyDomainError('STALE_PREVIEW',mismatch,'NOT_FOUND');
  if(input.expectedCycle!==r.cycle)throw new ProxyDomainError('STALE_PREVIEW',mismatch,'CYCLE_CHANGED');
  if(input.earnAppId!==r.earnAppId)throw new ProxyDomainError('STALE_PREVIEW',mismatch,'ACCOUNT_CHANGED');
  if(r.consumedAt)throw new ProxyDomainError('INVALID_INPUT','Yêu cầu này đã dùng để ghi tạo lại VM; chỉ đối chiếu, không sửa / xoá','VALIDATION');
  const earnApp=await tx.earnAppAccount.findUniqueOrThrow({where:{id:r.earnAppId}});
  const vm=await activeVM(tx,projectId,r.vmId),ops=vm?await tx.vmOperation.findUnique({where:{vmId:vm.id},select:{cycle:true}}):null;
  if(!vm||earnApp.vmId!==r.vmId||earnApp.closedAt||(ops?.cycle??1)!==r.cycle)throw new ProxyDomainError('STALE_PREVIEW','VM đã đổi tài khoản EarnApp hoặc sang lượt mới; yêu cầu này thuộc tài khoản cũ — đối chiếu ở Lịch sử của VM',vm&&(ops?.cycle??1)!==r.cycle?'CYCLE_CHANGED':'ACCOUNT_CHANGED');
  return {r,vm};
}
const notOpen=()=>new ProxyDomainError('INVALID_INPUT','Yêu cầu không còn mở (thất bại / huỷ / mất do SUS); không sửa','VALIDATION');
/**
 * Gives a mistaken receiving email back to stock (whoever bound it, also an email linked earlier through "PayPal nhận"): refused once any
 * money (FundTransaction, voided ones included) was recorded on this email for this EarnApp. Clears this EarnApp's hold and used mark,
 * its link to the EarnApp account, the receiving-email periods of that pair and this request's day markers for the email.
 */
export async function unbindMistakenEmail(tx:Tx,images:BusinessCollector,r:{id:string;projectId:string;earnAppId:string;paypalId:string;paypalEmailId:string}):Promise<void>{
  const money=await tx.fundTransaction.findFirst({where:{projectId:r.projectId,paypalEmailId:r.paypalEmailId,earnAppId:r.earnAppId},select:{id:true}});
  if(money)throw new ProxyDomainError('INVALID_INPUT',HAS_MONEY,'EMAIL_HAS_MONEY',{receiptId:money.id});
  const email=await tx.payPalEmail.findFirst({where:{id:r.paypalEmailId,projectId:r.projectId}});if(!email)throw new ProxyDomainError('NOT_FOUND','Email PayPal không còn trong kho','NOT_FOUND');
  let changed=false;
  if(email.holdEarnAppId===r.earnAppId||email.usedEarnAppId===r.earnAppId){
    await images.remember('PAYPAL_EMAIL',email.id);changed=true;
    await tx.payPalEmail.update({where:{id:email.id},data:{...(email.holdEarnAppId===r.earnAppId?{holdEarnAppId:null,holdAt:null}:{}),...(email.usedEarnAppId===r.earnAppId?{usedEarnAppId:null,usedAt:null}:{}),revision:{increment:1}}});
  }
  const earnApp=await tx.earnAppAccount.findFirst({where:{id:r.earnAppId,projectId:r.projectId},select:{id:true,paypalEmailId:true}});
  if(earnApp?.paypalEmailId===email.id){await images.remember('EARNAPP',earnApp.id);changed=true;await tx.earnAppAccount.update({where:{id:earnApp.id},data:{paypalEmailId:null,paypalId:null,revision:{increment:1}}});}
  const periods=await tx.earnAppPayout.findMany({where:{projectId:r.projectId,earnAppId:r.earnAppId,paypalEmailId:email.id},select:{id:true}});
  if(periods.length){for(const p of periods)await images.remember('PAYOUT',p.id);changed=true;await tx.earnAppPayout.deleteMany({where:{id:{in:periods.map(p=>p.id)}}});}
  await tx.payPalPayoutDayEmail.deleteMany({where:{projectId:r.projectId,requestId:r.id,paypalEmailId:email.id}});
  if(changed){await images.remember('PAYPAL',email.paypalId);await tx.payPalAccount.update({where:{id:email.paypalId},data:{revision:{increment:1}}});}
}
/**
 * Takes an email for this EarnApp: HOLD (a preparation / an unconfirmed send) or USE (sent: this EarnApp's for good). One conditional
 * write: free, or already this EarnApp's; never one held / used / received by another EarnApp. The EarnApp's own linked email needs nothing.
 */
async function takeEmail(tx:Tx,images:BusinessCollector,projectId:string,earnAppId:string,emailId:string,mode:'HOLD'|'USE'){
  const ok=await emailFor(tx,projectId,emailId,earnAppId);
  if(!ok.ok){const e=await tx.payPalEmail.findFirst({where:{id:emailId,projectId},select:{holdEarnAppId:true}});throw new ProxyDomainError('INVALID_INPUT',ok.message,e?.holdEarnAppId&&e.holdEarnAppId!==earnAppId?'REVISION_CONFLICT':'VALIDATION');}
  const email=await tx.payPalEmail.findUniqueOrThrow({where:{id:emailId},include:{earnApp:{select:{id:true}}}});
  const taken={id:email.id,paypalId:ok.email.paypalId,email:ok.email.email,code:ok.email.code};
  if(email.earnApp?.id===earnAppId)return taken;
  await images.remember('PAYPAL_EMAIL',email.id);
  const now=new Date(),mine=(field:'holdEarnAppId'|'usedEarnAppId')=>({OR:[{[field]:null},{[field]:earnAppId}]});
  const stale=()=>new ProxyDomainError('STALE_PREVIEW','Email PayPal vừa được người khác giữ hoặc cấp; tải lại và chọn email khác','REVISION_CONFLICT');
  let n:{count:number};
  try{n=await tx.payPalEmail.updateMany({where:{id:email.id,projectId,archivedAt:null,reviewHold:false,earnApp:null,AND:[mine('holdEarnAppId'),mine('usedEarnAppId')],paypal:{status:'ACTIVE',archivedAt:null}},
    data:mode==='HOLD'?{holdEarnAppId:earnAppId,holdAt:email.holdEarnAppId===earnAppId?email.holdAt:now,revision:{increment:1}}:{usedEarnAppId:earnAppId,usedAt:email.usedAt??now,holdEarnAppId:null,holdAt:null,revision:{increment:1}}});}
  // One hold per EarnApp (holdEarnAppId is unique): another email still held for it is a conflict to reconcile, never overwritten.
  catch(e){if((e as {code?:string}).code==='P2002')throw stale();throw e;}
  if(n.count!==1){const now2=await tx.payPalEmail.findUnique({where:{id:email.id},select:{archivedAt:true,reviewHold:true,paypal:{select:{code:true,status:true,archivedAt:true}}}});
    if(!now2||now2.archivedAt||now2.paypal.archivedAt)throw new ProxyDomainError('INVALID_INPUT','Email PayPal / PP '+(now2?.paypal.code??'')+' không còn trong kho','VALIDATION');
    if(now2.paypal.status!=='ACTIVE')throw new ProxyDomainError('INVALID_INPUT','PP '+now2.paypal.code+' không còn hoạt động ('+now2.paypal.status+'); chọn email khác','VALIDATION');
    if(now2.reviewHold)throw new ProxyDomainError('INVALID_INPUT','Email đang tạm giữ để đối chiếu; xử lý ở Cần đối chiếu trước','VALIDATION');
    throw stale();}
  await images.remember('PAYPAL',taken.paypalId);await tx.payPalAccount.update({where:{id:taken.paypalId},data:{revision:{increment:1}}});
  return taken;
}
const label=(submission:string)=>submission==='SENT'?'Đã rút':submission==='UNKNOWN'?'Chưa rõ đã rút chưa':'Đang rút (chưa xác nhận)';
// ─── Sửa ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PayoutEditInput extends RequestIdentity {key:string;paypalEmailId?:string;amount?:string;requestedAt?:string;reference?:string|null;note?:string|null}
/**
 * Edit a request until money is confirmed (replaces CORRECT for the web; CORRECT stays for existing callers). The receiving email can
 * change only while no money was recorded on the old one; the amount (and date / reference) can still change afterwards, with a reason.
 * A reason is required once the request is sent / unconfirmed or has a receipt. A new email of a sent / unconfirmed request counts on the
 * day it was sent (submittedAt, server time), never today and never the editable requested date; changing the date changes only requestedAt.
 */
export async function editPayoutRequest(scope:ActorScope,input:PayoutEditInput,db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_PAYOUT_EDIT',module:'FUNDS',skipJournalWhenUnchanged:true,authorize:authorizer(scope)},async(tx,images,current)=>{
    const {r,vm}=await loadCurrent(tx,scope.projectId,input);
    if(r.state!=='REQUESTED')throw notOpen();
    const note=input.note?.trim().slice(0,500)||null;
    const amount=input.amount!=null&&input.amount.trim()!==''?ledgerAmount(input.amount,'Số tiền yêu cầu'):r.amount;
    const requestedAt=input.requestedAt!=null&&input.requestedAt.trim()!==''?dayDate(input.requestedAt.trim()):r.requestedAt;
    const reference=input.reference!==undefined?input.reference?.trim().slice(0,200)||null:r.reference;
    const emailId=input.paypalEmailId||r.paypalEmailId;
    const change={email:emailId!==r.paypalEmailId,amount:!amount.eq(r.amount),date:requestedAt.getTime()!==r.requestedAt.getTime(),reference:reference!==r.reference};
    if(!change.email&&!change.amount&&!change.date&&!change.reference)return {id:r.id,changed:false,revision:r.revision};
    if((r.submission!=='PREPARING'||r.receipts.length>0)&&!note)throw new ProxyDomainError('INVALID_INPUT','Ghi lý do khi sửa yêu cầu đã rút (hoặc đã có tiền về)','VALIDATION');
    if(change.date){const live=r.receipts.filter(x=>!x.voidedAt&&!x.failed).map(x=>x.date).sort((a,b)=>a.getTime()-b.getTime());
      if(live.length&&live[0]<requestedAt)throw new ProxyDomainError('INVALID_INPUT','Ngày rút không được sau ngày tiền về ('+dayText(live[0])+')','VALIDATION');}
    await images.remember('PAYOUT_REQUEST',r.id);
    let to={id:r.paypalEmailId,paypalId:r.paypalId,email:r.paypalEmail.email,code:r.paypal.code};
    if(change.email){
      await authorizeVM(current,'ASSIGN',tx);
      // The day the old email's slot was taken for this request (an unconfirmed send has no submittedAt); read before it is removed.
      const marker=await tx.payPalPayoutDayEmail.findFirst({where:{projectId:scope.projectId,requestId:r.id,paypalEmailId:r.paypalEmailId},orderBy:{day:'desc'},select:{day:true}});
      // The new email's image first: an undo gives its hold back before the old email takes the hold again (one hold per EarnApp).
      await images.remember('PAYPAL_EMAIL',emailId);
      await unbindMistakenEmail(tx,images,r);
      to=await takeEmail(tx,images,scope.projectId,r.earnAppId,emailId,r.submission==='SENT'?'USE':'HOLD');
      const today=payoutDay().date,day=r.submission==='SENT'?payoutDay(r.submittedAt??r.createdAt).date:r.submission==='UNKNOWN'?marker?.day??today:today;
      await assertPayoutDailySlot(tx,scope.projectId,to.paypalId,to.id,day,r.id);
      // An unconfirmed send also stays held from today on (like any open preparation).
      if(r.submission==='UNKNOWN'&&day!==today)await assertPayoutDailySlot(tx,scope.projectId,to.paypalId,to.id,today,r.id);
      if(r.submission!=='PREPARING')await consumePayoutDailySlotOn(tx,{projectId:scope.projectId,paypalId:to.paypalId,paypalEmailId:to.id,id:r.id},day);
      if(r.submission==='SENT'){
        // Sent: the new email becomes this EarnApp's receiving email (the same checked assignment as the SENT milestone).
        const c=await checkLink(tx,scope.projectId,vm,{paypalEmail:to.id});if(!c.ok)throw new ProxyDomainError('INVALID_INPUT',c.message,'VALIDATION');
        if(!c.skip&&c.plan){try{await writeLink(tx,images,scope.projectId,vm,c.plan,current.userId);}catch(e){if((e as {code?:string}).code==='P2002')throw new ProxyDomainError('STALE_PREVIEW','Email PayPal vừa được cấp cho EarnApp khác; tải lại','REVISION_CONFLICT');throw e;}}
      }
    }
    const parts=[change.email?'email '+r.paypal.code+' · '+r.paypalEmail.email+' → '+to.code+' · '+to.email:null,change.amount?'số tiền '+r.amount.toFixed(2)+' → '+amount.toFixed(2)+' '+r.currency:null,
      change.date?'ngày rút '+dayText(r.requestedAt)+' → '+dayText(requestedAt):null,change.reference?'mã tham chiếu '+(r.reference??'—')+' → '+(reference??'—'):null].filter(Boolean);
    const after=await tx.earnPayoutRequest.update({where:{id:r.id},data:{paypalId:to.paypalId,paypalEmailId:to.id,amount,requestedAt,reference,...(change.amount?{settledAt:null,settledById:null,settleNote:null,shortfall:null}:{}),revision:{increment:1},
      history:[...(r.history as Prisma.JsonArray),historyEntry(current.userId,'EDIT','Sửa ('+label(r.submission)+'): '+parts.join('; ')+(note?' · '+note:''))]}});
    return {id:r.id,changed:true,revision:after.revision,vmId:r.vmId,cycle:r.cycle,earnAppId:r.earnAppId,paypalEmailId:to.id,amount:amount.toFixed(2),currency:r.currency,submission:r.submission,requestedOn:dayText(requestedAt)};
  },db);
}
// ─── Bỏ "Đã rút" ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PayoutUnsendInput extends RequestIdentity {key:string;note?:string|null}
/** SENT / UNKNOWN → PREPARING: the email is still held for this preparation; its binding and day slot are removed (no money on it). */
export async function unsendPayoutRequest(scope:ActorScope,input:PayoutUnsendInput,db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_PAYOUT_UNSEND',module:'FUNDS',skipJournalWhenUnchanged:true,authorize:authorizer(scope)},async(tx,images,current)=>{
    const {r}=await loadCurrent(tx,scope.projectId,input);
    if(r.state!=='REQUESTED')throw notOpen();
    if(r.submission==='PREPARING')return {id:r.id,changed:false,revision:r.revision,submission:'PREPARING' as const};
    if(r.receipts.length)throw new ProxyDomainError('INVALID_INPUT','Yêu cầu đã có khoản tiền về (kể cả đã thu hồi); không bỏ "Đã rút"','EMAIL_HAS_MONEY');
    const note=input.note?.trim().slice(0,500)||null;
    await images.remember('PAYOUT_REQUEST',r.id);
    await unbindMistakenEmail(tx,images,r);
    // Held again from today on: it takes a slot of today like any open preparation (never another operator's slot).
    await assertPayoutDailySlot(tx,scope.projectId,r.paypalId,r.paypalEmailId,payoutDay().date,r.id);
    await takeEmail(tx,images,scope.projectId,r.earnAppId,r.paypalEmailId,'HOLD');
    const after=await tx.earnPayoutRequest.update({where:{id:r.id},data:{submission:'PREPARING',submittedAt:null,revision:{increment:1},
      history:[...(r.history as Prisma.JsonArray),historyEntry(current.userId,'UNSEND','Bỏ "Đã rút": '+label(r.submission)+' → '+label('PREPARING')+', email '+r.paypal.code+' · '+r.paypalEmail.email+' vẫn giữ'+(note?' · '+note:''))]}});
    return {id:r.id,changed:true,revision:after.revision,submission:'PREPARING' as const,vmId:r.vmId,cycle:r.cycle,earnAppId:r.earnAppId};
  },db);
}
// ─── Xoá ghi nhầm ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PayoutVoidInput extends RequestIdentity {key:string;reason:string}
const json=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Date?v.toISOString():v instanceof Prisma.Decimal?v.toFixed(2):v]));
/**
 * The body of a void inside the caller's transaction (also used by "EarnApp bị SUS" for a request never sent). Refused with any receipt
 * (voided ones included), money on its email for this EarnApp, an active merged member, once used for a recreation or lost to SUS.
 * Snapshot (every column, history with the VOID line, members) + giving the email back + removing the row, together.
 */
export async function voidInTx(tx:Tx,images:BusinessCollector,ctx:{projectId:string;actorId:string},r:{id:string},reason:string):Promise<{voidId:string}>{
  const why=reason.trim().slice(0,500);if(!why)throw new ProxyDomainError('INVALID_INPUT','Ghi lý do xoá yêu cầu rút ghi nhầm','VALIDATION');
  const row=await tx.earnPayoutRequest.findFirst({where:{id:r.id,projectId:ctx.projectId},include:{receipts:{select:{id:true}},members:true,paypal:{select:{code:true}},paypalEmail:{select:{email:true}}}});
  if(!row)throw new ProxyDomainError('NOT_FOUND','Yêu cầu rút không còn (có thể đã xoá)','NOT_FOUND');
  const refuse=(m:string,reason:'VALIDATION'|'EMAIL_HAS_MONEY'='VALIDATION')=>{throw new ProxyDomainError('INVALID_INPUT',m,reason);};
  if(row.receipts.length)refuse('Yêu cầu đã có khoản tiền về (kể cả đã thu hồi); không xoá. Sửa số tiền hoặc đối chiếu khoản nhận','EMAIL_HAS_MONEY');
  if(row.consumedAt)refuse('Yêu cầu này đã dùng để ghi tạo lại VM; không xoá');
  if(row.state==='LOST_SUS')refuse('Yêu cầu đã ghi "Mất do SUS"; không xoá (hoàn tác lệnh SUS nếu ghi nhầm)');
  const active=row.members.filter(m=>!m.removedAt);if(active.length)refuse('Lệnh rút đang gộp '+active.length+' VM; bỏ gộp trước khi xoá');
  const {receipts:_receipts,members,paypal,paypalEmail,history,...columns}=row;
  const voidLine=historyEntry(ctx.actorId,'VOID','Xoá do ghi nhầm ('+label(row.submission)+', '+row.amount.toFixed(2)+' '+row.currency+', PP '+paypal.code+' · '+paypalEmail.email+'): '+why);
  const snapshot={...json(columns),history:[...(history as Prisma.JsonArray),voidLine],paypalCode:paypal.code,email:paypalEmail.email,members:members.map(m=>json(m))} as Prisma.InputJsonObject;
  await images.remember('PAYOUT_REQUEST',row.id);
  await unbindMistakenEmail(tx,images,row);
  const v=await tx.earnPayoutRequestVoid.create({data:{projectId:ctx.projectId,requestId:row.id,vmId:row.vmId,cycle:row.cycle,earnAppId:row.earnAppId,paypalEmailId:row.paypalEmailId,snapshot,reason:why,voidedById:ctx.actorId}});
  // Members left earlier (removedAt) are kept in the snapshot; the request row goes, so the EarnApp can withdraw again.
  if(members.length)await tx.earnPayoutMember.deleteMany({where:{requestId:row.id}});
  await tx.earnPayoutRequest.delete({where:{id:row.id}});
  return {voidId:v.id};
}
export async function voidPayoutRequest(scope:ActorScope,input:PayoutVoidInput,db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_PAYOUT_VOID',module:'FUNDS',authorize:authorizer(scope)},async(tx,images,current)=>{
    const {r}=await loadCurrent(tx,scope.projectId,input);
    const {voidId}=await voidInTx(tx,images,{projectId:scope.projectId,actorId:current.userId},{id:r.id},input.reason??'');
    return {voidId,requestId:r.id,vmId:r.vmId,cycle:r.cycle,earnAppId:r.earnAppId};
  },db);
}
/**
 * Undo of a void (operation-images restore): the request comes back from its snapshot (same id, columns, history without the VOID line,
 * members), the void record is removed. Refused when the EarnApp has a new request meanwhile, or the open preparation would overbook the day.
 */
export async function restoreVoidedRequest(tx:Tx,projectId:string,requestId:string){
  const v=await tx.earnPayoutRequestVoid.findFirst({where:{projectId,requestId},orderBy:{voidedAt:'desc'}});
  if(!v)throw new ProxyDomainError('INVALID_INPUT','Không còn ảnh chụp của yêu cầu rút đã xoá; không hoàn tác');
  const s=v.snapshot as Record<string,unknown>&{history:Prisma.JsonArray;members:Record<string,unknown>[]};
  if(await tx.earnPayoutRequest.findFirst({where:{earnAppId:v.earnAppId},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','EarnApp này đã có yêu cầu rút mới; không hoàn tác lệnh xoá');
  const earnApp=await tx.earnAppAccount.findUnique({where:{id:v.earnAppId},select:{closedAt:true,vmId:true}}),ops=await tx.vmOperation.findUnique({where:{vmId:v.vmId},select:{cycle:true}});
  // The account must still be this VM's (A → B in the same round refuses). Undo may have cleared vmId of the imaged account just before.
  const other=await tx.earnAppAccount.findFirst({where:{vmId:v.vmId,id:{not:v.earnAppId}},select:{id:true}});
  if(!earnApp||earnApp.closedAt||(earnApp.vmId!==null&&earnApp.vmId!==v.vmId)||other||(ops?.cycle??1)!==v.cycle)throw new ProxyDomainError('INVALID_INPUT','VM đã sang lượt mới hoặc EarnApp đã đóng; không hoàn tác lệnh xoá yêu cầu rút');
  const str=(k:string)=>s[k]==null?null:String(s[k]),date=(k:string)=>s[k]==null?null:new Date(String(s[k]));
  if(s.state==='REQUESTED'&&(s.submission==='PREPARING'||s.submission==='UNKNOWN'))await assertPayoutDailySlot(tx,projectId,String(s.paypalId),String(s.paypalEmailId));
  const history=[...s.history];const last=history.at(-1) as {kind?:string}|undefined;if(last?.kind==='VOID')history.pop();
  await tx.earnPayoutRequest.create({data:{id:requestId,projectId,earnAppId:v.earnAppId,vmId:v.vmId,cycle:v.cycle,paypalId:String(s.paypalId),paypalEmailId:v.paypalEmailId,currency:String(s.currency),amount:String(s.amount),reference:str('reference'),
    requestedAt:date('requestedAt')!,requestedById:String(s.requestedById),state:String(s.state),stateNote:str('stateNote'),settledAt:date('settledAt'),settledById:str('settledById'),settleNote:str('settleNote'),shortfall:str('shortfall'),consumedAt:date('consumedAt'),
    history,submission:String(s.submission),submittedAt:date('submittedAt'),revision:Number(s.revision)+1,lostAmount:str('lostAmount'),lostAt:date('lostAt'),createdAt:date('createdAt')??undefined}});
  for(const m of s.members??[]){const d=(k:string)=>m[k]==null?null:new Date(String(m[k]));
    await tx.earnPayoutMember.create({data:{id:String(m.id),projectId,requestId,vmId:String(m.vmId),cycle:Number(m.cycle),sdkId:m.sdkId==null?null:String(m.sdkId),shareAmount:m.shareAmount==null?null:String(m.shareAmount),shareObservedAt:d('shareObservedAt'),removedAt:d('removedAt'),removedById:m.removedById==null?null:String(m.removedById),consumedAt:d('consumedAt'),consumedReason:m.consumedReason==null?null:String(m.consumedReason),createdById:String(m.createdById),createdAt:d('createdAt')??undefined,revision:Number(m.revision)}});}
  await tx.earnPayoutRequestVoid.delete({where:{id:v.id}});
}
