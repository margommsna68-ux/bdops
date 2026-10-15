import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {withProxyTransaction} from '../proxy-management/transaction';
import {lockCashProject} from './cash-lock';
import {recordOperation} from '../operation-history/journal';
export type CashArea='FUNDS'|'WITHDRAWALS'|'COSTS'|'PROFIT';
export async function authorizeTeamCash(scope:ActorScope,area:CashArea,write:boolean,db:PrismaClient|Prisma.TransactionClient){
 const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);
 if(!current.teamCashEnabled||current.role!=='ADMIN'&&!current.allowedModules?.includes(area)||write&&!['ADMIN','MODERATOR'].includes(current.role))throw new ProxyDomainError('FORBIDDEN');
 return current;
}
export async function activateTeamCash(scope:ActorScope,{key}:{key:string},db:PrismaClient=prisma){
 if(key.length<8||key.length>100)throw new ProxyDomainError('INVALID_INPUT');
 return withProxyTransaction(async tx=>{
  await lockCashProject(tx,scope.projectId);const current=await loadInfrastructureScope(tx,scope.userId,scope.projectId);if(current.role!=='ADMIN')throw new ProxyDomainError('FORBIDDEN');
  const prior=await tx.operationJournal.findUnique({where:{projectId_commandKey:{projectId:scope.projectId,commandKey:key}}});
  if(prior){if(prior.actorId!==scope.userId||prior.kind!=='TEAM_CASH_ACTIVATE')throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');return {id:scope.projectId,replay:true,undone:false};}
  const project=await tx.project.findUniqueOrThrow({where:{id:scope.projectId}});
  await tx.project.update({where:{id:scope.projectId},data:{settings:{...(project.settings as object??{}),teamCashEnabled:true}}});
  await recordOperation(tx,{scope:current,kind:'TEAM_CASH_ACTIVATE',accessModule:'PROFIT',commandKey:key,reversible:false,summary:{count:1},snapshot:{version:4,resources:[],eventIds:[],replacementIds:[]}});
  return {id:scope.projectId,replay:false,undone:false};
 },db);
}
export const cashFinancialResources=new Set(['COST','FUND','WITHDRAWAL','PROFIT','SPLIT_PAYMENT','TEAM_RECEIPT','COLLECTOR_EXPENSE','PAYPAL']);
