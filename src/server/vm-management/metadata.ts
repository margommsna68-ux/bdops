import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {withProxyTransaction} from '../proxy-management/transaction';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {recordOperation} from '../operation-history/journal';
import {authorizeVM} from './repository';
import {snapshotCollector} from './allocation';
function validateCodes(codes:string[]){if(!codes.length||codes.length>500||new Set(codes).size!==codes.length||codes.some(code=>!/^[a-zA-Z0-9_-]{1,64}$/.test(code)))throw new ProxyDomainError('INVALID_INPUT','Mỗi VM có một mã riêng (chữ/số/-/_), tối đa 500 VM mỗi đợt');}
export async function createManagedServer(scope:ActorScope,input:{code:string;vmCodes:string[];ipAddress?:string},db:PrismaClient=prisma){
  validateCodes(input.vmCodes);if(!input.code.trim()||input.code.length>80)throw new ProxyDomainError('INVALID_INPUT');
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),images=await snapshotCollector(tx,current),server=await tx.server.create({data:{projectId:scope.projectId,code:input.code.trim(),ipAddress:input.ipAddress||null,managed:true}});await images.remember('SERVER',server.id,true);
    for(const code of input.vmCodes){const vm=await tx.virtualMachine.create({data:{serverId:server.id,code,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});await images.remember('VM',vm.id,true);}
    await recordOperation(tx,{scope:current,kind:'SERVER_CREATE',summary:{server:server.code,count:input.vmCodes.length},snapshot:await images.finish()});return {id:server.id};
  },db);
}
export async function addManagedVMs(scope:ActorScope,serverId:string,codes:string[],db:PrismaClient=prisma){
  validateCodes(codes);return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),server=await tx.server.findFirst({where:{id:serverId,projectId:scope.projectId,managed:true,archivedAt:null}});if(!server)throw new ProxyDomainError('NOT_FOUND');
    const images=await snapshotCollector(tx,current);await images.remember('SERVER',server.id);
    for(const code of codes){const vm=await tx.virtualMachine.create({data:{serverId,code,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});await images.remember('VM',vm.id,true);}
    await tx.server.update({where:{id:server.id},data:{revision:{increment:1}}});await recordOperation(tx,{scope:current,kind:'VM_CREATE',summary:{server:server.code,count:codes.length},snapshot:await images.finish()});return {created:codes.length};
  },db);
}
export async function updateManagedServer(scope:ActorScope,serverId:string,input:{code:string;ipAddress?:string;notes?:string;expectedRevision:number},db:PrismaClient=prisma){
  if(!input.code.trim()||input.code.length>80)throw new ProxyDomainError('INVALID_INPUT');return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),server=await tx.server.findFirst({where:{id:serverId,projectId:scope.projectId,managed:true}});if(!server)throw new ProxyDomainError('NOT_FOUND');if(server.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW');
    const images=await snapshotCollector(tx,current);await images.remember('SERVER',server.id);await tx.server.update({where:{id:server.id},data:{code:input.code.trim(),ipAddress:input.ipAddress||null,notes:input.notes||null,revision:{increment:1}}});await recordOperation(tx,{scope:current,kind:'SERVER_METADATA',summary:{server:input.code},snapshot:await images.finish()});return {saved:true};
  },db);
}
export async function archiveManagedResource(scope:ActorScope,type:'SERVER'|'VM',id:string,db:PrismaClient=prisma){
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),images=await snapshotCollector(tx,current);
    if(type==='SERVER'){
      const server=await tx.server.findFirst({where:{id,projectId:scope.projectId,managed:true}});if(!server)throw new ProxyDomainError('NOT_FOUND');
      if(await tx.vMProxyAllocation.count({where:{releasedAt:null,vm:{serverId:id}}}))throw new ProxyDomainError('INVALID_INPUT','Máy còn proxy đang giữ/đã cài. Xác nhận ngừng dùng trước khi ẩn.');await images.remember('SERVER',id);await tx.server.update({where:{id},data:{archivedAt:new Date(),revision:{increment:1}}});
    }else{
      const vm=await tx.virtualMachine.findFirst({where:{id,managed:true,server:{projectId:scope.projectId,managed:true}}});if(!vm)throw new ProxyDomainError('NOT_FOUND');if(await tx.vMProxyAllocation.count({where:{vmId:id,releasedAt:null}}))throw new ProxyDomainError('INVALID_INPUT','VM còn proxy đang giữ/đã cài; chưa thể ẩn.');await images.remember('VM',id);await tx.virtualMachine.update({where:{id},data:{archivedAt:new Date(),revision:{increment:1}}});
    }
    await recordOperation(tx,{scope:current,kind:'INFRA_ARCHIVE',summary:{type},snapshot:await images.finish()});return {saved:true};
  },db);
}
