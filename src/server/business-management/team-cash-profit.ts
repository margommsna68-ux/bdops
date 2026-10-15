import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runCashCommand} from './cash-command';
import {cashSourcesForProject} from './team-cash-report';
import {allocateUsdt} from './usdt-money';
import {period,dayText} from './money';
import {cashReason} from './usdt-costs';
import {authorizeTeamCash} from './team-cash-scope';
import type {CashRange} from './usdt-types';
type PeriodInput=CashRange&{partners:{name:string;percentage:string}[];key:string};
type ChangeInput={id:string;expectedRevision:number;key:string;reason?:string};
export async function createTeamCashPeriod(scope:ActorScope,input:PeriodInput,db:PrismaClient=prisma){
 const bounds=period(input.start,input.end);allocateUsdt('0',input.partners);
 return runCashCommand(scope,{key:input.key,payload:input,kind:'TEAM_CASH_PROFIT_CREATE',module:'PROFIT'},async(tx,images)=>{
  if(await tx.profitSplit.findFirst({where:{projectId:scope.projectId,voidedAt:null,currency:'USDT',periodStart:{lt:bounds.end},periodEnd:{gte:bounds.start}}}))throw new ProxyDomainError('INVALID_INPUT','Kỳ USDT bị trùng');
  const range={start:input.start,end:input.end},source=await cashSourcesForProject(scope.projectId,range,tx),allocations=allocateUsdt(source.report.net,input.partners);
  const row=await tx.profitSplit.create({data:{projectId:scope.projectId,periodStart:bounds.start,periodEnd:new Date(bounds.end.getTime()-1),currency:'USDT',basis:'TEAM_RECEIVED',businessManaged:true,totalWithdrawal:source.report.teamReceived,totalCost:source.report.cost,netProfit:source.report.net,netProfitUsdt:source.report.net,sourceHash:source.report.sourceHash,sourceSnapshotCipher:encrypt(JSON.stringify({version:1,basis:'TEAM_RECEIVED',range,partners:input.partners,facts:source.facts})),allocations:{create:allocations.map(a=>({partnerName:a.name,percentage:a.percentage,amount:a.amount,amountUsdt:a.amount}))}}});
  await images.remember('PROFIT',row.id,true);return {id:row.id};
 },db);
}
async function changePeriod(scope:ActorScope,input:ChangeInput,action:'RECALCULATE'|'SETTLE'|'REOPEN',db:PrismaClient,deps:{afterWrite?:(tx:Prisma.TransactionClient)=>void|Promise<void>}={}){
 if(action==='REOPEN')cashReason(input.reason);
 return runCashCommand(scope,{key:input.key,payload:input,kind:'TEAM_CASH_PROFIT_'+action,module:'PROFIT',reversible:action==='RECALCULATE'},async(tx,images,current)=>{
  const row=await tx.profitSplit.findFirst({where:{id:input.id,projectId:scope.projectId,basis:'TEAM_RECEIVED',currency:'USDT',voidedAt:null},include:{allocations:true}});if(!row)throw new ProxyDomainError('NOT_FOUND');
  if(row.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW');
  if(action==='REOPEN'){
   if(current.role!=='ADMIN')throw new ProxyDomainError('FORBIDDEN');if(!row.settled||row.allocations.some(a=>a.paid))throw new ProxyDomainError('INVALID_INPUT','Kỳ chưa chốt hoặc có khoản đã trả');await images.remember('PROFIT',row.id);await tx.profitSplit.update({where:{id:row.id},data:{settled:false,revision:{increment:1},notes:[row.notes,input.reason].filter(Boolean).join('\n')}});
  }else{
   if(row.settled||row.allocations.some(a=>a.paid))throw new ProxyDomainError('INVALID_INPUT','Mở lại kỳ trước khi sửa');
   const snapshot=JSON.parse(decrypt(row.sourceSnapshotCipher!)) as {range:CashRange;partners:PeriodInput['partners']},source=await cashSourcesForProject(scope.projectId,snapshot.range,tx);
   if(action==='SETTLE'){
    if(source.report.sourceHash!==row.sourceHash)throw new ProxyDomainError('STALE_PREVIEW','Thu/chi đã đổi; tính lại trước khi chốt');if(source.report.blockingCount)throw new ProxyDomainError('INVALID_INPUT','Còn nguồn cần xác minh hoặc tỷ giá cần bổ sung');
    await images.remember('PROFIT',row.id);await tx.profitSplit.update({where:{id:row.id},data:{settled:true,revision:{increment:1}}});
   }else{
    const shares=allocateUsdt(source.report.net,snapshot.partners);await images.remember('PROFIT',row.id);
    for(const a of row.allocations){const share=shares.find(s=>s.name===a.partnerName);if(!share)throw new ProxyDomainError('INVALID_INPUT');await images.remember('SPLIT_PAYMENT',a.id);await tx.splitAllocation.update({where:{id:a.id},data:{amount:share.amount,amountUsdt:share.amount,revision:{increment:1}}});}
    await tx.profitSplit.update({where:{id:row.id},data:{totalWithdrawal:source.report.teamReceived,totalCost:source.report.cost,netProfit:source.report.net,netProfitUsdt:source.report.net,sourceHash:source.report.sourceHash,sourceSnapshotCipher:encrypt(JSON.stringify({...snapshot,facts:source.facts})),revision:{increment:1}}});
   }
  }
  await deps.afterWrite?.(tx);return {id:row.id};
 },db);
}
export function recalculateTeamCashPeriod(scope:ActorScope,input:ChangeInput,db:PrismaClient=prisma){return changePeriod(scope,input,'RECALCULATE',db);}
export function settleTeamCashPeriod(scope:ActorScope,input:ChangeInput,db:PrismaClient=prisma,deps:{afterWrite?:(tx:Prisma.TransactionClient)=>void|Promise<void>}={}){return changePeriod(scope,input,'SETTLE',db,deps);}
export function reopenTeamCashPeriod(scope:ActorScope,input:ChangeInput,db:PrismaClient=prisma){return changePeriod(scope,input,'REOPEN',db);}
export async function readTeamCashPeriods(scope:ActorScope,range:CashRange,db:PrismaClient=prisma){
 await authorizeTeamCash(scope,'PROFIT',false,db);const bounds=period(range.start,range.end),rows=await db.profitSplit.findMany({where:{projectId:scope.projectId,voidedAt:null,periodStart:{lt:bounds.end},periodEnd:{gte:bounds.start}},include:{allocations:{orderBy:{partnerName:'asc'}}},orderBy:{periodStart:'desc'}});
 return rows.map(r=>({id:r.id,start:dayText(r.periodStart),end:dayText(r.periodEnd),currency:r.currency,basis:r.basis,received:r.totalWithdrawal.toFixed(r.basis==='TEAM_RECEIVED'?6:2),cost:r.totalCost.toFixed(r.basis==='TEAM_RECEIVED'?6:2),net:r.netProfit.toFixed(r.basis==='TEAM_RECEIVED'?6:2),settled:r.settled,businessManaged:r.businessManaged,revision:r.revision,allocations:r.allocations.map(a=>({id:a.id,name:a.partnerName,percentage:a.percentage.toFixed(2),amount:a.amount.toFixed(r.basis==='TEAM_RECEIVED'?6:2),paid:a.paid,revision:a.revision,note:a.note}))}));
}
