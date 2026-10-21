import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {persistSourceSnapshot} from '@/server/proxy-management/sources';
import {getEligibleInventory} from '@/server/proxy-management/repository';
import {createVMService} from '@/server/vm-management/allocation';
import {copyConfiguration,startInstall,confirmInstalled} from '@/server/vm-management/installation';
import {listOperations} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import {createManagedServer,addManagedVMs} from '@/server/vm-management/metadata';
import {appRouter} from '@/server/routers/_app';
import {assertProjectCanBeDestroyed} from '@/server/permissions/legacy-infrastructure';
import {getProxyTimeline,copyProxyEndpoint} from '@/server/proxy-management/history';
import {readVMWorkspace} from '@/server/vm-management/repository';
import type {Context} from '@/server/trpc';
import {testClient} from './db-fixture';
import type {ActorScope} from '@/server/proxy-management/types';
const db=testClient();afterAll(()=>db.$disconnect());
async function fixture(ips:string[]){
  const projectId=randomUUID(),userId=randomUUID();
  await db.project.create({data:{id:projectId,code:projectId,name:'VM fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});await db.projectMember.create({data:{projectId,userId,role:'ADMIN'}});
  await db.proxyProviderAccount.create({data:{projectId,code:'fixture',label:'Fixture',credentialCipher:encrypt(JSON.stringify({username:'u',password:'vm-test-secret'}))}});
  const scope:ActorScope={projectId,userId,role:'ADMIN',capabilities:[]};let succeeded=true,fault=false;
  const refresh=async()=>persistSourceSnapshot(projectId,{id:randomUUID(),sourceKey:'GENJY',hash:succeeded?'vm-empty':'vm-source-error',scanSucceeded:succeeded,fetchedAt:new Date().toISOString(),evidence:[]},db);
  const stock=createProxyBatchService(db,{refreshSource:refresh});const key=randomUUID(),p=await stock.preview(scope,{kind:'NEW',text:ips.map(ip=>ip+':80:u:vm-test-secret').join('\n'),idempotencyKey:key});const imported=await stock.commit(scope,p.token,key);
  const server=await db.server.create({data:{projectId,code:'personal-fixture',managed:true}});
  const vm=await db.virtualMachine.create({data:{serverId:server.id,code:'VM_001',managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});
  const service=createVMService(db,{refreshSource:refresh,afterWrite:()=>{if(fault)throw new Error('VM write fault');}});
  const allocate=async(endpointId?:string)=>{const key=randomUUID(),p=await service.preview(scope,{mode:endpointId?'MANUAL':'AUTO',vmIds:[vm.id],endpointId,idempotencyKey:key});return {result:await service.commit(scope,p.token,key),preview:p,key};};
  const confirm=async()=>{const current=await db.virtualMachine.findUniqueOrThrow({where:{id:vm.id}}),config=await db.vMConfiguration.findUniqueOrThrow({where:{id:current.desiredConfigurationId!}});return confirmInstalled(scope,{configurationId:config.id,configurationHash:config.configurationHash,expectedVmRevision:current.revision},db,{refreshSource:refresh});};
  const cleanup=async()=>{
    await db.deleteRequest.deleteMany({where:{projectId}});await db.editHistory.deleteMany({where:{projectId}});
    const ids=await db.proxyIdentity.findMany({where:{endpoints:{some:{projectId}}},select:{id:true}});
    await db.vmOpsEvent.deleteMany({where:{projectId}});await db.vmOperation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{desiredConfigurationId:null,installedConfigurationId:null,proxyId:null}});await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.vMConfiguration.deleteMany({where:{projectId}});await db.server.deleteMany({where:{projectId}});await db.auditLog.deleteMany({where:{projectId}});await db.proxyReplacement.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await db.projectMember.deleteMany({where:{projectId}});await db.project.delete({where:{id:projectId}});await db.user.delete({where:{id:userId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids.map(i=>i.id)}}});
  };
  return {scope,stock,imported,server,vm,service,allocate,confirm,refresh,cleanup,setFault:(v:boolean)=>{fault=v;},setSource:(v:boolean)=>{succeeded=v;}};
}
it('autofill only literal blank; reservation excludes stock and invalidates stock undo',async()=>{
  const f=await fixture(['203.0.113.171','203.0.113.172']);try{
    for(const state of ['FORMULA','PLACEHOLDER','UNRESOLVED'] as const)await db.virtualMachine.create({data:{serverId:f.server.id,code:state,managed:true,proxySlotState:state}});
    const key=randomUUID(),p=await f.service.preview(f.scope,{mode:'AUTO',vmIds:[f.vm.id],idempotencyKey:key});expect(p.ready).toBe(1);await f.service.commit(f.scope,p.token,key);
    expect(await db.vMProxyAllocation.count({where:{projectId:f.scope.projectId,releasedAt:null}})).toBe(1);expect(await getEligibleInventory(f.scope.projectId,db)).toHaveLength(1);
    const stockOp=(await listOperations(f.scope,db)).find(o=>o.batchId===f.imported.batchId)!;await expect(undoOperation(f.scope,stockOp.id,'Reserved',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    const current=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});expect(current.proxyId).toBeNull();expect(current.installedConfigurationId).toBeNull();expect(current.desiredConfigurationId).not.toBeNull();
  }finally{await f.cleanup();}
});
// Owner decision 19/10/2026 (replaces "installed A stays until B is confirmed"): assigning B makes B the VM's proxy at once; the old
// confirmed A leaves the VM (its configuration stays CONFIRMED as history) and goes back to stock by the NEW / LIVE rule.
it('assigning B replaces an older confirmed A at once; A keeps its history, never a second current proxy',async()=>{
  const f=await fixture(['203.0.113.173','203.0.113.174']);try{
    await f.allocate();const current=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});const a=current.desiredConfigurationId!;
    await db.vMConfiguration.update({where:{id:a},data:{status:'IN_PROGRESS',startedAt:new Date()}});await f.confirm(); // older data: confirmed A
    const endpointB=await db.proxyIP.findFirstOrThrow({where:{projectId:f.scope.projectId,host:'203.0.113.174'}});await f.allocate(endpointB.id);
    const after=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id},include:{desiredConfiguration:true}});
    expect(after.installedConfigurationId).toBeNull();expect(after.desiredConfiguration?.endpointId).toBe(endpointB.id);
    expect(await db.vMProxyAllocation.count({where:{projectId:f.scope.projectId,releasedAt:null}})).toBe(1);
    expect((await db.vMConfiguration.findUniqueOrThrow({where:{id:a}})).status).toBe('CONFIRMED');
    expect(await db.vMTask.count({where:{vmId:f.vm.id,status:{in:['PENDING','IN_PROGRESS']}}})).toBe(0);
  }finally{await f.cleanup();}
});
it('untouched plan undo releases pending only; copy/start prevents ordinary undo',async()=>{
  const f=await fixture(['203.0.113.175']);try{
    const result=await f.allocate(),op=(await listOperations(f.scope,db)).find(o=>o.batchId===result.result.batchId)!;await undoOperation(f.scope,op.id,'Chưa cài',db);expect(await getEligibleInventory(f.scope.projectId,db)).toHaveLength(1);expect((await f.service.commit(f.scope,result.preview.token,result.key)).undone).toBe(true);
    const next=await f.allocate(),op2=(await listOperations(f.scope,db)).find(o=>o.batchId===next.result.batchId)!;const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});await copyConfiguration(f.scope,vm.desiredConfigurationId!,db);await expect(undoOperation(f.scope,op2.id,'Đã bắt đầu',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});expect(await db.vMProxyAllocation.count({where:{projectId:f.scope.projectId,releasedAt:null}})).toBe(1);
  }finally{await f.cleanup();}
});
it('competing plans create one hold, and source error/write fault never partially assign',async()=>{
  const f=await fixture(['203.0.113.176']);try{
    const p1=await f.service.preview(f.scope,{mode:'AUTO',vmIds:[f.vm.id],idempotencyKey:randomUUID()}),key=randomUUID(),p2=await f.service.preview(f.scope,{mode:'AUTO',vmIds:[f.vm.id],idempotencyKey:key});
    f.setFault(true);await expect(f.service.commit(f.scope,p2.token,key)).rejects.toThrow('VM write fault');expect(await db.vMProxyAllocation.count({where:{projectId:f.scope.projectId}})).toBe(0);f.setFault(false);
    const firstBatch=await db.proxyBatch.findUniqueOrThrow({where:{token:p1.token}}),results=await Promise.allSettled([f.service.commit(f.scope,p1.token,firstBatch.idempotencyKey),f.service.commit(f.scope,p2.token,key)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await db.vMProxyAllocation.count({where:{projectId:f.scope.projectId,releasedAt:null}})).toBe(1);
    f.setSource(false);await expect(f.service.preview(f.scope,{mode:'AUTO',vmIds:[f.vm.id],idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});
  }finally{await f.cleanup();}
});
it('fresh full-project operator scope works; viewer, copy permission, foreign IDs and old hashes fail',async()=>{
  const f=await fixture(['203.0.113.177']),other=await fixture(['203.0.113.178']);try{
    await db.projectMember.update({where:{userId_projectId:{userId:f.scope.userId,projectId:f.scope.projectId}},data:{role:'VIEWER',allowedModules:['INFRASTRUCTURE']}});await expect(f.allocate()).rejects.toMatchObject({code:'FORBIDDEN'});
    await db.projectMember.update({where:{userId_projectId:{userId:f.scope.userId,projectId:f.scope.projectId}},data:{role:'USER'}});
    await expect(f.service.preview(f.scope,{mode:'AUTO',vmIds:[other.vm.id],idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'NOT_FOUND'});
    const foreign=await db.proxyIP.findFirstOrThrow({where:{projectId:other.scope.projectId}}),p=await f.service.preview(f.scope,{mode:'MANUAL',vmIds:[f.vm.id],endpointId:foreign.id,idempotencyKey:randomUUID()});expect(p.errors).toBe(1);expect(JSON.stringify(p)).not.toContain('203.0.113.178');
    await f.allocate();let vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});const config=await db.vMConfiguration.findUniqueOrThrow({where:{id:vm.desiredConfigurationId!}});
    await expect(copyConfiguration(f.scope,config.id,db)).rejects.toMatchObject({code:'FORBIDDEN'});await expect(startInstall(other.scope,config.id,db)).rejects.toMatchObject({code:'NOT_FOUND'});
    await startInstall(f.scope,config.id,db);vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});
    await expect(confirmInstalled(f.scope,{configurationId:config.id,configurationHash:'wrong-hash',expectedVmRevision:vm.revision},db,{refreshSource:f.refresh})).rejects.toMatchObject({code:'STALE_PREVIEW'});await f.confirm();expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).status).toBe('NEW');
  }finally{await f.cleanup();await other.cleanup();}
});
it('Genjy and unknown ownership never enter autofill; latest failed source blocks a returned-success commit',async()=>{
  const f=await fixture(['203.0.113.179','203.0.113.180']);try{
    await db.proxyIdentity.update({where:{ip:'203.0.113.179'},data:{owner:'GENJY'}});await db.proxyIdentity.update({where:{ip:'203.0.113.180'},data:{owner:'UNKNOWN'}});
    expect((await f.service.preview(f.scope,{mode:'AUTO',vmIds:[f.vm.id],idempotencyKey:randomUUID()})).ready).toBe(0);
    await db.proxyIdentity.update({where:{ip:'203.0.113.180'},data:{owner:'SELF'}});
    const interrupted=createVMService(db,{refreshSource:async()=>{const good=await f.refresh();await persistSourceSnapshot(f.scope.projectId,{id:randomUUID(),sourceKey:'GENJY',hash:'latest-failed',scanSucceeded:false,fetchedAt:new Date(Date.now()+2000).toISOString(),evidence:[]},db);return good;}});
    const key=randomUUID(),p=await interrupted.preview(f.scope,{mode:'AUTO',vmIds:[f.vm.id],idempotencyKey:key});await expect(interrupted.commit(f.scope,p.token,key)).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});expect(await db.vMProxyAllocation.count({where:{projectId:f.scope.projectId}})).toBe(0);
  }finally{await f.cleanup();}
});
it('managed create has reversible history, rejects duplicate codes without a partial server',async()=>{
  const f=await fixture(['203.0.113.181']);try{
    await expect(createManagedServer(f.scope,{code:'bad',vmCodes:['VM_001','VM_001']},db)).rejects.toMatchObject({code:'INVALID_INPUT'});expect(await db.server.count({where:{projectId:f.scope.projectId,code:'bad'}})).toBe(0);
    const result=await createManagedServer(f.scope,{code:'manual-new',vmCodes:['M-001','M-002']},db);expect(await db.virtualMachine.count({where:{serverId:result.id,proxySlotState:'BLANK'}})).toBe(2);
    const original=(await listOperations(f.scope,db)).find(o=>o.kind==='SERVER_CREATE')!;await addManagedVMs(f.scope,result.id,['M-003'],db);await expect(undoOperation(f.scope,original.id,'Has later VM',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  }finally{await f.cleanup();}
});
it('legacy task completion, deletion and editHistory cannot bypass managed configuration',async()=>{
  const f=await fixture(['203.0.113.182']);try{
    await f.allocate();await db.vMTask.create({data:{vmId:f.vm.id,configurationId:(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).desiredConfigurationId!,type:'PROXY_INSTALL',title:'Việc cài cũ (dữ liệu trước 19/10/2026)',scheduledAt:new Date()}});const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}}),task=await db.vMTask.findFirstOrThrow({where:{configurationId:vm.desiredConfigurationId}});
    const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId,memberships:[]},expires:'2099-01-01'}} as unknown as Context);
    await expect(caller.vmTask.updateStatus({projectId:f.scope.projectId,id:task.id,status:'COMPLETED'})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
    await expect(caller.deleteRequest.create({projectId:f.scope.projectId,entity:'VMTask',entityId:task.id})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
    const history=await db.editHistory.create({data:{projectId:f.scope.projectId,userId:f.scope.userId,entity:'VirtualMachine',entityId:vm.id,field:'proxyId',oldValue:null,newValue:'dummy'}});
    await expect(caller.editHistory.revert({projectId:f.scope.projectId,historyId:history.id})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});await db.editHistory.delete({where:{id:history.id}});expect((await db.vMTask.findUniqueOrThrow({where:{id:task.id}})).status).toBe('PENDING');
  }finally{await f.cleanup();}
});
it('allocation tokens stay in the VM flow and pending locations appear in proxy timeline',async()=>{
  const f=await fixture(['203.0.113.183']);try{
    const key=randomUUID(),p=await f.service.preview(f.scope,{mode:'AUTO',vmIds:[f.vm.id],idempotencyKey:key});
    await expect(f.stock.commit(f.scope,p.token,key)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await f.service.commit(f.scope,p.token,key);const endpoint=await db.proxyIP.findFirstOrThrow({where:{projectId:f.scope.projectId}});
    expect((await getProxyTimeline(f.scope,endpoint.identityId!,db)).vmRefs).toContain('personal-fixture/VM_001 · Chờ cài');
    const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId,memberships:[]},expires:'2099-01-01'}} as unknown as Context);
    const alerts=await caller.notification.alerts({projectId:f.scope.projectId});// 19/10/2026: no install step, so no "chờ cài" alert and no link to the old pages.
    expect(alerts.find(a=>a.id==='vm-install')).toBeUndefined();expect(alerts.some(a=>a.link?.startsWith('/vm-tasks')||a.link?.startsWith('/work')||a.link==='/infrastructure/vms')).toBe(false);
  }finally{await f.cleanup();}
});
it('changing project mode cannot destroy managed infrastructure or its journal',async()=>{
  const projectId=randomUUID(),userId=randomUUID();await db.project.create({data:{id:projectId,code:projectId,name:'Managed archive fixture'}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
  try{
    await db.server.create({data:{projectId,code:'empty-managed',managed:true}});
    await expect(assertProjectCanBeDestroyed(db,projectId)).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
    await db.server.deleteMany({where:{projectId}});await db.operationJournal.create({data:{projectId,actorId:userId,kind:'SERVER_CREATE',summary:{},snapshotCipher:encrypt('{}')}});
    await expect(assertProjectCanBeDestroyed(db,projectId)).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
  }finally{await db.server.deleteMany({where:{projectId}});await db.project.delete({where:{id:projectId}});await db.user.delete({where:{id:userId}});}
});
it('registry copy of a held proxy neither starts the install nor blocks undo; only the configuration copy does',async()=>{
  const f=await fixture(['203.0.113.184']);try{
    await f.allocate();const endpoint=await db.proxyIP.findFirstOrThrow({where:{projectId:f.scope.projectId}});
    const safe=await readVMWorkspace(f.scope,db);expect(safe.vms[0].desired).toMatchObject({endpointId:endpoint.id,port:80});expect(JSON.stringify(safe)).not.toMatch(/credentialCipher|snapshotCipher|vm-test-secret/);
    await db.projectMember.update({where:{userId_projectId:{userId:f.scope.userId,projectId:f.scope.projectId}},data:{capabilities:['COPY_CREDENTIALS']}});
    expect(await copyProxyEndpoint(f.scope,endpoint.id,db)).toEqual({proxy:'203.0.113.184:80:u:vm-test-secret'});
    expect(await db.proxyStatusEvent.count({where:{projectId:f.scope.projectId,kind:'INSTALL_STARTED'}})).toBe(0);expect((await db.vMConfiguration.findFirstOrThrow({where:{projectId:f.scope.projectId}})).startedAt).toBeNull();
    const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});await copyConfiguration(f.scope,vm.desiredConfigurationId!,db);
    const op=(await listOperations(f.scope,db)).find(o=>o.kind==='VM_PLAN')!;await expect(undoOperation(f.scope,op.id,'Copied',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  }finally{await f.cleanup();}
});
// 19/10/2026: an older plan whose install had started is just released when another proxy is assigned; it is NEW again but stays out
// of the autofill pool (its INSTALL_STARTED event is history), so it is never handed out as untouched stock.
it('a proxy whose old install had started is released on a change and never re-enters the autofill pool',async()=>{
  const f=await fixture(['203.0.113.185','203.0.113.186']);try{
    await f.allocate();const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});await copyConfiguration(f.scope,vm.desiredConfigurationId!,db);
    const c=await db.proxyIP.findFirstOrThrow({where:{projectId:f.scope.projectId,host:'203.0.113.186'}});await f.allocate(c.id);
    expect((await db.proxyIP.findFirstOrThrow({where:{projectId:f.scope.projectId,host:'203.0.113.185'}})).inventoryState).toBe('NEW');
    expect(await getEligibleInventory(f.scope.projectId,db)).toHaveLength(0);
  }finally{await f.cleanup();}
});
it('managed legacy reads and mutations remain blocked even after project settings change',async()=>{
  const f=await fixture(['203.0.113.187']);try{
    await f.allocate();await db.vMTask.create({data:{vmId:f.vm.id,configurationId:(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).desiredConfigurationId!,type:'PROXY_INSTALL',title:'Việc cài cũ (dữ liệu trước 19/10/2026)',scheduledAt:new Date()}});const task=await db.vMTask.findFirstOrThrow({where:{vmId:f.vm.id}}),caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId,memberships:[]},expires:'2099-01-01'}} as unknown as Context);
    await expect(caller.server.getById({projectId:f.scope.projectId,id:f.server.id})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
    await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'FULL'}}});
    await expect(caller.vmTask.updateStatus({projectId:f.scope.projectId,id:task.id,status:'COMPLETED'})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
    const empty=await db.server.create({data:{projectId:f.scope.projectId,code:'empty',managed:true}});
    await expect(caller.server.delete({projectId:f.scope.projectId,id:empty.id})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
  }finally{await f.cleanup();}
});
