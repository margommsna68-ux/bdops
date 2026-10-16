import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {queryRegistry} from '@/server/proxy-management/history';
import {createGroup,listGroups,normalizeGroupName,ownerLabel} from '@/server/proxy-management/groups';
import {createProxyEditService,listVmTargets,parsePasteMapping} from '@/server/proxy-management/edits';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {getEligibleInventory} from '@/server/proxy-management/repository';
import {undoOperation} from '@/server/operation-history/undo';
import {listOperations} from '@/server/operation-history/journal';
import {GROUP_TUT,type ActorScope} from '@/server/proxy-management/types';
import {appRouter} from '@/server/routers/_app';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
const key=()=>'edit-'+randomUUID();
// Fixture: moon1 (VM_001 holds e1 Chờ cài, VM_002 free, VM_003 holds e4 Giữ để kiểm tra), moon2 (VM_001 has e3 installed). e2/e5 unassigned TUT, g = genjy.
async function fixture(role:'ADMIN'|'USER'='ADMIN'){
  const projectId=randomUUID(),userId=randomUUID(),ids:string[]=[],net='203.0.'+(1+Math.floor(Math.random()*250))+'.';
  await db.project.create({data:{id:projectId,code:projectId,name:'Edit fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
  await db.projectMember.create({data:{projectId,userId,role,allowedModules:['INFRASTRUCTURE'],capabilities:['COPY_CREDENTIALS','PROXY_IMPORT']}});
  const servers:Record<string,{id:string}>={};for(const code of ['moon1','moon2']) servers[code]=await db.server.create({data:{projectId,code,managed:true}});
  const vm=async(server:string,code:string)=>db.virtualMachine.create({data:{serverId:servers[server].id,code,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});
  const vms={m1_1:await vm('moon1','VM_001'),m1_2:await vm('moon1','VM_002'),m1_3:await vm('moon1','VM_003'),m2_1:await vm('moon2','VM_001')};
  const endpoint=async(ip:string,o:{owner?:'SELF'|'GENJY';state?:'NEW'|'LIVE'}={})=>{
    const identity=await db.proxyIdentity.create({data:{ip,owner:o.owner||'SELF'}});ids.push(identity.id);
    return db.proxyIP.create({data:{projectId,identityId:identity.id,address:ip+':80',host:ip,port:80,credentialCipher:encrypt(JSON.stringify({username:'u'+ip.split('.')[3],password:'secret-'+ip.split('.')[3]})),packageCode:'231243',inventoryState:o.state||'NEW',inventoryKey:identity.id,statusAt:new Date('2026-10-14T00:00:00Z')}});
  };
  const hold=async(endpointId:string,vmId:string,role:'DESIRED'|'INSTALLED'|'UNCERTAIN')=>{
    const config=await db.vMConfiguration.create({data:{projectId,vmId,version:1,endpointId,snapshotCipher:encrypt('{}'),configurationHash:'h-'+randomUUID(),createdById:userId,status:role==='INSTALLED'?'CONFIRMED':'PLANNED',confirmedAt:role==='INSTALLED'?new Date():null}});
    const ep=await db.proxyIP.findUniqueOrThrow({where:{id:endpointId}});const h=await db.vMProxyAllocation.create({data:{projectId,vmId,endpointId,configurationId:config.id,allocationKey:ep.inventoryKey!,role,createdById:userId}});
    const task=await db.vMTask.create({data:{vmId,configurationId:config.id,type:'PROXY_INSTALL',title:'Cài proxy',scheduledAt:new Date(),status:role==='INSTALLED'?'COMPLETED':'PENDING'}});
    await db.virtualMachine.update({where:{id:vmId},data:{desiredConfigurationId:config.id,installedConfigurationId:role==='INSTALLED'?config.id:null,proxyId:role==='INSTALLED'?endpointId:null,configurationSequence:1,proxySlotState:'FULL'}});return {config,hold:h,task};
  };
  const e1=await endpoint(net+'1'),e2=await endpoint(net+'2'),e3=await endpoint(net+'3',{state:'LIVE'}),e4=await endpoint(net+'4'),e5=await endpoint(net+'5'),g=await endpoint(net+'9',{owner:'GENJY'});
  const h1=await hold(e1.id,vms.m1_1.id,'DESIRED');await hold(e3.id,vms.m2_1.id,'INSTALLED');await hold(e4.id,vms.m1_3.id,'UNCERTAIN');
  const snapshot=await db.proxySourceSnapshot.create({data:{projectId,sourceKey:'GENJY',hash:'edit-fixture',scanSucceeded:true}});
  await db.proxySourceReference.create({data:{snapshotId:snapshot.id,identityId:g.identityId!,sourceRef:'Genjy!A1',owner:'GENJY',format:'BARE',hasFullCredentials:false,hasManualMetadata:false}});
  const scope:ActorScope={projectId,userId,role,capabilities:['COPY_CREDENTIALS','PROXY_IMPORT']};
  const cleanup=async()=>{await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});await db.vMConfiguration.deleteMany({where:{projectId}});await db.virtualMachine.deleteMany({where:{server:{projectId}}});await db.server.deleteMany({where:{projectId}});await db.auditLog.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyGroup.deleteMany({where:{projectId}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});};
  return {projectId,userId,scope,net,vms,e1,e2,e3,e4,e5,g,h1,cleanup};
}
const service=()=>createProxyEditService(db);
async function apply(scope:ActorScope,input:Parameters<ReturnType<typeof service>['preview']>[1]){const s=service();const preview=await s.preview(scope,input);return {preview,result:preview.ready?await s.commit(scope,preview.token,input.idempotencyKey):null};}
const location=async(endpointId:string)=>(await db.vMProxyAllocation.findMany({where:{endpointId,releasedAt:null},include:{vm:{include:{server:true}}}})).map(h=>h.vm.server.code+'/'+h.vm.code+':'+h.role).sort();

it('group names are normalized, reserved names and case/space duplicates are rejected, labels show TUT',()=>{
  expect(normalizeGroupName('  Nhóm   A ')).toEqual({name:'Nhóm A',normalized:'nhóm a'});
  expect(ownerLabel('SELF',null,null)).toBe('TUT');expect(ownerLabel('GENJY','PC_CHUNG',null)).toBe('Chung mooon–Genjy');expect(ownerLabel('GENJY',null,null)).toBe('Genjy riêng');expect(ownerLabel('OTHER',null,'Nhóm A')).toBe('Nhóm A');expect(ownerLabel('UNKNOWN',null,null)).toBe('Chưa xác định');
});
it('creates reusable groups per project and blocks duplicates and reserved names',async()=>{
  const f=await fixture();try{
    const a=await createGroup(f.scope,' Nhóm  A ',db);expect(a.name).toBe('Nhóm A');
    await expect(createGroup(f.scope,'nhóm a',db)).rejects.toMatchObject({code:'DUPLICATE_INPUT'});
    await expect(createGroup(f.scope,'NHÓM A ',db)).rejects.toMatchObject({code:'DUPLICATE_INPUT'});
    for(const reserved of ['TUT','tut ','genjy','PC chung','']) await expect(createGroup(f.scope,reserved,db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await createGroup(f.scope,'Đối tác B',db);
    expect((await listGroups(f.scope,db)).map(g=>g.name)).toEqual(['Đối tác B','Nhóm A']);
    await db.projectMember.update({where:{userId_projectId:{userId:f.userId,projectId:f.projectId}},data:{role:'VIEWER'}});await expect(createGroup(f.scope,'X',db)).rejects.toMatchObject({code:'FORBIDDEN'});
  }finally{await f.cleanup();}
});
it('import can register a new group or pick an existing one; grouped proxies are OTHER, listed under the group and never eligible for VMs',async()=>{
  const f=await fixture();try{
    const batches=createProxyBatchService(db,{refreshSource:async()=>({id:'s',sourceKey:'GENJY',hash:'edit-fixture',fetchedAt:new Date().toISOString(),scanSucceeded:true})});
    const k1=key(),preview=await batches.preview(f.scope,{kind:'NEW',text:f.net+'21:80:u21:p21\n'+f.net+'22:80:u21:p21',owner:'OTHER',newGroup:{name:' Khách  C '},packageCode:undefined,newPackage:{code:'PKG-C',site:null},idempotencyKey:k1});
    expect(preview.ready).toBe(2);expect(preview.rows[0]).toMatchObject({owner:'OTHER',groupName:'Khách C'});
    const result=await batches.commit(f.scope,preview.token,k1);expect(result.applied).toBe(2);
    const group=await db.proxyGroup.findFirstOrThrow({where:{projectId:f.projectId,normalizedName:'khách c'}});expect(group.name).toBe('Khách C');
    const rows=await db.proxyIP.findMany({where:{projectId:f.projectId,groupId:group.id},include:{identity:true}});expect(rows).toHaveLength(2);expect(rows.every(r=>r.identity!.owner==='OTHER'&&r.inventoryState==='NEW')).toBe(true);
    await expect(batches.preview(f.scope,{kind:'NEW',text:f.net+'23:80:u21:p21',owner:'OTHER',newGroup:{name:'khách c'},packageCode:'PKG-C',idempotencyKey:key()})).rejects.toMatchObject({code:'DUPLICATE_INPUT'});
    const k2=key(),again=await batches.preview(f.scope,{kind:'NEW',text:f.net+'23:80:u21:p21',owner:'OTHER',groupId:group.id,packageCode:'PKG-C',idempotencyKey:k2});expect(again.ready).toBe(1);await batches.commit(f.scope,again.token,k2);
    expect((await getEligibleInventory(f.projectId,db)).map(e=>e.ip).sort()).toEqual([f.net+'2',f.net+'5']); // grouped proxies stay out of the TUT pool (held/installed TUT rows are out as before)
    const page=await queryRegistry(f.scope,{view:'CURRENT',limit:50,group:group.id},db);expect(page.rows.map(r=>r.ip).sort()).toEqual([f.net+'21',f.net+'22',f.net+'23']);expect(page.rows[0]).toMatchObject({owner:'OTHER',groupId:group.id,groupName:'Khách C'});expect(page.groups).toEqual([{id:group.id,name:'Khách C'}]);
    const tut=await queryRegistry(f.scope,{view:'CURRENT',limit:50,group:GROUP_TUT},db);expect(tut.rows.map(r=>r.ip).sort()).toEqual([f.net+'1',f.net+'2',f.net+'3',f.net+'4',f.net+'5']);
    const combined=await queryRegistry(f.scope,{view:'CURRENT',limit:50,group:GROUP_TUT,servers:['moon1'],state:'NEW'},db);expect(combined.rows.map(r=>r.ip).sort()).toEqual([f.net+'1',f.net+'4']);
    await expect(batches.preview(f.scope,{kind:'NEW',text:f.net+'24:80:u24:p24',owner:'OTHER',idempotencyKey:key()})).rejects.toMatchObject({code:'INVALID_INPUT'}); // OTHER needs a group
  }finally{await f.cleanup();}
});
it('changes the group of a row with journal and undo; a held row cannot join an operator group; genjy rows may move to TUT; same edit again is a no-op',async()=>{
  const f=await fixture();try{
    const first=await apply(f.scope,{items:[{endpointId:f.e2.id,group:{kind:'NEW',name:'Nhóm A'}},{endpointId:f.e1.id,group:{kind:'NEW',name:'Nhóm A'}},{endpointId:f.g.id,group:{kind:'TUT'}}],idempotencyKey:key()});
    expect(first.preview.rows.map(r=>[r.field,r.outcome,r.before,r.after])).toEqual([['GROUP','READY','TUT','Nhóm A'],['GROUP','ERROR','TUT','Nhóm A'],['GROUP','READY','Genjy riêng','TUT']]);
    expect(first.preview.rows[1].message).toMatch(/đang giữ|VM/);
    expect(first.result).toMatchObject({applied:2,errors:1,skipped:0});
    const group=await db.proxyGroup.findFirstOrThrow({where:{projectId:f.projectId,normalizedName:'nhóm a'}});
    const e2=await db.proxyIP.findUniqueOrThrow({where:{id:f.e2.id},include:{identity:true}});expect(e2.groupId).toBe(group.id);expect(e2.identity!.owner).toBe('OTHER');
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{id:f.g.identityId!}})).toMatchObject({owner:'SELF',subgroup:null,ownerDecidedBy:f.userId});
    const ops=await db.operationJournal.findMany({where:{projectId:f.projectId,kind:'PROXY_EDIT'}});expect(ops).toHaveLength(1);
    const same=await apply(f.scope,{items:[{endpointId:f.e2.id,group:{kind:'GROUP',id:group.id}}],idempotencyKey:key()});expect(same.preview.rows[0]).toMatchObject({outcome:'SKIP'});expect(same.result).toBeNull();
    expect(await db.operationJournal.count({where:{projectId:f.projectId,kind:'PROXY_EDIT'}})).toBe(1);
    const replay=await service().commit(f.scope,first.preview.token,(await db.proxyBatch.findFirstOrThrow({where:{token:first.preview.token}})).idempotencyKey);expect(replay.replay).toBe(true);
    await undoOperation(f.scope,ops[0].id,'nhầm nhóm',db);
    const restored=await db.proxyIP.findUniqueOrThrow({where:{id:f.e2.id},include:{identity:true}});expect(restored.groupId).toBeNull();expect(restored.identity!.owner).toBe('SELF');
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{id:f.g.identityId!}})).toMatchObject({owner:'GENJY',ownerDecidedAt:null});
    const back=await apply(f.scope,{items:[{endpointId:f.e2.id,group:{kind:'GROUP',id:group.id}}],idempotencyKey:key()});expect(back.result?.applied).toBe(1);
    const toTut=await apply(f.scope,{items:[{endpointId:f.e2.id,group:{kind:'TUT'}}],idempotencyKey:key()});expect(toTut.result?.applied).toBe(1);expect((await db.proxyIdentity.findUniqueOrThrow({where:{id:f.e2.identityId!}})).owner).toBe('SELF');
  }finally{await f.cleanup();}
});
it('moves a pending plan to a free VM, refuses installed/uncertain/occupied/foreign targets, and undo restores both VMs',async()=>{
  const f=await fixture();try{
    const targets=await listVmTargets(f.scope,db);expect(targets.map(t=>t.serverCode+'/'+t.code+'='+(t.occupant||'free'))).toEqual(['moon1/VM_001='+f.net+'1','moon1/VM_002=free','moon1/VM_003='+f.net+'4','moon2/VM_001='+f.net+'3']);
    await db.vMConfiguration.updateMany({where:{endpointId:f.e4.id},data:{startedAt:new Date()}}); // a hold kept because a real install had started
    const bad=await apply(f.scope,{items:[{endpointId:f.e3.id,location:{kind:'VM',vmId:f.vms.m1_2.id}},{endpointId:f.e4.id,location:{kind:'UNASSIGN'}},{endpointId:f.e1.id,location:{kind:'VM',vmId:f.vms.m2_1.id}},{endpointId:f.g.id,location:{kind:'VM',vmId:f.vms.m1_2.id}},{endpointId:f.e2.id,location:{kind:'VM',vmId:f.vms.m1_2.id}},{endpointId:f.e5.id,location:{kind:'VM',vmId:f.vms.m1_2.id}}],idempotencyKey:key()});
    expect(bad.preview.rows.map(r=>r.outcome)).toEqual(['ERROR','ERROR','ERROR','ERROR','ERROR','ERROR']);
    expect(bad.preview.rows[0].message).toMatch(/đã cài/i);expect(bad.preview.rows[1].message).toMatch(/kiểm tra/i);expect(bad.preview.rows[2].message).toMatch(/đang/i);expect(bad.preview.rows[3].code).toBe('GENJY_RESERVED');expect(bad.preview.rows[4].message).toMatch(/trùng|nhiều proxy/i);expect(bad.preview.rows[5].message).toMatch(/trùng|nhiều proxy/i);
    expect(bad.result).toBeNull();expect(await location(f.e2.id)).toEqual([]);
    const moved=await apply(f.scope,{items:[{endpointId:f.e1.id,location:{kind:'VM',vmId:f.vms.m1_2.id}}],idempotencyKey:key()});
    expect(moved.preview.rows[0]).toMatchObject({field:'LOCATION',outcome:'READY',before:'moon1/VM_001 · Chờ cài',after:'moon1/VM_002'});expect(moved.result?.applied).toBe(1);
    expect(await location(f.e1.id)).toEqual(['moon1/VM_002:DESIRED']);
    const old=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms.m1_1.id}}),target=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms.m1_2.id},include:{desiredConfiguration:{include:{task:true}}}});
    expect(old).toMatchObject({desiredConfigurationId:null,proxySlotState:'BLANK'});expect((await db.vMConfiguration.findUniqueOrThrow({where:{id:f.h1.config.id}})).status).toBe('CANCELLED');expect((await db.vMTask.findUniqueOrThrow({where:{id:f.h1.task.id}})).status).toBe('CANCELLED');
    expect(target.desiredConfiguration).toMatchObject({endpointId:f.e1.id,status:'PLANNED',version:1});expect(target.desiredConfiguration!.task).toMatchObject({status:'PENDING',type:'PROXY_INSTALL'});expect(target.proxySlotState).toBe('FULL');
    const page=await queryRegistry(f.scope,{view:'CURRENT',limit:50,servers:['moon1']},db);expect(page.rows.find(r=>r.ip===f.net+'1')!.locations).toEqual([{serverId:f.vms.m1_2.serverId,serverCode:'moon1',vmId:f.vms.m1_2.id,vmCode:'VM_002',role:'DESIRED'}]);
    const op=await db.operationJournal.findFirstOrThrow({where:{projectId:f.projectId,kind:'PROXY_EDIT'}});await undoOperation(f.scope,op.id,'chuyển nhầm',db);
    expect(await location(f.e1.id)).toEqual(['moon1/VM_001:DESIRED']);expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms.m1_1.id}})).toMatchObject({desiredConfigurationId:f.h1.config.id,proxySlotState:'FULL'});expect((await db.vMConfiguration.findUniqueOrThrow({where:{id:f.h1.config.id}})).status).toBe('PLANNED');
    expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms.m1_2.id}})).toMatchObject({desiredConfigurationId:null});expect((await db.vMConfiguration.findFirstOrThrow({where:{vmId:f.vms.m1_2.id}})).status).toBe('CANCELLED');
    await db.virtualMachine.update({where:{id:f.vms.m1_2.id},data:{archivedAt:new Date()}});
    const archived=await apply(f.scope,{items:[{endpointId:f.e2.id,location:{kind:'VM',vmId:f.vms.m1_2.id}}],idempotencyKey:key()});expect(archived.preview.rows[0]).toMatchObject({outcome:'ERROR'});
  }finally{await f.cleanup();}
});
it('unassigns a pending plan explicitly, refuses a plan whose install has started, and lets a USER without PROXY_IMPORT move VMs but not groups',async()=>{
  const f=await fixture('USER');try{
    const user=await apply(f.scope,{items:[{endpointId:f.e2.id,group:{kind:'NEW',name:'X'}}],idempotencyKey:key()});expect(user.preview.rows[0]).toMatchObject({outcome:'READY'});
    await db.projectMember.update({where:{userId_projectId:{userId:f.userId,projectId:f.projectId}},data:{capabilities:[]}});
    await expect(service().preview({...f.scope,capabilities:[]},{items:[{endpointId:f.e2.id,group:{kind:'TUT'}}],idempotencyKey:key()})).rejects.toMatchObject({code:'FORBIDDEN'});
    const gone=await apply({...f.scope,capabilities:[]},{items:[{endpointId:f.e1.id,location:{kind:'UNASSIGN'}},{endpointId:f.e2.id,location:{kind:'UNASSIGN'}}],idempotencyKey:key()});
    expect(gone.preview.rows.map(r=>[r.outcome,r.before,r.after])).toEqual([['READY','moon1/VM_001 · Chờ cài','Bỏ gán'],['SKIP','Chưa gán','Bỏ gán']]);expect(gone.result).toMatchObject({applied:1,skipped:1});
    expect(await location(f.e1.id)).toEqual([]);expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms.m1_1.id}})).toMatchObject({desiredConfigurationId:null,proxySlotState:'BLANK'});
    const op=await db.operationJournal.findFirstOrThrow({where:{projectId:f.projectId,kind:'PROXY_EDIT'},orderBy:{createdAt:'desc'}});await db.projectMember.update({where:{userId_projectId:{userId:f.userId,projectId:f.projectId}},data:{role:'ADMIN'}});
    await undoOperation({...f.scope,role:'ADMIN'},op.id,'bỏ gán nhầm',db);expect(await location(f.e1.id)).toEqual(['moon1/VM_001:DESIRED']);
    await db.vMConfiguration.update({where:{id:f.h1.config.id},data:{status:'IN_PROGRESS',startedAt:new Date()}});
    const started=await apply({...f.scope,role:'ADMIN'},{items:[{endpointId:f.e1.id,location:{kind:'VM',vmId:f.vms.m1_2.id}}],idempotencyKey:key()});expect(started.preview.rows[0]).toMatchObject({outcome:'ERROR'});expect(started.preview.rows[0].message).toMatch(/bắt đầu/i);
  }finally{await f.cleanup();}
});
it('genjy rows: unassign from a review hold nobody started, retire and restore; group stays genjy and they are never placed on a VM',async()=>{
  const f=await fixture();try{
    // The Sheet import put the genjy proxy on moon1/VM_002 as "Giữ để kiểm tra" with a FAILED, never-started configuration.
    const config=await db.vMConfiguration.create({data:{projectId:f.projectId,vmId:f.vms.m1_2.id,version:1,endpointId:f.g.id,snapshotCipher:encrypt('{}'),configurationHash:'h-'+randomUUID(),createdById:f.userId,status:'FAILED',failureNote:'Giữ chủ sở hữu genjy'}});
    await db.vMProxyAllocation.create({data:{projectId:f.projectId,vmId:f.vms.m1_2.id,endpointId:f.g.id,configurationId:config.id,allocationKey:f.g.inventoryKey!,role:'UNCERTAIN',createdById:f.userId}});
    await db.virtualMachine.update({where:{id:f.vms.m1_2.id},data:{desiredConfigurationId:config.id,configurationSequence:1,proxySlotState:'FULL'}});
    const refused=await apply(f.scope,{items:[{endpointId:f.g.id,group:{kind:'TUT'}},{endpointId:f.g.id,location:{kind:'VM',vmId:f.vms.m1_3.id}}],idempotencyKey:key()});
    expect(refused.preview.rows.map(r=>r.code)).toEqual(['DUPLICATE_INPUT','DUPLICATE_INPUT']);
    const group=await service().preview(f.scope,{items:[{endpointId:f.g.id,group:{kind:'NEW',name:'Nhóm Y'}}],idempotencyKey:key()});expect(group.rows[0]).toMatchObject({outcome:'ERROR',code:'OWNER_CONFLICT'}); // held on a VM: cannot join an operator group
    const toTut=await service().preview(f.scope,{items:[{endpointId:f.g.id,group:{kind:'TUT'}}],idempotencyKey:key()});expect(toTut.rows[0]).toMatchObject({outcome:'READY',after:'TUT'}); // TUT may keep the VM position (preview only)
    const assign=await apply(f.scope,{items:[{endpointId:f.g.id,location:{kind:'VM',vmId:f.vms.m1_3.id}}],idempotencyKey:key()});expect(assign.preview.rows[0]).toMatchObject({outcome:'ERROR',code:'GENJY_RESERVED'});
    const off=await apply(f.scope,{items:[{endpointId:f.g.id,location:{kind:'UNASSIGN'}}],idempotencyKey:key()});
    expect(off.preview.rows[0]).toMatchObject({outcome:'READY',before:'moon1/VM_002 · Giữ để kiểm tra',after:'Bỏ gán'});expect(off.preview.rows[0].message).toContain('chưa gỡ ngoài máy');
    expect(off.result?.applied).toBe(1);expect(await location(f.g.id)).toEqual([]);
    expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms.m1_2.id}})).toMatchObject({desiredConfigurationId:null,proxySlotState:'BLANK'});
    expect((await db.vMConfiguration.findUniqueOrThrow({where:{id:config.id}})).status).toBe('CANCELLED');
    expect(await db.proxyIdentity.findUniqueOrThrow({where:{id:f.g.identityId!}})).toMatchObject({owner:'GENJY'});
    // the freed VM takes a TUT proxy through the same flow
    const move=await apply(f.scope,{items:[{endpointId:f.e1.id,location:{kind:'VM',vmId:f.vms.m1_2.id}}],idempotencyKey:key()});expect(move.result?.applied).toBe(1);expect(await location(f.e1.id)).toEqual(['moon1/VM_002:DESIRED']);
    // undo puts the review hold back
    const op=(await listOperations(f.scope,db)).find(o=>o.batchId===off.result!.batchId)!;
    await expect(undoOperation(f.scope,op.id,'thử',db)).rejects.toMatchObject({code:'STALE_PREVIEW'}); // VM changed since (new plan) → refused
  }finally{await f.cleanup();}
});
it('bulk server move picks free VMs in natural order and reports when the server runs out',async()=>{
  const f=await fixture();try{
    await db.virtualMachine.create({data:{serverId:f.vms.m1_1.serverId,code:'VM_010',managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});
    const r=await apply(f.scope,{items:[{endpointId:f.e2.id,location:{kind:'SERVER',serverId:f.vms.m1_1.serverId}},{endpointId:f.e5.id,location:{kind:'SERVER',serverId:f.vms.m1_1.serverId}},{endpointId:f.e1.id,location:{kind:'SERVER',serverId:f.vms.m1_1.serverId}},{endpointId:f.e3.id,location:{kind:'SERVER',serverId:f.vms.m1_1.serverId}}],idempotencyKey:key()});
    expect(r.preview.rows.map(x=>[x.outcome,x.after])).toEqual([['READY','moon1/VM_002'],['READY','moon1/VM_010'],['SKIP','moon1/VM_001 · Chờ cài'],['ERROR','moon1']]);
    expect(r.result).toMatchObject({applied:2,skipped:1,errors:1});expect(await location(f.e5.id)).toEqual(['moon1/VM_010:DESIRED']);
    const none=await apply(f.scope,{items:[{endpointId:f.e2.id,location:{kind:'SERVER',serverId:f.vms.m2_1.serverId}}],idempotencyKey:key()});expect(none.preview.rows[0]).toMatchObject({outcome:'ERROR'});expect(none.preview.rows[0].message).toMatch(/trống/i);
  }finally{await f.cleanup();}
});
it('parses a pasted Proxy | Server | VM table and matches by proxy identity and VM code, never by row order',async()=>{
  expect(parsePasteMapping('ip | moon1 | VM_002\n\n ip2\tmoon1\tvm_003 \nip3 | | \nip4 | - |\nip5 | moon1 | ')).toEqual([{row:1,proxy:'ip',server:'moon1',vm:'VM_002'},{row:3,proxy:'ip2',server:'moon1',vm:'vm_003'},{row:4,proxy:'ip3',server:'',vm:''},{row:5,proxy:'ip4',server:'-',vm:''},{row:6,proxy:'ip5',server:'moon1',vm:''}]);
  const f=await fixture();try{
    await db.vMConfiguration.updateMany({where:{endpointId:f.e4.id},data:{startedAt:new Date()}}); // e4: install had started → stays with Server/VM
    const text=[f.net+'2 | moon1 | VM_002',f.net+'5:80:u5:secret-5\tMOON1\tvm_003',f.net+'1 | | ',f.net+'4 | - | ','198.18.0.1 | moon1 | VM_002',f.net+'3 | moon1 | ',f.net+'2 | moon2 | VM_001'].join('\n');
    const r=await apply(f.scope,{paste:text,idempotencyKey:key()});
    expect(r.preview.rows.map(x=>[x.row,x.outcome])).toEqual([[1,'ERROR'],[2,'ERROR'],[3,'SKIP'],[4,'ERROR'],[5,'ERROR'],[6,'ERROR'],[7,'ERROR']]);
    expect(r.preview.rows[0].message).toMatch(/nhiều dòng|trùng/i);expect(r.preview.rows[1].message).toMatch(/đang/i);expect(r.preview.rows[4].message).toMatch(/không tìm thấy/i);expect(r.preview.rows[5].message).toMatch(/VM/);expect(r.preview.rows[6].message).toMatch(/nhiều dòng|trùng/i);
    expect(r.result).toBeNull();
    const ok=await apply(f.scope,{paste:f.net+'2 | moon1 | VM_002\n'+f.net+'1 | - |',idempotencyKey:key()});expect(ok.preview.rows.map(x=>[x.outcome,x.after])).toEqual([['READY','moon1/VM_002'],['READY','Bỏ gán']]);expect(ok.result).toMatchObject({applied:2});
    expect(await location(f.e2.id)).toEqual(['moon1/VM_002:DESIRED']);expect(await location(f.e1.id)).toEqual([]);
    const again=await apply(f.scope,{paste:f.net+'2 | moon1 | VM_002\n'+f.net+'1 | - |',idempotencyKey:key()});expect(again.preview.rows.map(x=>x.outcome)).toEqual(['SKIP','SKIP']);expect(again.result).toBeNull();
    expect(await db.operationJournal.count({where:{projectId:f.projectId,kind:'PROXY_EDIT'}})).toBe(1);
  }finally{await f.cleanup();}
});
it('tRPC exposes groups, vmTargets, editPreview and editCommit with revision checks',async()=>{
  const f=await fixture();try{
    const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.userId,memberships:[]},expires:'2099-01-01'}} as any);
    expect(await caller.proxyManagement.groups({projectId:f.projectId})).toEqual([]);
    expect((await caller.proxyManagement.vmTargets({projectId:f.projectId})).map(t=>t.code)).toEqual(['VM_001','VM_002','VM_003','VM_001']);
    const k=key(),preview=await caller.proxyManagement.editPreview({projectId:f.projectId,items:[{endpointId:f.e1.id,location:{kind:'VM',vmId:f.vms.m1_2.id}}],idempotencyKey:k});expect(preview.ready).toBe(1);
    await db.proxyIP.update({where:{id:f.e1.id},data:{revision:{increment:1}}});
    await expect(caller.proxyManagement.editCommit({projectId:f.projectId,token:preview.token,idempotencyKey:k})).rejects.toMatchObject({code:'CONFLICT'});
    const list=await caller.proxyManagement.list({projectId:f.projectId,view:'CURRENT',limit:50,group:'GENJY'});expect(list.rows.map(r=>r.ip)).toEqual([f.net+'9']);
  }finally{await f.cleanup();}
});
