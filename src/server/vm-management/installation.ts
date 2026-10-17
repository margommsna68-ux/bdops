import type {PrismaClient,Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {decrypt,encrypt} from '@/lib/encryption';
import {ProxyDomainError,isShared,type ActorScope,type SourceSnapshotRef} from '../proxy-management/types';
import {refreshGenjy} from '../proxy-management/sources';
import {fullProxy} from '../proxy-management/parse';
import {withProxyTransaction} from '../proxy-management/transaction';
import {recordOperation} from '../operation-history/journal';
import {authorizeVM,requireGenjy} from './repository';
import {snapshotCollector} from './allocation';
import {vmHash,type ConfigurationSnapshot} from './types';
import {syncAssignmentState} from '../proxy-management/assignment-state';
async function currentConfiguration(tx:Prisma.TransactionClient,scope:ActorScope,id:string){
  const config=await tx.vMConfiguration.findFirst({where:{id,projectId:scope.projectId,vm:{managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}}},include:{vm:{include:{server:true}},endpoint:{include:{identity:true}},task:true}});
  if(!config)throw new ProxyDomainError('NOT_FOUND');if(config.vm.desiredConfigurationId!==id&&config.vm.installedConfigurationId!==id)throw new ProxyDomainError('STALE_PREVIEW','Cấu hình này đã được thay bằng phiên bản mới');return config;
}
async function begin(tx:Prisma.TransactionClient,scope:ActorScope,id:string){
  const config=await currentConfiguration(tx,scope,id);
  if(config.status==='CONFIRMED'&&config.vm.installedConfigurationId===config.id)return config;
  if(config.vm.desiredConfigurationId!==config.id||config.status==='CANCELLED')throw new ProxyDomainError('STALE_PREVIEW');
  if(!config.endpoint?.identity||(config.endpoint.identity.owner!=='SELF'&&!isShared(config.endpoint.identity.owner,config.endpoint.identity.subgroup)))throw new ProxyDomainError('OWNER_CONFLICT','Proxy không còn thuộc kho TUT hoặc nhóm chung. Giữ lại để kiểm tra.');
  if(config.endpoint.retiredAt||!['NEW','LIVE'].includes(config.endpoint.inventoryState))throw new ProxyDomainError('INVALID_INPUT','Proxy đang lỗi hoặc đã ngừng dùng. Giao proxy mới trước khi cài.');
  if(config.status==='IN_PROGRESS')return config;
  const images=await snapshotCollector(tx,scope);await images.remember('VM_CONFIG',id);await images.remember('VM',config.vmId);if(config.task)await images.remember('VM_TASK',config.task.id);
  await tx.vMConfiguration.update({where:{id},data:{status:'IN_PROGRESS',startedAt:config.startedAt||new Date(),failureNote:null,revision:{increment:1}}});if(config.task)await tx.vMTask.update({where:{id:config.task.id},data:{status:'IN_PROGRESS'}});await tx.virtualMachine.update({where:{id:config.vmId},data:{revision:{increment:1}}});
  if(!config.startedAt)await tx.proxyStatusEvent.create({data:{projectId:scope.projectId,identityId:config.endpoint.identityId!,endpointId:config.endpoint.id,ip:config.endpoint.host!,kind:'INSTALL_STARTED',occurredAt:new Date(),actorId:scope.userId,sourceRef:config.vm.server.code+'/'+config.vm.code}});
  await recordOperation(tx,{scope,kind:'INSTALL_START',summary:{vm:config.vm.code,version:config.version},snapshot:await images.finish(),reversible:false});return config;
}
export async function startInstall(scope:ActorScope,id:string,db:PrismaClient=prisma){return withProxyTransaction(async tx=>{const current=await authorizeVM(scope,'CONFIRM',tx),config=await begin(tx,current,id);return {configurationId:config.id,version:config.version};},db);}
export async function copyConfiguration(scope:ActorScope,id:string,db:PrismaClient=prisma){
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'COPY_CREDENTIALS',tx);await authorizeVM(scope,'CONFIRM',tx);
    const config=await currentConfiguration(tx,current,id),snapshot=JSON.parse(decrypt(config.snapshotCipher)) as ConfigurationSnapshot;if(vmHash(snapshot)!==config.configurationHash||snapshot.proxy.format!=='FULL')throw new ProxyDomainError('INVALID_INPUT');
    await begin(tx,current,id);await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'COPY_VM_CONFIGURATION',entity:'VMConfiguration',entityId:id,changes:{version:config.version}}});return {proxy:fullProxy(snapshot.proxy),version:config.version,configurationHash:config.configurationHash};
  },db);
}
// Plain copy (Server/VM table, bulk bar): reads the assigned (DESIRED) or installed snapshot in the order given. It never starts the
// install, never changes status/startedAt/task and keeps undo possible; "Copy để cài" (copyConfiguration) keeps that meaning.
// Audit logs carry counts only.
export async function copyVmConfigurations(scope:ActorScope,input:{vmIds:string[];which:'DESIRED'|'INSTALLED'},db:PrismaClient=prisma){
  if(!input.vmIds.length||input.vmIds.length>2000||!['DESIRED','INSTALLED'].includes(input.which))throw new ProxyDomainError('INVALID_INPUT');
  const current=await authorizeVM(scope,'COPY_CREDENTIALS',db);
  const vms=await db.virtualMachine.findMany({where:{id:{in:input.vmIds},managed:true,server:{projectId:scope.projectId,managed:true}},include:{server:{select:{code:true}},desiredConfiguration:true,installedConfiguration:true}});
  if(vms.length!==new Set(input.vmIds).size)throw new ProxyDomainError('NOT_FOUND','Có VM không thuộc dự án này');
  const byId=new Map(vms.map(v=>[v.id,v])),items:{vmId:string;server:string;vm:string;version:number;proxy:string}[]=[],skipped:{vmId:string;server:string;vm:string;reason:string}[]=[];
  for(const id of input.vmIds){
    const vm=byId.get(id)!,config=input.which==='DESIRED'?vm.desiredConfiguration:vm.installedConfiguration,where={vmId:vm.id,server:vm.server.code,vm:vm.code};
    if(!config||config.status==='CANCELLED'){skipped.push({...where,reason:input.which==='DESIRED'?'Chưa có proxy được giao':'Chưa có cấu hình đã cài'});continue;}
    const snapshot=JSON.parse(decrypt(config.snapshotCipher)) as ConfigurationSnapshot;
    if(vmHash(snapshot)!==config.configurationHash||snapshot.proxy?.format!=='FULL'){skipped.push({...where,reason:'Cấu hình thiếu user/pass hoặc không khớp bản ghi'});continue;}
    items.push({...where,version:config.version,proxy:fullProxy(snapshot.proxy)});
  }
  await db.auditLog.create({data:{userId:current.userId,projectId:scope.projectId,action:'COPY_VM_PROXY',entity:'VirtualMachine',entityId:'bulk',changes:{which:input.which,copied:items.length,skipped:skipped.length}}});
  return {items,skipped};
}
export async function reportInstallFailure(scope:ActorScope,id:string,note:string,db:PrismaClient=prisma){
  if(!note.trim()||note.length>1000)throw new ProxyDomainError('INVALID_INPUT');return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'CONFIRM',tx),config=await currentConfiguration(tx,current,id);if(config.vm.desiredConfigurationId!==id||!config.startedAt||['CONFIRMED','CANCELLED'].includes(config.status))throw new ProxyDomainError('STALE_PREVIEW');
    const images=await snapshotCollector(tx,current);await images.remember('VM_CONFIG',id);await images.remember('VM',config.vmId);await tx.vMConfiguration.update({where:{id},data:{status:'FAILED',failureNote:note.trim(),revision:{increment:1}}});await tx.virtualMachine.update({where:{id:config.vmId},data:{revision:{increment:1}}});await recordOperation(tx,{scope:current,kind:'INSTALL_FAILURE',summary:{vm:config.vm.code,version:config.version},snapshot:await images.finish(),reversible:false});return {saved:true};
  },db);
}
export async function confirmInstalled(scope:ActorScope,input:{configurationId:string;configurationHash:string;expectedVmRevision:number},db:PrismaClient=prisma,deps:{refreshSource?:(projectId:string,db:PrismaClient)=>Promise<SourceSnapshotRef>}={}){
  await authorizeVM(scope,'CONFIRM',db);const source=await requireGenjy(scope,db,deps.refreshSource||refreshGenjy);
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'CONFIRM',tx),config=await currentConfiguration(tx,current,input.configurationId);
    const latest=await tx.proxySourceSnapshot.findFirst({where:{projectId:scope.projectId,sourceKey:'GENJY'},orderBy:{fetchedAt:'desc'}});if(!latest?.scanSucceeded)throw new ProxyDomainError('SOURCE_UNAVAILABLE');if(latest.hash!==source.hash)throw new ProxyDomainError('STALE_PREVIEW');
    if(config.vm.desiredConfigurationId!==config.id||config.configurationHash!==input.configurationHash)throw new ProxyDomainError('STALE_PREVIEW','Cần xác nhận đúng cấu hình hiện hành');
    if(config.status==='CONFIRMED'&&config.vm.installedConfigurationId===config.id)return {confirmed:true,replay:true};
    if(config.vm.revision!==input.expectedVmRevision||!config.startedAt||!['IN_PROGRESS','FAILED'].includes(config.status))throw new ProxyDomainError('STALE_PREVIEW','Thông tin cài đã thay đổi; tải lại trước khi xác nhận');
    const endpoint=config.endpoint;if(!endpoint?.identity||(endpoint.identity.owner!=='SELF'&&!isShared(endpoint.identity.owner,endpoint.identity.subgroup)))throw new ProxyDomainError('OWNER_CONFLICT','Sở hữu Genjy/chưa rõ: giữ proxy và kiểm tra thực tế trước khi xác nhận');
    if(endpoint.retiredAt||['VOID','REPLACED','DIE','QUARANTINED'].includes(endpoint.inventoryState))throw new ProxyDomainError('INVALID_INPUT','Proxy đã ngừng dùng hoặc cần kiểm tra');
    const holds=await tx.vMProxyAllocation.findMany({where:{vmId:config.vmId,releasedAt:null}}),target=holds.find(h=>h.endpointId===endpoint.id);if(!target)throw new ProxyDomainError('STALE_PREVIEW','Không còn bản giữ proxy đúng máy');
    const images=await snapshotCollector(tx,current);await images.remember('VM',config.vmId);await images.remember('VM_CONFIG',config.id);await images.remember('ENDPOINT',endpoint.id);if(config.task)await images.remember('VM_TASK',config.task.id);
    for(const hold of holds){await images.remember('VM_ALLOCATION',hold.id);if(hold.id!==target.id){await images.remember('ENDPOINT',hold.endpointId);await tx.vMProxyAllocation.update({where:{id:hold.id},data:{releasedAt:new Date(),releaseReason:'Đã xác nhận cấu hình mới trên máy',revision:{increment:1}}});const released=await tx.proxyIP.findUniqueOrThrow({where:{id:hold.endpointId}});const attempted=hold.role==='UNCERTAIN'&&(released.inventoryState==='NEW'||released.inventoryState==='LIVE')&&!released.retiredAt;/* started on a machine: never back to unused NEW stock */await tx.proxyIP.update({where:{id:hold.endpointId},data:{...(attempted?{inventoryState:'QUARANTINED' as const,status:'RESERVED' as const,notesCipher:encrypt(JSON.stringify({quarantineReason:'INSTALL_ATTEMPT',message:'Đã bắt đầu cài trước đây; không coi là NEW chưa dùng',previousNotesCipher:released.notesCipher}))}:{}),revision:{increment:1}}});await syncAssignmentState(tx,hold.endpointId,{released:true});}}
    await tx.vMProxyAllocation.update({where:{id:target.id},data:{role:'INSTALLED',revision:{increment:1}}});await tx.vMConfiguration.update({where:{id:config.id},data:{status:'CONFIRMED',confirmedAt:new Date(),confirmedById:scope.userId,failureNote:null,revision:{increment:1}}});
    await tx.virtualMachine.update({where:{id:config.vmId},data:{installedConfigurationId:config.id,proxyId:endpoint.id,revision:{increment:1}}});await tx.proxyIP.update({where:{id:endpoint.id},data:{revision:{increment:1}}});await syncAssignmentState(tx,endpoint.id);if(config.task)await tx.vMTask.update({where:{id:config.task.id},data:{status:'COMPLETED',completedAt:new Date()}});
    await tx.proxyStatusEvent.create({data:{projectId:scope.projectId,identityId:endpoint.identity.id,endpointId:endpoint.id,ip:endpoint.identity.ip,kind:'INSTALLED',occurredAt:new Date(),actorId:scope.userId,sourceRef:config.vm.server.code+'/'+config.vm.code}});
    await recordOperation(tx,{scope:current,kind:'INSTALL_CONFIRM',summary:{vm:config.vm.code,version:config.version},snapshot:await images.finish(),reversible:false});await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'VM_INSTALLED',entity:'VMConfiguration',entityId:config.id,changes:{version:config.version}}});return {confirmed:true,replay:false};
  },db);
}
