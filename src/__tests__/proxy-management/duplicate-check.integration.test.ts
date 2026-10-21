import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {createProxyEditService} from '@/server/proxy-management/edits';
import {persistSourceSnapshot} from '@/server/proxy-management/sources';
import {listOperations} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import {freeTestNet,testClient} from './db-fixture';
import type {ActorScope,BatchInput,SourceSnapshot} from '@/server/proxy-management/types';
const db=testClient();afterAll(()=>db.$disconnect());
// Two projects share the global identity table; project B exists only to prove cross-project conflicts stay opaque.
async function fixture(){
  const projectId=randomUUID(),otherId=randomUUID(),userId=randomUUID(),net=await freeTestNet(db,'203.2.'),ip=(n:number)=>net+n;
  for(const [id,name] of [[projectId,'Dup fixture'],[otherId,'Other project']]){await db.project.create({data:{id,code:id,name,settings:{businessMode:'PROXY_VM'}}});}
  await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
  for(const id of [projectId,otherId]){await db.projectMember.create({data:{userId,projectId:id,role:'ADMIN'}});await db.proxyProviderAccount.create({data:{projectId:id,code:'fixture',label:'Fixture',credentialCipher:encrypt(JSON.stringify({username:'u',password:'secret'}))}});}
  const server=await db.server.create({data:{projectId,code:'An-01',managed:true}}),vm=await db.virtualMachine.create({data:{serverId:server.id,code:'VM_001',managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});
  const scope:ActorScope={userId,projectId,role:'ADMIN',capabilities:[]},otherScope:ActorScope={...scope,projectId:otherId};
  let source:SourceSnapshot={id:randomUUID(),sourceKey:'GENJY',hash:'empty-dup',fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[]};
  const service=createProxyBatchService(db,{refreshSource:async(pid)=>persistSourceSnapshot(pid,{...source,id:randomUUID(),fetchedAt:new Date().toISOString()},db)});
  const run=async(input:Omit<BatchInput,'idempotencyKey'>,as:ActorScope=scope)=>{const key=randomUUID();const preview=await service.preview(as,{...input,idempotencyKey:key});return {preview,key,commit:()=>service.commit(as,preview.token,key)};};
  const importIP=async(host:string,owner:'SELF'|'GENJY'='SELF',as:ActorScope=scope)=>(await run({kind:'NEW',text:host+':80:u:secret',owner},as)).commit();
  const block=async(host:string)=>(await run({kind:'BLOCKED',text:host})).commit();
  const endpoint=(host:string,pid=projectId)=>db.proxyIP.findFirstOrThrow({where:{projectId:pid,host},orderBy:{createdAt:'asc'}});
  const cleanup=async()=>{
    const ids=await db.proxyIdentity.findMany({where:{OR:[{endpoints:{some:{projectId:{in:[projectId,otherId]}}}},{sourceRefs:{some:{snapshot:{projectId:{in:[projectId,otherId]}}}}}]},select:{id:true}});
    for(const pid of [projectId,otherId]){await db.vmOpsEvent.deleteMany({where:{projectId:pid}});await db.vmOperation.deleteMany({where:{projectId:pid}});await db.virtualMachine.updateMany({where:{server:{projectId:pid}},data:{proxyId:null}});await db.auditLog.deleteMany({where:{projectId:pid}});await db.operationJournal.deleteMany({where:{projectId:pid}});await db.proxyReplacement.deleteMany({where:{projectId:pid}});await db.proxyStatusEvent.deleteMany({where:{projectId:pid}});await db.proxySourceReference.deleteMany({where:{snapshot:{projectId:pid}}});await db.proxyIP.deleteMany({where:{projectId:pid}});await db.virtualMachine.deleteMany({where:{server:{projectId:pid}}});await db.server.deleteMany({where:{projectId:pid}});await db.proxyBatch.deleteMany({where:{projectId:pid}});await db.proxySourceSnapshot.deleteMany({where:{projectId:pid}});await db.proxyProviderAccount.deleteMany({where:{projectId:pid}});await db.projectMember.deleteMany({where:{projectId:pid}});await db.project.delete({where:{id:pid}});}
    await db.user.delete({where:{id:userId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids.map(i=>i.id)}}});
  };
  return {projectId,otherId,scope,otherScope,ip,vm,service,run,importIP,block,endpoint,cleanup,setSource:(next:SourceSnapshot)=>{source=next;}};
}
const codes=(rows:{outcome:string;code?:string}[])=>rows.map(r=>r.code||r.outcome);
it('new purchase: same IP with another port/password, duplicates and malformed lines are shown per row; only valid rows save, once',async()=>{
  const f=await fixture();try{
    await f.importIP(f.ip(1));const a=await f.endpoint(f.ip(1));await db.virtualMachine.update({where:{id:f.vm.id},data:{proxyId:a.id}});
    const text=[f.ip(1)+':81:other:pass',f.ip(2)+':80:u:secret',f.ip(2)+':8080:u:secret','192.0.2.999:80:u:secret',f.ip(3)+':80:u:secret'].join('\n');
    const {preview,commit}=await f.run({kind:'NEW',text,owner:'SELF'});
    expect(codes(preview.rows)).toEqual(['CURRENT_IP','READY','DUPLICATE_INPUT','INVALID_INPUT','READY']);
    expect(preview).toMatchObject({ready:2,errors:3,duplicates:2,skipped:0});
    expect(preview.rows[0].message).toContain('An-01/VM_001');expect(preview.rows[0].existing).toMatchObject({identityId:a.identityId,state:'NEW',locations:['An-01/VM_001'],foreign:false});
    expect(preview.rows[2].message).toContain('dòng 2');expect(preview.rows[3].message).toContain('hợp lệ');
    expect(JSON.stringify(preview)).not.toContain('secret');expect(JSON.stringify(preview)).not.toContain('other:pass');
    const result=await commit();expect(result.applied).toBe(2);
    const again=await f.service.commit(f.scope,preview.token,(await db.proxyBatch.findUniqueOrThrow({where:{token:preview.token}})).idempotencyKey);expect(again.replay).toBe(true);
    expect(await db.proxyIP.count({where:{projectId:f.projectId}})).toBe(3);expect(await db.proxyIdentity.count({where:{ip:{in:[f.ip(1),f.ip(2),f.ip(3)]}}})).toBe(3);
  }finally{await f.cleanup();}
});
it('IPs that were replaced, BLOCKED, retired or undone are refused with their history, never re-created as NEW',async()=>{
  const f=await fixture();try{
    await f.importIP(f.ip(4));await f.block(f.ip(4));await (await f.run({kind:'REPLACE',removedText:f.ip(4),addedText:f.ip(5)})).commit();
    await f.importIP(f.ip(6));const retired=await f.endpoint(f.ip(6));const edits=createProxyEditService(db);const key=randomUUID();const ep=await edits.preview(f.scope,{items:[{endpointId:retired.id,manage:{kind:'RETIRE',reason:'Hết hạn'}}],idempotencyKey:key});await edits.commit(f.scope,ep.token,key);
    const r7=await (await f.run({kind:'NEW',text:f.ip(7)+':80:u:secret',owner:'SELF'})).commit();const op=(await listOperations(f.scope,db)).find(o=>o.batchId===r7.batchId)!;await undoOperation(f.scope,op.id,'nhập nhầm',db);
    await f.importIP(f.ip(8));await f.block(f.ip(8));
    const {preview}=await f.run({kind:'NEW',text:[4,5,6,7,8].map(n=>f.ip(n)+':90:x:y').join('\n'),owner:'SELF'});
    expect(codes(preview.rows)).toEqual(['HISTORICAL_IP','CURRENT_IP','HISTORICAL_IP','HISTORICAL_IP','CURRENT_IP']);
    expect(preview.rows[0].message).toContain(f.ip(5));expect(preview.rows[2].message).toContain('ngừng quản lý');expect(preview.rows[3].message).toContain('hoàn tác');expect(preview.rows[4].message).toContain('BLOCKED');
    for(const r of preview.rows) expect(r.existing?.identityId).toBeTruthy();
    expect(preview.duplicates).toBe(5);expect(preview.ready).toBe(0);
    expect(await db.proxyIP.count({where:{projectId:f.projectId,inventoryState:'NEW'}})).toBe(1);
  }finally{await f.cleanup();}
});
it('Genjy IPs and their replace chain stay reserved for purchases and for other replacements',async()=>{
  const f=await fixture();try{
    await f.importIP(f.ip(10),'GENJY');await f.block(f.ip(10));
    f.setSource({id:randomUUID(),sourceKey:'GENJY',hash:'bare-'+f.ip(11),fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[{sourceRef:'genjy/tab/A1',ip:f.ip(11),owner:'GENJY',subgroup:null,format:'BARE',hasFullCredentials:false,hasManualMetadata:false}]});
    await (await f.run({kind:'REPLACE',removedText:f.ip(10),addedText:f.ip(11)})).commit();
    const {preview}=await f.run({kind:'NEW',text:[f.ip(10),f.ip(11)].map(h=>h+':80:u:secret').join('\n'),owner:'SELF'});
    expect(codes(preview.rows)).toEqual(['GENJY_RESERVED','GENJY_RESERVED']);expect(preview.rows[0].sourceRefs.length+preview.rows[1].sourceRefs.length).toBeGreaterThan(0);
    await f.importIP(f.ip(12));await f.block(f.ip(12));
    const chain=await f.run({kind:'REPLACE',removedText:[f.ip(12),f.ip(12)].join('\n'),addedText:[f.ip(10),f.ip(11)].join('\n')});
    expect(codes(chain.preview.rows)).toEqual(['HISTORICAL_IP','DUPLICATE_INPUT']);
    expect(await db.proxyReplacement.count({where:{projectId:f.projectId}})).toBe(1);
    expect((await db.proxyIdentity.findUniqueOrThrow({where:{ip:f.ip(11)}})).owner).toBe('GENJY');
  }finally{await f.cleanup();}
});
it('replace pairs: blank, malformed, duplicate or self-referencing lines fail only their own pair and never shift the others',async()=>{
  const f=await fixture();try{
    for(const n of [20,21,22]){await f.importIP(f.ip(n));await f.block(f.ip(n));}
    const first=await f.run({kind:'REPLACE',removedText:[f.ip(20),f.ip(21),f.ip(22)].join('\n')+'\n',addedText:[f.ip(30),'',f.ip(32)].join('\n')});
    expect(first.preview.rows.map(r=>[r.row,r.oldIp,r.newIp||null,r.code||r.outcome])).toEqual([[1,f.ip(20),f.ip(30),'READY'],[2,f.ip(21),null,'COUNT_MISMATCH'],[3,f.ip(22),f.ip(32),'READY']]);
    const second=await f.run({kind:'REPLACE',removedText:[f.ip(20),f.ip(21),f.ip(22),f.ip(21),f.ip(22)].join('\n'),addedText:[f.ip(33),f.ip(33),f.ip(22),f.ip(34),'broken'].join('\n')});
    expect(codes(second.preview.rows)).toEqual(['READY','DUPLICATE_INPUT','CURRENT_IP','DUPLICATE_INPUT','INVALID_INPUT']);
    expect(second.preview.rows[1].message).toContain('dòng 1');expect(second.preview.rows[2].message).toContain('giống');expect(second.preview.rows[3].message).toContain('dòng 2');
    expect(second.preview).toMatchObject({ready:1,duplicates:3,errors:4});
    const result=await first.commit();expect(result.applied).toBe(2);
    expect((await f.endpoint(f.ip(21))).inventoryState).toBe('BLOCKED');expect((await f.endpoint(f.ip(20))).inventoryState).toBe('REPLACED');
    const n30=await f.endpoint(f.ip(30));expect(n30.inventoryState).toBe('NEW');expect(JSON.parse((await import('@/lib/encryption')).decrypt(n30.credentialCipher!))).toEqual({username:'u',password:'secret'});
    await expect(second.commit()).rejects.toMatchObject({code:'STALE_PREVIEW'});
    expect(await db.proxyReplacement.count({where:{projectId:f.projectId}})).toBe(2);
  }finally{await f.cleanup();}
});
it('approved port stream: a new port of the same owner saves with its own key; same port, other owner and single-IP identities are duplicates',async()=>{
  const f=await fixture();try{
    await f.importIP(f.ip(40));const stream=await f.endpoint(f.ip(40));await db.proxyIdentity.update({where:{id:stream.identityId!},data:{allocationMode:'APPROVED_PORT_STREAM'}});
    await f.importIP(f.ip(41));
    const {preview,commit}=await f.run({kind:'NEW',text:[f.ip(40)+':81:u:secret',f.ip(40)+':80:v:w',f.ip(41)+':81:u:secret'].join('\n'),owner:'SELF'});
    expect(codes(preview.rows)).toEqual(['READY','CURRENT_IP','CURRENT_IP']);expect(preview.rows[0].message).toContain('nhiều cổng');
    await commit();
    const ports=await db.proxyIP.findMany({where:{projectId:f.projectId,host:f.ip(40)},orderBy:{port:'asc'}});
    expect(ports.map(p=>[p.port,p.inventoryKey])).toEqual([[80,stream.identityId],[81,stream.identityId+':81']]);
    expect(await db.proxyIdentity.count({where:{ip:f.ip(40)}})).toBe(1);
    const other=await f.run({kind:'NEW',text:f.ip(40)+':82:u:secret',owner:'OTHER',newGroup:{name:'Nhóm X'}});expect(codes(other.preview.rows)).toEqual(['CURRENT_IP']);
    await f.block(f.ip(41));const rep=await f.run({kind:'REPLACE',removedText:f.ip(41),addedText:f.ip(40)+':83:u:secret'});expect(codes(rep.preview.rows)).toEqual(['READY']);await rep.commit();
    expect((await db.proxyIP.findFirstOrThrow({where:{projectId:f.projectId,host:f.ip(40),port:83}})).inventoryKey).toBe(stream.identityId+':83');
  }finally{await f.cleanup();}
});
it('an IP held by another project is refused without revealing where it is',async()=>{
  const f=await fixture();try{
    const otherServer=await db.server.create({data:{projectId:f.otherId,code:'SECRET-SERVER',managed:true}});const otherVm=await db.virtualMachine.create({data:{serverId:otherServer.id,code:'VM_777',managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});
    await f.importIP(f.ip(50),'SELF',f.otherScope);await db.virtualMachine.update({where:{id:otherVm.id},data:{proxyId:(await f.endpoint(f.ip(50),f.otherId)).id}});
    const {preview}=await f.run({kind:'NEW',text:f.ip(50)+':80:u:secret',owner:'SELF'});
    expect(codes(preview.rows)).toEqual(['CURRENT_IP']);expect(preview.rows[0].message).toContain('dự án khác');expect(preview.rows[0].existing).toMatchObject({foreign:true,locations:[]});
    const text=JSON.stringify(preview);expect(text).not.toContain('SECRET-SERVER');expect(text).not.toContain('VM_777');expect(text).not.toContain(f.otherId);
  }finally{await f.cleanup();}
});
