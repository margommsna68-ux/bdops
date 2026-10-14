import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand} from './idempotency';
import {authorizeBusiness} from './scope';
import {allocateCents,dayText,period} from './money';
import {financialSources,type ReportInput} from './report';
type ProfitInput=ReportInput&{partners:{name:string;percentage:string}[];key:string};
type ProfitSnapshot={range:ReportInput;partners:{name:string;percentage:string}[]};
export async function createProfitPeriod(scope:ActorScope,input:ProfitInput,db:PrismaClient=prisma){
 const bounds=period(input.start,input.end);allocateCents('0.00',input.partners);
 return runBusinessCommand(scope,{key:input.key,payload:input,kind:'BUSINESS_PROFIT_CREATE',module:'PROFIT'},async(tx,images)=>{
  if(await tx.profitSplit.findFirst({where:{projectId:scope.projectId,voidedAt:null,currency:input.currency,periodStart:{lt:bounds.end},periodEnd:{gte:bounds.start}},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','Kỳ này trùng với một kỳ đã ghi. Mở kỳ hiện có để xem/cập nhật.');
  const source=await financialSources(scope.projectId,input,tx),allocations=allocateCents(source.report.net,input.partners),snapshot:ProfitSnapshot={range:{start:input.start,end:input.end,currency:input.currency},partners:input.partners};
  const row=await tx.profitSplit.create({data:{projectId:scope.projectId,periodStart:bounds.start,periodEnd:new Date(bounds.end.getTime()-1),currency:input.currency,basis:'WITHDRAWN',businessManaged:true,totalWithdrawal:source.report.withdrawn,totalCost:source.report.cost,netProfit:source.report.net,sourceHash:source.report.sourceHash,sourceSnapshotCipher:encrypt(JSON.stringify(snapshot)),allocations:{create:allocations.map(a=>({partnerName:a.name,percentage:a.percentage,amount:a.amount}))}}});await images.remember('PROFIT',row.id,true);return {id:row.id};
 },db);
}
export async function recalculateProfit(scope:ActorScope,input:{id:string;expectedRevision:number;key:string},db:PrismaClient=prisma){
 return runBusinessCommand(scope,{key:input.key,payload:input,kind:'BUSINESS_PROFIT_RECALCULATE',module:'PROFIT'},async(tx,images)=>{
  const row=await tx.profitSplit.findFirst({where:{id:input.id,projectId:scope.projectId,businessManaged:true,voidedAt:null},include:{allocations:true}});if(!row)throw new ProxyDomainError('NOT_FOUND');if(row.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW');if(row.settled||row.allocations.some(a=>a.paid))throw new ProxyDomainError('INVALID_INPUT','Kỳ đã chốt hoặc đã ghi trả tiền; chưa được tính lại');
  const snapshot=JSON.parse(decrypt(row.sourceSnapshotCipher!)) as ProfitSnapshot,source=await financialSources(scope.projectId,snapshot.range,tx),allocations=allocateCents(source.report.net,snapshot.partners);await images.remember('PROFIT',row.id);
  for(const entry of row.allocations){const amount=allocations.find(a=>a.name===entry.partnerName)?.amount;if(amount===undefined)throw new ProxyDomainError('INVALID_INPUT');await images.remember('SPLIT_PAYMENT',entry.id);await tx.splitAllocation.update({where:{id:entry.id},data:{amount,revision:{increment:1}}});}
  await tx.profitSplit.update({where:{id:row.id},data:{totalWithdrawal:source.report.withdrawn,totalCost:source.report.cost,netProfit:source.report.net,sourceHash:source.report.sourceHash,revision:{increment:1}}});return {id:row.id};
 },db);
}
export async function settleProfit(scope:ActorScope,input:{id:string;expectedRevision:number;key:string},db:PrismaClient=prisma){
 return runBusinessCommand(scope,{key:input.key,payload:input,kind:'BUSINESS_PROFIT_SETTLE',module:'PROFIT',reversible:false},async(tx,images)=>{
  const row=await tx.profitSplit.findFirst({where:{id:input.id,projectId:scope.projectId,businessManaged:true,voidedAt:null}});if(!row)throw new ProxyDomainError('NOT_FOUND');if(row.revision!==input.expectedRevision||row.settled)throw new ProxyDomainError('STALE_PREVIEW');const snapshot=JSON.parse(decrypt(row.sourceSnapshotCipher!)) as ProfitSnapshot,source=await financialSources(scope.projectId,snapshot.range,tx);
  if(source.report.sourceHash!==row.sourceHash)throw new ProxyDomainError('STALE_PREVIEW','Thu/chi đã đổi; tính lại trước khi chốt');if(source.report.pendingWithdrawals)throw new ProxyDomainError('INVALID_INPUT','Còn khoản rút chưa xác nhận về. Kiểm tra tiền rút trước khi chốt kỳ.');
  await images.remember('PROFIT',row.id);await tx.profitSplit.update({where:{id:row.id},data:{settled:true,revision:{increment:1}}});return {id:row.id};
 },db);
}
export async function markProfitPaid(scope:ActorScope,input:{allocationId:string;expectedRevision:number;key:string;reason:string},db:PrismaClient=prisma){
 if(!input.reason.trim()||input.reason.length>300)throw new ProxyDomainError('INVALID_INPUT');return runBusinessCommand(scope,{key:input.key,payload:input,kind:'BUSINESS_PROFIT_PAID',module:'PROFIT',reversible:false},async(tx,images)=>{
  const row=await tx.splitAllocation.findFirst({where:{id:input.allocationId,split:{projectId:scope.projectId,businessManaged:true,voidedAt:null}},include:{split:true}});if(!row)throw new ProxyDomainError('NOT_FOUND');if(row.revision!==input.expectedRevision||row.paid)throw new ProxyDomainError('STALE_PREVIEW');if(!row.split.settled||row.amount.lte(0))throw new ProxyDomainError('INVALID_INPUT','Chỉ ghi đã trả cho phần lợi nhuận dương của kỳ đã chốt');
  await images.remember('SPLIT_PAYMENT',row.id);await tx.splitAllocation.update({where:{id:row.id},data:{paid:true,note:input.reason.trim(),revision:{increment:1}}});return {id:row.id};
 },db);
}
export async function reopenProfit(scope:ActorScope,input:{id:string;expectedRevision:number;key:string;reason:string},db:PrismaClient=prisma){
 if(!input.reason.trim()||input.reason.length>300)throw new ProxyDomainError('INVALID_INPUT');return runBusinessCommand(scope,{key:input.key,payload:input,kind:'BUSINESS_PROFIT_REOPEN',module:'PROFIT',reversible:false},async(tx,images,current)=>{
  if(current.role!=='ADMIN')throw new ProxyDomainError('FORBIDDEN');const row=await tx.profitSplit.findFirst({where:{id:input.id,projectId:scope.projectId,businessManaged:true,voidedAt:null},include:{allocations:true}});if(!row)throw new ProxyDomainError('NOT_FOUND');if(row.revision!==input.expectedRevision||!row.settled)throw new ProxyDomainError('STALE_PREVIEW');if(row.allocations.some(a=>a.paid))throw new ProxyDomainError('INVALID_INPUT','Đã có ghi trả lợi nhuận. Cần điều chỉnh thực tế trước khi mở lại kỳ.');
  await images.remember('PROFIT',row.id);await tx.profitSplit.update({where:{id:row.id},data:{settled:false,notes:[row.notes,'Mở lại: '+input.reason.trim()].filter(Boolean).join('\n'),revision:{increment:1}}});return {id:row.id};
 },db);
}
export async function readProfitWorkspace(scope:ActorScope,input:ReportInput,db:PrismaClient=prisma){
 await authorizeBusiness(scope,'PROFIT',false,db);const bounds=period(input.start,input.end),[source,rows]=await Promise.all([financialSources(scope.projectId,input,db),db.profitSplit.findMany({where:{projectId:scope.projectId,currency:input.currency,voidedAt:null,periodStart:{lt:bounds.end},periodEnd:{gte:bounds.start}},include:{allocations:{orderBy:{partnerName:'asc'}}},orderBy:{periodStart:'desc'}})]);
 return {report:source.report,items:rows.map(p=>({id:p.id,start:dayText(p.periodStart),end:dayText(p.periodEnd),currency:p.currency,withdrawn:p.totalWithdrawal.toFixed(2),cost:p.totalCost.toFixed(2),net:p.netProfit.toFixed(2),settled:p.settled,revision:p.revision,businessManaged:p.businessManaged,allocations:p.allocations.map(a=>({id:a.id,name:a.partnerName,percentage:a.percentage.toFixed(2),amount:a.amount.toFixed(2),paid:a.paid,note:a.note,revision:a.revision}))}))};
}
