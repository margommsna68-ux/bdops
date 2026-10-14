import type {PrismaClient,VMTaskStatus} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand} from './idempotency';
import {authorizeBusiness} from './scope';
import {dayDate,dayText} from './money';
export interface WorkInput {id?:string;title:string;notes?:string;vmId?:string|null;serverId?:string|null;assigneeId?:string|null;status?:VMTaskStatus;dueDate?:string|null;expectedRevision?:number;key:string}
export async function saveWork(scope:ActorScope,input:WorkInput,db:PrismaClient=prisma){
 if(!input.title.trim()||input.title.length>200||input.notes&&input.notes.length>2000||input.status&&!['PENDING','IN_PROGRESS','COMPLETED','CANCELLED'].includes(input.status))throw new ProxyDomainError('INVALID_INPUT');
 return runBusinessCommand(scope,{key:input.key,payload:input,kind:'BUSINESS_WORK',module:'INFRASTRUCTURE'},async(tx,images)=>{
  const old=input.id?await tx.businessWorkItem.findFirst({where:{id:input.id,projectId:scope.projectId,archivedAt:null}}):null;if(input.id&&!old)throw new ProxyDomainError('NOT_FOUND');if(old&&old.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW');
  const vmId=input.vmId===undefined?old?.vmId||null:input.vmId;let serverId=input.serverId===undefined?old?.serverId||null:input.serverId;
  if(vmId){const vm=await tx.virtualMachine.findFirst({where:{id:vmId,managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}}});if(!vm||serverId&&serverId!==vm.serverId)throw new ProxyDomainError('NOT_FOUND');serverId=vm.serverId;}
  if(serverId&&!await tx.server.findFirst({where:{id:serverId,projectId:scope.projectId,managed:true,archivedAt:null}}))throw new ProxyDomainError('NOT_FOUND');
  const assigneeId=input.assigneeId===undefined?old?.assigneeId||null:input.assigneeId;if(assigneeId){const member=await tx.projectMember.findFirst({where:{projectId:scope.projectId,userId:assigneeId}});if(!member||member.role==='VIEWER'||member.role!=='ADMIN'&&!member.allowedModules.includes('INFRASTRUCTURE'))throw new ProxyDomainError('NOT_FOUND');}
  const status=input.status||old?.status||'PENDING',data={title:input.title.trim(),notes:input.notes,vmId,serverId,assigneeId,status,dueDate:input.dueDate===undefined?undefined:input.dueDate?dayDate(input.dueDate):null,completedAt:status==='COMPLETED'?old?.completedAt||new Date():null,completedById:status==='COMPLETED'?old?.completedById||scope.userId:null};
  if(old)await images.remember('WORK',old.id);const row=old?await tx.businessWorkItem.update({where:{id:old.id},data:{...data,revision:{increment:1}}}):await tx.businessWorkItem.create({data:{...data,projectId:scope.projectId,createdById:scope.userId}});if(!old)await images.remember('WORK',row.id,true);return {id:row.id};
 },db);
}
export async function readWorkWorkspace(scope:ActorScope,db:PrismaClient=prisma){await authorizeBusiness(scope,'INFRASTRUCTURE',false,db);const items=await db.businessWorkItem.findMany({where:{projectId:scope.projectId,archivedAt:null},include:{server:{select:{code:true}},vm:{select:{code:true}},assignee:{select:{name:true,username:true}}},orderBy:[{createdAt:'desc'},{id:'asc'}],take:500});return {items:items.map(w=>({id:w.id,title:w.title,notes:w.notes,status:w.status,vmId:w.vmId,serverId:w.serverId,server:w.server?.code||null,vm:w.vm?.code||null,assigneeId:w.assigneeId,assignee:w.assignee?.name||w.assignee?.username||null,revision:w.revision,dueDate:w.dueDate?dayText(w.dueDate):null,completedAt:w.completedAt?.toISOString()||null}))};}
