import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {authorizeBusiness} from './scope';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {period,dayText} from './money';
import {businessHash} from './idempotency';
import type {Currency} from './types';
export interface ReportInput {start:string;end:string;currency:Currency}
export async function financialSources(projectId:string,input:ReportInput,db:PrismaClient|Prisma.TransactionClient){
 if(!['USD','VND'].includes(input.currency))throw new ProxyDomainError('INVALID_INPUT');const bounds=period(input.start,input.end),where={projectId,currency:input.currency,voidedAt:null,date:{gte:bounds.start,lt:bounds.end}};
 const [funds,withdrawals,costs]=await Promise.all([
  db.fundTransaction.findMany({where,orderBy:{id:'asc'},include:{paypal:{select:{code:true,primaryEmail:true}},server:{select:{code:true}},vm:{select:{code:true}}}}),
  db.withdrawal.findMany({where,orderBy:{id:'asc'},include:{sourcePaypal:{select:{code:true}},destPaypal:{select:{code:true}}}}),
  db.costRecord.findMany({where,orderBy:{id:'asc'},include:{server:{select:{code:true}},proxyAccount:{select:{code:true}}}}),
 ]);
 const sum=(values:Prisma.Decimal[])=>values.reduce((a,b)=>a.plus(b),new Prisma.Decimal(0)),received=sum(funds.filter(f=>f.confirmed&&!f.failed).map(f=>f.amount)),withdrawn=sum(withdrawals.filter(w=>w.type==='EXCHANGE').map(w=>w.amount)),receivedBack=sum(withdrawals.filter(w=>w.type==='EXCHANGE'&&w.paidToTeam).map(w=>w.amount)),transferred=sum(withdrawals.filter(w=>w.type==='MIXING').map(w=>w.amount)),cost=sum(costs.map(c=>c.total));
 const facts={funds:funds.map(f=>[f.id,f.revision]),withdrawals:withdrawals.map(w=>[w.id,w.revision]),costs:costs.map(c=>[c.id,c.revision])},report={currency:input.currency,basis:'WITHDRAWN' as const,received:received.toFixed(2),withdrawn:withdrawn.toFixed(2),receivedBack:receivedBack.toFixed(2),transferred:transferred.toFixed(2),cost:cost.toFixed(2),net:withdrawn.minus(cost).toFixed(2),sourceHash:businessHash({range:{start:input.start,end:input.end,currency:input.currency},facts}),pendingWithdrawals:withdrawals.filter(w=>w.type==='EXCHANGE'&&!w.paidToTeam).length};
 return {funds,withdrawals,costs,facts,report,bounds};
}
export async function businessReport(scope:ActorScope,input:ReportInput,db:PrismaClient=prisma){await authorizeBusiness(scope,'PROFIT',false,db);return (await financialSources(scope.projectId,input,db)).report;}
export async function readFinanceWorkspace(scope:ActorScope,input:ReportInput,db:PrismaClient=prisma){
 const current=await loadInfrastructureScope(db,scope.userId,scope.projectId),can=(module:string)=>current.role==='ADMIN'||!!current.allowedModules?.includes(module),hasFunds=can('FUNDS'),hasWithdrawals=can('WITHDRAWALS'),hasCosts=can('COSTS');if(current.businessMode!=='PROXY_VM'||!hasFunds&&!hasWithdrawals&&!hasCosts)throw new ProxyDomainError('FORBIDDEN');const source=await financialSources(scope.projectId,input,db);
 return {funds:hasFunds?source.funds.map(f=>({id:f.id,date:dayText(f.date),amount:f.amount.toFixed(2),currency:f.currency,transactionId:f.transactionId,confirmed:f.confirmed,failed:f.failed,notes:f.notes,paypalId:f.paypalId,paypal:f.paypal.code,serverId:f.serverId,vmId:f.vmId,server:f.server?.code||null,vm:f.vm?.code||null,revision:f.revision})):[],withdrawals:hasWithdrawals?source.withdrawals.map(w=>({id:w.id,date:dayText(w.date),amount:w.amount.toFixed(2),currency:w.currency,transactionId:w.transactionId,type:w.type,paypalId:w.sourcePaypalId,paypal:w.sourcePaypal.code,destPaypalId:w.destPaypalId,dest:w.destPaypal?.code||null,paidToTeam:w.paidToTeam,notes:w.notes,revision:w.revision})):[],costs:hasCosts?source.costs.map(c=>({id:c.id,date:dayText(c.date),amount:c.total.toFixed(2),currency:c.currency,category:c.category,notes:c.note,serverId:c.serverId,server:c.server?.code||null,proxyAccountId:c.proxyAccountId,proxyAccount:c.proxyAccount?.code||null,isPrepaid:c.isPrepaid,revision:c.revision})):[],report:can('PROFIT')?source.report:null,rights:{funds:hasFunds,withdrawals:hasWithdrawals,costs:hasCosts,writeFunds:hasFunds&&['ADMIN','MODERATOR'].includes(current.role),writeWithdrawals:hasWithdrawals&&['ADMIN','MODERATOR'].includes(current.role),writeCosts:hasCosts&&['ADMIN','MODERATOR'].includes(current.role)}};
}
export async function readFinanceChoices(scope:ActorScope,db:PrismaClient=prisma){
 const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);if(current.businessMode!=='PROXY_VM'||current.role!=='ADMIN'&&!['FUNDS','WITHDRAWALS','COSTS'].some(m=>current.allowedModules?.includes(m)))throw new ProxyDomainError('FORBIDDEN');
 const [paypals,servers,vms,packages]=await Promise.all([db.payPalAccount.findMany({where:{projectId:scope.projectId,archivedAt:null},select:{id:true,code:true,primaryEmail:true},orderBy:{code:'asc'}}),db.server.findMany({where:{projectId:scope.projectId,managed:true,archivedAt:null},select:{id:true,code:true},orderBy:{code:'asc'}}),db.virtualMachine.findMany({where:{managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},select:{id:true,code:true,serverId:true},orderBy:{code:'asc'}}),db.proxyProviderAccount.findMany({where:{projectId:scope.projectId},select:{id:true,code:true},orderBy:{code:'asc'}})]);return {paypals,servers,vms,packages};
}
