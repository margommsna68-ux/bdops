import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {persistSourceSnapshot} from '@/server/proxy-management/sources';
import {getEligibleInventory} from '@/server/proxy-management/repository';
import {getProxyTimeline} from '@/server/proxy-management/history';
import {listOperations,inspectOperation} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import {saveProviderAccount} from '@/server/proxy-management/catalog-management';
import {setProxyCapabilities} from '@/server/proxy-management/capabilities';
import {testClient} from './db-fixture';
import type {ActorScope,BatchInput} from '@/server/proxy-management/types';
const db=testClient();afterAll(()=>db.$disconnect());
async function fixture(){
  const projectId=randomUUID(),userId=randomUUID();
  await db.project.create({data:{id:projectId,code:projectId,name:'Undo fixture',settings:{businessMode:'PROXY_VM'}}});
  await db.user.create({data:{id:userId,email:userId+'@fixture.invalid',name:'Test admin'}});
  await db.projectMember.create({data:{userId,projectId,role:'ADMIN'}});
  await db.proxyProviderAccount.create({data:{projectId,code:'fixture',label:'Fixture',credentialCipher:encrypt(JSON.stringify({username:'u',password:'test-secret'}))}});
  const scope:ActorScope={userId,projectId,role:'ADMIN',capabilities:[]};
  const service=createProxyBatchService(db,{refreshSource:async()=>persistSourceSnapshot(projectId,{id:randomUUID(),sourceKey:'GENJY',hash:'empty',scanSucceeded:true,fetchedAt:new Date().toISOString(),evidence:[]},db)});
  const apply=async(input:Omit<BatchInput,'idempotencyKey'>)=>{const key=randomUUID(),p=await service.preview(scope,{...input,idempotencyKey:key});return {result:await service.commit(scope,p.token,key),preview:p,key};};
  const cleanup=async()=>{
    const ids=await db.proxyIdentity.findMany({where:{endpoints:{some:{projectId}}},select:{id:true}});
    await db.auditLog.deleteMany({where:{projectId}});await db.server.deleteMany({where:{projectId}});await db.proxyReplacement.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await db.projectMember.deleteMany({where:{projectId}});await db.project.delete({where:{id:projectId}});await db.user.delete({where:{id:userId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids.map(i=>i.id)}}});
  };
  const operation=async(batchId:string)=>(await listOperations(scope,db)).find(o=>o.batchId===batchId)!;
  return {scope,service,apply,cleanup,operation};
}
it('undo blocked restores dates and eligibility, retains encrypted immutable history and replay',async()=>{
  const f=await fixture();try{
    await f.apply({kind:'NEW',text:'203.0.113.161:80:u:test-secret'});
    const before=await db.proxyIP.findFirstOrThrow({where:{projectId:f.scope.projectId}});
    const blocked=await f.apply({kind:'BLOCKED',text:'203.0.113.161'}),operation=await f.operation(blocked.result.batchId);
    const detail=await inspectOperation(f.scope,operation.id,db);expect(JSON.stringify(detail)).not.toContain('test-secret');expect(detail.canUndo).toBe(true);
    const undo=await undoOperation(f.scope,operation.id,'Báo nhầm',db);
    expect((await db.proxyIP.findUniqueOrThrow({where:{id:before.id}}))).toMatchObject({inventoryState:'NEW',statusAt:before.statusAt});
    expect(await getEligibleInventory(f.scope.projectId,db)).toHaveLength(1);
    expect(await undoOperation(f.scope,operation.id,'Gửi lại',db)).toMatchObject({id:undo.id,replay:true});
    const original=await f.service.commit(f.scope,blocked.preview.token,blocked.key);expect(original.replay).toBe(true);
    expect((await db.proxyIP.findUniqueOrThrow({where:{id:before.id}})).inventoryState).toBe('NEW');
    expect(await db.operationJournal.count({where:{undoOfId:operation.id}})).toBe(1);
    expect((await db.proxyStatusEvent.findFirstOrThrow({where:{batchId:blocked.result.batchId}})).reversedAt).not.toBeNull();
    const history=await getProxyTimeline(f.scope,before.identityId!,db);expect(history.events.find(e=>e.kind==='BLOCKED')?.reversedAt).toEqual(expect.any(String));
  }finally{await f.cleanup();}
});
it('cross-project history and VM changes are rejected; concurrent undo has one winner',async()=>{
  const f=await fixture(),other=await fixture();try{
    const r=await f.apply({kind:'NEW',text:'203.0.113.167:80:u:test-secret'}),operation=await f.operation(r.result.batchId);
    await expect(inspectOperation(other.scope,operation.id,db)).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(undoOperation(other.scope,operation.id,'Foreign',db)).rejects.toMatchObject({code:'NOT_FOUND'});
    const endpoint=await db.proxyIP.findFirstOrThrow({where:{projectId:f.scope.projectId}}),server=await db.server.create({data:{projectId:f.scope.projectId,code:'trial-server'}});
    const vm=await db.virtualMachine.create({data:{serverId:server.id,code:'VM_001',proxyId:endpoint.id}});
    await expect(undoOperation(f.scope,operation.id,'Assigned',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    await db.virtualMachine.delete({where:{id:vm.id}});
    const results=await Promise.all([undoOperation(f.scope,operation.id,'One',db),undoOperation(f.scope,operation.id,'Two',db)]);
    expect(new Set(results.map(r=>r.id)).size).toBe(1);expect(await db.operationJournal.count({where:{undoOfId:operation.id}})).toBe(1);
  }finally{await f.cleanup();await other.cleanup();}
});
it('undo fault rolls back all resources and events, and later catalog usage blocks its undo',async()=>{
  const f=await fixture();try{
    const r=await f.apply({kind:'NEW',text:'203.0.113.168:80:u:test-secret'}),operation=await f.operation(r.result.batchId);
    await expect(undoOperation(f.scope,operation.id,'Fault',db,{afterWrite:()=>{throw new Error('Undo fault');}})).rejects.toThrow('Undo fault');
    expect((await db.proxyIP.findFirstOrThrow({where:{projectId:f.scope.projectId}})).inventoryState).toBe('NEW');expect(await db.operationJournal.count({where:{undoOfId:operation.id}})).toBe(0);
    await saveProviderAccount(f.scope,{code:'second',label:'Second',username:'v',password:'another-secret'},db);
    const catalogOp=(await listOperations(f.scope,db)).find(o=>o.kind==='CATALOG')!;await f.apply({kind:'NEW',text:'203.0.113.169:80:v:another-secret'});
    await expect(undoOperation(f.scope,catalogOp.id,'New dependent',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  }finally{await f.cleanup();}
});
it('withdraw new and undo Genjy replace without forgetting received IP or changing owner',async()=>{
  const f=await fixture();try{
    const first=await f.apply({kind:'NEW',text:'203.0.113.162:80:u:test-secret'});await undoOperation(f.scope,(await f.operation(first.result.batchId)).id,'Sai list',db);
    expect(await getEligibleInventory(f.scope.projectId,db)).toHaveLength(0);
    const p=await f.service.preview(f.scope,{kind:'NEW',text:'203.0.113.162:80:u:test-secret',idempotencyKey:randomUUID()});expect(p.errors).toBe(1);
    await f.apply({kind:'NEW',owner:'GENJY',text:'203.0.113.163:80:u:test-secret'});await f.apply({kind:'BLOCKED',text:'203.0.113.163'});
    const r=await f.apply({kind:'REPLACE',removedText:'203.0.113.163',addedText:'203.0.113.164'});await undoOperation(f.scope,(await f.operation(r.result.batchId)).id,'Sai cặp',db);
    const endpoints=await db.proxyIP.findMany({where:{projectId:f.scope.projectId},include:{identity:true}});
    expect(endpoints.find(e=>e.host==='203.0.113.163')).toMatchObject({inventoryState:'BLOCKED',retiredAt:null,identity:{owner:'GENJY'}});
    expect(endpoints.find(e=>e.host==='203.0.113.164')).toMatchObject({inventoryState:'VOID',identity:{owner:'GENJY'}});
    expect((await db.proxyReplacement.findFirstOrThrow({where:{projectId:f.scope.projectId}})).status).toBe('VOID');
    expect((await f.service.preview(f.scope,{kind:'REPLACE',removedText:'203.0.113.163',addedText:'203.0.113.164',idempotencyKey:randomUUID()})).errors).toBe(1);
  }finally{await f.cleanup();}
});
it('fresh permissions and changed row reject all undo without a partial write',async()=>{
  const f=await fixture();try{
    const r=await f.apply({kind:'NEW',text:'203.0.113.165:80:u:test-secret\n203.0.113.166:80:u:test-secret'}),operation=await f.operation(r.result.batchId);
    await db.projectMember.update({where:{userId_projectId:{userId:f.scope.userId,projectId:f.scope.projectId}},data:{role:'VIEWER'}});
    await expect(undoOperation(f.scope,operation.id,'Wrong role',db)).rejects.toMatchObject({code:'FORBIDDEN'});
    await db.projectMember.update({where:{userId_projectId:{userId:f.scope.userId,projectId:f.scope.projectId}},data:{role:'ADMIN'}});
    const rows=await db.proxyIP.findMany({where:{projectId:f.scope.projectId}});
    await db.proxyIP.update({where:{id:rows[1].id},data:{revision:{increment:1}}});
    expect(await inspectOperation(f.scope,operation.id,db)).toMatchObject({canUndo:false,blockedReason:expect.any(String)});
    await expect(undoOperation(f.scope,operation.id,'Changed',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    expect(await db.proxyIP.count({where:{projectId:f.scope.projectId,retiredAt:null}})).toBe(2);
    expect(await db.operationJournal.count({where:{undoOfId:operation.id}})).toBe(0);
  }finally{await f.cleanup();}
});
it('catalog and member changes have guarded before-images and reversible access',async()=>{
  const f=await fixture();try{
    const member=await db.projectMember.findFirstOrThrow({where:{projectId:f.scope.projectId}});
    await saveProviderAccount(f.scope,{code:'second',label:'Second',username:'v',password:'another-secret'},db);
    const catalogOp=(await listOperations(f.scope,db)).find(o=>o.kind==='CATALOG')!;
    await undoOperation(f.scope,catalogOp.id,'Sai gói',db);expect((await db.proxyProviderAccount.findUniqueOrThrow({where:{projectId_code:{projectId:f.scope.projectId,code:'second'}}})).disabled).toBe(true);
    await setProxyCapabilities(f.scope,member.id,['COPY_CREDENTIALS'],db,true);
    const accessOp=(await listOperations(f.scope,db)).find(o=>o.kind==='ACCESS')!;await undoOperation(f.scope,accessOp.id,'Thử quyền',db);
    expect((await db.projectMember.findUniqueOrThrow({where:{id:member.id}})).capabilities).toEqual([]);
  }finally{await f.cleanup();}
});
it('catalog undo cannot reclaim credentials now used by a newly added package',async()=>{
  const f=await fixture();try{
    await saveProviderAccount(f.scope,{code:'fixture',label:'Changed',username:'changed',password:'changed-secret'},db);
    const original=(await listOperations(f.scope,db)).find(o=>o.kind==='CATALOG')!;
    await saveProviderAccount(f.scope,{code:'other',label:'Other',username:'u',password:'test-secret'},db);
    await expect(undoOperation(f.scope,original.id,'Restore old credentials',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    expect(await db.proxyProviderAccount.count({where:{projectId:f.scope.projectId,disabled:false}})).toBe(2);
    expect(await db.operationJournal.count({where:{undoOfId:original.id}})).toBe(0);
  }finally{await f.cleanup();}
});
