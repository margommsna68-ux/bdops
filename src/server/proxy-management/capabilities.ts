import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {withProxyTransaction} from './transaction';
import {ProxyDomainError,type ActorScope} from './types';
export const proxyCapabilities=['COPY_CREDENTIALS','PROXY_IMPORT','PROXY_REPLACE'] as const;
async function administrator(scope:ActorScope,db:Parameters<typeof loadInfrastructureScope>[0]){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);
  if(current.role!=='ADMIN'||current.businessMode!=='PROXY_VM') throw new ProxyDomainError('FORBIDDEN');
  return current;
}
export async function listProxyMembers(scope:ActorScope,db:PrismaClient=prisma){
  await administrator(scope,db);
  return db.projectMember.findMany({where:{projectId:scope.projectId},select:{id:true,role:true,capabilities:true,allowedModules:true,user:{select:{name:true,username:true,email:true}}},orderBy:{createdAt:'asc'}});
}
export async function setProxyCapabilities(scope:ActorScope,memberId:string,capabilities:string[],db:PrismaClient=prisma,allowInfrastructure?:boolean){
  return withProxyTransaction(async tx=>{
    await administrator(scope,tx);
    if(capabilities.some(c=>!proxyCapabilities.includes(c as typeof proxyCapabilities[number]))) throw new ProxyDomainError('INVALID_INPUT');
    const member=await tx.projectMember.findFirst({where:{id:memberId,projectId:scope.projectId}});
    if(!member) throw new ProxyDomainError('FORBIDDEN');
    if(member.role==='VIEWER'&&capabilities.length) throw new ProxyDomainError('FORBIDDEN','Tài khoản chỉ xem không nhận quyền thao tác/copy');
    if(allowInfrastructure===false&&capabilities.length) throw new ProxyDomainError('INVALID_INPUT','Tắt quyền truy cập phải tắt các quyền thao tác');
    if(member.role==='ADMIN'&&allowInfrastructure===false) throw new ProxyDomainError('FORBIDDEN');
    const next=[...member.capabilities.filter(c=>!proxyCapabilities.includes(c as typeof proxyCapabilities[number])),...Array.from(new Set(capabilities))];
    const allowedModules=allowInfrastructure===undefined?member.allowedModules:allowInfrastructure?Array.from(new Set([...member.allowedModules,'INFRASTRUCTURE'])):member.allowedModules.filter(m=>m!=='INFRASTRUCTURE');
    await tx.projectMember.update({where:{id:member.id},data:{capabilities:next,allowedModules}});
    await tx.auditLog.create({data:{projectId:scope.projectId,userId:scope.userId,action:'PROXY_CAPABILITIES',entity:'ProjectMember',entityId:member.id,changes:{capabilities:next,allowInfrastructure:allowedModules.includes('INFRASTRUCTURE')}}});
    return {saved:true};
  },db);
}
