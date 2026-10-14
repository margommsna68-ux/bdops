import type {Prisma,PrismaClient} from '@prisma/client';
import {loadInfrastructureScope,assertInfrastructureAction} from '../permissions/infrastructure';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import type {BusinessArea} from './types';
export function assertBusinessArea(scope:ActorScope,area:BusinessArea,write=false){
  if(scope.businessMode!=='PROXY_VM'||scope.role!=='ADMIN'&&!scope.allowedModules?.includes(area)||write&&scope.role==='VIEWER')throw new ProxyDomainError('FORBIDDEN');
  if(area==='INFRASTRUCTURE')assertInfrastructureAction(scope,write?'ASSIGN':'READ');
  else if(write&&!['ADMIN','MODERATOR'].includes(scope.role))throw new ProxyDomainError('FORBIDDEN','Chỉ quản lý được ghi số liệu tài chính');
}
export async function authorizeBusiness(scope:ActorScope,area:BusinessArea,write:boolean,db:PrismaClient|Prisma.TransactionClient){const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);assertBusinessArea(current,area,write);return current;}
