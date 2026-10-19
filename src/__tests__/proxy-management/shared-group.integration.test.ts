import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {queryRegistry} from '@/server/proxy-management/history';
import {createProxyEditService} from '@/server/proxy-management/edits';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {getEligibleInventory} from '@/server/proxy-management/repository';
import {ownerLabel} from '@/server/proxy-management/groups';
import {listOperations} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import {GROUP_GENJY,GROUP_SHARED,GROUP_TUT,type ActorScope,type RegistryFilter} from '@/server/proxy-management/types';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
const key=()=>'shared-'+randomUUID();
// "PC chung" = proxies mooon and Genjy invest in together; stored as owner GENJY + subgroup PC_CHUNG, shown as "Chung mooon–Genjy".
// Fixture: t1..t3 TUT, s1..s5 shared (endpoints), sx shared reserved IP without endpoint, g1/g2 Genjy riêng, moon1 VM_001 free, VM_002 holds t3.
async function fixture(){
  const projectId=randomUUID(),userId=randomUUID(),ids:string[]=[],net='203.3.'+(1+Math.floor(Math.random()*250))+'.',ip=(n:number)=>net+n;
  await db.project.create({data:{id:projectId,code:projectId,name:'Shared fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
  await db.projectMember.create({data:{projectId,userId,role:'ADMIN',allowedModules:['INFRASTRUCTURE'],capabilities:['COPY_CREDENTIALS','PROXY_IMPORT']}});
  await db.proxyProviderAccount.create({data:{projectId,code:'231243',label:'231243',credentialCipher:encrypt(JSON.stringify({username:'u',password:'secret'}))}});
  const server=await db.server.create({data:{projectId,code:'moon1',managed:true}});
  const vm=async(code:string)=>db.virtualMachine.create({data:{serverId:server.id,code,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});
  const vms={v1:await vm('VM_001'),v2:await vm('VM_002'),v3:await vm('VM_003')};
  const snapshot=await db.proxySourceSnapshot.create({data:{projectId,sourceKey:'GENJY',hash:'shared-fixture',scanSucceeded:true}});
  const endpoint=async(n:number,o:{owner?:'SELF'|'GENJY';sub?:'PC_CHUNG'|null;state?:'NEW'|'LIVE'|'BLOCKED'}={})=>{
    const identity=await db.proxyIdentity.create({data:{ip:ip(n),owner:o.owner||'SELF',subgroup:o.sub||null}});ids.push(identity.id);
    if(o.owner==='GENJY') await db.proxySourceReference.create({data:{snapshotId:snapshot.id,identityId:identity.id,sourceRef:'Genjy!A'+n,owner:'GENJY',subgroup:o.sub||null,format:'BARE',hasFullCredentials:false,hasManualMetadata:false}});
    return db.proxyIP.create({data:{projectId,identityId:identity.id,address:ip(n)+':5432',host:ip(n),port:5432,credentialCipher:encrypt(JSON.stringify({username:'u',password:'secret'})),packageCode:'231243',inventoryState:o.state||'LIVE',status:'AVAILABLE',inventoryKey:identity.id,statusAt:new Date('2026-10-14T00:00:00Z')}});
  };
  const t1=await endpoint(1,{state:'NEW'}),t2=await endpoint(2,{state:'NEW'}),t3=await endpoint(3);
  const shared=[];for(const n of [11,12,13,14,15]) shared.push(await endpoint(n,{owner:'GENJY',sub:'PC_CHUNG',state:n===15?'BLOCKED':'LIVE'}));
  const g1=await endpoint(21,{owner:'GENJY'}),g2=await endpoint(22,{owner:'GENJY'});
  const sx=await db.proxyIdentity.create({data:{ip:ip(31),owner:'GENJY',subgroup:'PC_CHUNG'}});ids.push(sx.id);await db.proxySourceReference.create({data:{snapshotId:snapshot.id,identityId:sx.id,sourceRef:'Genjy!PC31',owner:'GENJY',subgroup:'PC_CHUNG',format:'BARE',hasFullCredentials:false,hasManualMetadata:false}});
  const gx=await db.proxyIdentity.create({data:{ip:ip(32),owner:'GENJY'}});ids.push(gx.id);await db.proxySourceReference.create({data:{snapshotId:snapshot.id,identityId:gx.id,sourceRef:'Genjy!B32',owner:'GENJY',format:'BARE',hasFullCredentials:false,hasManualMetadata:false}});
  // t3 is planned on VM_002 (Chờ cài)
  const config=await db.vMConfiguration.create({data:{projectId,vmId:vms.v2.id,version:1,endpointId:t3.id,snapshotCipher:encrypt('{}'),configurationHash:'h-'+randomUUID(),createdById:userId,status:'PLANNED'}});
  await db.vMProxyAllocation.create({data:{projectId,vmId:vms.v2.id,endpointId:t3.id,configurationId:config.id,allocationKey:t3.inventoryKey!,role:'DESIRED',createdById:userId}});
  await db.virtualMachine.update({where:{id:vms.v2.id},data:{desiredConfigurationId:config.id,configurationSequence:1,proxySlotState:'FULL'}});
  const scope:ActorScope={projectId,userId,role:'ADMIN',capabilities:['COPY_CREDENTIALS','PROXY_IMPORT']};
  const cleanup=async()=>{const more=await db.proxyIdentity.findMany({where:{endpoints:{some:{projectId}}},select:{id:true}});await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});await db.vMConfiguration.deleteMany({where:{projectId}});await db.vmOpsEvent.deleteMany({where:{projectId}});await db.vmOperation.deleteMany({where:{projectId}});await db.virtualMachine.deleteMany({where:{server:{projectId}}});await db.server.deleteMany({where:{projectId}});await db.auditLog.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await db.proxyReplacement.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyGroup.deleteMany({where:{projectId}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:[...ids,...more.map(m=>m.id)]}}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});};
  return {projectId,userId,scope,ip,vms,t1,t2,t3,shared,g1,g2,sx,gx,snapshot,cleanup};
}
const edits=()=>createProxyEditService(db);
async function apply(scope:ActorScope,input:Parameters<ReturnType<typeof edits>['preview']>[1]){const s=edits();const preview=await s.preview(scope,input);return {preview,result:preview.ready?await s.commit(scope,preview.token,input.idempotencyKey):null};}
const page=(scope:ActorScope,f:Partial<RegistryFilter>)=>queryRegistry(scope,{view:'CURRENT',limit:100,sort:'IP',...f},db);
const ipsOf=async(scope:ActorScope,f:Partial<RegistryFilter>)=>(await page(scope,f)).rows.map(r=>r.ip);
it('labels and filters keep shared, Genjy riêng and TUT apart, with counts for the current scope, combined filters and pagination',async()=>{
  const f=await fixture();try{
    expect(ownerLabel('GENJY','PC_CHUNG',null)).toBe('Chung mooon–Genjy');expect(ownerLabel('GENJY',null,null)).toBe('Genjy riêng');expect(ownerLabel('SELF',null,null)).toBe('TUT');
    expect(await ipsOf(f.scope,{group:GROUP_SHARED})).toEqual([11,12,13,14,15,31].map(f.ip));
    expect(await ipsOf(f.scope,{group:GROUP_GENJY})).toEqual([21,22,32].map(f.ip));
    expect(await ipsOf(f.scope,{group:GROUP_TUT})).toEqual([1,2,3].map(f.ip));
    const all=await page(f.scope,{});expect(all.groupCounts).toMatchObject({ALL:12,TUT:3,SHARED:6,GENJY:3});
    // counts follow the other filters (state, search) but not the group itself
    const blocked=await page(f.scope,{group:GROUP_SHARED,state:'BLOCKED'});expect(blocked.rows.map(r=>r.ip)).toEqual([f.ip(15)]);expect(blocked.groupCounts).toMatchObject({ALL:1,SHARED:1,TUT:0,GENJY:0});
    const search=await page(f.scope,{group:GROUP_SHARED,search:f.ip(1)});expect(search.rows.map(r=>r.ip)).toEqual([11,12,13,14,15].map(f.ip));expect(search.groupCounts).toMatchObject({ALL:6,TUT:1,SHARED:5,GENJY:0});
    // pagination walks the whole filtered result before cutting pages
    const seen:string[]=[];let cursor:string|undefined;do{const p=await queryRegistry(f.scope,{view:'CURRENT',limit:2,sort:'IP',group:GROUP_SHARED,cursor},db);expect(p.total).toBe(6);seen.push(...p.rows.map(r=>r.ip));cursor=p.nextCursor||undefined;}while(cursor);
    expect(seen).toEqual([11,12,13,14,15,31].map(f.ip));
  }finally{await f.cleanup();}
});
it('shared proxies are assigned to VMs by hand (single and paste), never autofilled; Genjy riêng and occupied VMs are refused; replace keeps the shared class',async()=>{
  const f=await fixture();try{
    const [s1,s2]=f.shared;
    expect((await getEligibleInventory(f.projectId,db)).map(e=>e.ip).sort()).toEqual([1,2].map(f.ip));
    const one=await apply(f.scope,{items:[{endpointId:s1.id,location:{kind:'VM',vmId:f.vms.v1.id}}],idempotencyKey:key()});
    expect(one.preview.rows[0]).toMatchObject({outcome:'READY',after:'moon1/VM_001'});expect(one.result?.applied).toBe(1);
    const holds=await db.vMProxyAllocation.findMany({where:{endpointId:s1.id,releasedAt:null}});expect(holds.map(h=>h.role)).toEqual(['DESIRED']);
    const refused=await apply(f.scope,{items:[{endpointId:f.g1.id,location:{kind:'VM',vmId:f.vms.v3.id}},{endpointId:s2.id,location:{kind:'VM',vmId:f.vms.v2.id}}],idempotencyKey:key()});
    expect(refused.preview.rows.map(r=>r.code)).toEqual(['GENJY_RESERVED','CURRENT_IP']);
    const paste=await apply(f.scope,{paste:f.ip(12)+' | moon1 | VM_003',idempotencyKey:key()});expect(paste.result?.applied).toBe(1);
    const same=key(),p1=await edits().preview(f.scope,{paste:f.ip(13)+' | moon1 | VM_001',idempotencyKey:same});expect(p1.rows[0]).toMatchObject({outcome:'ERROR',code:'CURRENT_IP'}); // VM_001 now holds s1
    // BLOCKED + replace: the new proxy stays in the shared class and keeps the chain
    const batches=createProxyBatchService(db,{refreshSource:async()=>({id:f.snapshot.id,sourceKey:'GENJY',hash:'shared-fixture',fetchedAt:new Date().toISOString(),scanSucceeded:true})});
    const run=async(input:Parameters<typeof batches.preview>[1])=>{const p=await batches.preview(f.scope,input);return batches.commit(f.scope,p.token,input.idempotencyKey);};
    await run({kind:'BLOCKED',text:f.ip(14),idempotencyKey:key()});
    const rep=await run({kind:'REPLACE',removedText:f.ip(14),addedText:f.ip(41),idempotencyKey:key()});expect(rep.applied).toBe(1);
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{ip:f.ip(41)}})).toMatchObject({owner:'GENJY',subgroup:'PC_CHUNG'});
    expect(await ipsOf(f.scope,{group:GROUP_SHARED})).toContain(f.ip(41));
    expect((await getEligibleInventory(f.projectId,db)).map(e=>e.ip)).not.toContain(f.ip(41));
  }finally{await f.cleanup();}
});
it('confirmed shared list: preview shows found, missing, conflicts and duplicates, saves once, keeps history and undoes',async()=>{
  const f=await fixture();try{
    await db.proxyIP.update({where:{id:f.t3.id},data:{groupId:null}});
    const retired=await db.proxyIP.update({where:{id:f.t2.id},data:{inventoryState:'RETIRED',retiredAt:new Date()}});
    const list=[f.ip(1)+':5432:u:secret',f.ip(21),f.ip(11),'not a proxy',f.ip(99),f.ip(1),f.ip(3)+':5432:u:wrong',f.ip(2),f.ip(32),f.ip(3)].join('\n');
    const k=key(),{preview,result}=await apply(f.scope,{sharedList:list,idempotencyKey:k});
    expect(preview.rows.map(r=>[r.row,r.ip,r.outcome,r.code||null,r.before,r.after])).toEqual([
      [1,f.ip(1),'READY',null,'TUT','Chung mooon–Genjy'],
      [2,f.ip(21),'READY',null,'Genjy riêng','Chung mooon–Genjy'],
      [3,f.ip(11),'SKIP',null,'Chung mooon–Genjy','Chung mooon–Genjy'],
      [4,'not a proxy','ERROR','INVALID_INPUT','',''],
      [5,f.ip(99),'ERROR','NOT_FOUND','',''],
      [6,f.ip(1),'ERROR','DUPLICATE_INPUT','TUT','Chung mooon–Genjy'],
      [7,f.ip(3),'ERROR','AMBIGUOUS_OLD','TUT','Chung mooon–Genjy'],
      [8,f.ip(2),'ERROR','HISTORICAL_IP','TUT','Chung mooon–Genjy'],
      [9,f.ip(32),'READY',null,'Genjy riêng','Chung mooon–Genjy'],
      [10,f.ip(3),'ERROR','DUPLICATE_INPUT','TUT','Chung mooon–Genjy'],
    ]);
    expect(preview.notListed.map(r=>r.ip)).toEqual([12,13,14,15,31].map(f.ip)); // already shared but not in the confirmed list: shown, never changed
    expect(JSON.stringify(preview)).not.toContain('secret');
    expect(result?.applied).toBe(3);
    for(const n of [1,21,32]) expect(await db.proxyIdentity.findUniqueOrThrow({where:{ip:f.ip(n)}})).toMatchObject({owner:'GENJY',subgroup:'PC_CHUNG'});
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{ip:f.ip(3)}})).toMatchObject({owner:'SELF',subgroup:null});
    expect(await db.proxySourceReference.count({where:{identityId:f.g1.identityId!}})).toBe(1); // source kept
    expect(await db.proxyStatusEvent.count({where:{projectId:f.projectId,kind:'SHARED_CONFIRMED'}})).toBe(3);
    const replay=await edits().commit(f.scope,preview.token,k);expect(replay.replay).toBe(true);expect(await db.proxyStatusEvent.count({where:{projectId:f.projectId,kind:'SHARED_CONFIRMED'}})).toBe(3);
    expect((await getEligibleInventory(f.projectId,db)).map(e=>e.ip)).toEqual([]); // t1 left TUT autofill, t2 retired
    // stale: a classified row changed after preview → commit refused
    const k2=key(),p2=await edits().preview(f.scope,{sharedList:f.ip(22),idempotencyKey:k2});await db.proxyIdentity.update({where:{id:f.g2.identityId!},data:{revision:{increment:1}}});
    await expect(edits().commit(f.scope,p2.token,k2)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    const op=(await listOperations(f.scope,db)).find(o=>o.batchId===result!.batchId)!;await undoOperation(f.scope,op.id,'nhầm danh sách',db);
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{ip:f.ip(1)}})).toMatchObject({owner:'SELF',subgroup:null});
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{ip:f.ip(21)}})).toMatchObject({owner:'GENJY',subgroup:null});
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{ip:f.ip(32)}})).toMatchObject({owner:'GENJY',subgroup:null});
    expect(retired.inventoryState).toBe('RETIRED');
    await expect(db.proxyIdentity.update({where:{id:f.g2.identityId!},data:{owner:'SELF'}})).rejects.toThrow(/permanent/); // ordinary writes still cannot undo Genjy ownership
    await expect(db.proxyIdentity.update({where:{id:f.shared[1].identityId!},data:{subgroup:null}})).rejects.toThrow(/permanent/);
  }finally{await f.cleanup();}
});
it('any row can change group (TUT, Chung mooon–Genjy, Genjy riêng, operator groups) one by one or in bulk, with VM rules, journal, undo and a sticky operator decision',async()=>{
  const f=await fixture();try{
    const [s1,s2,,,s5]=f.shared;
    await apply(f.scope,{items:[{endpointId:s1.id,location:{kind:'VM',vmId:f.vms.v1.id}}],idempotencyKey:key()});
    const one=await apply(f.scope,{items:[{endpointId:s1.id,group:{kind:'TUT'}}],idempotencyKey:key()});
    expect(one.preview.rows[0]).toMatchObject({outcome:'READY',before:'Chung mooon–Genjy',after:'TUT'});expect(one.result?.applied).toBe(1);
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{id:s1.identityId!}})).toMatchObject({owner:'SELF',subgroup:null,ownerDecidedBy:f.userId});
    expect(await db.vMProxyAllocation.count({where:{endpointId:s1.id,releasedAt:null}})).toBe(1); // stays on its VM
    expect(await db.proxyStatusEvent.count({where:{endpointId:s1.id,kind:'OWNER_CHANGED'}})).toBe(1);
    const bulk=await apply(f.scope,{items:[{endpointId:f.g1.id,group:{kind:'TUT'}},{endpointId:f.g2.id,group:{kind:'SHARED'}},{endpointId:f.t1.id,group:{kind:'GENJY'}},{endpointId:f.t3.id,group:{kind:'GENJY'}},{endpointId:s2.id,group:{kind:'NEW',name:'Nhóm X'}},{endpointId:f.shared[2].id,group:{kind:'SHARED'}}],idempotencyKey:key()});
    expect(bulk.preview.rows.map(r=>[r.outcome,r.before,r.after])).toEqual([['READY','Genjy riêng','TUT'],['READY','Genjy riêng','Chung mooon–Genjy'],['READY','TUT','Genjy riêng'],['ERROR','TUT','Genjy riêng'],['READY','Chung mooon–Genjy','Nhóm X'],['SKIP','Chung mooon–Genjy','Chung mooon–Genjy']]);
    expect(bulk.preview.rows[3].message).toMatch(/VM/);
    expect(bulk.result?.applied).toBe(4);
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{id:f.g2.identityId!}})).toMatchObject({owner:'GENJY',subgroup:'PC_CHUNG'});
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{id:f.t1.identityId!}})).toMatchObject({owner:'GENJY',subgroup:null});
    expect(await db.proxyIP.findUniqueOrThrow({where:{id:s2.id},include:{identity:true,group:true}})).toMatchObject({identity:{owner:'OTHER',subgroup:null},group:{name:'Nhóm X'}});
    // state NEW ↔ LIVE; BLOCKED is not changed here
    const st=await apply(f.scope,{items:[{endpointId:f.g1.id,manage:{kind:'STATE',state:'NEW'}},{endpointId:s5.id,manage:{kind:'STATE',state:'NEW'}},{endpointId:f.t2.id,manage:{kind:'STATE',state:'NEW'}}],idempotencyKey:key()});
    expect(st.preview.rows.map(r=>[r.outcome,r.before,r.after])).toEqual([['READY','LIVE','NEW'],['ERROR','BLOCKED','NEW'],['SKIP','NEW','NEW']]);
    expect((await db.proxyIP.findUniqueOrThrow({where:{id:f.g1.id}})).inventoryState).toBe('NEW');
    expect((await getEligibleInventory(f.projectId,db)).map(e=>e.ip)).toContain(f.ip(21)); // former Genjy riêng, now TUT NEW: eligible despite its old Genjy source
    // a Genjy refresh keeps the operator's decision
    const {persistSourceSnapshot}=await import('@/server/proxy-management/sources');
    await persistSourceSnapshot(f.projectId,{id:randomUUID(),sourceKey:'GENJY',hash:'refresh-'+randomUUID(),fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[{sourceRef:'Genjy!Z1',ip:f.ip(21),owner:'GENJY',subgroup:'PC_CHUNG',format:'BARE',hasFullCredentials:false,hasManualMetadata:false}]},db);
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{id:f.g1.identityId!}})).toMatchObject({owner:'SELF',subgroup:null});
    // undo the first change: s1 back to the shared class
    const op=(await listOperations(f.scope,db)).find(o=>o.batchId===one.result!.batchId)!;await undoOperation(f.scope,op.id,'nhầm',db);
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{id:s1.identityId!}})).toMatchObject({owner:'GENJY',subgroup:'PC_CHUNG',ownerDecidedAt:null});
    await expect(db.proxyIdentity.update({where:{id:f.g2.identityId!},data:{owner:'SELF'}})).rejects.toThrow(/permanent/); // direct writes stay blocked
  }finally{await f.cleanup();}
});
