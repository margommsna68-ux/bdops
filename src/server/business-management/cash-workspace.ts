import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import type {ActorScope} from '../proxy-management/types';
import {authorizeTeamCash} from './team-cash-scope';
import {period,dayText} from './money';
import type {CashRange} from './usdt-types';
export async function readCashCosts(scope:ActorScope,range:CashRange,db:PrismaClient=prisma){
 await authorizeTeamCash(scope,'COSTS',false,db);const bounds=period(range.start,range.end),[rows,locks]=await Promise.all([db.costRecord.findMany({where:{projectId:scope.projectId,voidedAt:null,date:{gte:bounds.start,lt:bounds.end}},orderBy:[{date:'desc'},{id:'asc'}]}),db.profitSplit.findMany({where:{projectId:scope.projectId,settled:true,voidedAt:null,businessManaged:true}})]);
 return rows.map(c=>({id:c.id,date:dayText(c.date),amount:c.total.toFixed(8),currency:c.currency,rate:c.usdtRate?.toFixed(12)??null,usdt:c.usdtAmount?.toFixed(6)??null,fxDate:c.fxAppliedAt?.toISOString()??null,fxSource:c.fxSource,category:c.category,notes:c.note,revision:c.revision,treatment:c.profitTreatment as 'CASH_COST'|'ALREADY_NETTED',sourceReceiptId:c.sourceReceiptId,sourceCollectorExpenseId:c.sourceCollectorExpenseId,serverId:c.serverId,proxyAccountId:c.proxyAccountId,locked:locks.some(l=>(l.basis==='TEAM_RECEIVED'||l.currency===c.currency)&&l.periodStart<=c.date&&l.periodEnd>=c.date)}));
}
export async function readCashReceipts(scope:ActorScope,range:CashRange,db:PrismaClient=prisma){
 await authorizeTeamCash(scope,'WITHDRAWALS',false,db);const bounds=period(range.start,range.end),[rows,locks]=await Promise.all([db.teamReceipt.findMany({where:{projectId:scope.projectId,receivedAt:{gte:bounds.start,lt:bounds.end}},orderBy:[{receivedAt:'desc'},{id:'asc'}]}),db.profitSplit.findMany({where:{projectId:scope.projectId,settled:true,voidedAt:null,businessManaged:true,currency:'USDT'}})]);
 return rows.map(r=>({id:r.id,date:dayText(r.receivedAt),amountUsdt:r.amountUsdt?.toFixed(6)??null,referenceId:r.referenceId,status:r.status as 'DRAFT'|'CONFIRMED',collectorId:r.collectorId,sourceCollectorExpenseId:r.sourceCollectorExpenseId,collectorUsdAmount:r.collectorUsdAmount?.toFixed(2)??null,notes:r.notes,revision:r.revision,voided:!!r.voidedAt,locked:locks.some(l=>l.periodStart<=r.receivedAt&&l.periodEnd>=r.receivedAt)}));
}
