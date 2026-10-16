import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {queryRegistry,copyProxyEndpoint} from '@/server/proxy-management/history';
import {archiveGroup,createGroup,listGroups,renameGroup} from '@/server/proxy-management/groups';
import {createProxyEditService} from '@/server/proxy-management/edits';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {undoOperation} from '@/server/operation-history/undo';
import type {ActorScope} from '@/server/proxy-management/types';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
const key=()=>'retire-'+randomUUID();
// moon1: VM_001 holds e1 (Chờ cài, chưa bắt đầu), VM_002 free; moon2/VM_001 has e3 installed. e2/e5 unassigned TUT, g genjy.
async function fixture(role:'ADMIN'|'USER'='ADMIN'){
  const projectId=randomUUID(),userId=randomUUID(),ids:string[]=[],net='203.1.'+(1+Math.floor(Math.random()*250))+'.';
  await db.project.create({data:{id:projectId,code:projectId,name:'Retire fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
  await db.projectMember.create({data:{projectId,userId,role,allowedModules:['INFRASTRUCTURE'],capabilities:['COPY_CREDENTIALS','PROXY_IMPORT']}});
  const servers:Record<string,{id:string}>={};for(const code of ['moon1','moon2']) servers[code]=await db.server.create({data:{projectId,code,managed:true}});
  const vm=async(server:string,code:string)=>db.virtualMachine.create({data:{serverId:servers[server].id,code,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});
  const vms={m1_1:await vm('moon1','VM_001'),m1_2:await vm('moon1','VM_002'),m2_1:await vm('moon2','VM_001')};
  const endpoint=async(ip:string,o:{owner?:'SELF'|'GENJY';state?:'NEW'|'LIVE'|'BLOCKED'}={})=>{
    const identity=await db.proxyIdentity.create({data:{ip,owner:o.owner||'SELF'}});ids.push(identity.id);
    return db.proxyIP.create({data:{projectId,identityId:identity.id,address:ip+':80',host:ip,port:80,credentialCipher:encrypt(JSON.stringify({username:'u'+ip.split('.')[3],password:'secret-'+ip.split('.')[3]})),packageCode:'231243',inventoryState:o.state||'NEW',status:o.state==='BLOCKED'?'BLOCKED':'AVAILABLE',inventoryKey:identity.id,statusAt:new Date('2026-10-14T00:00:00Z')}});
  };
  const hold=async(endpointId:string,vmId:string,role:'DESIRED'|'INSTALLED')=>{
    const config=await db.vMConfiguration.create({data:{projectId,vmId,version:1,endpointId,snapshotCipher:encrypt('{}'),configurationHash:'h-'+randomUUID(),createdById:userId,status:role==='INSTALLED'?'CONFIRMED':'PLANNED'}});
    const ep=await db.proxyIP.findUniqueOrThrow({where:{id:endpointId}});const h=await db.vMProxyAllocation.create({data:{projectId,vmId,endpointId,configurationId:config.id,allocationKey:ep.inventoryKey!,role,createdById:userId}});
    await db.vMTask.create({data:{vmId,configurationId:config.id,type:'PROXY_INSTALL',title:'Cài proxy',scheduledAt:new Date(),status:role==='INSTALLED'?'COMPLETED':'PENDING'}});
    await db.virtualMachine.update({where:{id:vmId},data:{desiredConfigurationId:config.id,installedConfigurationId:role==='INSTALLED'?config.id:null,proxyId:role==='INSTALLED'?endpointId:null,configurationSequence:1,proxySlotState:'FULL'}});return {config,hold:h};
  };
  const e1=await endpoint(net+'1'),e2=await endpoint(net+'2'),e3=await endpoint(net+'3',{state:'LIVE'}),e5=await endpoint(net+'5',{state:'BLOCKED'}),g=await endpoint(net+'9',{owner:'GENJY'});
  const h1=await hold(e1.id,vms.m1_1.id,'DESIRED');await hold(e3.id,vms.m2_1.id,'INSTALLED');
  const snapshot=await db.proxySourceSnapshot.create({data:{projectId,sourceKey:'GENJY',hash:'retire-fixture',scanSucceeded:true}});
  await db.proxySourceReference.create({data:{snapshotId:snapshot.id,identityId:g.identityId!,sourceRef:'Genjy!A1',owner:'GENJY',format:'BARE',hasFullCredentials:false,hasManualMetadata:false}});
  const scope:ActorScope={projectId,userId,role,capabilities:['COPY_CREDENTIALS','PROXY_IMPORT']};
  const cleanup=async()=>{await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});await db.vMConfiguration.deleteMany({where:{projectId}});await db.virtualMachine.deleteMany({where:{server:{projectId}}});await db.server.deleteMany({where:{projectId}});await db.auditLog.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyGroup.deleteMany({where:{projectId}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});await db.projectMember.deleteMany({where:{projectId}});await db.project.deleteMany({where:{id:projectId}});await db.user.deleteMany({where:{id:userId}});};
  return {projectId,userId,scope,net,vms,e1,e2,e3,e5,g,h1,cleanup};
}
const service=()=>createProxyEditService(db);
async function apply(scope:ActorScope,input:Parameters<ReturnType<typeof service>['preview']>[1]){const s=service();const preview=await s.preview(scope,input);return {preview,result:preview.ready?await s.commit(scope,preview.token,input.idempotencyKey):null};}
const ips=async(scope:ActorScope,view:'CURRENT'|'HISTORY')=>(await queryRegistry(scope,{view,limit:100},db)).rows.map(r=>r.ip).sort();
const holds=async(endpointId:string)=>(await db.vMProxyAllocation.findMany({where:{endpointId,releasedAt:null}})).length;

it('retires rows (single and bulk, one reason) keeping IP/credentials/ownership/history, hides them from the current view, blocks re-import, restores and undoes',async()=>{
  const f=await fixture();try{
    const r=await apply(f.scope,{items:[{endpointId:f.e2.id,manage:{kind:'RETIRE',reason:'Hết hạn không gia hạn'}},{endpointId:f.e5.id,manage:{kind:'RETIRE',reason:'Hết hạn không gia hạn'}},{endpointId:f.g.id,manage:{kind:'RETIRE',reason:'x'}}],idempotencyKey:key()});
    expect(r.preview.rows.map(x=>[x.field,x.outcome,x.before,x.after])).toEqual([['STATE','READY','NEW','Ngừng quản lý'],['STATE','READY','BLOCKED','Ngừng quản lý'],['STATE','ERROR','genjy','Ngừng quản lý']]);
    expect(r.result).toMatchObject({applied:2,errors:1});
    const e2=await db.proxyIP.findUniqueOrThrow({where:{id:f.e2.id},include:{identity:true}});
    expect(e2).toMatchObject({inventoryState:'RETIRED',credentialCipher:expect.any(String),packageCode:'231243'});expect(e2.retiredAt).toBeTruthy();expect(e2.identity!.owner).toBe('SELF');
    expect(await ips(f.scope,'CURRENT')).toEqual([f.net+'1',f.net+'3',f.net+'9']);expect(await ips(f.scope,'HISTORY')).toEqual([f.net+'2',f.net+'5']);
    const page=await queryRegistry(f.scope,{view:'HISTORY',limit:100},db);expect(page.rows.find(x=>x.ip===f.net+'2')).toMatchObject({state:'RETIRED',locations:[]});
    expect((await copyProxyEndpoint(f.scope,f.e2.id,db)).proxy).toBe(f.net+'2:80:u2:secret-2'); // credentials kept
    const events=await db.proxyStatusEvent.findMany({where:{endpointId:f.e2.id,kind:'RETIRED'}});expect(events).toHaveLength(1);expect(events[0].reason).toBe('Hết hạn không gia hạn');
    const batches=createProxyBatchService(db,{refreshSource:async()=>({id:'s',sourceKey:'GENJY',hash:'retire-fixture',fetchedAt:new Date().toISOString(),scanSucceeded:true})});
    const again=await batches.preview(f.scope,{kind:'NEW',text:f.net+'2:80:u2:secret-2',owner:'SELF',idempotencyKey:key()});expect(again.rows[0]).toMatchObject({outcome:'ERROR',code:'HISTORICAL_IP'}); // no duplicate import
    const same=await apply(f.scope,{items:[{endpointId:f.e2.id,manage:{kind:'RETIRE',reason:'again'}}],idempotencyKey:key()});expect(same.preview.rows[0]).toMatchObject({outcome:'SKIP'});expect(same.result).toBeNull();
    const back=await apply(f.scope,{items:[{endpointId:f.e2.id,manage:{kind:'RESTORE'}},{endpointId:f.e1.id,manage:{kind:'RESTORE'}}],idempotencyKey:key()});
    expect(back.preview.rows.map(x=>[x.outcome,x.before,x.after])).toEqual([['READY','Ngừng quản lý','NEW'],['SKIP','NEW','Khôi phục']]);expect(back.result).toMatchObject({applied:1,skipped:1});
    const restored=await db.proxyIP.findUniqueOrThrow({where:{id:f.e2.id}});expect(restored).toMatchObject({inventoryState:'NEW',status:'AVAILABLE',retiredAt:null});
    expect(await ips(f.scope,'CURRENT')).toEqual([f.net+'1',f.net+'2',f.net+'3',f.net+'9']);
    const retireOp=await db.operationJournal.findFirstOrThrow({where:{projectId:f.projectId,kind:'PROXY_EDIT'},orderBy:{createdAt:'asc'}});
    await expect(undoOperation(f.scope,retireOp.id,'thử',db)).rejects.toMatchObject({code:'STALE_PREVIEW'}); // e2 changed since (restored) → refused
    // port streams: another current port of the same IP does not block a restore; a single-IP identity does
    const twin=await db.proxyIP.create({data:{projectId:f.projectId,identityId:f.e5.identityId!,address:f.net+'5:81',host:f.net+'5',port:81,credentialCipher:f.e5.credentialCipher,packageCode:'231243',inventoryState:'NEW',inventoryKey:f.e5.identityId!+':81'}});
    const single=await apply(f.scope,{items:[{endpointId:f.e5.id,manage:{kind:'RESTORE'}}],idempotencyKey:key()});expect(single.preview.rows[0]).toMatchObject({outcome:'ERROR',code:'CURRENT_IP'});
    await db.proxyIdentity.update({where:{id:f.e5.identityId!},data:{allocationMode:'APPROVED_PORT_STREAM'}});
    const e5op=await apply(f.scope,{items:[{endpointId:f.e5.id,manage:{kind:'RESTORE'}}],idempotencyKey:key()});expect(e5op.result?.applied).toBe(1);await db.proxyIP.delete({where:{id:twin.id}});
    const last=await db.operationJournal.findFirstOrThrow({where:{projectId:f.projectId,kind:'PROXY_EDIT'},orderBy:{createdAt:'desc'}});await undoOperation(f.scope,last.id,'nhầm',db);
    expect((await db.proxyIP.findUniqueOrThrow({where:{id:f.e5.id}})).inventoryState).toBe('RETIRED');
  }finally{await f.cleanup();}
});
it('retiring a planned proxy needs explicit plan release and previews the VM; installed plans are refused; undo restores the plan',async()=>{
  const f=await fixture();try{
    const no=await apply(f.scope,{items:[{endpointId:f.e1.id,manage:{kind:'RETIRE',reason:'r'}},{endpointId:f.e3.id,manage:{kind:'RETIRE',reason:'r',releasePlans:true}}],idempotencyKey:key()});
    expect(no.preview.rows[0]).toMatchObject({outcome:'ERROR'});expect(no.preview.rows[0].message).toMatch(/huỷ giao/i);expect(no.preview.rows[1]).toMatchObject({outcome:'ERROR'});expect(no.preview.rows[1].message).toMatch(/đã cài/i);expect(no.result).toBeNull();
    const yes=await apply(f.scope,{items:[{endpointId:f.e1.id,manage:{kind:'RETIRE',reason:'Nhà cung cấp thu hồi',releasePlans:true}}],idempotencyKey:key()});
    expect(yes.preview.rows[0]).toMatchObject({outcome:'READY',before:'NEW'});expect(yes.preview.rows[0].message).toMatch(/moon1\/VM_001/);expect(yes.result?.applied).toBe(1);
    expect(await holds(f.e1.id)).toBe(0);expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms.m1_1.id}})).toMatchObject({desiredConfigurationId:null,proxySlotState:'BLANK'});expect((await db.vMConfiguration.findUniqueOrThrow({where:{id:f.h1.config.id}})).status).toBe('CANCELLED');
    const op=await db.operationJournal.findFirstOrThrow({where:{projectId:f.projectId,kind:'PROXY_EDIT'}});await undoOperation(f.scope,op.id,'nhầm',db);
    expect(await holds(f.e1.id)).toBe(1);expect((await db.proxyIP.findUniqueOrThrow({where:{id:f.e1.id}})).inventoryState).toBe('NEW');expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms.m1_1.id}})).toMatchObject({desiredConfigurationId:f.h1.config.id,proxySlotState:'FULL'});
    await db.projectMember.update({where:{userId_projectId:{userId:f.userId,projectId:f.projectId}},data:{role:'USER',capabilities:[]}});
    await expect(service().preview(f.scope,{items:[{endpointId:f.e2.id,manage:{kind:'RETIRE',reason:'r'}}],idempotencyKey:key()})).rejects.toMatchObject({code:'FORBIDDEN'});
  }finally{await f.cleanup();}
});
it('groups rename by id (links kept, duplicates refused, undo) and archive without moving proxies to TUT',async()=>{
  const f=await fixture();try{
    const a=await createGroup(f.scope,'Nhóm A',db),b=await createGroup(f.scope,'Nhóm B',db);
    await apply(f.scope,{items:[{endpointId:f.e2.id,group:{kind:'GROUP',id:a.id}}],idempotencyKey:key()});
    await expect(renameGroup(f.scope,a.id,' nhóm  b ',db)).rejects.toMatchObject({code:'DUPLICATE_INPUT'});
    await expect(renameGroup(f.scope,a.id,'TUT',db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(await renameGroup(f.scope,a.id,' Khách  A ',db)).toMatchObject({id:a.id,name:'Khách A'});
    const page=await queryRegistry(f.scope,{view:'CURRENT',limit:100,group:a.id},db);expect(page.rows.map(r=>r.ip)).toEqual([f.net+'2']);expect(page.rows[0]).toMatchObject({groupId:a.id,groupName:'Khách A',owner:'OTHER'});
    const rename=await db.operationJournal.findFirstOrThrow({where:{projectId:f.projectId,kind:'GROUP'}});await undoOperation(f.scope,rename.id,'tên cũ',db);expect((await db.proxyGroup.findUniqueOrThrow({where:{id:a.id}})).name).toBe('Nhóm A');
    await renameGroup(f.scope,a.id,'Khách A',db);
    await archiveGroup(f.scope,a.id,true,db);
    expect((await listGroups(f.scope,db)).map(g=>[g.name,!!g.archivedAt])).toEqual([['Khách A',true],['Nhóm B',false]]);
    expect((await listGroups(f.scope,db,{activeOnly:true})).map(g=>g.name)).toEqual(['Nhóm B']);
    const still=await db.proxyIP.findUniqueOrThrow({where:{id:f.e2.id},include:{identity:true}});expect(still.groupId).toBe(a.id);expect(still.identity!.owner).toBe('OTHER');
    const move=await apply(f.scope,{items:[{endpointId:f.e5.id,group:{kind:'GROUP',id:a.id}}],idempotencyKey:key()});expect(move.preview.rows[0]).toMatchObject({outcome:'ERROR'});expect(move.preview.rows[0].message).toMatch(/lưu trữ/i);
    await archiveGroup(f.scope,a.id,false,db);expect((await listGroups(f.scope,db,{activeOnly:true})).map(g=>g.name)).toEqual(['Khách A','Nhóm B']);
    expect(await db.operationJournal.count({where:{projectId:f.projectId,kind:'GROUP'}})).toBe(4);
    await db.projectMember.update({where:{userId_projectId:{userId:f.userId,projectId:f.projectId}},data:{role:'USER'}});
    await expect(renameGroup(f.scope,b.id,'X',db)).rejects.toMatchObject({code:'FORBIDDEN'});
  }finally{await f.cleanup();}
});
