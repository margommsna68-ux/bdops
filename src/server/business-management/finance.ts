import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand} from './idempotency';
import {money,dayDate} from './money';
import {assertPeriodOpen} from './period-lock';
import type {Currency,FinanceKind} from './types';
export interface FinanceInput {kind:FinanceKind;id?:string;expectedRevision?:number;key:string;date:string;currency:Currency;amount:string;notes?:string;transactionId?:string;paypalId?:string;paypalEmailId?:string|null;serverId?:string|null;vmId?:string|null;proxyAccountId?:string|null;category?:string;confirmed?:boolean;failed?:boolean;company?:string;type?:'EXCHANGE'|'MIXING';destPaypalId?:string|null;paidToTeam?:boolean;paypalFee?:string|null;isPrepaid?:boolean}
export async function saveFinance(scope:ActorScope,input:FinanceInput,db:PrismaClient=prisma,deps:{afterWrite?:(tx:Prisma.TransactionClient)=>void|Promise<void>}={}){
 const amount=money(input.amount),date=dayDate(input.date);if(amount.lte(0)||!['USD','VND'].includes(input.currency)||input.notes&&input.notes.length>2000||input.transactionId&&input.transactionId.length>160)throw new ProxyDomainError('INVALID_INPUT');
 return runBusinessCommand(scope,{key:input.key,payload:input,kind:input.kind==='FUND'?'BUSINESS_FUND':input.kind==='COST'?'BUSINESS_COST':'BUSINESS_WITHDRAWAL',module:input.kind==='COST'?'COSTS':input.kind==='WITHDRAWAL'?'WITHDRAWALS':'FUNDS'},async(tx,images)=>{
  const old=input.id?(input.kind==='FUND'?await tx.fundTransaction.findFirst({where:{id:input.id,projectId:scope.projectId}}):input.kind==='COST'?await tx.costRecord.findFirst({where:{id:input.id,projectId:scope.projectId}}):await tx.withdrawal.findFirst({where:{id:input.id,projectId:scope.projectId}})):null;
  if(input.id&&!old)throw new ProxyDomainError('NOT_FOUND');if(old&&(old.revision!==input.expectedRevision||old.voidedAt))throw new ProxyDomainError('STALE_PREVIEW');if(old)await assertPeriodOpen(tx,scope.projectId,old.date,old.currency);await assertPeriodOpen(tx,scope.projectId,date,input.currency);
  let serverId=input.serverId===undefined?old&&'serverId' in old?old.serverId:null:input.serverId;const vmId=input.vmId===undefined?old&&'vmId' in old?old.vmId:null:input.vmId;
  if(vmId){const vm=await tx.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId:scope.projectId,managed:true}}});if(!vm||serverId&&serverId!==vm.serverId)throw new ProxyDomainError('NOT_FOUND');serverId=vm.serverId;}
  if(serverId&&!await tx.server.findFirst({where:{id:serverId,projectId:scope.projectId,managed:true}}))throw new ProxyDomainError('NOT_FOUND');
  if(input.kind==='COST'){
   const prior=old as Awaited<ReturnType<typeof tx.costRecord.findFirst>>,proxyAccountId=input.proxyAccountId===undefined?prior?.proxyAccountId||null:input.proxyAccountId;
   if(proxyAccountId&&!await tx.proxyProviderAccount.findFirst({where:{id:proxyAccountId,projectId:scope.projectId}}))throw new ProxyDomainError('NOT_FOUND');const category=input.category||prior?.category||'OTHER';if(!['SERVER','IP_PROXY','GMAIL','PAYPAL','OTHER'].includes(category))throw new ProxyDomainError('INVALID_INPUT');
   const data={date,amount,total:amount,category,currency:input.currency,note:input.notes,serverId,proxyAccountId,isPrepaid:input.isPrepaid??prior?.isPrepaid??false,businessManaged:true};if(prior)await images.remember('COST',prior.id);const row=prior?await tx.costRecord.update({where:{id:prior.id},data:{...data,revision:{increment:1}}}):await tx.costRecord.create({data:{...data,projectId:scope.projectId,code:'CP-'+input.key}});if(!prior)await images.remember('COST',row.id,true);await deps.afterWrite?.(tx);return {id:row.id};
  }
  const prior=old as Awaited<ReturnType<typeof tx.fundTransaction.findFirst>>|Awaited<ReturnType<typeof tx.withdrawal.findFirst>>,paypalId=input.paypalId|| (prior&&'paypalId' in prior?prior.paypalId:prior&&'sourcePaypalId' in prior?prior.sourcePaypalId:undefined);
  if(!paypalId||!await tx.payPalAccount.findFirst({where:{id:paypalId,projectId:scope.projectId}}))throw new ProxyDomainError('NOT_FOUND');
  if(prior&&input.transactionId!==undefined&&input.transactionId.trim()!==prior.transactionId)throw new ProxyDomainError('INVALID_INPUT','Mã giao dịch giữ nguyên; tạo ghi nhận điều chỉnh nếu cần');
  await images.remember('PAYPAL',paypalId);await tx.payPalAccount.update({where:{id:paypalId},data:{revision:{increment:1}}});
  if(input.kind==='FUND'){
   const previous=prior as Awaited<ReturnType<typeof tx.fundTransaction.findFirst>>,transactionId=previous?.transactionId||input.transactionId?.trim();if(!transactionId)throw new ProxyDomainError('INVALID_INPUT','Cần mã giao dịch để tránh ghi hai lần');
   const confirmed=input.confirmed??previous?.confirmed??false,failed=input.failed??previous?.failed??false;if(confirmed&&failed)throw new ProxyDomainError('INVALID_INPUT','Tiền không thể vừa đã nhận vừa không về');
   if(await tx.fundTransaction.findFirst({where:{projectId:scope.projectId,transactionId,...(previous?{id:{not:previous.id}}:{})},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','Mã giao dịch đã xuất hiện trước đây');
   const paypalEmailId=input.paypalEmailId===undefined?previous?.paypalEmailId||null:input.paypalEmailId;if(paypalEmailId&&!await tx.payPalEmail.findFirst({where:{id:paypalEmailId,projectId:scope.projectId,paypalId}}))throw new ProxyDomainError('NOT_FOUND');
   const data={date,amount,currency:input.currency,transactionId,confirmed,failed,notes:input.notes,company:input.company||previous?.company||'',paypalId,paypalEmailId,serverId,vmId,businessManaged:true};if(previous)await images.remember('FUND',previous.id);const row=previous?await tx.fundTransaction.update({where:{id:previous.id},data:{...data,revision:{increment:1}}}):await tx.fundTransaction.create({data:{...data,projectId:scope.projectId,createdById:scope.userId}});if(!previous)await images.remember('FUND',row.id,true);await deps.afterWrite?.(tx);return {id:row.id};
  }
  const previous=prior as Awaited<ReturnType<typeof tx.withdrawal.findFirst>>,type=input.type||previous?.type||'EXCHANGE',destPaypalId=input.destPaypalId===undefined?previous?.destPaypalId||null:input.destPaypalId;
  if(type==='MIXING'&&(!destPaypalId||destPaypalId===paypalId)||type==='EXCHANGE'&&destPaypalId)throw new ProxyDomainError('INVALID_INPUT','Chuyển nội bộ cần tài khoản nhận khác; rút về không chọn tài khoản đích');
  if(destPaypalId){if(!await tx.payPalAccount.findFirst({where:{id:destPaypalId,projectId:scope.projectId}}))throw new ProxyDomainError('NOT_FOUND');await images.remember('PAYPAL',destPaypalId);await tx.payPalAccount.update({where:{id:destPaypalId},data:{revision:{increment:1}}});}
  const transactionId=previous?.transactionId||input.transactionId?.trim()||'WEB-'+input.key;if(await tx.withdrawal.findFirst({where:{projectId:scope.projectId,transactionId,...(previous?{id:{not:previous.id}}:{})},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','Mã giao dịch rút/chuyển đã có');
  const paidToTeam=input.paidToTeam??previous?.paidToTeam??false,data={date,amount,currency:input.currency,type,sourcePaypalId:paypalId,destPaypalId,transactionId,paidToTeam,paidAt:paidToTeam?previous?.paidAt||new Date():null,notes:input.notes,paypalFee:input.paypalFee===undefined?undefined:input.paypalFee?money(input.paypalFee):null,businessManaged:true};
  if(previous)await images.remember('WITHDRAWAL',previous.id);const row=previous?await tx.withdrawal.update({where:{id:previous.id},data:{...data,revision:{increment:1}}}):await tx.withdrawal.create({data:{...data,projectId:scope.projectId}});if(!previous)await images.remember('WITHDRAWAL',row.id,true);await deps.afterWrite?.(tx);return {id:row.id};
 },db);
}
export async function voidFinance(scope:ActorScope,input:{kind:FinanceKind;id:string;expectedRevision:number;reason:string;key:string},db:PrismaClient=prisma){
 if(!input.reason.trim()||input.reason.length>300)throw new ProxyDomainError('INVALID_INPUT');return runBusinessCommand(scope,{key:input.key,payload:input,kind:'BUSINESS_FINANCE_VOID',module:input.kind==='COST'?'COSTS':input.kind==='WITHDRAWAL'?'WITHDRAWALS':'FUNDS'},async(tx,images)=>{
  const old=input.kind==='COST'?await tx.costRecord.findFirst({where:{id:input.id,projectId:scope.projectId}}):input.kind==='FUND'?await tx.fundTransaction.findFirst({where:{id:input.id,projectId:scope.projectId}}):await tx.withdrawal.findFirst({where:{id:input.id,projectId:scope.projectId}});if(!old)throw new ProxyDomainError('NOT_FOUND');if(old.revision!==input.expectedRevision||old.voidedAt)throw new ProxyDomainError('STALE_PREVIEW');await assertPeriodOpen(tx,scope.projectId,old.date,old.currency);await images.remember(input.kind,old.id);
  const data={voidedAt:new Date(),revision:{increment:1}};if(input.kind==='COST')await tx.costRecord.update({where:{id:old.id},data});else if(input.kind==='FUND')await tx.fundTransaction.update({where:{id:old.id},data});else await tx.withdrawal.update({where:{id:old.id},data});return {id:old.id};
 },db);
}
