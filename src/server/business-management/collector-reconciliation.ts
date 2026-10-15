import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import type {ActorScope} from '../proxy-management/types';
import {authorizeTeamCash} from './team-cash-scope';
import {dayText,period} from './money';
import type {CashRange} from './usdt-types';
import {businessHash} from './idempotency';
export async function collectorCandidates(projectId:string,range:CashRange,db:PrismaClient|Prisma.TransactionClient){
 const bounds=period(range.start,range.end);
 const rows=await db.collectorExpense.findMany({where:{projectId,voidedAt:null,type:{in:['TEAM_PAYMENT','BILL','OTHER']},date:{gte:bounds.start,lt:bounds.end}},include:{teamReceipt:true,sourcedCost:true},orderBy:{id:'asc'}});
 return rows.map(row=>({id:row.id,revision:row.revision,kind:row.type,date:dayText(row.date),originalUsd:row.amount.toFixed(2),amountUsdt:row.teamReceipt?.amountUsdt?.toFixed(6)??null,collectorId:row.collectorId,receiptId:row.teamReceipt?.id??null,costId:row.sourcedCost?.id??null,
  needsReview:row.type==='TEAM_PAYMENT'?!(row.teamReceipt?.status==='CONFIRMED'&&!row.teamReceipt.voidedAt):!row.sourcedCost||!!row.sourcedCost.voidedAt,
  fingerprint:businessHash({id:row.id,date:row.date.toISOString(),amount:row.amount.toString(),type:row.type,reference:row.referenceId,collector:row.collectorId,updated:row.updatedAt.toISOString(),revision:row.revision,receipt:row.teamReceipt?[row.teamReceipt.id,row.teamReceipt.revision,row.teamReceipt.status,!!row.teamReceipt.voidedAt]:null,cost:row.sourcedCost?[row.sourcedCost.id,row.sourcedCost.revision,!!row.sourcedCost.voidedAt]:null})}));
}
export async function reviewCollectorSources(scope:ActorScope,range:CashRange,db:PrismaClient=prisma){await authorizeTeamCash(scope,'WITHDRAWALS',false,db);return collectorCandidates(scope.projectId,range,db);}
export async function readReceiptChoices(scope:ActorScope,db:PrismaClient=prisma){
 await authorizeTeamCash(scope,'WITHDRAWALS',false,db);const [members,sources]=await Promise.all([db.projectMember.findMany({where:{projectId:scope.projectId},select:{userId:true,user:{select:{name:true,username:true}}}}),db.collectorExpense.findMany({where:{projectId:scope.projectId,voidedAt:null,type:'TEAM_PAYMENT',teamReceipt:null},select:{id:true,collectorId:true,date:true,amount:true},orderBy:{date:'desc'}})]);
 return {members:members.map(m=>({id:m.userId,label:m.user.name||m.user.username||'Thành viên'})),sources:sources.map(s=>({id:s.id,collectorId:s.collectorId,date:dayText(s.date),originalUsd:s.amount.toFixed(2)}))};
}
