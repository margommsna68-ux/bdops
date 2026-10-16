import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {createProxyEditService} from '@/server/proxy-management/edits';
import {queryRegistry} from '@/server/proxy-management/history';
import {createVMService} from '@/server/vm-management/allocation';
import {listOperations} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import type {ActorScope} from '@/server/proxy-management/types';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
const key=()=>'state-'+randomUUID();
// NEW = eligible stock not on a VM; LIVE = assigned to a VM on the web (a Chờ cài or Đã cài hold). Giữ để kiểm tra does not count.
// Fixture on moon9 (VM_001..VM_006 free): t1,t2,t7 TUT NEW free; t3 BLOCKED free; t4 TUT LIVE free (stale); t5 TUT NEW held on VM_005 (stale);
// t8 BLOCKED held on VM_006; t9 LIVE with an install-started UNCERTAIN hold on VM_004; t10 LIVE installed on VM_003; s1 shared LIVE free; g1 Genjy riêng LIVE.
async function fixture(){
  const projectId=randomUUID(),userId=randomUUID(),ids:string[]=[],net='203.4.'+(1+Math.floor(Math.random()*250))+'.',ip=(n:number)=>net+n;
  await db.project.create({data:{id:projectId,code:projectId,name:'State fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
  await db.projectMember.create({data:{projectId,userId,role:'ADMIN',allowedModules:['INFRASTRUCTURE'],capabilities:['COPY_CREDENTIALS','PROXY_IMPORT']}});
  await db.proxyProviderAccount.create({data:{projectId,code:'231243',label:'231243',credentialCipher:encrypt(JSON.stringify({username:'u',password:'secret'}))}});
  const server=await db.server.create({data:{projectId,code:'moon9',managed:true}});
  const vms:Record<string,{id:string}>={};for(const n of [1,2,3,4,5,6]) vms['v'+n]=await db.virtualMachine.create({data:{serverId:server.id,code:'VM_00'+n,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});
  const snapshot=await db.proxySourceSnapshot.create({data:{projectId,sourceKey:'GENJY',hash:'state-fixture',scanSucceeded:true}});
  const endpoint=async(n:number,o:{owner?:'SELF'|'GENJY';sub?:'PC_CHUNG'|null;state?:'NEW'|'LIVE'|'BLOCKED'}={})=>{
    const identity=await db.proxyIdentity.create({data:{ip:ip(n),owner:o.owner||'SELF',subgroup:o.sub||null}});ids.push(identity.id);
    if(o.owner==='GENJY') await db.proxySourceReference.create({data:{snapshotId:snapshot.id,identityId:identity.id,sourceRef:'Genjy!A'+n,owner:'GENJY',subgroup:o.sub||null,format:'BARE',hasFullCredentials:false,hasManualMetadata:false}});
    return db.proxyIP.create({data:{projectId,identityId:identity.id,address:ip(n)+':5432',host:ip(n),port:5432,credentialCipher:encrypt(JSON.stringify({username:'u',password:'secret'})),packageCode:'231243',inventoryState:o.state||'NEW',status:o.state==='BLOCKED'?'BLOCKED':'AVAILABLE',inventoryKey:identity.id,statusAt:new Date('2026-10-14T00:00:00Z')}});
  };
  const hold=async(endpointId:string,vmId:string,role:'DESIRED'|'INSTALLED'|'UNCERTAIN',started=false)=>{
    const config=await db.vMConfiguration.create({data:{projectId,vmId,version:1,endpointId,snapshotCipher:encrypt('{}'),configurationHash:'h-'+randomUUID(),createdById:userId,status:role==='INSTALLED'?'CONFIRMED':started?'IN_PROGRESS':'PLANNED',startedAt:started||role==='INSTALLED'?new Date():null}});
    const ep=await db.proxyIP.findUniqueOrThrow({where:{id:endpointId}});await db.vMProxyAllocation.create({data:{projectId,vmId,endpointId,configurationId:config.id,allocationKey:ep.inventoryKey!,role,createdById:userId}});
    await db.virtualMachine.update({where:{id:vmId},data:{desiredConfigurationId:config.id,installedConfigurationId:role==='INSTALLED'?config.id:null,proxyId:role==='INSTALLED'?endpointId:null,configurationSequence:1,proxySlotState:'FULL'}});
  };
  const t1=await endpoint(1),t2=await endpoint(2),t3=await endpoint(3,{state:'BLOCKED'}),t4=await endpoint(4,{state:'LIVE'}),t5=await endpoint(5),t7=await endpoint(7),t8=await endpoint(8,{state:'BLOCKED'}),t9=await endpoint(9,{state:'LIVE'}),t10=await endpoint(10,{state:'LIVE'});
  const s1=await endpoint(11,{owner:'GENJY',sub:'PC_CHUNG',state:'LIVE'}),g1=await endpoint(21,{owner:'GENJY',state:'LIVE'});
  await hold(t5.id,vms.v5.id,'DESIRED');await hold(t8.id,vms.v6.id,'DESIRED');await hold(t9.id,vms.v4.id,'UNCERTAIN',true);await hold(t10.id,vms.v3.id,'INSTALLED');
  const scope:ActorScope={projectId,userId,role:'ADMIN',capabilities:['COPY_CREDENTIALS','PROXY_IMPORT']};
  const cleanup=async()=>{const more=await db.proxyIdentity.findMany({where:{endpoints:{some:{projectId}}},select:{id:true}});await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});await db.vMConfiguration.deleteMany({where:{projectId}});await db.virtualMachine.deleteMany({where:{server:{projectId}}});await db.server.deleteMany({where:{projectId}});await db.auditLog.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:[...ids,...more.map(m=>m.id)]}}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});};
  return {projectId,userId,scope,ip,server,vms,t1,t2,t3,t4,t5,t7,t8,t9,t10,s1,g1,snapshot,cleanup};
}
const edits=()=>createProxyEditService(db);
async function apply(scope:ActorScope,input:Parameters<ReturnType<typeof edits>['preview']>[1]){const s=edits();const preview=await s.preview(scope,input);return {preview,result:preview.ready?await s.commit(scope,preview.token,input.idempotencyKey):null};}
const state=async(id:string)=>(await db.proxyIP.findUniqueOrThrow({where:{id}})).inventoryState;
it('assigning makes NEW → LIVE on every path; unassigning the last hold returns to NEW; BLOCKED and installed/started holds are kept',async()=>{
  const f=await fixture();try{
    const one=await apply(f.scope,{items:[{endpointId:f.t1.id,location:{kind:'VM',vmId:f.vms.v1.id}}],idempotencyKey:key()});expect(one.result?.applied).toBe(1);expect(await state(f.t1.id)).toBe('LIVE');
    const bulk=await apply(f.scope,{items:[{endpointId:f.t2.id,location:{kind:'SERVER',serverId:f.server.id}}],idempotencyKey:key()});expect(bulk.preview.rows[0].after).toBe('moon9/VM_002');expect(await state(f.t2.id)).toBe('LIVE');
    const off=await apply(f.scope,{items:[{endpointId:f.t1.id,location:{kind:'UNASSIGN'}}],idempotencyKey:key()});expect(off.result?.applied).toBe(1);expect(await state(f.t1.id)).toBe('NEW');
    const paste=await apply(f.scope,{paste:f.ip(7)+' | moon9 | VM_001',idempotencyKey:key()});expect(paste.result?.applied).toBe(1);expect(await state(f.t7.id)).toBe('LIVE');
    // BLOCKED stays BLOCKED when its plan is dropped; installed / install-started holds cannot be unassigned here and stay LIVE
    const blocked=await apply(f.scope,{items:[{endpointId:f.t8.id,location:{kind:'UNASSIGN'}}],idempotencyKey:key()});expect(blocked.result?.applied).toBe(1);expect(await state(f.t8.id)).toBe('BLOCKED');
    const kept=await apply(f.scope,{items:[{endpointId:f.t10.id,location:{kind:'UNASSIGN'}},{endpointId:f.t9.id,location:{kind:'UNASSIGN'}}],idempotencyKey:key()});expect(kept.preview.rows.map(r=>r.outcome)).toEqual(['ERROR','ERROR']);expect(await state(f.t10.id)).toBe('LIVE');expect(await state(f.t9.id)).toBe('LIVE');
    // autofill from Server/VM takes NEW stock and makes it LIVE
    const vm=createVMService(db,{refreshSource:async()=>({id:f.snapshot.id,sourceKey:'GENJY',hash:'state-fixture',fetchedAt:new Date().toISOString(),scanSucceeded:true})});
    const k=key(),p=await vm.preview(f.scope,{mode:'AUTO',vmIds:[f.vms.v6.id],idempotencyKey:k});expect(p.rows[0]).toMatchObject({outcome:'READY',ip:f.ip(1)});const r=await vm.commit(f.scope,p.token,k);
    expect(await state(f.t1.id)).toBe('LIVE');
    // undo of the autofill brings back NEW together with the released hold
    const op=(await listOperations(f.scope,db)).find(o=>o.batchId===r.batchId)!;await undoOperation(f.scope,op.id,'thử',db);
    expect(await state(f.t1.id)).toBe('NEW');expect(await db.vMProxyAllocation.count({where:{endpointId:f.t1.id,releasedAt:null}})).toBe(0);
    // history still shows the earlier assignment
    expect(await db.vMProxyAllocation.count({where:{endpointId:f.t1.id}})).toBeGreaterThanOrEqual(2);
  }finally{await f.cleanup();}
});
it('the status action saves directly: LIVE without a VM is allowed (in use), NEW on a held row needs an unassign, BLOCKED goes through the controlled path',async()=>{
  const f=await fixture();try{
    await apply(f.scope,{items:[{endpointId:f.t2.id,location:{kind:'VM',vmId:f.vms.v2.id}}],idempotencyKey:key()});
    const bad=await apply(f.scope,{items:[{endpointId:f.t1.id,manage:{kind:'STATE',state:'LIVE'}},{endpointId:f.t2.id,manage:{kind:'STATE',state:'NEW'}},{endpointId:f.t3.id,manage:{kind:'STATE',state:'NEW'}},{endpointId:f.t7.id,manage:{kind:'STATE',state:'NEW'}}],idempotencyKey:key()});
    expect(bad.preview.rows.map(r=>[r.outcome,r.code||null])).toEqual([['READY',null],['ERROR','INVALID_INPUT'],['ERROR','INVALID_INPUT'],['SKIP',null]]);
    expect(bad.preview.rows[1].message).toMatch(/Bỏ gán/);
    expect(await state(f.t1.id)).toBe('LIVE');expect(await db.vMProxyAllocation.count({where:{endpointId:f.t1.id,releasedAt:null}})).toBe(0); // in use, no VM recorded
    expect(await db.proxyStatusEvent.count({where:{endpointId:f.t7.id}})).toBe(0); // same value: no history
    const back=await apply(f.scope,{items:[{endpointId:f.t1.id,manage:{kind:'STATE',state:'NEW'}}],idempotencyKey:key()});expect(back.result?.applied).toBe(1);
    // re-assigning the current position is a no-op, also for an installed proxy
    const same=await apply(f.scope,{items:[{endpointId:f.t2.id,location:{kind:'VM',vmId:f.vms.v2.id}},{endpointId:f.t10.id,location:{kind:'VM',vmId:f.vms.v3.id}}],idempotencyKey:key()});
    expect(same.preview.rows.map(r=>[r.outcome,r.message])).toEqual([['SKIP','Đã ở VM này'],['SKIP','Đã ở VM này']]);
    // one save: unassign + NEW together
    const both=await apply(f.scope,{items:[{endpointId:f.t2.id,location:{kind:'UNASSIGN'},manage:{kind:'STATE',state:'NEW'}}],idempotencyKey:key()});expect(both.result?.applied).toBe(1);expect(await state(f.t2.id)).toBe('NEW');
    const vmLive=await apply(f.scope,{items:[{endpointId:f.t2.id,location:{kind:'VM',vmId:f.vms.v2.id},manage:{kind:'STATE',state:'LIVE'}}],idempotencyKey:key()});expect(vmLive.result?.applied).toBe(1);expect(await state(f.t2.id)).toBe('LIVE');
    // BLOCKED from the status action keeps the VM position, writes a BLOCKED event and is refused for Genjy-less rights
    const block=await apply(f.scope,{items:[{endpointId:f.t2.id,manage:{kind:'STATE',state:'BLOCKED'}}],idempotencyKey:key()});expect(block.result?.applied).toBe(1);
    expect(await state(f.t2.id)).toBe('BLOCKED');expect(await db.proxyStatusEvent.count({where:{endpointId:f.t2.id,kind:'BLOCKED'}})).toBe(1);expect(await db.vMProxyAllocation.count({where:{endpointId:f.t2.id,releasedAt:null}})).toBe(1);
    // two people assigning different proxies to the same VM: one wins
    const s=edits(),k1=key(),k2=key();const p1=await s.preview(f.scope,{items:[{endpointId:f.t1.id,location:{kind:'VM',vmId:f.vms.v1.id}}],idempotencyKey:k1}),p2=await s.preview(f.scope,{items:[{endpointId:f.t7.id,location:{kind:'VM',vmId:f.vms.v1.id}}],idempotencyKey:k2});
    const res=await Promise.allSettled([s.commit(f.scope,p1.token,k1),s.commit(f.scope,p2.token,k2)]);expect(res.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(await db.vMProxyAllocation.count({where:{vmId:f.vms.v1.id,releasedAt:null}})).toBe(1);
    expect([await state(f.t1.id),await state(f.t7.id)].sort()).toEqual(['LIVE','NEW']);
  }finally{await f.cleanup();}
});
it('state sync previews rows whose NEW/LIVE does not match their holds, applies once, leaves BLOCKED, review holds and Genjy riêng alone, and counts follow',async()=>{
  const f=await fixture();try{
    const k=key(),{preview,result}=await apply(f.scope,{syncStates:true,idempotencyKey:k});
    // LIVE without a VM is a valid "in use" record now; only NEW rows that a VM already holds are corrected
    expect(preview.rows.map(r=>[r.ip,r.outcome,r.before,r.after])).toEqual([[f.ip(5),'READY','NEW','LIVE']]);
    expect(result?.applied).toBe(1);
    expect([await state(f.t4.id),await state(f.t5.id),await state(f.s1.id),await state(f.g1.id),await state(f.t3.id),await state(f.t8.id)]).toEqual(['LIVE','LIVE','LIVE','LIVE','BLOCKED','BLOCKED']);
    expect(await db.proxyStatusEvent.count({where:{projectId:f.projectId,kind:'STATE_SYNC'}})).toBe(1);
    const again=await apply(f.scope,{syncStates:true,idempotencyKey:key()});expect(again.preview.ready).toBe(0);
    const page=await queryRegistry(f.scope,{view:'CURRENT',limit:100},db);expect(page.stateCounts).toMatchObject({NEW:3,LIVE:6,BLOCKED:2});
    const op=(await listOperations(f.scope,db)).find(o=>o.batchId===result!.batchId)!;await undoOperation(f.scope,op.id,'',db); // no reason needed
    expect(await state(f.t5.id)).toBe('NEW');
  }finally{await f.cleanup();}
});
