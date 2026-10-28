import type {Prisma} from '@prisma/client';
import {fromCents,requestMoney,surplusNeedsConfirm,toCents} from '@/lib/vm-ops';
import {formatMoney} from '@/lib/money-input';
import type {BusinessCollector} from '../business-management/idempotency';
// Surplus settle outside recordPayoutReceipt (review 29/10/2026). recordPayoutReceipt settles a receipt above the request itself; these
// two helpers keep the other money paths consistent with it:
// - a confirmed receipt linked by email in Tiền vào PayPal / Kho tài khoản (recordReceipts) that takes a WAITING request above its
//   amount settles the surplus the same way (negative shortfall, "Nhận dư $X", SETTLE history) while it is within
//   max(1.00, 5% of the request); a larger surplus is left unsettled, so the request shows "Cần đối chiếu" (REVIEW) as before;
// - voiding a receipt of a request closed by a surplus settle clears that settle (it was computed from the voided money).
type Tx=Prisma.TransactionClient;
const entry=(by:string,what:string)=>({at:new Date().toISOString(),by,kind:'SETTLE',what});
const include={receipts:{select:{amount:true,currency:true,confirmed:true,failed:true,voidedAt:true}}} as const;
type Row=NonNullable<Awaited<ReturnType<typeof load>>>;
const load=(tx:Tx,id:string)=>tx.earnPayoutRequest.findUnique({where:{id},include});
const money=(r:Row)=>requestMoney({amount:r.amount.toString(),currency:r.currency,state:r.state,settledAt:r.settledAt?.toISOString()??null,shortfall:r.shortfall?.toString()??null,consumedAt:r.consumedAt?.toISOString()??null,
  receipts:r.receipts.map(x=>({amount:x.amount.toString(),currency:x.currency,confirmed:x.confirmed,failed:x.failed,voided:!!x.voidedAt}))});
/** Phase of a request before a linked receipt is written (null = no such request). */
export async function requestPhase(tx:Tx,requestId:string){const r=await load(tx,requestId);return r?money(r).phase:null;}
/** After a confirmed linked receipt: settle a small surplus on a request that was WAITING before it. */
export async function settleLinkedSurplus(tx:Tx,images:BusinessCollector,requestId:string,actorId:string,wasWaiting:boolean){
  if(!wasWaiting)return null;const r=await load(tx,requestId);if(!r||r.state!=='REQUESTED'||r.settledAt)return null;
  const m=money(r),amount=toCents(r.amount.toFixed(2)),received=toCents(m.received);
  if(m.phase!=='REVIEW'||received<=amount||toCents(m.pendingLinked)>0)return null;
  if(r.receipts.some(x=>!x.voidedAt&&!x.failed&&x.currency!==r.currency))return null;
  const over=received-amount;if(surplusNeedsConfirm(amount,over))return null;
  const note='Nhận dư '+formatMoney(fromCents(over),r.currency);
  await images.remember('PAYOUT_REQUEST',r.id);
  await tx.earnPayoutRequest.update({where:{id:r.id},data:{settledAt:new Date(),settledById:actorId,settleNote:note,shortfall:fromCents(-over),revision:{increment:1},
    history:[...(r.history as Prisma.JsonArray),entry(actorId,'Chốt nhận '+fromCents(received)+' '+r.currency+', dư '+fromCents(over)+' (khoản về ghi ở Tiền vào PayPal): '+note)]}});
  return note;
}
/** Before / after voiding a receipt: a surplus settle of its request no longer holds; clear it so the book decides again. */
export async function clearSurplusSettle(tx:Tx,images:BusinessCollector,requestId:string,actorId:string){
  const r=await load(tx,requestId);if(!r||!r.settledAt||!r.shortfall||!r.shortfall.isNegative())return false;
  await images.remember('PAYOUT_REQUEST',r.id);
  await tx.earnPayoutRequest.update({where:{id:r.id},data:{settledAt:null,settledById:null,settleNote:null,shortfall:null,revision:{increment:1},
    history:[...(r.history as Prisma.JsonArray),entry(actorId,'Bỏ chốt nhận dư ('+(r.settleNote??'')+'): khoản về của yêu cầu bị thu hồi')]}});
  return true;
}
