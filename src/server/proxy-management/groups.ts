import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {assertInfrastructureAction,loadInfrastructureScope} from '@/server/permissions/infrastructure';
import {ProxyDomainError,type ActorScope,type Owner,type ProxyGroupRef,type Subgroup} from './types';
type Reader=PrismaClient|Prisma.TransactionClient;
export const MAX_GROUP_NAME=60;
// Display names of the built-in groups; a ProxyGroup row may not reuse them.
const RESERVED=new Set(['tut','genjy','pc chung','genjy / pc chung','genjy · pc chung','chưa xác định','nhóm khác']);
export function normalizeGroupName(raw:string){const name=raw.replace(/\s+/g,' ').trim();return {name,normalized:name.toLocaleLowerCase('vi')};}
export function assertGroupName(raw:string){
  const n=normalizeGroupName(raw||'');
  if(!n.name||n.name.length>MAX_GROUP_NAME) throw new ProxyDomainError('INVALID_INPUT','Tên nhóm cần 1–'+MAX_GROUP_NAME+' ký tự');
  if(RESERVED.has(n.normalized)) throw new ProxyDomainError('INVALID_INPUT','"'+n.name+'" là tên có sẵn; chọn tên nhóm khác');
  return n;
}
export const ownerLabel=(owner:Owner,subgroup:Subgroup,groupName:string|null|undefined)=>owner==='SELF'?'TUT':owner==='GENJY'?(subgroup==='PC_CHUNG'?'genjy · PC chung':'genjy'):owner==='OTHER'?(groupName||'Nhóm khác'):'Chưa xác định';
export async function listGroups(scope:ActorScope,db:Reader=prisma):Promise<ProxyGroupRef[]>{
  assertInfrastructureAction(await loadInfrastructureScope(db,scope.userId,scope.projectId),'READ');
  return (await db.proxyGroup.findMany({where:{projectId:scope.projectId},select:{id:true,name:true}})).sort((a,b)=>a.name.localeCompare(b.name,'vi',{sensitivity:'base',numeric:true}));
}
// Inside a transaction: the group row for an exact (normalized) name, or a duplicate error when `create` is false.
export async function findGroupByName(tx:Reader,projectId:string,raw:string){const n=assertGroupName(raw);return {...n,group:await tx.proxyGroup.findUnique({where:{projectId_normalizedName:{projectId,normalizedName:n.normalized}}})};}
export async function insertGroup(tx:Reader,scope:ActorScope,raw:string){
  const {name,normalized,group}=await findGroupByName(tx,scope.projectId,raw);
  if(group) throw new ProxyDomainError('DUPLICATE_INPUT','Nhóm "'+group.name+'" đã có; chọn nhóm sẵn có');
  return tx.proxyGroup.create({data:{projectId:scope.projectId,name,normalizedName:normalized,createdById:scope.userId}});
}
export async function createGroup(scope:ActorScope,raw:string,db:PrismaClient=prisma):Promise<ProxyGroupRef>{
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);assertInfrastructureAction(current,'IMPORT');
  const group=await insertGroup(db,current,raw);return {id:group.id,name:group.name};
}
