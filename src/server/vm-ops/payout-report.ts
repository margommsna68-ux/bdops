import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {fromCents,toCents} from '@/lib/vm-ops';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {authorizeVM} from '../vm-management/repository';
import {payoutRights} from './payout';
import {moneyOfRequest} from './ops';
import {dayDate,dayText} from '../business-management/money';

const statuses=['PREPARING','UNKNOWN','WAITING','PARTIAL','RECEIVED','FAILED','CANCELLED','REVIEW'] as const;
export type PayoutReportStatus=typeof statuses[number];
export interface PayoutReportInput {serverId?:string;paypalId?:string;status?:string;q?:string;from?:string;to?:string;page?:number}
type DB=PrismaClient|Prisma.TransactionClient;
const invalid=()=>{throw new ProxyDomainError('INVALID_INPUT','Bộ lọc báo cáo rút tiền chưa hợp lệ');};

/** Historical read only: request.vmId/cycle are the binding, never earnApp.vmId. */
export async function readPayoutReport(scope:ActorScope,input:PayoutReportInput,db:DB=prisma){
 const current=await authorizeVM(scope,'READ',db);
 const rights=await payoutRights(current,db);
 if(!rights.requestMoney)throw new ProxyDomainError('FORBIDDEN','Xem báo cáo rút tiền cần quyền xem tiền của yêu cầu rút');
 const page=input.page??1;
 if(!Number.isSafeInteger(page)||page<1||input.status!==undefined&&!(statuses as readonly string[]).includes(input.status))invalid();
 const from=input.from===undefined?undefined:dayDate(input.from),to=input.to===undefined?undefined:dayDate(input.to);
 if(from&&to&&from>to)invalid();
 const q=input.q?.trim().toLocaleLowerCase()??'';
 const projectId=rights.current.projectId;
 const [requests,servers,paypals]=await Promise.all([
  db.earnPayoutRequest.findMany({where:{projectId,earnApp:{projectId},paypal:{projectId},paypalEmail:{projectId},
   ...(input.paypalId?{paypalId:input.paypalId}:{}),
   ...(from||to?{requestedAt:{...(from?{gte:from}:{}),...(to?{lt:new Date(to.getTime()+86400_000)}:{})}}:{})},
   select:{id:true,revision:true,earnAppId:true,vmId:true,cycle:true,paypalId:true,amount:true,currency:true,requestedAt:true,submittedAt:true,reference:true,
    state:true,submission:true,shortfall:true,settledAt:true,consumedAt:true,
    earnApp:{select:{vmId:true,closedAt:true,login:{select:{email:true}}}},paypal:{select:{code:true}},paypalEmail:{select:{email:true}},
    receipts:{where:{projectId},select:{id:true,date:true,amount:true,currency:true,confirmed:true,failed:true,voidedAt:true,transactionId:true},orderBy:[{date:'desc'},{id:'desc'}]}},
   orderBy:[{requestedAt:'desc'},{createdAt:'desc'},{id:'desc'}]}),
  db.server.findMany({where:{projectId},select:{id:true,code:true},orderBy:[{code:'asc'},{id:'asc'}]}),
  db.payPalAccount.findMany({where:{projectId},select:{id:true,code:true},orderBy:[{code:'asc'},{id:'asc'}]}),
 ]);
 // EarnPayoutRequest.vmId is a historical scalar, not a Prisma relation.
 // Archived/deleted operating states remain visible; a missing VM retains its ID.
 const vms=await db.virtualMachine.findMany({where:{id:{in:[...new Set(requests.map(r=>r.vmId))]},server:{projectId}},
  select:{id:true,code:true,serverId:true,managed:true,archivedAt:true,operation:{select:{cycle:true}},server:{select:{code:true,managed:true,archivedAt:true}}}});
 const vmById=new Map(vms.map(v=>[v.id,v]));
 const filtered=requests.map(r=>{
  const vm=vmById.get(r.vmId),money=moneyOfRequest(r);
  const status:PayoutReportStatus=money.phase==='CANCELLED'?'CANCELLED':money.phase==='FAILED'?'FAILED':
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
   amount:r.amount.toFixed(2),currency:r.currency,received:money.received,remaining:r.submission==='SENT'&&money.phase==='WAITING'?money.remaining:'0.00',shortfall:r.shortfall?.toFixed(2)??'0.00',status,reference:r.reference,
   receipts:r.receipts.map(x=>({id:x.id,date:dayText(x.date),amount:x.amount.toFixed(2),currency:x.currency,
    status:x.voidedAt?'VOIDED' as const:x.failed?'FAILED' as const:x.confirmed?'CONFIRMED' as const:'PENDING' as const,transactionId:x.transactionId}))};
  return {row,money,submission:r.submission};
 }).filter(({row})=>(!input.serverId||row.serverId===input.serverId)&&(!input.status||row.status===input.status)
  &&(!q||[row.server,row.vm,row.login,row.paypal,row.email,row.reference].some(s=>s?.toLocaleLowerCase().includes(q))));
 const totals=new Map<string,{prepared:number;sent:number;waiting:number;received:number;unknown:number}>();
 const sumsOf=(currency:string)=>{
  let sums=totals.get(currency);
  if(!sums){sums={prepared:0,sent:0,waiting:0,received:0,unknown:0};totals.set(currency,sums);}
  return sums;
 };
 for(const {row,money,submission} of filtered){
  const sums=sumsOf(row.currency);
  const amount=toCents(row.amount);
  if(row.status==='PREPARING')sums.prepared+=amount;
  if(row.status==='UNKNOWN')sums.unknown+=amount;
  // Sent is a historical fact; later failure/cancellation does not unsend it.
  if(submission==='SENT')sums.sent+=amount;
  if(submission==='SENT'&&money.phase==='WAITING')sums.waiting+=toCents(money.remaining);
  // Actual receipts retain their own currency, including a mismatch needing
  // review and money received against a failed/cancelled request. No FX inference.
  for(const receipt of row.receipts)if(receipt.status==='CONFIRMED')sumsOf(receipt.currency).received+=toCents(receipt.amount);
 }
 const summary=[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([currency,s])=>({currency,prepared:fromCents(s.prepared),sent:fromCents(s.sent),
  waiting:fromCents(s.waiting),received:fromCents(s.received),unknown:fromCents(s.unknown)}));
 const pages=Math.max(1,Math.ceil(filtered.length/50)),currentPage=Math.min(page,pages);
 return {rows:filtered.slice((currentPage-1)*50,currentPage*50).map(x=>x.row),total:filtered.length,page:currentPage,pages,
  updatedAt:new Date().toISOString(),summary,servers,paypals,
  rights:{manage:rights.writeMoney,markSubmission:rights.writeMoney||rights.payout,userId:current.userId}};
}
