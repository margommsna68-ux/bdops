import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {authorizeVM} from './repository';
import {ownerLabel} from '../proxy-management/groups';
// Side panel of one VM: every configuration version (who/when created, started, confirmed, cancelled), install and other tasks.
// Never returns credentials; the proxy is shown as IP:port only. Works for deleted VMs too (read-only history).
export async function readVMDetail(scope:ActorScope,vmId:string,db:PrismaClient=prisma){
  await authorizeVM(scope,'READ',db);
  const vm=await db.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId:scope.projectId,managed:true}},include:{server:{select:{id:true,code:true}},gmail:{select:{id:true,email:true}},configurations:{orderBy:{version:'desc'},take:50,include:{endpoint:{select:{host:true,port:true,group:{select:{name:true}},identity:{select:{owner:true,subgroup:true}}}}}},tasks:{orderBy:{scheduledAt:'desc'},take:50}}});
  if(!vm)throw new ProxyDomainError('NOT_FOUND');
  const ids=Array.from(new Set(vm.configurations.flatMap(c=>[c.createdById,c.confirmedById]).filter((s):s is string=>!!s)));
  const users=await db.user.findMany({where:{id:{in:ids}},select:{id:true,name:true,username:true}});
  const who=(id:string|null)=>{if(!id)return null;const u=users.find(x=>x.id===id);return u?u.name||u.username||'Tài khoản cũ':'Tài khoản cũ';};
  const iso=(d:Date|null)=>d?d.toISOString():null;
  return {
    id:vm.id,code:vm.code,server:vm.server.code,serverId:vm.server.id,archivedAt:iso(vm.archivedAt),notes:vm.notes,gmail:vm.gmail,
    configurations:vm.configurations.map(c=>({id:c.id,version:c.version,status:c.status,ip:c.endpoint?.host||null,port:c.endpoint?.port||null,group:c.endpoint?.identity?ownerLabel(c.endpoint.identity.owner,c.endpoint.identity.subgroup,c.endpoint.group?.name):null,current:c.id===vm.desiredConfigurationId?'DESIRED':c.id===vm.installedConfigurationId?'INSTALLED':null,installed:c.id===vm.installedConfigurationId,createdAt:c.createdAt.toISOString(),createdBy:who(c.createdById),startedAt:iso(c.startedAt),confirmedAt:iso(c.confirmedAt),confirmedBy:who(c.confirmedById),failureNote:c.failureNote})),
    tasks:vm.tasks.map(t=>({id:t.id,type:t.type,title:t.title,status:t.status,scheduledAt:t.scheduledAt.toISOString(),completedAt:iso(t.completedAt),configurationId:t.configurationId})),
  };
}
export type VMDetail=Awaited<ReturnType<typeof readVMDetail>>;
