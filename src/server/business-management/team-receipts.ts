import {createHash} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runCashCommand} from './cash-command';
import {dayDate,money} from './money';
import {parseUsdt,CashDecimal} from './usdt-money';
import {cashReason} from './usdt-costs';
import {assertPeriodOpen,assertCollectorSourceOpen} from './period-lock';
import {openSnapshot} from '../operation-history/journal';
import type {SaveTeamReceiptInput} from './usdt-types';
const conflict=()=>new ProxyDomainError('INVALID_INPUT','Mã giao dịch hoặc nguồn đã được ghi nhận; kiểm tra trước khi lưu lại');
async function receiptOwnsSource(tx:Prisma.TransactionClient,projectId:string,id:string,sourceId:string){
 const entries=await tx.operationJournal.findMany({where:{projectId,kind:'TEAM_CASH_RECEIPT'}});
 return entries.some(e=>{const resources=openSnapshot(e.snapshotCipher).resources;return resources.some(r=>r.resource==='TEAM_RECEIPT'&&r.id===id&&r.after.sourceCollectorExpenseId===sourceId)&&resources.some(r=>r.resource==='COLLECTOR_EXPENSE'&&r.id===sourceId&&!r.before);});
}
export async function saveTeamReceipt(scope:ActorScope,input:SaveTeamReceiptInput,db:PrismaClient=prisma,deps:{afterWrite?:(tx:Prisma.TransactionClient)=>void|Promise<void>}={}){
 const date=dayDate(input.receivedDate),amount=input.amountUsdt?parseUsdt(input.amountUsdt):null,referenceId=input.referenceId?.trim()||null;
 if(!['DRAFT','CONFIRMED'].includes(input.status)||input.status==='CONFIRMED'&&(!amount||!referenceId)||referenceId&&referenceId.length>200||input.notes&&input.notes.length>2000)throw new ProxyDomainError('INVALID_INPUT');
 const referenceKey=referenceId?createHash('sha256').update(referenceId).digest('hex'):null;
 try{return await runCashCommand(scope,{key:input.key,payload:input,kind:'TEAM_CASH_RECEIPT',module:'WITHDRAWALS'},async(tx,images)=>{
  const old=input.id?await tx.teamReceipt.findFirst({where:{id:input.id,projectId:scope.projectId}}):null;
  if(input.id&&!old)throw new ProxyDomainError('NOT_FOUND');
  if(old){if(old.revision!==input.expectedRevision||old.voidedAt)throw new ProxyDomainError('STALE_PREVIEW');cashReason(input.reason);await assertPeriodOpen(tx,scope.projectId,old.receivedAt,'USDT');if(old.referenceKey&&old.referenceKey!==referenceKey)throw new ProxyDomainError('INVALID_INPUT','Giữ mã giao dịch gốc; thu hồi để sửa nhầm');}
  await assertPeriodOpen(tx,scope.projectId,date,'USDT');
  if(referenceKey&&await tx.teamReceipt.findFirst({where:{referenceKey,...(old?{id:{not:old.id}}:{})}}))throw conflict();
  const collectorId=input.collectorId===undefined?old?.collectorId??null:input.collectorId;
  if(collectorId&&!await tx.projectMember.findUnique({where:{userId_projectId:{userId:collectorId,projectId:scope.projectId}}}))throw new ProxyDomainError('NOT_FOUND');
  let sourceId=input.sourceCollectorExpenseId===undefined?old?.sourceCollectorExpenseId??null:input.sourceCollectorExpenseId,usd=input.collectorUsdAmount?money(input.collectorUsdAmount):old?.collectorUsdAmount??null;
  if(usd&&usd.lte(0))throw new ProxyDomainError('INVALID_INPUT');
  if(old?.sourceCollectorExpenseId&&(sourceId!==old.sourceCollectorExpenseId||collectorId!==old.collectorId))throw new ProxyDomainError('INVALID_INPUT','Giữ nguồn collector gốc');
  if(sourceId){
   const source=await tx.collectorExpense.findFirst({where:{id:sourceId,projectId:scope.projectId,voidedAt:null}});
   if(!source||source.type!=='TEAM_PAYMENT'||!collectorId||source.collectorId!==collectorId)throw new ProxyDomainError('INVALID_INPUT','Nguồn phải là TEAM_PAYMENT cùng dự án và collector');
   if(usd&&!new CashDecimal(source.amount.toString()).eq(usd.toString()))throw new ProxyDomainError('INVALID_INPUT','Số USD phải khớp nguồn gốc');usd=source.amount;
   if(await tx.teamReceipt.findFirst({where:{sourceCollectorExpenseId:sourceId,...(old?{id:{not:old.id}}:{})}}))throw conflict();
   await assertPeriodOpen(tx,scope.projectId,source.date,'USDT');await images.remember('COLLECTOR_EXPENSE',source.id);
   await tx.collectorExpense.update({where:{id:source.id},data:{businessManaged:true,revision:{increment:1}}});
  }else if(usd&&input.status==='CONFIRMED'){
   if(!collectorId)throw new ProxyDomainError('INVALID_INPUT','Chọn collector cho khoản USD đối soát');
   const source=await tx.collectorExpense.create({data:{projectId:scope.projectId,collectorId,date,type:'TEAM_PAYMENT',amount:usd,referenceId:'TEAM-CASH-'+input.key,businessManaged:true}});sourceId=source.id;await images.remember('COLLECTOR_EXPENSE',source.id,true);
  }
  if(old&&input.status!=='CONFIRMED'&&await tx.costRecord.findFirst({where:{sourceReceiptId:old.id,voidedAt:null}}))throw new ProxyDomainError('INVALID_INPUT','Phiếu đang làm nguồn đối soát chi phí');
  if(old)await images.remember('TEAM_RECEIPT',old.id);
  const data={receivedAt:date,amountUsdt:amount,referenceId,referenceKey,status:input.status,collectorId,sourceCollectorExpenseId:sourceId,collectorUsdAmount:usd,notes:input.notes};
  const row=old?await tx.teamReceipt.update({where:{id:old.id},data:{...data,revision:{increment:1}}}):await tx.teamReceipt.create({data:{...data,projectId:scope.projectId,createdById:scope.userId}});
  if(!old)await images.remember('TEAM_RECEIPT',row.id,true);await deps.afterWrite?.(tx);return {id:row.id};
 },db);}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw conflict();throw error;}
}
async function setReceiptVoided(scope:ActorScope,input:{id:string;expectedRevision:number;key:string;reason:string},restore:boolean,db:PrismaClient,deps:{afterWrite?:(tx:Prisma.TransactionClient)=>void|Promise<void>}={}){
 cashReason(input.reason);return runCashCommand(scope,{key:input.key,payload:input,kind:restore?'TEAM_CASH_RECEIPT_RESTORE':'TEAM_CASH_RECEIPT_VOID',module:'WITHDRAWALS'},async(tx,images,current)=>{
  if(restore&&current.role!=='ADMIN')throw new ProxyDomainError('FORBIDDEN');
  const row=await tx.teamReceipt.findFirst({where:{id:input.id,projectId:scope.projectId}});if(!row)throw new ProxyDomainError('NOT_FOUND');if(row.revision!==input.expectedRevision||!!row.voidedAt!==restore)throw new ProxyDomainError('STALE_PREVIEW');
  await assertPeriodOpen(tx,scope.projectId,row.receivedAt,'USDT');
  await assertCollectorSourceOpen(tx,scope.projectId,row.sourceCollectorExpenseId);
  if(!restore&&await tx.costRecord.findFirst({where:{sourceReceiptId:row.id,voidedAt:null}}))throw new ProxyDomainError('INVALID_INPUT','Thu hồi chi phí đối soát liên kết trước');
  if(row.sourceCollectorExpenseId&&await receiptOwnsSource(tx,scope.projectId,row.id,row.sourceCollectorExpenseId)){
   const source=await tx.collectorExpense.findUniqueOrThrow({where:{id:row.sourceCollectorExpenseId}});
   await assertPeriodOpen(tx,scope.projectId,source.date,'USDT');
   if(source.projectId!==scope.projectId||source.type!=='TEAM_PAYMENT'||source.collectorId!==row.collectorId||!source.amount.eq(row.collectorUsdAmount!))throw new ProxyDomainError('STALE_PREVIEW');
   if(await tx.withdrawal.findFirst({where:{expenseId:source.id}}))throw new ProxyDomainError('INVALID_INPUT','Có giao dịch khác liên kết nguồn; cần đối soát');
   await images.remember('COLLECTOR_EXPENSE',source.id);await tx.collectorExpense.update({where:{id:source.id},data:{voidedAt:restore?null:new Date(),revision:{increment:1}}});
  }
  await images.remember('TEAM_RECEIPT',row.id);await tx.teamReceipt.update({where:{id:row.id},data:{voidedAt:restore?null:new Date(),revision:{increment:1}}});await deps.afterWrite?.(tx);return {id:row.id};
 },db);
}
export function voidTeamReceipt(scope:ActorScope,input:{id:string;expectedRevision:number;key:string;reason:string},db:PrismaClient=prisma,deps:{afterWrite?:(tx:Prisma.TransactionClient)=>void|Promise<void>}={}){return setReceiptVoided(scope,input,false,db,deps);}
export function restoreTeamReceipt(scope:ActorScope,input:{id:string;expectedRevision:number;key:string;reason:string},db:PrismaClient=prisma){return setReceiptVoided(scope,input,true,db);}
