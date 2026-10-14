import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {persistSourceSnapshot} from '@/server/proxy-management/sources';
import {testClient} from './db-fixture';
import type {ActorScope,SourceSnapshot} from '@/server/proxy-management/types';
const db=testClient();afterAll(()=>db.$disconnect());
async function fixture(){
  const projectId=randomUUID(),userId=randomUUID();
  await db.project.create({data:{id:projectId,code:projectId,name:'Fixture',settings:{businessMode:'PROXY_VM'}}});
  await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
  await db.projectMember.create({data:{userId,projectId,role:'ADMIN'}});
  await db.proxyProviderAccount.create({data:{projectId,code:'fixture',label:'Fixture',credentialCipher:encrypt(JSON.stringify({username:'u',password:'secret'}))}});
  const scope:ActorScope={userId,projectId,role:'ADMIN',capabilities:[]};
  let source:SourceSnapshot={id:randomUUID(),sourceKey:'GENJY',hash:'empty-fixture',fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[]};
  let fault=false;
  const service=createProxyBatchService(db,{refreshSource:async()=>persistSourceSnapshot(projectId,{...source,id:randomUUID(),fetchedAt:new Date().toISOString()},db),afterEvent:()=>{if(fault) throw new Error('Injected rollback');}});
  const importIP=async(ip:string,owner:'SELF'|'GENJY'='SELF')=>{
    const key=randomUUID(),preview=await service.preview(scope,{kind:'NEW',text:ip+':80:u:secret',owner,idempotencyKey:key});return service.commit(scope,preview.token,key);
  };
  const cleanup=async()=>{
    const identities=await db.proxyIdentity.findMany({where:{OR:[{endpoints:{some:{projectId}}},{sourceRefs:{some:{snapshot:{projectId}}}}]},select:{id:true}});
    await db.auditLog.deleteMany({where:{projectId}});await db.proxyReplacement.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await db.projectMember.deleteMany({where:{projectId}});await db.project.delete({where:{id:projectId}});await db.user.delete({where:{id:userId}});await db.proxyIdentity.deleteMany({where:{id:{in:identities.map(i=>i.id)}}});
  };
  return {scope,service,importIP,cleanup,setSource:(next:SourceSnapshot)=>{source=next;},setFault:(value:boolean)=>{fault=value;}};
}
it('import -> block -> replace inherits credentials, dates and replays without extra events',async()=>{
  const f=await fixture();try{
    await f.importIP('192.0.2.82');
    const blockKey=randomUUID(),blocked=await f.service.preview(f.scope,{kind:'BLOCKED',text:'192.0.2.82',idempotencyKey:blockKey});await f.service.commit(f.scope,blocked.token,blockKey);
    const old=await db.proxyIP.findFirstOrThrow({where:{projectId:f.scope.projectId,host:'192.0.2.82'}});
    const repeated=await f.service.preview(f.scope,{kind:'BLOCKED',text:'192.0.2.82',idempotencyKey:randomUUID()});expect(repeated.skipped).toBe(1);expect((await db.proxyIP.findUniqueOrThrow({where:{id:old.id}})).statusAt).toEqual(old.statusAt);
    const key=randomUUID(),preview=await f.service.preview(f.scope,{kind:'REPLACE',removedText:'192.0.2.82',addedText:'198.51.100.82',receivedDate:'2026-10-14',idempotencyKey:key});expect(preview.ready).toBe(1);expect(JSON.stringify(preview)).not.toContain('secret');
    const result=await f.service.commit(f.scope,preview.token,key);const eventCount=await db.proxyStatusEvent.count({where:{projectId:f.scope.projectId}});
    const replay=await f.service.commit(f.scope,preview.token,key);expect(replay).toMatchObject({replay:true,batchId:result.batchId,applied:1});expect(await db.proxyStatusEvent.count({where:{projectId:f.scope.projectId}})).toBe(eventCount);
    const rows=await db.proxyIP.findMany({where:{projectId:f.scope.projectId},orderBy:{host:'asc'}});expect(rows.map(r=>r.inventoryState)).toEqual(['REPLACED','NEW']);
    expect((await db.proxyReplacement.findFirstOrThrow({where:{projectId:f.scope.projectId}})).receivedDate?.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    const receipt=await f.service.preview(f.scope,{kind:'REPLACE',removedText:'192.0.2.82',addedText:'198.51.100.82',receivedDate:'2026-10-14',idempotencyKey:randomUUID()});expect(receipt.skipped).toBe(1);
    await expect(f.service.preview(f.scope,{kind:'NEW',text:'198.51.100.99:80:u:secret',idempotencyKey:key})).rejects.toMatchObject({code:'KEY_PAYLOAD_MISMATCH'});
  }finally{await f.cleanup();}
});
it('competing different batches create one physical proxy and one applied journal',async()=>{
  const f=await fixture();try{
    const k1=randomUUID(),k2=randomUUID();const p1=await f.service.preview(f.scope,{kind:'NEW',text:'192.0.2.83:80:u:secret',idempotencyKey:k1});const p2=await f.service.preview(f.scope,{kind:'NEW',text:'192.0.2.83:80:u:secret',idempotencyKey:k2});
    const results=await Promise.allSettled([f.service.commit(f.scope,p1.token,k1),f.service.commit(f.scope,p2.token,k2)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await db.proxyIP.count({where:{projectId:f.scope.projectId}})).toBe(1);expect(await db.proxyBatch.count({where:{projectId:f.scope.projectId,status:'APPLIED'}})).toBe(1);
  }finally{await f.cleanup();}
});
it('an error after event creation rolls the whole write back; expiry and changed revisions reject commits',async()=>{
  const f=await fixture();try{
    const key=randomUUID(),p=await f.service.preview(f.scope,{kind:'NEW',text:'192.0.2.84:80:u:secret',idempotencyKey:key});f.setFault(true);await expect(f.service.commit(f.scope,p.token,key)).rejects.toThrow('Injected rollback');
    expect(await db.proxyIP.count({where:{projectId:f.scope.projectId}})).toBe(0);expect(await db.proxyStatusEvent.count({where:{projectId:f.scope.projectId}})).toBe(0);expect((await db.proxyBatch.findUniqueOrThrow({where:{token:p.token}})).status).toBe('PREVIEW');f.setFault(false);
    await f.service.commit(f.scope,p.token,key);
    const blockKey=randomUUID(),block=await f.service.preview(f.scope,{kind:'BLOCKED',text:'192.0.2.84',idempotencyKey:blockKey});await db.proxyIP.updateMany({where:{projectId:f.scope.projectId},data:{revision:{increment:1}}});await expect(f.service.commit(f.scope,block.token,blockKey)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    const expKey=randomUUID(),expired=await f.service.preview(f.scope,{kind:'NEW',text:'192.0.2.85:80:u:secret',idempotencyKey:expKey});await db.proxyBatch.update({where:{token:expired.token},data:{expiresAt:new Date(0)}});await expect(f.service.commit(f.scope,expired.token,expKey)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  }finally{await f.cleanup();}
});
it('same Genjy bare completion stays Genjy after VOID; manual metadata and source changes cannot bypass checks',async()=>{
  const f=await fixture();try{
    await f.importIP('192.0.2.86','GENJY');const blockKey=randomUUID(),block=await f.service.preview(f.scope,{kind:'BLOCKED',text:'192.0.2.86',idempotencyKey:blockKey});await f.service.commit(f.scope,block.token,blockKey);
    const source:SourceSnapshot={id:randomUUID(),sourceKey:'GENJY',hash:'bare-genjy',fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[{sourceRef:'fixture/tab/A1',ip:'198.51.100.86',owner:'GENJY',subgroup:null,format:'BARE',hasFullCredentials:false,hasManualMetadata:false}]};f.setSource(source);
    const key=randomUUID(),p=await f.service.preview(f.scope,{kind:'REPLACE',removedText:'192.0.2.86',addedText:'198.51.100.86',idempotencyKey:key});expect(p.ready).toBe(1);await f.service.commit(f.scope,p.token,key);
    await db.proxyReplacement.updateMany({where:{projectId:f.scope.projectId},data:{status:'VOID'}});expect((await db.proxyIdentity.findUniqueOrThrow({where:{ip:'198.51.100.86'}})).owner).toBe('GENJY');
    const newKey=randomUUID(),newPreview=await f.service.preview(f.scope,{kind:'NEW',text:'192.0.2.87:80:u:secret',idempotencyKey:newKey});f.setSource({...source,hash:'changed-source'});await expect(f.service.commit(f.scope,newPreview.token,newKey)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  }finally{await f.cleanup();}
});
it('Genjy bare IP with manual status evidence cannot be completed by replace',async()=>{
  const f=await fixture();try{
    await f.importIP('192.0.2.96','GENJY');const key=randomUUID(),blocked=await f.service.preview(f.scope,{kind:'BLOCKED',text:'192.0.2.96',idempotencyKey:key});await f.service.commit(f.scope,blocked.token,key);
    f.setSource({id:randomUUID(),sourceKey:'GENJY',hash:'manual-genjy',fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[{sourceRef:'fixture/PC/B1',ip:'198.51.100.96',owner:'GENJY',subgroup:null,format:'BARE',hasFullCredentials:false,hasManualMetadata:true}]});
    const preview=await f.service.preview(f.scope,{kind:'REPLACE',removedText:'192.0.2.96',addedText:'198.51.100.96',idempotencyKey:randomUUID()});
    expect(preview.errors).toBe(1);expect(preview.ready).toBe(0);
    expect(await db.proxyReplacement.count({where:{projectId:f.scope.projectId}})).toBe(0);
    expect((await db.proxyIP.findFirstOrThrow({where:{projectId:f.scope.projectId}})).inventoryState).toBe('BLOCKED');
  }finally{await f.cleanup();}
});
