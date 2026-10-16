import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {parseVmRange,addManagedVMs,updateManagedVM,updateManagedServer,archiveVMs,restoreVMs,archiveServer,restoreServer} from '@/server/vm-management/metadata';
import {createVMService} from '@/server/vm-management/allocation';
import {undoOperation} from '@/server/operation-history/undo';
import type {ActorScope} from '@/server/proxy-management/types';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
describe('VM code ranges',()=>{
  it('expands a range keeping the prefix and the zero padding of the start code',()=>{
    expect(parseVmRange('VM_001','VM_012')).toHaveLength(12);expect(parseVmRange('VM_001','VM_012')[11]).toBe('VM_012');
    expect(parseVmRange('M-001','M-030').slice(0,2)).toEqual(['M-001','M-002']);
    expect(parseVmRange('VM_098','VM_102')).toEqual(['VM_098','VM_099','VM_100','VM_101','VM_102']);
    expect(parseVmRange('VM_1','VM_10')).toEqual(['VM_1','VM_2','VM_3','VM_4','VM_5','VM_6','VM_7','VM_8','VM_9','VM_10']);
    expect(parseVmRange('VM_005','VM_005')).toEqual(['VM_005']);
    for(const [a,b] of [['VM_001','M-002'],['VM_010','VM_002'],['VM_','VM_002'],['VM_001','VM_501'],['VM 001','VM 002']]) expect(()=>parseVmRange(a,b)).toThrow('INVALID_INPUT');
  });
});
// Fixture: moon7 (VM_001..VM_003 active, VM_004 deleted), VM_002 holds a planned proxy, VM_003 has an open install task; moon8 empty server.
async function fixture(role:'ADMIN'|'USER'='ADMIN'){
  const projectId=randomUUID(),userId=randomUUID(),ids:string[]=[];
  await db.project.create({data:{id:projectId,code:projectId,name:'VM admin fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
  await db.projectMember.create({data:{projectId,userId,role,allowedModules:['INFRASTRUCTURE'],capabilities:['PROXY_IMPORT']}});
  const s7=await db.server.create({data:{projectId,code:'moon7',managed:true}}),s8=await db.server.create({data:{projectId,code:'moon8',managed:true}});
  const vm=(serverId:string,code:string,o:{archived?:boolean;sdk?:string}={})=>db.virtualMachine.create({data:{serverId,code,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL',archivedAt:o.archived?new Date():null,sdkId:o.sdk||null}});
  const v1=await vm(s7.id,'VM_001',{sdk:'sdk-'+projectId.slice(0,8)}),v2=await vm(s7.id,'VM_002'),v3=await vm(s7.id,'VM_003'),v4=await vm(s7.id,'VM_004',{archived:true,sdk:'sdk-old-'+projectId.slice(0,8)});
  const net='203.5.'+(1+Math.floor(Math.random()*250))+'.',identity=await db.proxyIdentity.create({data:{ip:net+'1',owner:'SELF'}});ids.push(identity.id);
  const ep=await db.proxyIP.create({data:{projectId,identityId:identity.id,address:net+'1:80',host:net+'1',port:80,credentialCipher:encrypt(JSON.stringify({username:'u',password:'p'})),packageCode:'p',inventoryState:'LIVE',inventoryKey:identity.id}});
  const config=await db.vMConfiguration.create({data:{projectId,vmId:v2.id,version:1,endpointId:ep.id,snapshotCipher:encrypt('{}'),configurationHash:'h-'+randomUUID(),createdById:userId,status:'PLANNED'}});
  await db.vMProxyAllocation.create({data:{projectId,vmId:v2.id,endpointId:ep.id,configurationId:config.id,allocationKey:identity.id,role:'DESIRED',createdById:userId}});
  await db.virtualMachine.update({where:{id:v2.id},data:{desiredConfigurationId:config.id,configurationSequence:1,proxySlotState:'FULL'}});
  await db.vMTask.create({data:{vmId:v3.id,type:'PROXY_INSTALL',title:'Cài proxy',scheduledAt:new Date(),status:'IN_PROGRESS'}});
  const snapshot=await db.proxySourceSnapshot.create({data:{projectId,sourceKey:'GENJY',hash:'vm-admin',scanSucceeded:true}});
  const scope:ActorScope={projectId,userId,role,capabilities:['PROXY_IMPORT']};
  const cleanup=async()=>{await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});await db.vMConfiguration.deleteMany({where:{projectId}});await db.virtualMachine.deleteMany({where:{server:{projectId}}});await db.server.deleteMany({where:{projectId}});await db.auditLog.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});};
  return {projectId,userId,scope,s7,s8,v1,v2,v3,v4,snapshot,cleanup};
}
const codes=async(serverId:string,archived=false)=>(await db.virtualMachine.findMany({where:{serverId,archivedAt:archived?{not:null}:null},orderBy:{code:'asc'}})).map(v=>v.code);
it('creates only new VMs from a range, skips existing and deleted codes, and repeated or concurrent clicks never duplicate',async()=>{
  const f=await fixture();try{
    const r=await addManagedVMs(f.scope,f.s7.id,parseVmRange('VM_001','VM_006'),db);
    expect(r).toMatchObject({created:2,existing:['VM_001','VM_002','VM_003'],archived:['VM_004']});
    expect(await codes(f.s7.id)).toEqual(['VM_001','VM_002','VM_003','VM_005','VM_006']);expect(await codes(f.s7.id,true)).toEqual(['VM_004']);
    expect(await addManagedVMs(f.scope,f.s7.id,parseVmRange('VM_005','VM_006'),db)).toMatchObject({created:0,existing:['VM_005','VM_006']});
    const both=await Promise.allSettled([addManagedVMs(f.scope,f.s8.id,parseVmRange('M-001','M-030'),db),addManagedVMs(f.scope,f.s8.id,parseVmRange('M-001','M-030'),db)]);
    expect(both.filter(x=>x.status==='fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(await db.virtualMachine.count({where:{serverId:f.s8.id}})).toBe(30);
    const user=await fixture('USER');try{await expect(addManagedVMs(user.scope,user.s8.id,['VM_001'],db)).rejects.toMatchObject({code:'FORBIDDEN'});}finally{await user.cleanup();}
  }finally{await f.cleanup();}
});
it('renames a VM or server keeping its id and links; duplicates, stale revisions and no-op saves are handled',async()=>{
  const f=await fixture();try{
    const r=await updateManagedVM(f.scope,f.v2.id,{code:'VM_102',notes:'máy chính',expectedRevision:(await db.virtualMachine.findUniqueOrThrow({where:{id:f.v2.id}})).revision},db);expect(r.saved).toBe(true);
    const v2=await db.virtualMachine.findUniqueOrThrow({where:{id:f.v2.id},include:{allocations:{where:{releasedAt:null}}}});expect(v2).toMatchObject({code:'VM_102',notes:'máy chính',desiredConfigurationId:expect.any(String)});expect(v2.allocations).toHaveLength(1);
    await expect(updateManagedVM(f.scope,f.v2.id,{code:'VM_001',expectedRevision:v2.revision},db)).rejects.toMatchObject({code:'DUPLICATE_INPUT'});
    await expect(updateManagedVM(f.scope,f.v2.id,{code:'VM_004',expectedRevision:v2.revision},db)).rejects.toMatchObject({code:'DUPLICATE_INPUT'}); // deleted code is still taken
    await expect(updateManagedVM(f.scope,f.v2.id,{code:'VM_103',expectedRevision:v2.revision-1},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    const before=await db.operationJournal.count({where:{projectId:f.projectId}});
    expect(await updateManagedVM(f.scope,f.v2.id,{code:'VM_102',notes:'máy chính',expectedRevision:v2.revision},db)).toMatchObject({saved:false});
    const s7=await db.server.findUniqueOrThrow({where:{id:f.s7.id}});expect(await updateManagedServer(f.scope,f.s7.id,{code:'moon7',expectedRevision:s7.revision},db)).toMatchObject({saved:false});
    expect(await db.operationJournal.count({where:{projectId:f.projectId}})).toBe(before);
    await expect(updateManagedServer(f.scope,f.s7.id,{code:'moon8',expectedRevision:s7.revision},db)).rejects.toMatchObject({code:'DUPLICATE_INPUT'});
    await db.server.update({where:{id:f.s7.id},data:{notes:'Imported from personal Sheet; actual host credentials'}});const s7b=await db.server.findUniqueOrThrow({where:{id:f.s7.id}});
    expect(await updateManagedServer(f.scope,f.s7.id,{code:'moon7-new',expectedRevision:s7b.revision},db)).toMatchObject({saved:true});
    expect(await db.server.findUniqueOrThrow({where:{id:f.s7.id}})).toMatchObject({code:'moon7-new',notes:'Imported from personal Sheet; actual host credentials'}); // untouched fields stay
  }finally{await f.cleanup();}
});
it('deletes VMs that hold nothing (single and bulk), reports blocked rows, undoes, restores with conflict checks and never autofills a deleted VM',async()=>{
  const f=await fixture();try{
    const one=await archiveVMs(f.scope,[f.v1.id],db);expect(one).toMatchObject({archived:1,blocked:[]});expect(one.operationId).toBeTruthy();
    await undoOperation(f.scope,one.operationId!,'',db);expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.v1.id}})).archivedAt).toBeNull();
    const bulk=await archiveVMs(f.scope,[f.v1.id,f.v2.id,f.v3.id],db);
    expect(bulk.archived).toBe(1);expect(bulk.blocked.map(b=>[b.code,b.reason.includes('proxy')||b.reason.includes('cài')])).toEqual([['VM_002',true],['VM_003',true]]);
    expect(bulk.blocked[0].reason).toMatch(/Chờ cài/);expect(bulk.blocked[1].reason).toMatch(/việc cài/);
    expect(await db.vMProxyAllocation.count({where:{vmId:f.v2.id,releasedAt:null}})).toBe(1); // nothing released to make room
    // a deleted VM is never autofilled
    const vm=createVMService(db,{refreshSource:async()=>({id:f.snapshot.id,sourceKey:'GENJY',hash:'vm-admin',fetchedAt:new Date().toISOString(),scanSucceeded:true})});
    const p=await vm.preview(f.scope,{mode:'AUTO',serverId:f.s7.id,idempotencyKey:randomUUID()});expect(p.rows.find(r=>r.vm==='VM_001')?.message).toMatch(/ẩn|xoá/i);
    // restore: VM_001 fine; VM_004 refused because its SDK now belongs to an active VM
    await db.virtualMachine.update({where:{id:f.v3.id},data:{sdkId:'sdk-old-'+f.projectId.slice(0,8)}});
    const back=await restoreVMs(f.scope,[f.v1.id,f.v4.id],db);expect(back.restored).toBe(1);expect(back.blocked.map(b=>b.code)).toEqual(['VM_004']);expect(back.blocked[0].reason).toMatch(/SDK/);
    expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.v1.id}})).archivedAt).toBeNull();
  }finally{await f.cleanup();}
});
it('deletes a server with its VMs in one transaction only when nothing is held, restores them together; a VM of a deleted server waits for the server',async()=>{
  const f=await fixture();try{
    await expect(archiveServer(f.scope,f.s7.id,db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect((await db.server.findUniqueOrThrow({where:{id:f.s7.id}})).archivedAt).toBeNull();
    await addManagedVMs(f.scope,f.s8.id,['VM_001','VM_002'],db);
    const r=await archiveServer(f.scope,f.s8.id,db);expect(r).toMatchObject({archivedVMs:2});
    expect((await db.server.findUniqueOrThrow({where:{id:f.s8.id}})).archivedAt).not.toBeNull();expect(await codes(f.s8.id)).toEqual([]);
    const vmId=(await db.virtualMachine.findFirstOrThrow({where:{serverId:f.s8.id,code:'VM_001'}})).id;
    const wait=await restoreVMs(f.scope,[vmId],db);expect(wait.blocked[0].reason).toMatch(/server/);
    const back=await restoreServer(f.scope,f.s8.id,db);expect(back).toMatchObject({restoredVMs:2});expect(await codes(f.s8.id)).toEqual(['VM_001','VM_002']);
  }finally{await f.cleanup();}
});
