import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import type {ActorScope} from '../proxy-management/types';
import {authorizeTeamCash} from './team-cash-scope';
import {period} from './money';
import {CashDecimal} from './usdt-money';
import {businessHash} from './idempotency';
import {collectorCandidates} from './collector-reconciliation';
import type {CashRange,CashSourceFacts,TeamCashReport,ProfitTreatment} from './usdt-types';
export async function cashSourcesForProject(projectId:string,range:CashRange,db:PrismaClient|Prisma.TransactionClient){
 const bounds=period(range.start,range.end),[receipts,costs,candidates]=await Promise.all([
  db.teamReceipt.findMany({where:{projectId,voidedAt:null,receivedAt:{gte:bounds.start,lt:bounds.end}},orderBy:{id:'asc'}}),
  db.costRecord.findMany({where:{projectId,voidedAt:null,date:{gte:bounds.start,lt:bounds.end}},orderBy:{id:'asc'}}),collectorCandidates(projectId,range,db)]);
 const confirmed=receipts.filter(r=>r.status==='CONFIRMED'),cashCosts=costs.filter(c=>c.profitTreatment==='CASH_COST'),blockers:TeamCashReport['blockers']=[];
 for(const c of cashCosts)if(!c.usdtRate||!c.usdtAmount)blockers.push({kind:'MISSING_RATE',id:c.id});
 for(const r of receipts)if(r.status!=='CONFIRMED')blockers.push({kind:'UNVERIFIED_RECEIPT',id:r.id});
 for(const c of candidates)if(c.needsReview&&!blockers.some(b=>b.id===c.receiptId))blockers.push({kind:c.kind==='TEAM_PAYMENT'?'UNVERIFIED_RECEIPT':'UNCLASSIFIED_EXPENSE',id:c.id});
 const sum=(values:(string|null)[])=>values.reduce((a,b)=>a.plus(b??'0'),new CashDecimal(0));
 const received=sum(confirmed.map(r=>r.amountUsdt?.toFixed(6)??null)),cost=sum(cashCosts.map(c=>c.usdtAmount?.toFixed(6)??null));
 const facts:CashSourceFacts={receipts:receipts.map(r=>({id:r.id,revision:r.revision})),costs:costs.map(c=>({id:c.id,revision:c.revision,currency:c.currency,amount:c.total.toFixed(8),rate:c.usdtRate?.toFixed(12)??null,usdt:c.usdtAmount?.toFixed(6)??null,treatment:c.profitTreatment as ProfitTreatment})),collectorCandidates:candidates.map(c=>({id:c.id,revision:c.revision,fingerprint:c.fingerprint}))};
 const sourceHash=businessHash({basisVersion:1,range,facts,receipts:receipts.map(r=>({id:r.id,revision:r.revision,amount:r.amountUsdt?.toFixed(6)??null,date:r.receivedAt.toISOString(),status:r.status,source:r.sourceCollectorExpenseId,reference:r.referenceKey})),costDates:costs.map(c=>[c.id,c.date.toISOString(),c.sourceReceiptId,c.sourceCollectorExpenseId])});
 const report:TeamCashReport={basis:'TEAM_RECEIVED',currency:'USDT',teamReceived:received.toFixed(6),cost:cost.toFixed(6),net:received.minus(cost).toFixed(6),excludedNettedCostCount:costs.length-cashCosts.length,blockingCount:blockers.length,unlinkedReceiptCount:confirmed.filter(r=>!r.sourceCollectorExpenseId).length,blockers,sourceHash};
 return {report,facts};
}
export async function teamCashSources(scope:ActorScope,range:CashRange,db:PrismaClient=prisma){
 const current=await authorizeTeamCash(scope,'PROFIT',false,db),source=await cashSourcesForProject(scope.projectId,range,db);
 if(current.role!=='ADMIN')source.report.blockers=source.report.blockers.map(b=>({...b,id:current.allowedModules?.includes(b.kind==='MISSING_RATE'?'COSTS':'WITHDRAWALS')?b.id:''}));
 return source;
}
