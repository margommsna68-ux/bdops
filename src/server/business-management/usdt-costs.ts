import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runCashCommand} from './cash-command';
import {authorizeTeamCash} from './team-cash-scope';
import {dayDate,dayText} from './money';
import {cashCurrency,normalizeCostMoney,parseOriginalMoney,CashDecimal} from './usdt-money';
import {assertPeriodOpen} from './period-lock';
import type {SaveUsdtCostInput} from './usdt-types';
import {verifyP2PQuote} from './binance-p2p';
export function cashReason(reason?:string){if(!reason?.trim()||reason.length>300)throw new ProxyDomainError('INVALID_INPUT','Cần lý do điều chỉnh (tối đa 300 ký tự)');}
export async function saveUsdtCost(scope:ActorScope,input:SaveUsdtCostInput,db:PrismaClient=prisma,deps:{afterWrite?:(tx:Prisma.TransactionClient)=>void|Promise<void>}={}){
 const currency=cashCurrency(input.currency),original=parseOriginalMoney(input.amount),date=dayDate(input.date);
 if(!['CASH_COST','ALREADY_NETTED'].includes(input.treatment)||!['SERVER','IP_PROXY','GMAIL','PAYPAL','OTHER'].includes(input.category)||input.notes&&input.notes.length>2000)throw new ProxyDomainError('INVALID_INPUT');
 const quote=input.treatment==='ALREADY_NETTED'&&currency!=='USDT'&&!input.rate?null:normalizeCostMoney(input);
 return runCashCommand(scope,{key:input.key,payload:input,kind:'TEAM_CASH_COST',module:'COSTS'},async(tx,images)=>{
  const old=input.id?await tx.costRecord.findFirst({where:{id:input.id,projectId:scope.projectId}}):null;
  if(input.id&&!old)throw new ProxyDomainError('NOT_FOUND');if(old){if(old.revision!==input.expectedRevision||old.voidedAt)throw new ProxyDomainError('STALE_PREVIEW');cashReason(input.reason);await assertPeriodOpen(tx,scope.projectId,old.date,old.currency);}
  await assertPeriodOpen(tx,scope.projectId,date,currency);
  const p2p=input.p2pQuoteToken?verifyP2PQuote(input.p2pQuoteToken,scope,currency,quote?.rate??''):null;
  const serverId=input.serverId===undefined?old?.serverId??null:input.serverId,proxyAccountId=input.proxyAccountId===undefined?old?.proxyAccountId??null:input.proxyAccountId;
  if(serverId&&!await tx.server.findFirst({where:{id:serverId,projectId:scope.projectId}})||proxyAccountId&&!await tx.proxyProviderAccount.findFirst({where:{id:proxyAccountId,projectId:scope.projectId}}))throw new ProxyDomainError('NOT_FOUND');
  const sourceReceiptId=input.sourceReceiptId===undefined?old?.sourceReceiptId??null:input.sourceReceiptId,sourceCollectorExpenseId=input.sourceCollectorExpenseId===undefined?old?.sourceCollectorExpenseId??null:input.sourceCollectorExpenseId;
  if(sourceReceiptId&&!await tx.teamReceipt.findFirst({where:{id:sourceReceiptId,projectId:scope.projectId,status:'CONFIRMED',voidedAt:null}}))throw new ProxyDomainError('NOT_FOUND');
  if(input.treatment==='ALREADY_NETTED'&&!sourceReceiptId)throw new ProxyDomainError('INVALID_INPUT','Khoản đã trừ cần liên kết phiếu nhận team đã xác nhận');
  if(sourceCollectorExpenseId){
   const source=await tx.collectorExpense.findFirst({where:{id:sourceCollectorExpenseId,projectId:scope.projectId,voidedAt:null}});
   if(!source||!['BILL','OTHER'].includes(source.type))throw new ProxyDomainError('INVALID_INPUT','Chỉ phân loại BILL/OTHER thành chi phí');
   if(currency!=='USD'||!new CashDecimal(source.amount.toString()).eq(original))throw new ProxyDomainError('INVALID_INPUT','Giữ đúng số USD gốc của nguồn collector');
   if(await tx.costRecord.findFirst({where:{sourceCollectorExpenseId,...(old?{id:{not:old.id}}:{})}}))throw new ProxyDomainError('INVALID_INPUT','Nguồn đã liên kết');
   await assertPeriodOpen(tx,scope.projectId,source.date,'USDT');await images.remember('COLLECTOR_EXPENSE',source.id);
   await tx.collectorExpense.update({where:{id:source.id},data:{businessManaged:true,revision:{increment:1}}});
  }
  if(old?.sourceCollectorExpenseId&&old.sourceCollectorExpenseId!==sourceCollectorExpenseId)throw new ProxyDomainError('INVALID_INPUT','Giữ nguồn gốc; thu hồi để điều chỉnh liên kết');
  const sameQuote=!!old&&old.currency===currency&&old.usdtRate?.eq(quote?.rate??'0');
  const data={date,amount:original,total:original,currency,category:input.category,note:input.notes,serverId,proxyAccountId,usdtRate:quote?.rate??null,usdtAmount:quote?.usdt??null,fxAppliedAt:p2p?new Date(p2p.fetchedAt):sameQuote?old.fxAppliedAt:quote?new Date():null,fxSource:p2p?'BINANCE_P2P_'+p2p.side:sameQuote?old.fxSource:quote?'MANUAL':null,fxNote:input.reason??null,profitTreatment:input.treatment,sourceReceiptId,sourceCollectorExpenseId,businessManaged:true};
  if(old)await images.remember('COST',old.id);
  const row=old?await tx.costRecord.update({where:{id:old.id},data:{...data,revision:{increment:1}}}):await tx.costRecord.create({data:{...data,projectId:scope.projectId,code:'CP-'+input.key}});
  if(!old)await images.remember('COST',row.id,true);await deps.afterWrite?.(tx);return {id:row.id};
 },db);
}
export async function voidUsdtCost(scope:ActorScope,input:{id:string;expectedRevision:number;key:string;reason:string},db:PrismaClient=prisma){
 cashReason(input.reason);return runCashCommand(scope,{key:input.key,payload:input,kind:'TEAM_CASH_COST_VOID',module:'COSTS'},async(tx,images)=>{
  const row=await tx.costRecord.findFirst({where:{id:input.id,projectId:scope.projectId}});if(!row)throw new ProxyDomainError('NOT_FOUND');if(row.revision!==input.expectedRevision||row.voidedAt)throw new ProxyDomainError('STALE_PREVIEW');await assertPeriodOpen(tx,scope.projectId,row.date,row.currency);await images.remember('COST',row.id);await tx.costRecord.update({where:{id:row.id},data:{voidedAt:new Date(),revision:{increment:1}}});return {id:row.id};
 },db);
}
export async function lastCostRate(scope:ActorScope,currency:string,db:PrismaClient=prisma){
 await authorizeTeamCash(scope,'COSTS',false,db);const row=await db.costRecord.findFirst({where:{projectId:scope.projectId,currency:cashCurrency(currency),voidedAt:null,usdtRate:{gt:0},fxAppliedAt:{not:null}},orderBy:[{fxAppliedAt:'desc'},{id:'desc'}]});return row?{rate:row.usdtRate!.toFixed(12),date:dayText(row.date),sourceCostId:row.id}:null;
}
