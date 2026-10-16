import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {assertInfrastructureAction,loadInfrastructureScope} from '@/server/permissions/infrastructure';
import {recordOperation} from '../operation-history/journal';
import {captureGroup} from '../operation-history/snapshot';
import {withProxyTransaction} from './transaction';
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
export const ownerLabel=(owner:Owner,subgroup:Subgroup,groupName:string|null|undefined)=>owner==='SELF'?'TUT':owner==='GENJY'?(subgroup==='PC_CHUNG'?'Chung mooon–Genjy':'Genjy riêng'):owner==='OTHER'?(groupName||'Nhóm khác'):'Chưa xác định';
export const sortGroups=<T extends {name:string}>(list:T[])=>list.sort((a,b)=>a.name.localeCompare(b.name,'vi',{sensitivity:'base',numeric:true}));
export async function listGroups(scope:ActorScope,db:Reader=prisma,options:{activeOnly?:boolean}={}):Promise<ProxyGroupRef[]>{
  assertInfrastructureAction(await loadInfrastructureScope(db,scope.userId,scope.projectId),'READ');
  const [groups,counts]=await Promise.all([db.proxyGroup.findMany({where:{projectId:scope.projectId,...(options.activeOnly?{archivedAt:null}:{})}}),db.proxyIP.groupBy({by:['groupId'],where:{projectId:scope.projectId,groupId:{not:null},inventoryState:{notIn:['REPLACED','VOID','RETIRED']}},_count:{_all:true}})]);
  const byId=new Map(counts.map(c=>[c.groupId,c._count._all]));
  return sortGroups(groups.map(g=>({id:g.id,name:g.name,archivedAt:g.archivedAt?.toISOString()??null,proxyCount:byId.get(g.id)||0})));
}
// Rename keeps the id (links and history untouched); archive only hides the group from choice lists. Both are journaled and undoable.
async function manageGroup(scope:ActorScope,id:string,db:PrismaClient,change:(group:{id:string;name:string;archivedAt:Date|null})=>Promise<{name?:string;normalizedName?:string;archivedAt?:Date|null}>,summary:Record<string,string|number>){
  return withProxyTransaction(async tx=>{
    const current=await loadInfrastructureScope(tx,scope.userId,scope.projectId);assertInfrastructureAction(current,'MANAGE');
    const group=await tx.proxyGroup.findFirst({where:{id,projectId:scope.projectId}});if(!group) throw new ProxyDomainError('NOT_FOUND','Không có nhóm này');
    const data=await change(group);
    const updated=await tx.proxyGroup.update({where:{id:group.id},data:{...data,revision:{increment:1}}});
    await recordOperation(tx,{scope:current,kind:'GROUP',summary,snapshot:{version:1,resources:[{resource:'GROUP',id:group.id,before:captureGroup(group),after:captureGroup(updated)}],eventIds:[],replacementIds:[]}});
    await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'PROXY_GROUP',entity:'ProxyGroup',entityId:group.id,changes:summary}});
    return {id:updated.id,name:updated.name,archivedAt:updated.archivedAt?.toISOString()??null};
  },db);
}
export async function renameGroup(scope:ActorScope,id:string,raw:string,db:PrismaClient=prisma):Promise<ProxyGroupRef>{
  return manageGroup(scope,id,db,async group=>{
    const {name,normalized,group:other}=await findGroupByName(db,scope.projectId,raw);
    if(other&&other.id!==group.id) throw new ProxyDomainError('DUPLICATE_INPUT','Nhóm "'+other.name+'" đã có');
    return {name,normalizedName:normalized};
  },{action:'rename',name:normalizeGroupName(raw).name});
}
export async function archiveGroup(scope:ActorScope,id:string,archived:boolean,db:PrismaClient=prisma):Promise<ProxyGroupRef>{
  return manageGroup(scope,id,db,async()=>({archivedAt:archived?new Date():null}),{action:archived?'archive':'unarchive'});
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
