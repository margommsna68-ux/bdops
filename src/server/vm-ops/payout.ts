import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {vmWhere,assertScopedVmIds,hasServerScope} from '../permissions/server-scope';
import {fromCents,gatherOf,milestoneOf,recreateReady,suggestPaypal,toCents} from '@/lib/vm-ops';
import {formatMoney} from '@/lib/money-input';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {assertInfrastructureAction} from '../permissions/infrastructure';
import {runBusinessCommand} from '../business-management/idempotency';
import {bookUsdBalances,ledgerAmount,ledgerRights,readPaypalLedger} from '../business-management/paypal-ledger';
import {assertPeriodOpen} from '../business-management/period-lock';
import {dayDate,dayText} from '../business-management/money';
import {LEDGER_CURRENCY} from '../business-management/types';
import {authorizeVM} from '../vm-management/repository';
import {activeVM,checkLink,writeLink} from '../account-store/links';
import {moneyOfRequest,staleCycle} from './ops';
import {balanceRights,currentBalances} from './balance';
import {assertPayoutDailySlot,consumePayoutDailySlot,readPayoutDaily} from './payout-daily';
import {assertMembersFree,attachMembers,linkMergedSdks,type MemberInput} from './payout-members';
// EarnApp payout requests (owner decision 18/10/2026: one EarnApp account, one withdrawal).
// - One request per EarnApp (unique earnAppId): a retry, a lost answer or a status correction stays on the same row; a new command
//   key never creates a second one.
// - The request keeps its VM, round, PayPal and receiving email; the email of a sent request is never changed.
// - Money received is what the PayPal book says (confirmed FundTransaction rows linked to the request). A pending linked receipt is
//   part of what is still to come, never added on top. A request is only an expectation, never income.
// - "Tiền về PP" is money on the PayPal, not a withdrawal from it, not money at a collector, not USDT at the team.
type Tx=Prisma.TransactionClient;
const D=(v:Prisma.Decimal.Value)=>new Prisma.Decimal(v);
const currencyOf=(c:string)=>{const v=c.trim().toUpperCase();if(!LEDGER_CURRENCY.test(v))throw new ProxyDomainError('INVALID_INPUT','Đồng tiền là mã 3–5 chữ cái (USD, USDT, VND…)');return v;};
export const requestInclude={receipts:{select:{id:true,amount:true,currency:true,confirmed:true,failed:true,voidedAt:true,date:true}},paypal:{select:{id:true,code:true,status:true}},paypalEmail:{select:{id:true,email:true}}} as const;
// A history line keeps its kind next to the full text: the full text (amounts, corrections, shortfall, notes) is shown only with the
// money rights; everyone else gets the operating milestone of the kind.
export type PayoutHistoryKind='REQUESTED'|'CORRECT'|'FAILED'|'CANCELLED'|'RETRY'|'SETTLE'|'CONSUMED'|'PREPARED'|'SENT'|'UNKNOWN'|'RECEIPT'|'MEMBERS'|'EDIT'|'UNSEND'|'VOID'|'SUS';
export const historyEntry=(by:string,kind:PayoutHistoryKind,what:string)=>({at:new Date().toISOString(),by,kind,what});
const NEUTRAL:Record<PayoutHistoryKind,string>={REQUESTED:'Ghi yêu cầu rút',CORRECT:'Sửa yêu cầu rút',FAILED:'Đánh dấu thất bại',CANCELLED:'Đánh dấu huỷ',RETRY:'Gửi lại (cùng lượt rút)',SETTLE:'Chốt nhận thiếu',CONSUMED:'Dùng để ghi tạo lại VM',PREPARED:'Chuẩn bị rút (giữ email)',SENT:'Đã gửi trên EarnApp',UNKNOWN:'Chưa xác định kết quả gửi',RECEIPT:'Ghi tiền về PP',MEMBERS:'Cập nhật VM gộp',EDIT:'Sửa yêu cầu rút',UNSEND:'Bỏ "Đã rút"',VOID:'Đã xoá do ghi nhầm',SUS:'EarnApp bị SUS'};
// Lines written before 19/10/2026 carry no kind: it is read from the fixed start of the text (never from the amounts).
const LEGACY:[string,PayoutHistoryKind][]=[['Ghi yêu cầu rút','REQUESTED'],['Sửa','CORRECT'],['Thất bại','FAILED'],['Huỷ','CANCELLED'],['Gửi lại','RETRY'],['Chốt nhận','SETTLE'],['Dùng để ghi tạo lại VM','CONSUMED']];
export function neutralHistory(h:{kind?:string;what:string}){const kind=(h.kind&&h.kind in NEUTRAL?h.kind:LEGACY.find(([p])=>h.what.startsWith(p))?.[1]) as PayoutHistoryKind|undefined;return kind?NEUTRAL[kind]:'Cập nhật yêu cầu rút';}
// Who may do what with payouts. Money (amounts, balances) needs the PayPal money rights; recording a request needs the right to
// record money in (FUNDS write, managers); choosing a new receiving email also needs the right to assign on Server / VM.
// Narrow rights (21/10/2026), off by default, for a member who is not a manager (e.g. an AI account), in a Proxy / VM project, with
// Server / VM access and not VIEWER: EARN_PAYOUT = prepare a request (hold the email) and record it sent / unknown; PAYPAL_RECEIPT_RECORD
// = record money received for a request already sent. Either one shows the money of payout requests (requestMoney), never the book.
export async function payoutRights(scope:ActorScope,db:PrismaClient|Tx=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId),r=await ledgerRights(current,db as PrismaClient);
  let assign=false;try{assertInfrastructureAction(current,'ASSIGN');assign=current.businessMode==='PROXY_VM';}catch{assign=false;}
  const proxyVm=current.businessMode==='PROXY_VM',narrow=(cap:string)=>proxyVm&&assign&&current.capabilities.includes(cap);
  if(hasServerScope(current))return {current,money:false,balance:false,writeMoney:false,assign,payout:false,receipt:false,requestMoney:false};
  const payout=r.writeFunds&&proxyVm||narrow('EARN_PAYOUT'),receipt=r.writeFunds&&proxyVm||narrow('PAYPAL_RECEIPT_RECORD');
  return {current,money:r.funds,balance:r.funds&&r.withdrawals,writeMoney:r.writeFunds,assign,payout,receipt,requestMoney:r.funds||payout||receipt};
}
const NO_PAYOUT='Chuẩn bị / ghi gửi yêu cầu rút cần quyền ghi Tiền vào PayPal hoặc quyền "Chuẩn bị rút EarnApp"';
// ─── Pending money per PayPal ────────────────────────────────────────────────────────────────────────────────────────────────
// Still to come = the open part of requests waiting for money + pending receipts not linked to a request (a linked pending
// receipt is already inside its request's open part, so it is not counted twice).
export async function pendingByPaypal(db:PrismaClient|Tx,projectId:string){
  const [requests,loose]=await Promise.all([
    db.earnPayoutRequest.findMany({where:{projectId,state:'REQUESTED',submission:'SENT'},include:{receipts:{select:{amount:true,currency:true,confirmed:true,failed:true,voidedAt:true}}}}),
    db.fundTransaction.findMany({where:{projectId,voidedAt:null,confirmed:false,failed:false,entryKind:'RECEIPT',payoutRequestId:null},select:{paypalId:true,amount:true,currency:true}}),
  ]);
  const out=new Map<string,Record<string,number>>(),add=(pp:string,cur:string,c:number)=>{if(!c)return;const m=out.get(pp)||{};m[cur]=(m[cur]||0)+c;out.set(pp,m);};
  for(const r of requests){const m=moneyOfRequest(r);if(m.phase==='WAITING')add(r.paypalId,r.currency,toCents(m.remaining));}
  for(const f of loose)add(f.paypalId,f.currency,toCents(f.amount.toString()));
  return out;
}
/** Money held by payouts being prepared or not confirmed sent (USD cents per PayPal): counted only when picking a PayPal. */
export async function heldByPaypal(db:PrismaClient|Tx,projectId:string,exceptEarnAppId?:string){
  const rows=await db.earnPayoutRequest.findMany({where:{projectId,state:'REQUESTED',submission:{in:['PREPARING','UNKNOWN']},currency:'USD',...(exceptEarnAppId?{earnAppId:{not:exceptEarnAppId}}:{})},select:{paypalId:true,amount:true}});
  const out=new Map<string,number>();for(const r of rows)out.set(r.paypalId,(out.get(r.paypalId)||0)+toCents(r.amount.toFixed(2)));return out;
}
// Balance by the book (up to today), pending and the gathering label of every PayPal, USD only for the label.
export async function readPaypalGather(scope:ActorScope,db:PrismaClient=prisma){
  const {current,money,balance}=await payoutRights(scope,db);
  if(!money)return {rights:{money,balance},paypals:[] as {paypalId:string;balanceUsd:string|null;pendingUsd:string;gather:ReturnType<typeof gatherOf>|null;pending:Record<string,string>}[]};
  const [ledger,pending,pps]=await Promise.all([balance?readPaypalLedger(current,{},db):Promise.resolve(null),pendingByPaypal(db,scope.projectId),db.payPalAccount.findMany({where:{projectId:scope.projectId},select:{id:true}})]);
  const bal=new Map((ledger?.paypals||[]).map(p=>[p.paypalId,p.currencies.find(c=>c.currency==='USD')?.balance??'0.00']));
  return {rights:{money,balance},paypals:pps.map(p=>{const pend=pending.get(p.id)||{},usd=fromCents(pend.USD||0),b=balance?bal.get(p.id)??'0.00':null;
    return {paypalId:p.id,balanceUsd:b,pendingUsd:usd,gather:b===null?null:gatherOf(b,usd),pending:Object.fromEntries(Object.entries(pend).map(([c,v])=>[c,fromCents(v)]))};})};
}
// ─── Picking the PayPal and email for a VM's EarnApp ─────────────────────────────────────────────────────────────────────────
export async function readPayoutPick(scope:ActorScope,input:{vmId:string;amount?:string|null},db:PrismaClient=prisma){
  const {current,money,balance,writeMoney,payout}=await payoutRights(scope,db);
  if(!writeMoney&&!payout)throw new ProxyDomainError('FORBIDDEN','Ghi yêu cầu rút cần quyền ghi Tiền vào PayPal');
  const vm=await activeVM(db,scope.projectId,input.vmId);if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không còn hoạt động');
  const earnApp=await db.earnAppAccount.findUnique({where:{vmId:vm.id},include:{login:{select:{email:true}},paypalEmail:{select:{id:true,email:true,paypalId:true}}}});
  const pps=await db.payPalAccount.findMany({where:{projectId:scope.projectId,archivedAt:null},select:{id:true,code:true,status:true,emails:{where:{archivedAt:null},select:{id:true,email:true,usedEarnAppId:true,reviewHold:true,holdEarnAppId:true,earnApp:{select:{id:true}}}}}});
  const gather=money?await readPaypalGather(current,db):null,g=new Map((gather?.paypals||[]).map(p=>[p.paypalId,p])),held=money||payout?await heldByPaypal(db,scope.projectId,earnApp?.id):new Map<string,number>();
  const daily=await readPayoutDaily(db,scope.projectId);
  const rows=pps.map(p=>{
    // own = the EarnApp's receiving email, or an email held for this EarnApp's payout being prepared; an email held for another
    // EarnApp is never offered (two people / AI cannot take the same email).
    const own=p.emails.filter(e=>earnApp&&(e.id===earnApp.paypalEmailId||e.holdEarnAppId===earnApp.id)).map(e=>({id:e.id,email:e.email,own:true}));
    const free=p.emails.filter(e=>!e.usedEarnAppId&&!e.reviewHold&&!e.earnApp&&!e.holdEarnAppId).map(e=>({id:e.id,email:e.email,own:false})).sort((a,b)=>a.email.localeCompare(b.email));
    const x=g.get(p.id);
    const emails=[...own,...(p.status==='ACTIVE'?free:[])].map(e=>({...e,dailyAllowed:daily.allowed(p.id,e.id),dailyOccupied:daily.occupied(p.id,e.id)}));
    return {id:p.id,code:p.code,status:p.status,usable:p.status==='ACTIVE'&&emails.some(e=>e.dailyAllowed),emails,daily:daily.summary(p.id),unused:p.status==='ACTIVE'?free.length:0,balanceUsd:balance?x?.balanceUsd??'0.00':null,pendingUsd:money?x?.pendingUsd??'0.00':null,heldUsd:money?fromCents(held.get(p.id)||0):'0.00'};
  }).filter(p=>p.emails.length).sort((a,b)=>a.code.localeCompare(b.code,'en',{numeric:true}));
  // Suggested PP (owner brief 20/10/2026): the EarnApp's own email, else the PP this amount brings closest to $100 (see suggestPaypal).
  // A member with EARN_PAYOUT but without the book gets the same suggestion, computed from the book here; the figures stay hidden.
  const inner=!balance&&payout?{book:await bookUsdBalances(db,scope.projectId),pending:await pendingByPaypal(db,scope.projectId)}:null;
  const ownBlocked=rows.some(p=>p.emails.some(e=>e.own&&!e.dailyAllowed));
  const suggestion=ownBlocked?null:suggestPaypal(rows.map(p=>({id:p.id,code:p.code,usable:p.usable,freeEmails:p.emails.filter(e=>!e.own&&e.dailyAllowed).length,own:p.emails.some(e=>e.own&&e.dailyAllowed),balanceUsd:inner?inner.book.get(p.id)??'0.00':p.balanceUsd,pendingUsd:inner?fromCents(inner.pending.get(p.id)?.USD||0):p.pendingUsd,heldUsd:inner?fromCents(held.get(p.id)||0):p.heldUsd})),input.amount||'0');
  return {vm:{id:vm.id,where:vm.server.code+' / '+vm.code},earnApp:earnApp?{id:earnApp.id,login:earnApp.login.email,emailId:earnApp.paypalEmailId,email:earnApp.paypalEmail?.email??null}:null,paypals:rows,suggestion,rights:{money,balance,prepareOnly:!writeMoney}};
}
// Suggestion for one EarnApp account and one amount (ops API, 21/10/2026): the same rule as the VM cell (suggestPaypal: the EarnApp's own
// email, else the usable PP with a free email this amount brings closest to $100 without going over, counting the book balance, money
// still to come and money held by other preparations). The $100 target is USD only: another currency is never converted, so only the
// EarnApp's own email can be suggested. Without an amount the answer is marked not exact. A suggestion holds nothing.
// A member with only EARN_PAYOUT gets the suggestion and each PayPal's projected USD after this payout, never the book balance itself.
export async function suggestPayout(scope:ActorScope,input:{earnAppId:string;amount?:string|null;currency:string},db:PrismaClient=prisma){
  const {payout,balance}=await payoutRights(scope,db);if(!payout)throw new ProxyDomainError('FORBIDDEN',NO_PAYOUT);
  const currency=currencyOf(input.currency),amount=input.amount?ledgerAmount(input.amount,'Số tiền').toFixed(2):null,usd=currency==='USD';
  const earnApp=await db.earnAppAccount.findFirst({where:{id:input.earnAppId,projectId:scope.projectId,closedAt:null,vmId:{not:null}},include:{payoutRequest:{select:{id:true}}}});
  const vm=earnApp?.vmId?await activeVM(db,scope.projectId,earnApp.vmId):null;if(!earnApp||!vm)throw new ProxyDomainError('NOT_FOUND','Tài khoản EarnApp không đang gán VM hoạt động','NOT_FOUND');
  const [pps,pending,held,book]=await Promise.all([db.payPalAccount.findMany({where:{projectId:scope.projectId,archivedAt:null},select:{id:true,code:true,status:true,emails:{where:{archivedAt:null},select:{id:true,email:true,usedEarnAppId:true,reviewHold:true,holdEarnAppId:true,earnApp:{select:{id:true}}},orderBy:{email:'asc'}}}}),
    pendingByPaypal(db,scope.projectId),heldByPaypal(db,scope.projectId,earnApp.id),bookUsdBalances(db,scope.projectId)]);
  const daily=await readPayoutDaily(db,scope.projectId);
  const rows=pps.map(p=>{
    const own=p.emails.filter(e=>e.id===earnApp.paypalEmailId||e.holdEarnAppId===earnApp.id).map(e=>({id:e.id,email:e.email,own:true}));
    const free=p.status==='ACTIVE'?p.emails.filter(e=>!e.usedEarnAppId&&!e.reviewHold&&!e.earnApp&&!e.holdEarnAppId).map(e=>({id:e.id,email:e.email,own:false})):[];
    const b=book.get(p.id)??'0.00',pend=fromCents(pending.get(p.id)?.USD||0),h=fromCents(held.get(p.id)||0),proj=toCents(b)+toCents(pend)+toCents(h);
    const emails=[...own,...free].map(e=>({...e,dailyAllowed:daily.allowed(p.id,e.id),dailyOccupied:daily.occupied(p.id,e.id)}));
    return {id:p.id,code:p.code,status:p.status,usable:p.status==='ACTIVE'&&emails.some(e=>e.dailyAllowed),emails,daily:daily.summary(p.id),free:emails.filter(e=>!e.own&&e.dailyAllowed).length,balanceUsd:b,pendingUsd:pend,heldUsd:h,projectedUsd:fromCents(proj),afterUsd:usd&&amount?fromCents(proj+toCents(amount)):null};
  }).filter(p=>p.emails.length).sort((a,b)=>a.code.localeCompare(b.code,'en',{numeric:true}));
  const cand=rows.map(p=>({id:p.id,code:p.code,usable:p.usable,freeEmails:p.free,own:p.emails.some(e=>e.own&&e.dailyAllowed),balanceUsd:p.balanceUsd,pendingUsd:p.pendingUsd,heldUsd:p.heldUsd}));
  const ownBlocked=rows.some(p=>p.emails.some(e=>e.own&&!e.dailyAllowed));
  const pick=ownBlocked?null:usd?suggestPaypal(cand,amount||'0'):(()=>{const mine=cand.find(c=>c.own);return mine?{paypalId:mine.id,why:'EarnApp đã có email nhận ở '+mine.code+'; giữ nguyên'}:null;})();
  const chosen=pick?rows.find(p=>p.id===pick.paypalId)!:null,email=chosen?chosen.emails.find(e=>e.own&&e.dailyAllowed)??chosen.emails.find(e=>e.dailyAllowed):null;
  const shown=(p:typeof rows[number])=>({paypalId:p.id,code:p.code,status:p.status,usable:p.usable,daily:p.daily,emails:p.emails.map(e=>({paypalEmailId:e.id,email:e.email,own:e.own,dailyAllowed:e.dailyAllowed,dailyOccupied:e.dailyOccupied})),projectedUsd:p.projectedUsd,afterUsd:p.afterUsd,...(balance?{balanceUsd:p.balanceUsd,pendingUsd:p.pendingUsd,heldUsd:p.heldUsd}:{})});
  return {earnAppAccountId:earnApp.id,vmId:vm.id,amount,currency,exact:!!amount&&usd,existingWithdrawalId:earnApp.payoutRequest?.id??null,
    note:!usd?'Mục tiêu gom 100 USD chỉ áp cho USD; không tự quy đổi '+currency+'. Chọn PP / email theo đối chiếu của người vận hành':!amount?'Chưa có số tiền: gợi ý chưa phải cho lần rút này':null,
    suggestion:pick&&chosen&&email?{paypalId:chosen.id,code:chosen.code,paypalEmailId:email.id,email:email.email,why:pick.why,afterUsd:chosen.afterUsd}:null,candidates:rows.map(shown)};
}
// Money received on PayPal for one payout request (ops API, 21/10/2026), written to the same PayPal book (FundTransaction RECEIPT,
// confirmed) as Tiền vào PayPal:
// - only for a request seen sent on EarnApp (SENT); PREPARING / UNKNOWN must be reconciled first, a failed / cancelled request too;
// - it belongs to the request's own PayPal, email, EarnApp and VM (history), never to the account now on the VM (late money for an
//   old, closed account lands on its old request);
// - the amount is what arrived (never the requested amount); parts add up (10 asked: 6, then 4) and never go over what is still
//   open, except that the exact PayPal figure may be a little above it (owner 28/10/2026): that receipt closes the request as received
//   with the surplus settled (negative shortfall, "Nhận dư $X"); nothing is settled short automatically; "received in full" follows
//   from the book;
// - a payment id is recorded once (any key); without one, a receipt with the same email, day and amount is a possible duplicate and
//   is refused (a person decides "khoản riêng" in Kho tài khoản); the period lock applies.
export interface PayoutReceiptInput {key:string;requestId:string;expectedRequestRevision:number;amount:string;currency:string;receivedAt:string;transactionId?:string|null;evidence?:string|null;/** Owner 28/10/2026: the real PayPal amount is usually below the withdrawn one (fees); true settles the rest as a fee in this same command. A receipt above the open part is always settled as a surplus. */settleRemainder?:boolean}
export async function recordPayoutReceipt(scope:ActorScope,input:PayoutReceiptInput,db:PrismaClient=prisma){
  const authorize=async(tx:Tx)=>{const r=await payoutRights(scope,tx);if(!r.receipt)throw new ProxyDomainError('FORBIDDEN','Ghi tiền về PP cần quyền ghi Tiền vào PayPal hoặc quyền "Ghi khoản nhận PP của yêu cầu rút"');return r.current;};
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_PAYOUT_RECEIPT',module:'FUNDS',authorize},async(tx,images,current)=>{
    const r=await tx.earnPayoutRequest.findFirst({where:{id:input.requestId,projectId:scope.projectId},include:{...requestInclude,paypal:{select:{id:true,code:true,status:true,archivedAt:true}}}});if(!r)throw new ProxyDomainError('NOT_FOUND',undefined,'NOT_FOUND');
    if(r.revision!==input.expectedRequestRevision)throw new ProxyDomainError('STALE_PREVIEW','Yêu cầu rút vừa được sửa; tải lại','REVISION_CONFLICT',{requestRevision:r.revision});
    const refuse=(m:string)=>{throw new ProxyDomainError('INVALID_INPUT',m,'VALIDATION',{submission:r.submission,state:r.state});};
    if(r.submission==='PREPARING')refuse('Yêu cầu chưa được ghi là đã gửi trên EarnApp; chưa nhận tiền cho yêu cầu này');
    if(r.submission==='UNKNOWN')refuse('Yêu cầu đang "chưa xác định kết quả gửi": đối chiếu lịch sử EarnApp và ghi đã gửi trước khi ghi tiền về');
    if(r.state!=='REQUESTED'&&r.state!=='LOST_SUS')refuse('Yêu cầu đã đánh dấu '+(r.state==='FAILED'?'thất bại':'huỷ')+'; đối chiếu ở Lịch sử VM trước');
    if(r.paypal.archivedAt)refuse('PP '+r.paypal.code+' không còn trong kho');
    const currency=currencyOf(input.currency);if(currency!==r.currency)refuse('Yêu cầu rút bằng '+r.currency+'; khoản về bằng '+currency+' cần đối chiếu ở Kho tài khoản');
    const amount=ledgerAmount(input.amount,'Số tiền thực nhận'),at=new Date(input.receivedAt);
    if(isNaN(at.getTime()))refuse('Thời điểm nhận không hợp lệ');if(at.getTime()>Date.now()+5*60e3)refuse('Thời điểm nhận ở tương lai');
    const date=dayDate(dayText(at));if(date<dayDate(dayText(r.requestedAt)))refuse('Ngày nhận trước ngày yêu cầu rút ('+dayText(r.requestedAt)+')');
    const txId=input.transactionId?.trim()||null;if(txId&&(txId.length>100||/\s/.test(txId)))refuse('Mã giao dịch tối đa 100 ký tự, không có khoảng trắng');
    if(txId){const t=await tx.fundTransaction.findFirst({where:{projectId:scope.projectId,transactionId:txId},select:{id:true,date:true,payoutRequestId:true}});
      if(t)throw new ProxyDomainError('INVALID_INPUT','Mã giao dịch đã ghi ngày '+dayText(t.date)+'; một giao dịch chỉ ghi một lần','DUPLICATE',{receiptId:t.id,withdrawalId:t.payoutRequestId});}
    else{const same=await tx.fundTransaction.findFirst({where:{projectId:scope.projectId,paypalEmailId:r.paypalEmailId,date,currency,amount,voidedAt:null,entryKind:'RECEIPT'},select:{id:true}});
      if(same)throw new ProxyDomainError('INVALID_INPUT','Đã có khoản cùng email, cùng ngày, cùng số tiền và không có mã giao dịch để phân biệt; đối chiếu ở Kho tài khoản (Khoản riêng do người xác nhận)','DUPLICATE',{receiptId:same.id});}
    // After the duplicate checks (a payment already recorded is reported as such, not as "over what is open").
    // Late money after SUS (28/10/2026): the request is reopened (the lost part is no longer lost) and the receipt recorded below.
    const late=r.state==='LOST_SUS';
    const m=moneyOfRequest(late?{...r,state:'REQUESTED'}:r),open=toCents(m.remaining)-toCents(m.pendingLinked);
    if(m.phase!=='WAITING')refuse(m.phase==='RECEIVED'?'Yêu cầu đã nhận đủ theo sổ':'Yêu cầu cần đối chiếu (nhận vượt hoặc khác đồng tiền)');
    // Owner 28/10/2026: the PayPal figure is exact and final, even a little above what is open; the surplus is settled below. Only a
    // linked pending receipt (older data) makes "above" ambiguous: reconcile that first.
    if(toCents(amount.toFixed(2))>open&&toCents(m.pendingLinked)>0)refuse('Yêu cầu còn khoản về chưa xác nhận ('+m.pendingLinked+' '+r.currency+'); đối chiếu ở Kho tài khoản trước khi ghi khoản lớn hơn phần còn chờ ('+fromCents(open)+')');
    await assertPeriodOpen(tx,scope.projectId,date,currency);
    const vm=await tx.virtualMachine.findUnique({where:{id:r.vmId},select:{serverId:true}});
    await images.remember('PAYOUT_REQUEST',r.id);await images.remember('PAYPAL',r.paypalId);await images.remember('PAYPAL_EMAIL',r.paypalEmailId);
    const evidence=input.evidence?.trim().slice(0,300)||null;
    const f=await tx.fundTransaction.create({data:{payoutRequestId:r.id,projectId:scope.projectId,date,amount,currency,transactionId:txId||'OPS-'+input.key,noTxId:!txId,confirmed:true,failed:false,company:'',paypalId:r.paypalId,paypalEmailId:r.paypalEmailId,earnAppId:r.earnAppId,vmId:r.vmId,serverId:vm?.serverId??null,entryKind:'RECEIPT',businessManaged:true,createdById:current.userId,notes:'Nhận lúc '+at.toISOString()+(evidence?' · '+evidence:'')}});
    await images.remember('FUND',f.id,true);
    await tx.payPalAccount.update({where:{id:r.paypalId},data:{revision:{increment:1}}});await tx.payPalEmail.update({where:{id:r.paypalEmailId},data:{revision:{increment:1}}});
    const history:Prisma.JsonArray=[...(r.history as Prisma.JsonArray)];
    const data:Prisma.EarnPayoutRequestUncheckedUpdateInput={revision:{increment:1}};
    const gap=open-toCents(amount.toFixed(2));let shortfall:string|null=null;
    // Late money after SUS (final review 28/10/2026): reopened only when it closes the request (the whole open part arrived, or the rest
    // is settled as a fee now); a part stays LOST_SUS with the lost part reduced, never back to "waiting".
    if(late&&(gap<=0||input.settleRemainder)){Object.assign(data,{state:'REQUESTED',lostAmount:null,lostAt:null});history.push(historyEntry(current.userId,'RECEIPT','Tiền về muộn sau SUS: yêu cầu mở lại (trước đó mất '+(r.lostAmount?.toFixed(2)??m.remaining)+' '+currency+')'));}
    else if(late){Object.assign(data,{lostAmount:D(fromCents(gap))});history.push(historyEntry(current.userId,'RECEIPT','Tiền về muộn sau SUS: '+amount.toFixed(2)+' '+currency+', còn mất '+fromCents(gap)+' '+currency));}
    history.push({...historyEntry(current.userId,'RECEIPT','Tiền về PP '+amount.toFixed(2)+' '+currency+(txId?' · mã '+txId:' · không có mã giao dịch')),observedAt:at.toISOString()});
    // Settle the rest as a fee in the same command (anyone who may record the receipt; a standalone SETTLE still needs writeMoney).
    if(input.settleRemainder&&gap>0){
      shortfall=fromCents(gap);const note='Phí / thiếu '+shortfall+' '+currency;
      Object.assign(data,{settledAt:new Date(),settledById:current.userId,settleNote:note,shortfall:D(shortfall)});
      history.push(historyEntry(current.userId,'SETTLE','Chốt nhận '+fromCents(toCents(m.received)+toCents(amount.toFixed(2)))+' '+currency+', thiếu '+shortfall+': '+note));
    }
    // Received more than open (owner 28/10/2026): always closed as received; the surplus is a negative shortfall with its own note.
    if(gap<0){
      shortfall=fromCents(gap);const note='Nhận dư '+formatMoney(fromCents(-gap),currency);
      Object.assign(data,{settledAt:new Date(),settledById:current.userId,settleNote:note,shortfall:D(shortfall)});
      history.push(historyEntry(current.userId,'SETTLE','Chốt nhận '+fromCents(toCents(m.received)+toCents(amount.toFixed(2)))+' '+currency+', dư '+fromCents(-gap)+': '+note));
    }
    await tx.earnPayoutRequest.update({where:{id:r.id},data:{...data,history}});
    return {settled:shortfall!==null,shortfall,receiptId:f.id,requestId:r.id,vmId:r.vmId,cycle:r.cycle,earnAppId:r.earnAppId,paypalEmailId:r.paypalEmailId,amount:amount.toFixed(2),currency,receivedOn:dayText(date),receivedAt:at.toISOString(),transactionId:txId};
  },db);
}
// ─── Commands ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PayoutRequestInput {key:string;vmId:string;expectedCycle:number;/** VM revision seen (ops API); checked in the transaction. */expectedVmRevision?:number;/** The EarnApp seen when the form was opened (review fix 20/10/2026): another account on the VM meanwhile is refused. */earnAppId?:string;paypalEmailId:string;amount:string;currency?:string;reference?:string|null;date:string;/** PREPARING = hold the email, not sent on EarnApp yet (AI flow); default SENT = sent on EarnApp (as before 20/10/2026). */submission?:'PREPARING'|'SENT';/** Merged payout (27/10/2026): other VMs whose SDKs were merged into this EarnApp account. */members?:MemberInput[]}
export async function createPayoutRequest(scope:ActorScope,input:PayoutRequestInput,db:PrismaClient=prisma){
  // A member with only EARN_PAYOUT may prepare (PREPARING); recording a request as already sent stays with the managers.
  const authorize=async(tx:Tx)=>{const r=await payoutRights(scope,tx);if(!(r.writeMoney||r.payout&&input.submission==='PREPARING'))throw new ProxyDomainError('FORBIDDEN',NO_PAYOUT);return r.current;};
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_PAYOUT_REQUEST',module:'FUNDS',authorize},async(tx,images,current)=>{
    const vm=await activeVM(tx,scope.projectId,input.vmId);if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không còn hoạt động');
    const ops=await tx.vmOperation.findUnique({where:{vmId:vm.id}}),cycle=ops?.cycle??1;
    if(cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle),'CYCLE_CHANGED',{cycle});
    if(input.expectedVmRevision!==undefined&&vm.revision!==input.expectedVmRevision)throw new ProxyDomainError('STALE_PREVIEW','VM vừa được sửa; tải lại','REVISION_CONFLICT',{vmRevision:vm.revision});
    const earnApp=await tx.earnAppAccount.findUnique({where:{vmId:vm.id},include:{payoutRequest:{include:{paypal:{select:{code:true}}}},login:{select:{email:true}}}});
    if(!earnApp||earnApp.closedAt)throw new ProxyDomainError('INVALID_INPUT','VM chưa có tài khoản EarnApp; gán tài khoản trước',input.earnAppId!==undefined?'ACCOUNT_CHANGED':'VALIDATION');
    if(input.earnAppId!==undefined&&earnApp.id!==input.earnAppId)throw new ProxyDomainError('STALE_PREVIEW','VM đã đổi tài khoản EarnApp từ khi mở form; nháp giữ cho tài khoản cũ, kiểm tra lại rồi ghi lần mới','ACCOUNT_CHANGED',{earnAppAccountId:earnApp.id});
    if(earnApp.payoutRequest){const r=earnApp.payoutRequest;throw new ProxyDomainError('INVALID_INPUT','EarnApp '+earnApp.login.email+' đã có yêu cầu rút ngày '+dayText(r.requestedAt)+' (PP '+r.paypal.code+'); mỗi EarnApp chỉ một lượt rút. Sửa trạng thái trên yêu cầu đó','DUPLICATE',{withdrawalId:r.id});}
    // A VM merged into another open request this round cannot open its own (it would be in two requests at once).
    const merged=await tx.earnPayoutMember.findFirst({where:{projectId:scope.projectId,vmId:vm.id,cycle,removedAt:null,request:{state:'REQUESTED'}},select:{request:{select:{id:true,vmId:true}}}});
    if(merged){const p=await tx.virtualMachine.findUnique({where:{id:merged.request.vmId},select:{code:true,server:{select:{code:true}}}});throw new ProxyDomainError('INVALID_INPUT','VM '+vm.server.code+' / '+vm.code+' đã gộp vào lệnh rút của '+(p?p.server.code+' / '+p.code:'VM khác')+'; không ghi lệnh riêng','DUPLICATE',{withdrawalId:merged.request.id});}
    if(input.members?.length&&input.members.length>100)throw new ProxyDomainError('INVALID_INPUT','Gộp tối đa 100 VM','VALIDATION');
    const amount=ledgerAmount(input.amount,'Số tiền yêu cầu'),currency=currencyOf(input.currency||'USD'),date=dayDate(input.date);
    let emailId=earnApp.paypalEmailId;const submission=input.submission||'SENT';
    if(submission==='PREPARING'&&input.paypalEmailId!==earnApp.paypalEmailId){
      // Being prepared: the email is only held (one holder at a time, conditional write); it becomes this EarnApp's for good only
      // when the request is confirmed sent. Same checks as an assignment (free, not held for review, PP usable).
      await authorizeVM(current,'ASSIGN',tx);
      // Held for another EarnApp (another person / token got there first): the web answer is unchanged; the ops API reports a conflict.
      const held=await tx.payPalEmail.findFirst({where:{id:input.paypalEmailId,projectId:scope.projectId},select:{holdEarnAppId:true}});
      if(held?.holdEarnAppId&&held.holdEarnAppId!==earnApp.id){const r=await checkLink(tx,scope.projectId,vm,{paypalEmail:input.paypalEmailId});throw new ProxyDomainError('INVALID_INPUT',r.ok?'Email PayPal đang được giữ cho EarnApp khác':r.message,'REVISION_CONFLICT');}
      const r=await checkLink(tx,scope.projectId,vm,{paypalEmail:input.paypalEmailId});if(!r.ok)throw new ProxyDomainError('INVALID_INPUT',r.message,'VALIDATION');
      await images.remember('PAYPAL_EMAIL',input.paypalEmailId);
      const n=await tx.payPalEmail.updateMany({where:{id:input.paypalEmailId,projectId:scope.projectId,holdEarnAppId:null,usedEarnAppId:null,reviewHold:false,earnApp:null},data:{holdEarnAppId:earnApp.id,holdAt:new Date(),revision:{increment:1}}});
      if(n.count!==1)throw new ProxyDomainError('STALE_PREVIEW','Email PayPal vừa được người khác giữ hoặc cấp; tải lại và chọn email khác','REVISION_CONFLICT');
      emailId=input.paypalEmailId;
    }else if(input.paypalEmailId!==earnApp.paypalEmailId){
      // A new receiving email: the same checked assignment as Server / VM (one email, one EarnApp, forever).
      await authorizeVM(current,'ASSIGN',tx);
      const r=await checkLink(tx,scope.projectId,vm,{paypalEmail:input.paypalEmailId});if(!r.ok)throw new ProxyDomainError('INVALID_INPUT',r.message);
      if(!r.skip&&r.plan){try{await writeLink(tx,images,scope.projectId,vm,r.plan,current.userId);}catch(e){if((e as {code?:string}).code==='P2002')throw new ProxyDomainError('STALE_PREVIEW','Email PayPal vừa được cấp cho EarnApp khác; tải lại');throw e;}}
      emailId=input.paypalEmailId;
    }
    if(!emailId)throw new ProxyDomainError('INVALID_INPUT','Chọn Mã PP → Email nhận tiền');
    const email=await tx.payPalEmail.findFirstOrThrow({where:{id:emailId,projectId:scope.projectId}});
    await assertPayoutDailySlot(tx,scope.projectId,email.paypalId,email.id);
    let row;
    try{row=await tx.earnPayoutRequest.create({data:{projectId:scope.projectId,earnAppId:earnApp.id,vmId:vm.id,cycle,paypalId:email.paypalId,paypalEmailId:email.id,currency,amount,reference:input.reference?.trim().slice(0,200)||null,requestedAt:date,requestedById:current.userId,submission,submittedAt:submission==='SENT'?new Date():null,history:[historyEntry(current.userId,submission==='PREPARING'?'PREPARED':'REQUESTED',(submission==='PREPARING'?'Chuẩn bị rút ':'Ghi yêu cầu rút ')+amount.toFixed(2)+' '+currency)]}});}
    catch(e){if((e as {code?:string}).code==='P2002')throw new ProxyDomainError('STALE_PREVIEW','EarnApp này vừa được ghi yêu cầu rút; tải lại','DUPLICATE');throw e;}
    if(submission==='SENT')await consumePayoutDailySlot(tx,row);
    await images.remember('PAYOUT_REQUEST',row.id,true);
    const members=await attachMembers(tx,images,{projectId:scope.projectId,actorId:current.userId,scope:current},row,input.members??[]);
    // What was recorded (kept with the command key): a retry acknowledges this request as it was created.
    return {members:members.map(m=>({vmId:m.vmId,where:m.where})),id:row.id,where:vm.server.code+' / '+vm.code,cycle,vmId:vm.id,earnAppId:earnApp.id,paypalEmailId:email.id,amount:amount.toFixed(2),currency,submission,requestedOn:dayText(date)};
  },db);
}
export type PayoutAction='FAILED'|'CANCELLED'|'RETRY'|'CORRECT'|'SETTLE'|'SENT'|'UNKNOWN';
// Review fix 20/10/2026. A request belongs to one VM, round and EarnApp. A command from the VM cell names them (vmId, expectedCycle,
// earnAppId) and is refused once the request is no longer the open one of that VM (the account was changed or the VM recreated):
// it never gives the email to, links it to or marks it used by the account now on the VM. Reconciling an old account's request
// (history: true, from the VM's history) acts on that old account only: SENT makes the email its receiving email for good (so
// late money links to the request), UNKNOWN keeps the hold, FAILED / CANCELLED give a held email back, CORRECT / SETTLE fix money;
// RETRY is refused (sending again is work on the machine, which that account has left).
export interface PayoutUpdateInput {key:string;requestId:string;expectedRevision:number;action:PayoutAction;note?:string|null;amount?:string|null;reference?:string|null;vmId?:string;expectedCycle?:number;earnAppId?:string;history?:boolean;/** VM revision seen (ops API). */expectedVmRevision?:number;/** When SENT / UNKNOWN was seen on EarnApp (ops API); kept on the history line next to the server time. */observedAt?:string|null}
export async function updatePayoutRequest(scope:ActorScope,input:PayoutUpdateInput,db:PrismaClient=prisma){
  // EARN_PAYOUT covers only the milestones of the current request (sent / unknown); corrections, failures, retries, settling and
  // reconciling an old account's request stay with the managers.
  const authorize=async(tx:Tx)=>{const r=await payoutRights(scope,tx);if(!(r.writeMoney||r.payout&&(input.action==='SENT'||input.action==='UNKNOWN')&&!input.history))throw new ProxyDomainError('FORBIDDEN',NO_PAYOUT);return r.current;};
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_PAYOUT_UPDATE',module:'FUNDS',skipJournalWhenUnchanged:true,authorize},async(tx,images,current)=>{
    const r=await tx.earnPayoutRequest.findFirst({where:{id:input.requestId,projectId:scope.projectId},include:requestInclude});if(!r)throw new ProxyDomainError('NOT_FOUND');
    if(r.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','Yêu cầu rút vừa được sửa; tải lại','REVISION_CONFLICT',{requestRevision:r.revision});
    const note=input.note?.trim().slice(0,500)||null,m=moneyOfRequest(r);
    if(r.consumedAt)throw new ProxyDomainError('INVALID_INPUT','Yêu cầu này đã dùng để ghi tạo lại VM; chỉ đối chiếu, không đổi trạng thái');
    const data:Prisma.EarnPayoutRequestUncheckedUpdateInput={};let what='';const kind:PayoutHistoryKind=input.action;
    const earnApp=await tx.earnAppAccount.findUniqueOrThrow({where:{id:r.earnAppId}});
    const mismatch='Yêu cầu rút này không thuộc VM / lượt / EarnApp đang mở trên form; tải lại';
    if(input.vmId!==undefined&&input.vmId!==r.vmId)throw new ProxyDomainError('STALE_PREVIEW',mismatch,'NOT_FOUND');
    if(input.expectedCycle!==undefined&&input.expectedCycle!==r.cycle)throw new ProxyDomainError('STALE_PREVIEW',mismatch,'CYCLE_CHANGED');
    if(input.earnAppId!==undefined&&input.earnAppId!==r.earnAppId)throw new ProxyDomainError('STALE_PREVIEW',mismatch,'ACCOUNT_CHANGED');
    const vmNow=await activeVM(tx,scope.projectId,r.vmId),opsNow=vmNow?await tx.vmOperation.findUnique({where:{vmId:vmNow.id},select:{cycle:true}}):null;
    const live=!!vmNow&&earnApp.vmId===r.vmId&&!earnApp.closedAt&&(opsNow?.cycle??1)===r.cycle;
    if(!live&&!input.history)throw new ProxyDomainError('STALE_PREVIEW','VM đã đổi tài khoản EarnApp hoặc sang lượt mới; yêu cầu này thuộc tài khoản cũ — đối chiếu ở Lịch sử của VM, không áp vào tài khoản hiện hành',vmNow&&(opsNow?.cycle??1)!==r.cycle?'CYCLE_CHANGED':'ACCOUNT_CHANGED');
    if(input.expectedVmRevision!==undefined&&vmNow&&vmNow.revision!==input.expectedVmRevision)throw new ProxyDomainError('STALE_PREVIEW','VM vừa được sửa; tải lại','REVISION_CONFLICT',{vmRevision:vmNow.revision});
    // Lost to SUS (final review 28/10/2026): no status / money action may touch it (it would corrupt the lost totals); only late money
    // ("Tiền đã về") or undo of the SUS command. Checked after the identity checks (a stale form gets its stale answer first).
    if(r.state==='LOST_SUS')throw new ProxyDomainError('INVALID_INPUT','Yêu cầu đã mất do SUS; chỉ ghi được tiền về muộn','VALIDATION');
    const observedAt=input.observedAt?new Date(input.observedAt):null;if(observedAt&&isNaN(observedAt.getTime()))throw new ProxyDomainError('INVALID_INPUT','Thời điểm quan sát không hợp lệ','VALIDATION');
    if(!live&&input.action==='RETRY')throw new ProxyDomainError('INVALID_INPUT','Tài khoản của yêu cầu này đã rời VM / lượt; không gửi lại, chỉ đối chiếu lịch sử');
    const release=async()=>{if(r.submission==='SENT')return;await images.remember('PAYPAL_EMAIL',r.paypalEmailId);await tx.payPalEmail.updateMany({where:{id:r.paypalEmailId,holdEarnAppId:r.earnAppId},data:{holdEarnAppId:null,holdAt:null,revision:{increment:1}}});};
    if(input.action==='SENT'||input.action==='UNKNOWN'){
      // Milestones of a payout prepared by a person / AI (owner brief 20/10/2026). SENT = EarnApp's own history shows the request:
      // the held email becomes this EarnApp's receiving email for good (same checked assignment). UNKNOWN = clicked but not
      // confirmed: stays held, needs reconciling against EarnApp's history before anything else is done (no second click).
      if(r.state!=='REQUESTED')throw new ProxyDomainError('INVALID_INPUT','Yêu cầu không còn mở; gửi lại trước');
      if(input.action==='UNKNOWN'){if(r.submission!=='PREPARING')return {id:r.id,changed:false};await assertPayoutDailySlot(tx,scope.projectId,r.paypalId,r.paypalEmailId);await consumePayoutDailySlot(tx,r);Object.assign(data,{submission:'UNKNOWN'});what='Chưa xác định kết quả gửi trên EarnApp'+(note?': '+note:'');}
      else{
        if(r.submission==='SENT')return {id:r.id,changed:false};
        await assertPayoutDailySlot(tx,scope.projectId,r.paypalId,r.paypalEmailId);
        await consumePayoutDailySlot(tx,r);
        if(!live&&earnApp.paypalEmailId!==r.paypalEmailId){
          // Old account (history): the email becomes ITS receiving email; the VM and the account now on it are not touched.
          await authorizeVM(current,'ASSIGN',tx);
          const email=await tx.payPalEmail.findFirst({where:{id:r.paypalEmailId,projectId:scope.projectId},include:{earnApp:{select:{id:true}}}});
          if(!email||(email.usedEarnAppId&&email.usedEarnAppId!==r.earnAppId)||(email.earnApp&&email.earnApp.id!==r.earnAppId)||(email.holdEarnAppId&&email.holdEarnAppId!==r.earnAppId))throw new ProxyDomainError('INVALID_INPUT','Email của yêu cầu đã cấp cho EarnApp khác; đối chiếu ở Kho tài khoản');
          await images.remember('EARNAPP',earnApp.id);await images.remember('PAYPAL_EMAIL',email.id);
          await tx.earnAppAccount.update({where:{id:earnApp.id},data:{paypalId:email.paypalId,paypalEmailId:email.id,revision:{increment:1}}});
          await tx.payPalEmail.update({where:{id:email.id},data:{usedEarnAppId:r.earnAppId,usedAt:email.usedAt??new Date(),holdEarnAppId:null,holdAt:null,revision:{increment:1}}});
          const period=await tx.earnAppPayout.create({data:{projectId:scope.projectId,earnAppId:earnApp.id,paypalId:email.paypalId,paypalEmailId:email.id,vmId:r.vmId,createdById:current.userId,endedAt:new Date()}});await images.remember('PAYOUT',period.id,true);
        }else if(earnApp.paypalEmailId!==r.paypalEmailId){
          await authorizeVM(current,'ASSIGN',tx);
          const vm=await activeVM(tx,scope.projectId,r.vmId);if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không còn hoạt động');
          await release();
          const c=await checkLink(tx,scope.projectId,vm,{paypalEmail:r.paypalEmailId});if(!c.ok)throw new ProxyDomainError('INVALID_INPUT',c.message);
          if(!c.skip&&c.plan){try{await writeLink(tx,images,scope.projectId,vm,c.plan,current.userId);}catch(e){if((e as {code?:string}).code==='P2002')throw new ProxyDomainError('STALE_PREVIEW','Email PayPal vừa được cấp cho EarnApp khác; tải lại');throw e;}}
        }
        Object.assign(data,{submission:'SENT',submittedAt:new Date()});what='Đã gửi trên EarnApp (xác nhận theo lịch sử EarnApp'+(live?'':', đối chiếu tài khoản cũ')+')'+(note?': '+note:'');
      }
    }else if(input.action==='FAILED'||input.action==='CANCELLED'){
      if(!note)throw new ProxyDomainError('INVALID_INPUT','Ghi căn cứ (lý do) khi đánh dấu '+(input.action==='FAILED'?'thất bại':'huỷ'));
      if(r.state===input.action&&r.stateNote===note)return {id:r.id,changed:false};
      // A preparation that never reached EarnApp gives its held email back (it was never used).
      await release();
      Object.assign(data,{state:input.action,stateNote:note});what=(input.action==='FAILED'?'Thất bại':'Huỷ')+': '+note;
    }else if(input.action==='RETRY'){
      if(r.state==='REQUESTED')return {id:r.id,changed:false};
      await assertMembersFree(tx,scope.projectId,r.id);
      await assertPayoutDailySlot(tx,scope.projectId,r.paypalId,r.paypalEmailId);
      if(r.submission==='SENT'||r.submission==='UNKNOWN')await consumePayoutDailySlot(tx,r);
      // A preparation sent again holds its email again (conditional: it may have been taken meanwhile).
      if(r.submission!=='SENT'&&earnApp.paypalEmailId!==r.paypalEmailId){await images.remember('PAYPAL_EMAIL',r.paypalEmailId);const n=await tx.payPalEmail.updateMany({where:{id:r.paypalEmailId,holdEarnAppId:null,usedEarnAppId:null,earnApp:null},data:{holdEarnAppId:r.earnAppId,holdAt:new Date(),revision:{increment:1}}});if(n.count!==1)throw new ProxyDomainError('STALE_PREVIEW','Email của yêu cầu này đã được giữ / cấp cho EarnApp khác; huỷ và chuẩn bị lại với email khác');}
      Object.assign(data,{state:'REQUESTED',stateNote:note});what='Gửi lại (cùng lượt rút)'+(note?': '+note:'');
    }else if(input.action==='CORRECT'){
      const amount=input.amount!=null?ledgerAmount(input.amount,'Số tiền yêu cầu'):r.amount,reference=input.reference!==undefined?input.reference?.trim().slice(0,200)||null:r.reference;
      if(amount.eq(r.amount)&&reference===r.reference)return {id:r.id,changed:false};
      if(!note)throw new ProxyDomainError('INVALID_INPUT','Ghi lý do khi sửa số tiền / mã tham chiếu');
      Object.assign(data,{amount,reference,settledAt:null,settledById:null,settleNote:null,shortfall:null});what='Sửa '+(amount.eq(r.amount)?'':r.amount.toFixed(2)+' → '+amount.toFixed(2)+' '+r.currency+' ')+(reference!==r.reference?'mã tham chiếu ':'')+'· '+note;
    }else{
      // Received less than asked: settled only with a stated reason (fee / shortfall); the gap is recorded, never assumed.
      if(m.phase!=='WAITING'||toCents(m.received)<=0)throw new ProxyDomainError('INVALID_INPUT','Chỉ chốt thiếu khi đã nhận một phần và còn chờ');
      if(!note)throw new ProxyDomainError('INVALID_INPUT','Ghi rõ phí / chênh lệch khi chốt nhận thiếu');
      const shortfall=D(m.remaining);Object.assign(data,{settledAt:new Date(),settledById:current.userId,settleNote:note,shortfall});what='Chốt nhận '+m.received+' '+r.currency+', thiếu '+shortfall.toFixed(2)+': '+note;
    }
    await images.remember('PAYOUT_REQUEST',r.id);
    const after=await tx.earnPayoutRequest.update({where:{id:r.id},data:{...data,revision:{increment:1},history:[...(r.history as Prisma.JsonArray),{...historyEntry(current.userId,kind,what),...(observedAt?{observedAt:observedAt.toISOString()}:{})}]}});
    if(input.action==='SENT')await linkMergedSdks(tx,images,{projectId:scope.projectId,actorId:current.userId},r.id);
    return {id:r.id,changed:true,action:input.action,vmId:r.vmId,cycle:r.cycle,earnAppId:r.earnAppId,revision:after.revision,submission:after.submission,state:after.state,observedAt:observedAt?.toISOString()??null};
  },db);
}
// ─── Reads ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Operating state of every VM for the Server / VM grid: recorded status and round, the money milestone of the current round, and
// (only with the money rights) the amounts.
export type MergeView=null|{role:'PRIMARY';members:{vmId:string;where:string;share:string|null;consumed:boolean}[]}|{role:'MEMBER';primaryVmId:string;primaryWhere:string;consumed:boolean};
export async function readVmOps(scope:ActorScope,db:PrismaClient=prisma){
  const current=await authorizeVM(scope,'READ',db);const {money:book,writeMoney,assign,payout,receipt,requestMoney:money}=await payoutRights(scope,db),bal=await balanceRights(scope,db);
  const [vms,users]=await Promise.all([db.virtualMachine.findMany({where:{managed:true,server:{projectId:scope.projectId,managed:true},...vmWhere(current)},select:{id:true,operation:true,earnApp:{select:{id:true,closedAt:true,payoutRequest:{include:requestInclude}}}}}),db.user.findMany({where:{memberships:{some:{projectId:scope.projectId}}},select:{id:true,name:true,username:true}})]);
  const who=(id:string|null|undefined)=>{const u=id?users.find(x=>x.id===id):null;return u?u.name||u.username||'Tài khoản cũ':null;};
  const balances=await currentBalances(db,scope.projectId,vms.map(v=>({id:v.id,cycle:v.operation?.cycle??1,earnAppId:v.earnApp&&!v.earnApp.closedAt?v.earnApp.id:null})),bal.read);
  // Merged payout (27/10/2026): a member VM shows the request it was merged into (this round); a primary lists its members.
  const cycleOf=new Map(vms.map(v=>[v.id,v.operation?.cycle??1]));
  const asMember=(await db.earnPayoutMember.findMany({where:{projectId:scope.projectId,removedAt:null,vmId:{in:vms.map(v=>v.id)},request:{state:'REQUESTED'}},include:{request:{include:requestInclude}}})).filter(m=>cycleOf.get(m.vmId)===m.cycle);
  // Members of a payout lost to SUS follow their primary (memberOf): the queue "Chờ tạo lại" reads them in the same batch.
  const lostMembers=(await db.earnPayoutMember.findMany({where:{projectId:scope.projectId,removedAt:null,vmId:{in:vms.map(v=>v.id)},request:{state:'LOST_SUS'}},orderBy:{createdAt:'desc'},include:{request:{include:{...requestInclude,earnApp:{select:{closedReason:true}}}}}})).filter(m=>cycleOf.get(m.vmId)===m.cycle);
  const memberPrimaries=[...asMember,...lostMembers].map(m=>m.request.vmId);
  const primaryOps=new Map((await db.vmOperation.findMany({where:{vmId:{in:[...new Set(memberPrimaries)]}},select:{vmId:true,cycle:true,status:true}})).map(o=>[o.vmId,o]));
  const primaryClosed=new Map((await db.earnAppAccount.findMany({where:{id:{in:asMember.map(m=>m.request.earnAppId)}},select:{id:true,closedReason:true}})).map(e=>[e.id,e.closedReason]));
  const memberReady=(vmId:string)=>{
    const m=asMember.find(x=>x.vmId===vmId)??lostMembers.find(x=>x.vmId===vmId);if(!m)return null;
    const r=m.request,ops=primaryOps.get(r.vmId),closed=r.state==='LOST_SUS'?'SUSPENDED':primaryClosed.get(r.earnAppId);
    return {consumed:!!m.consumedAt,phase:moneyOfRequest(r).phase,primarySus:r.state==='LOST_SUS'||closed==='SUSPENDED'||(ops?.status==='SUSPENDED'&&ops.cycle===r.cycle)};
  };
  const primaryIds=vms.map(v=>v.earnApp?.payoutRequest?.id).filter((x):x is string=>!!x);
  const ofPrimary=await db.earnPayoutMember.findMany({where:{projectId:scope.projectId,removedAt:null,requestId:{in:primaryIds}},orderBy:{createdAt:'asc'}});
  const names=new Map((await db.virtualMachine.findMany({where:{id:{in:[...new Set([...asMember.map(m=>m.request.vmId),...ofPrimary.map(m=>m.vmId)])]}},select:{id:true,code:true,server:{select:{code:true}}}})).map(v=>[v.id,v.server.code+' / '+v.code]));
  const requestView=(r:NonNullable<NonNullable<typeof vms[number]['earnApp']>['payoutRequest']>,m:ReturnType<typeof moneyOfRequest>)=>({id:r.id,revision:r.revision,cycle:r.cycle,earnAppId:r.earnAppId,state:r.state,submission:r.submission,submittedAt:r.submittedAt?.toISOString()??null,stateNote:money?r.stateNote:null,phase:m.phase,paypalId:r.paypal.id,paypal:r.paypal.code,email:r.paypalEmail.email,emailId:r.paypalEmail.id,requestedAt:dayText(r.requestedAt),reference:money?r.reference:null,settled:!!r.settledAt,
    money:money?{lost:r.lostAmount?.toFixed(2)??null,amount:r.amount.toFixed(2),currency:r.currency,received:m.received,pendingLinked:m.pendingLinked,remaining:m.remaining,shortfall:r.shortfall?.toFixed(2)??null,settleNote:r.settleNote}:null});
  // money = amounts of payout requests (PayPal money readers, or EARN_PAYOUT / PAYPAL_RECEIPT_RECORD); book = the PayPal book itself.
  return {rights:{money,book,writeMoney,assign,payout,receipt,balanceRead:bal.read,balanceWrite:bal.write},vms:vms.map(v=>{
    const cycle=v.operation?.cycle??1,own=v.earnApp?.payoutRequest&&v.earnApp.payoutRequest.cycle===cycle&&v.earnApp.payoutRequest.vmId===v.id?v.earnApp.payoutRequest:null;
    const mem=own?null:asMember.find(x=>x.vmId===v.id)??null,r=own??mem?.request??null,m=r?moneyOfRequest(r):null;
    const members=own?ofPrimary.filter(x=>x.requestId===own.id):[];
    const merge:MergeView=mem?{role:'MEMBER',primaryVmId:mem.request.vmId,primaryWhere:names.get(mem.request.vmId)??'',consumed:!!mem.consumedAt}:members.length?{role:'PRIMARY',members:members.map(x=>({vmId:x.vmId,where:names.get(x.vmId)??'',share:money?x.shareAmount?.toFixed(2)??null:null,consumed:!!x.consumedAt}))}:null;
    return {vmId:v.id,cycle,earnAppId:v.earnApp&&!v.earnApp.closedAt?v.earnApp.id:null,balance:balances.get(v.id)??{latest:null,lastOk:null},status:v.operation?.status??null,statusAt:v.operation?.statusAt?.toISOString()??null,statusBy:who(v.operation?.statusById),milestone:recreateReady({status:v.operation?.status??null,own:own&&m?{state:own.state,phase:m.phase,consumed:!!own.consumedAt}:null,member:memberReady(v.id)})?'RECREATE':milestoneOf(m&&{phase:m.phase,consumed:mem?!!mem.consumedAt:!!r!.consumedAt,submission:r!.submission}),
      merge,request:r?requestView(r,m!):null};
  })};
}
// History of one VM position: recorded statuses, closed rounds and the payout requests of every round.
export async function readVmOpsHistory(scope:ActorScope,input:{vmId:string},db:PrismaClient=prisma){
  await assertScopedVmIds(db,scope,[input.vmId]);
  const current=await authorizeVM(scope,'READ',db);const {money,writeMoney}=await payoutRights(scope,db);
  const vm=await db.virtualMachine.findFirst({where:{id:input.vmId,managed:true,server:{projectId:scope.projectId,managed:true}},select:{id:true,operation:{select:{cycle:true}}}});if(!vm)throw new ProxyDomainError('NOT_FOUND');
  const [events,cycles,requests,users]=await Promise.all([db.vmOpsEvent.findMany({where:{vmId:vm.id,projectId:scope.projectId},orderBy:{createdAt:'desc'},take:200}),db.vmCycle.findMany({where:{vmId:vm.id,projectId:scope.projectId},orderBy:{number:'desc'}}),
    db.earnPayoutRequest.findMany({where:{projectId:scope.projectId,OR:[{vmId:vm.id},{members:{some:{vmId:vm.id,removedAt:null}}}]},include:{...requestInclude,earnApp:{select:{login:{select:{email:true}},closedAt:true,vmId:true}}},orderBy:{createdAt:'desc'}}),db.user.findMany({where:{memberships:{some:{projectId:scope.projectId}}},select:{id:true,name:true,username:true}})]);
  const who=(id:string|null|undefined)=>{const u=id?users.find(x=>x.id===id):null;return u?u.name||u.username||'Tài khoản cũ':'—';};
  const logins=await db.gmailAccount.findMany({where:{id:{in:cycles.map(c=>c.loginId).filter((x):x is string=>!!x)}},select:{id:true,email:true}});
  // Merged payout (27/10/2026): a request this VM was merged into is listed with its primary VM; it is acted on from the primary only.
  const primaries=new Map((await db.virtualMachine.findMany({where:{id:{in:requests.filter(r=>r.vmId!==vm.id).map(r=>r.vmId)}},select:{id:true,code:true,server:{select:{code:true}}}})).map(v=>[v.id,v.server.code+' / '+v.code]));
  // Requests removed as mistaken (28/10/2026): kept as a full snapshot; the VM history still shows "Đã xoá do ghi nhầm".
  const voids=await db.earnPayoutRequestVoid.findMany({where:{projectId:scope.projectId,vmId:vm.id},orderBy:{voidedAt:'desc'}});
  return {
    voided:voids.map(v=>{const s=v.snapshot as {amount?:string;currency?:string;paypalCode?:string;email?:string};
      return {id:v.id,requestId:v.requestId,cycle:v.cycle,at:v.voidedAt.toISOString(),by:who(v.voidedById),reason:money?v.reason:null,paypal:s.paypalCode??null,email:s.email??null,amount:money?s.amount??null:null,currency:money?s.currency??null:null};}),
    events:events.map(e=>({id:e.id,cycle:e.cycle,kind:e.kind,from:e.fromStatus,to:e.toStatus,note:hasServerScope(current)?null:e.note,detail:hasServerScope(current)?null:e.detail,by:who(e.actorId),at:e.createdAt.toISOString()})),
    cycles:cycles.map(c=>({number:c.number,reason:c.reason,login:logins.find(l=>l.id===c.loginId)?.email??null,sdk:hasServerScope(current)?null:c.sdkId,status:c.status,closedAt:c.closedAt.toISOString(),by:who(c.closedById),note:c.note,proxyKept:!!c.proxyKept})),
    // old = the request's account has left this VM or round: only reconciling it is offered (never on the account now on the VM).
    rights:{writeMoney},
    requests:requests.map(r=>{const m=moneyOfRequest(r),old=r.vmId!==vm.id||!(r.earnApp.vmId===vm.id&&!r.earnApp.closedAt&&(vm.operation?.cycle??1)===r.cycle);return {memberOf:r.vmId!==vm.id?primaries.get(r.vmId)??r.vmId:null,id:r.id,revision:r.revision,vmId:r.vmId,earnAppId:r.earnAppId,submission:r.submission,old,cycle:r.cycle,login:r.earnApp.login.email,paypal:r.paypal.code,email:r.paypalEmail.email,requestedAt:dayText(r.requestedAt),state:r.state,phase:m.phase,consumed:!!r.consumedAt,reviewAfterRecreate:m.reviewAfterRecreate,
      history:(r.history as {at:string;by:string;kind?:string;what:string}[]).map(h=>({at:h.at,by:who(h.by),what:money?h.what:neutralHistory(h)})),money:money?{amount:r.amount.toFixed(2),currency:r.currency,received:m.received,remaining:m.remaining,receipts:r.receipts.map(x=>({date:dayText(x.date),amount:x.amount.toFixed(2),currency:x.currency,status:x.voidedAt?'Đã thu hồi':x.failed?'Không về':x.confirmed?'Đã nhận':'Chờ nhận'}))}:null};}),
  };
}
