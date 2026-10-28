import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {fromCents,toCents} from '@/lib/vm-ops';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {authorizeVM} from '../vm-management/repository';
import {payoutRights} from './payout';
import {moneyOfRequest} from './ops';
import {dayDate,dayText} from '../business-management/money';
import {assertScopedServerIds,hasServerScope} from '../permissions/server-scope';

const statuses=['PREPARING','UNKNOWN','WAITING','PARTIAL','RECEIVED','FAILED','CANCELLED','REVIEW','LOST'] as const;
export type PayoutReportStatus=typeof statuses[number];
export const PAYOUT_REPORT_VIEWS=['SENT_TODAY','WAITING','RECEIVED_TODAY','ATTENTION'] as const;
export type PayoutReportView=typeof PAYOUT_REPORT_VIEWS[number];
export interface PayoutReportInput {serverId?:string;paypalId?:string;status?:string;q?:string;from?:string;to?:string;page?:number;view?:string;day?:string}
type DB=PrismaClient|Prisma.TransactionClient;
const invalid=()=>{throw new ProxyDomainError('INVALID_INPUT','Bộ lọc báo cáo rút tiền chưa hợp lệ');};

/** Historical read only: request.vmId/cycle are the binding, never earnApp.vmId.
 * Both callers must reload current project/finance rights before loading rows. */
async function loadPayoutModel(projectId:string,input:PayoutReportInput,db:DB){
 const from=input.from===undefined?undefined:dayDate(input.from),to=input.to===undefined?undefined:dayDate(input.to);
 if(from&&to&&from>to)invalid();
 const q=input.q?.trim().toLocaleLowerCase()??'';
 const [requests,servers,paypals]=await Promise.all([
  db.earnPayoutRequest.findMany({where:{projectId,earnApp:{projectId},paypal:{projectId},paypalEmail:{projectId},
   ...(input.paypalId?{paypalId:input.paypalId}:{}),
   ...(from||to?{requestedAt:{...(from?{gte:from}:{}),...(to?{lt:new Date(to.getTime()+86400_000)}:{})}}:{})},
   select:{id:true,revision:true,earnAppId:true,vmId:true,cycle:true,paypalId:true,amount:true,currency:true,requestedAt:true,submittedAt:true,reference:true,
    state:true,submission:true,shortfall:true,settledAt:true,consumedAt:true,lostAmount:true,lostAt:true,
    members:{where:{removedAt:null},select:{vmId:true,cycle:true,consumedAt:true},orderBy:{createdAt:'asc'}},
    earnApp:{select:{vmId:true,closedAt:true,login:{select:{email:true}}}},paypal:{select:{code:true}},paypalEmail:{select:{email:true}},
    receipts:{where:{projectId},select:{id:true,date:true,amount:true,currency:true,confirmed:true,failed:true,voidedAt:true,transactionId:true},orderBy:[{date:'desc'},{id:'desc'}]}},
   orderBy:[{requestedAt:'desc'},{createdAt:'desc'},{id:'desc'}]}),
  db.server.findMany({where:{projectId},select:{id:true,code:true},orderBy:[{code:'asc'},{id:'asc'}]}),
  db.payPalAccount.findMany({where:{projectId},select:{id:true,code:true},orderBy:[{code:'asc'},{id:'asc'}]}),
 ]);
 // EarnPayoutRequest.vmId is a historical scalar, not a Prisma relation.
 // Archived/deleted operating states remain visible; a missing VM retains its ID.
 // Merged payout (27/10/2026): member VMs belong to the request too (server filter, search, VM counts); the money stays once.
 const vms=await db.virtualMachine.findMany({where:{id:{in:[...new Set(requests.flatMap(r=>[r.vmId,...r.members.map(m=>m.vmId)]))]},server:{projectId}},
  select:{id:true,code:true,serverId:true,managed:true,archivedAt:true,operation:{select:{cycle:true}},server:{select:{code:true,managed:true,archivedAt:true}}}});
 const vmById=new Map(vms.map(v=>[v.id,v]));
 const filtered=requests.map(r=>{
  const vm=vmById.get(r.vmId),money=moneyOfRequest(r);
  const status:PayoutReportStatus=money.phase==='CANCELLED'?'CANCELLED':money.phase==='FAILED'?'FAILED':money.phase==='LOST'?'LOST':
   money.phase==='REVIEW'||money.reviewAfterRecreate?'REVIEW':r.submission==='PREPARING'?'PREPARING':r.submission==='UNKNOWN'?'UNKNOWN':
   money.phase==='RECEIVED'?'RECEIVED':toCents(money.received)>0?'PARTIAL':'WAITING';
  // Match updatePayout's activeVM + account/cycle test. A consumed request can
  // still be current; its consumed flag separately prevents status mutation.
  const isCurrent=!!vm&&vm.managed&&!vm.archivedAt&&vm.server.managed&&!vm.server.archivedAt
   &&r.earnApp.vmId===r.vmId&&!r.earnApp.closedAt&&(vm.operation?.cycle??1)===r.cycle;
  const row={id:r.id,revision:r.revision,earnAppId:r.earnAppId,consumed:!!r.consumedAt,current:isCurrent,
   vmId:r.vmId,serverId:vm?.serverId??null,server:vm?.server.code??null,vm:vm?.code??null,cycle:r.cycle,
   login:r.earnApp.login.email,paypalId:r.paypalId,paypal:r.paypal.code,email:r.paypalEmail.email,
   requestedAt:r.requestedAt.toISOString(),submittedAt:r.submittedAt?.toISOString()??null,
   amount:r.amount.toFixed(2),currency:r.currency,received:money.received,remaining:r.submission==='SENT'&&money.phase==='WAITING'?money.remaining:'0.00',shortfall:r.shortfall?.toFixed(2)??'0.00',lostAmount:r.lostAmount?.toFixed(2)??'0.00',lostAt:r.lostAt?.toISOString()??null,status,reference:r.reference,
   members:r.members.map(m=>{const v=vmById.get(m.vmId);return {vmId:m.vmId,serverId:v?.serverId??null,server:v?.server.code??null,vm:v?.code??null,cycle:m.cycle,consumed:!!m.consumedAt};}),
   receipts:r.receipts.map(x=>({id:x.id,date:dayText(x.date),amount:x.amount.toFixed(2),currency:x.currency,
    status:x.voidedAt?'VOIDED' as const:x.failed?'FAILED' as const:x.confirmed?'CONFIRMED' as const:'PENDING' as const,transactionId:x.transactionId}))};
  return {row,money,submission:r.submission};
 }).filter(({row})=>(!input.serverId||row.serverId===input.serverId||row.members.some(m=>m.serverId===input.serverId))&&(!input.status||row.status===input.status)
  &&(!q||[row.server,row.vm,row.login,row.paypal,row.email,row.reference,...row.members.flatMap(m=>[m.server,m.vm])].some(s=>s?.toLocaleLowerCase().includes(q))));
 return {entries:filtered,servers,paypals};
}

type PayoutEntry=Awaited<ReturnType<typeof loadPayoutModel>>['entries'][number];
type Amount={currency:string;amount:string};
// Bangkok has a fixed UTC+7 offset, the same business-day boundary as dayText.
const bangkokDay=(at:Date)=>dayText(at);
function reportDay(raw:string|undefined,at:Date){
 const day=raw??bangkokDay(at);
 dayDate(day);
 return day;
}
function confirmedReceipts(entry:PayoutEntry,day?:string){
 return entry.row.receipts.filter(r=>r.status==='CONFIRMED'&&(day===undefined||r.date===day));
}
function sumAmounts(values:Iterable<Amount>):Amount[]{
 const sums=new Map<string,number>();
 for(const value of values)sums.set(value.currency,(sums.get(value.currency)??0)+toCents(value.amount));
 return [...sums].sort(([a],[b])=>a.localeCompare(b)).map(([currency,cents])=>({currency,amount:fromCents(cents)}));
}
function selectView(entries:PayoutEntry[],view:PayoutReportView,day:string){
 return entries.filter(entry=>{
  if(view==='SENT_TODAY')return entry.submission==='SENT'&&entry.row.submittedAt!==null&&bangkokDay(new Date(entry.row.submittedAt))===day;
  if(view==='WAITING')return entry.submission==='SENT'&&entry.money.phase==='WAITING';
  if(view==='RECEIVED_TODAY')return confirmedReceipts(entry,day).length>0;
  return ['UNKNOWN','FAILED','REVIEW'].includes(entry.row.status);
 });
}
function focusTotals(entries:PayoutEntry[],view:PayoutReportView,day:string){
 const amounts=view==='RECEIVED_TODAY'?sumAmounts(entries.flatMap(entry=>confirmedReceipts(entry,day))):
  sumAmounts(entries.map(entry=>({currency:entry.row.currency,amount:view==='WAITING'?entry.money.remaining:entry.row.amount})));
 return {requests:entries.length,vms:new Set(entries.flatMap(entry=>[entry.row.vmId,...entry.row.members.map(m=>m.vmId)])).size,amounts};
}
function reportSummary(entries:PayoutEntry[],receiptDay?:string){
 const totals=new Map<string,{prepared:number;sent:number;waiting:number;received:number;unknown:number}>();
 const sumsOf=(currency:string)=>{
  let sums=totals.get(currency);
  if(!sums){sums={prepared:0,sent:0,waiting:0,received:0,unknown:0};totals.set(currency,sums);}
  return sums;
 };
 for(const entry of entries){
  const {row,money,submission}=entry;
  const sums=sumsOf(row.currency);
  const amount=toCents(row.amount);
  if(row.status==='PREPARING')sums.prepared+=amount;
  if(row.status==='UNKNOWN')sums.unknown+=amount;
  // Sent is a historical fact; later failure/cancellation does not unsend it.
  if(submission==='SENT')sums.sent+=amount;
  if(submission==='SENT'&&money.phase==='WAITING')sums.waiting+=toCents(money.remaining);
  // Actual receipts retain their own currency, including a mismatch needing
  // review and money received against a failed/cancelled request. No FX inference.
  for(const receipt of confirmedReceipts(entry,receiptDay))sumsOf(receipt.currency).received+=toCents(receipt.amount);
 }
 return [...totals].sort(([a],[b])=>a.localeCompare(b)).map(([currency,s])=>({currency,prepared:fromCents(s.prepared),sent:fromCents(s.sent),
  waiting:fromCents(s.waiting),received:fromCents(s.received),unknown:fromCents(s.unknown)}));
}

// Money lost because the EarnApp was suspended (state LOST_SUS), per currency. Never added to waiting or received.
function lostTotals(entries:PayoutEntry[]){
 const sums=new Map<string,number>();
 for(const {row} of entries)if(row.status==='LOST')sums.set(row.currency,(sums.get(row.currency)??0)+toCents(row.lostAmount));
 return Object.fromEntries([...sums].sort(([a],[b])=>a.localeCompare(b)).map(([currency,cents])=>[currency,fromCents(cents)])) as Record<string,string>;
}

export async function readPayoutReport(scope:ActorScope,input:PayoutReportInput,db:DB=prisma){
 const current=await authorizeVM(scope,'READ',db),rights=await payoutRights(current,db);
 if(!rights.requestMoney)throw new ProxyDomainError('FORBIDDEN','Xem báo cáo rút tiền cần quyền xem tiền của yêu cầu rút');
 const page=input.page??1,at=new Date();
 if(!Number.isSafeInteger(page)||page<1||input.status!==undefined&&!(statuses as readonly string[]).includes(input.status)
  ||input.view!==undefined&&!(PAYOUT_REPORT_VIEWS as readonly string[]).includes(input.view)
  ||input.view!==undefined&&(input.from!==undefined||input.to!==undefined))invalid();
 const day=reportDay(input.day,at),view=input.view as PayoutReportView|undefined;
 const model=await loadPayoutModel(rights.current.projectId,input,db);
 const filtered=view?selectView(model.entries,view,day):model.entries;
 const focus=view?{view,day,...focusTotals(filtered,view,day)}:null;
 const summary=reportSummary(filtered,view==='RECEIVED_TODAY'?day:undefined);
 const pages=Math.max(1,Math.ceil(filtered.length/50)),currentPage=Math.min(page,pages);
 return {rows:filtered.slice((currentPage-1)*50,currentPage*50).map(entry=>({...entry.row,
   receivedInView:view==='RECEIVED_TODAY'?sumAmounts(confirmedReceipts(entry,day)):null})),total:filtered.length,page:currentPage,pages,
  updatedAt:at.toISOString(),summary,lost:lostTotals(filtered),servers:model.servers,paypals:model.paypals,focus,
  rights:{manage:rights.writeMoney,markSubmission:rights.writeMoney||rights.payout,userId:current.userId}};
}

/** No payout rows/options/totals are queried for a member without requestMoney. */
export async function readPayoutDashboard(scope:ActorScope,input:{serverId?:string},db:DB=prisma){
 const rights=await payoutRights(scope,db);
 if(!rights.requestMoney)return {available:false} as const;
 const current=await authorizeVM(rights.current,'READ',db),at=new Date(),day=reportDay(undefined,at);
 const {entries}=await loadPayoutModel(current.projectId,input,db);
 const card=(view:PayoutReportView)=>focusTotals(selectView(entries,view,day),view,day);
 return {available:true as const,day,updatedAt:at.toISOString(),cards:{sent:card('SENT_TODAY'),waiting:card('WAITING'),received:card('RECEIVED_TODAY'),attention:card('ATTENTION')},lost:lostTotals(entries)};
}

/** "Đã xoá do ghi nhầm" (28/10/2026): requests removed as mistaken, from their EarnPayoutRequestVoid snapshot. Readable by anyone who
 * reads the VMs; selected-server members only their servers; reason / amount only with request money rights (as the VM history). */
export async function readPayoutVoided(scope:ActorScope,input:{serverId?:string;page?:number},db:DB=prisma){
 const current=await authorizeVM(scope,'READ',db),rights=await payoutRights(current,db),money=rights.requestMoney;
 const page=input.page??1;if(!Number.isSafeInteger(page)||page<1)invalid();
 if(input.serverId)await assertScopedServerIds(db,current,[input.serverId]);
 const serverIds=input.serverId?[input.serverId]:hasServerScope(current)?current.serverIds!:null;
 const vmIds=serverIds?(await db.virtualMachine.findMany({where:{serverId:{in:serverIds},server:{projectId:current.projectId}},select:{id:true}})).map(v=>v.id):null;
 const where={projectId:current.projectId,...(vmIds?{vmId:{in:vmIds}}:{})};
 const [total,voids]=await Promise.all([db.earnPayoutRequestVoid.count({where}),
  db.earnPayoutRequestVoid.findMany({where,orderBy:[{voidedAt:'desc'},{id:'desc'}],skip:(page-1)*50,take:50})]);
 const vms=await db.virtualMachine.findMany({where:{id:{in:[...new Set(voids.map(v=>v.vmId))]},server:{projectId:current.projectId}},select:{id:true,code:true,serverId:true,server:{select:{code:true}}}});
 const users=await db.user.findMany({where:{id:{in:[...new Set(voids.map(v=>v.voidedById))]}},select:{id:true,name:true,username:true}});
 const vmById=new Map(vms.map(v=>[v.id,v])),who=(id:string)=>{const u=users.find(x=>x.id===id);return u?u.name||u.username||'Tài khoản cũ':'—';};
 return {total,page,pages:Math.max(1,Math.ceil(total/50)),money,rows:voids.map(v=>{
  const s=(v.snapshot??{}) as {amount?:string;currency?:string;paypalCode?:string;email?:string},vm=vmById.get(v.vmId);
  return {id:v.id,requestId:v.requestId,vmId:v.vmId,serverId:vm?.serverId??null,server:vm?.server.code??null,vm:vm?.code??null,cycle:v.cycle,
   paypal:s.paypalCode??null,email:s.email??null,voidedAt:v.voidedAt.toISOString(),voidedBy:who(v.voidedById),
   reason:money?v.reason:null,amount:money?s.amount??null:null,currency:money?s.currency??null:null};
 })};
}
