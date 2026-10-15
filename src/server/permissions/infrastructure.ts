import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import type {PrismaClient,Prisma} from '@prisma/client';
export type InfrastructureAction='READ'|'BLOCK'|'IMPORT'|'REPLACE'|'ASSIGN'|'CONFIRM'|'COPY_CREDENTIALS'|'MANAGE';
export function assertInfrastructureAction(scope:ActorScope,action:InfrastructureAction){
  const denied=()=>{throw new ProxyDomainError('FORBIDDEN','Không có quyền thao tác trong dự án này');};
  if(!scope.userId||!scope.projectId) denied();
  if(scope.role!=='ADMIN'&&!scope.allowedModules?.includes('INFRASTRUCTURE')) denied();
  if(action==='READ') return;
  if(scope.role==='VIEWER') denied();
  if(scope.role==='ADMIN') return;
  if(action==='COPY_CREDENTIALS'&&!scope.capabilities.includes('COPY_CREDENTIALS')) denied();
  if(scope.role==='MODERATOR') return;
  if(action==='MANAGE') denied();
  if(action==='IMPORT'&&!scope.capabilities.includes('PROXY_IMPORT')) denied();
  if(action==='REPLACE'&&!scope.capabilities.includes('PROXY_REPLACE')) denied();
}
export async function loadInfrastructureScope(db:PrismaClient|Prisma.TransactionClient,userId:string,projectId:string):Promise<ActorScope>{
  const member=await db.projectMember.findUnique({where:{userId_projectId:{userId,projectId}},include:{project:{select:{settings:true}}}});
  if(!member) throw new ProxyDomainError('FORBIDDEN','Không có quyền truy cập dự án');
  const settings=member.project.settings as {businessMode?:string;teamCashEnabled?:boolean}|null;
  const teamCashEnabled=!!settings?.teamCashEnabled||!!await db.teamReceipt.findFirst({where:{projectId},select:{id:true}})||!!await db.costRecord.findFirst({where:{projectId,OR:[{usdtRate:{not:null}},{profitTreatment:'ALREADY_NETTED',businessManaged:true}]},select:{id:true}})||!!await db.operationJournal.findFirst({where:{projectId,kind:{startsWith:'TEAM_CASH_'}},select:{id:true}});
  return {userId,projectId,role:member.role,allowedModules:member.allowedModules,capabilities:member.capabilities,businessMode:settings?.businessMode,teamCashEnabled};
}
