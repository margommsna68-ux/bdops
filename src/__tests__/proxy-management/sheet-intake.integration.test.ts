import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt,decrypt} from '@/lib/encryption';
import {persistSheetSnapshot,persistSourceSnapshot} from '@/server/proxy-management/sources';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import type {ActorScope,SheetSnapshot,SourceSnapshot} from '@/server/proxy-management/types';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
it('encrypted reviewed Sheet snapshot imports once with provenance and unknown receipt dates',async()=>{
  const projectId=randomUUID(),userId=randomUUID();
  await db.project.create({data:{id:projectId,code:projectId,name:'Sheet fixture',settings:{businessMode:'PROXY_VM'}}});
  await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
  await db.projectMember.create({data:{projectId,userId,role:'ADMIN'}});
  await db.proxyProviderAccount.create({data:{projectId,code:'fixture',label:'Fixture',credentialCipher:encrypt(JSON.stringify({username:'u',password:'sheet-secret'}))}});
  const scope:ActorScope={projectId,userId,role:'ADMIN',capabilities:[]};
  const genjy:SourceSnapshot={id:randomUUID(),sourceKey:'GENJY',hash:'sheet-genjy',fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[{sourceRef:'fixture/PC/A1',ip:'192.0.2.94',owner:'GENJY',subgroup:'PC_CHUNG',format:'FULL',hasFullCredentials:true,hasManualMetadata:false}]};
  const snapshot:SheetSnapshot={snapshots:[],rows:[
    {sourceRef:'final!A1',rawValue:'192.0.2.94:80:u:sheet-secret',proxy:{ip:'192.0.2.94',port:80,username:'u',password:'sheet-secret',format:'FULL'},kind:'CURRENT_INVENTORY',owner:'GENJY',subgroup:'PC_CHUNG',vmKey:null,valueState:'FULL'},
    {sourceRef:'Total!A1',rawValue:'192.0.2.95',proxy:{ip:'192.0.2.95',port:null,username:null,password:null,format:'BARE'},kind:'LOOKUP_HISTORY',owner:'UNKNOWN',subgroup:null,vmKey:null,valueState:'UNRESOLVED'},
    {sourceRef:'vt!B1',rawValue:'',proxy:null,kind:'VM',owner:'UNKNOWN',subgroup:null,vmKey:'vt/VM_001',valueState:'BLANK'},
  ]};
  try{
    const ref=await persistSheetSnapshot(projectId,snapshot,db);
    expect(JSON.stringify(ref)).not.toContain('sheet-secret');
    expect(await db.proxyIdentity.count({where:{ip:{in:['192.0.2.94','192.0.2.95']}}})).toBe(0);
    const stored=await db.proxySourceSnapshot.findUniqueOrThrow({where:{id:ref.id}});
    expect(stored.sourceKey).toBe('PERSONAL_SHEET');expect(decrypt(stored.encryptedPayload!)).toContain('vt/VM_001');
    expect((await persistSheetSnapshot(projectId,snapshot,db)).id).toBe(ref.id);
    const service=createProxyBatchService(db,{refreshSource:async()=>persistSourceSnapshot(projectId,{...genjy,id:randomUUID()},db)});
    const key=randomUUID(),preview=await service.preview(scope,{kind:'SHEET',snapshotIds:[ref.id],idempotencyKey:key});
    expect(preview.ready).toBe(1);expect(preview.skipped).toBe(2);
    const changed={...snapshot,rows:snapshot.rows.map((row,index)=>index===0?{...row,proxy:{...row.proxy!,password:'changed'},rawValue:'192.0.2.94:80:u:changed'}:row)};
    await db.proxySourceSnapshot.update({where:{id:ref.id},data:{encryptedPayload:encrypt(JSON.stringify(changed))}});
    await expect(service.commit(scope,preview.token,key)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    expect(await db.proxyIP.count({where:{projectId}})).toBe(0);
    await db.proxySourceSnapshot.update({where:{id:ref.id},data:{encryptedPayload:stored.encryptedPayload}});
    await service.commit(scope,preview.token,key);
    const endpoint=await db.proxyIP.findFirstOrThrow({where:{projectId}});
    expect(endpoint.inventoryState).toBe('LIVE');expect(endpoint.statusAt).toBeNull();
    expect((await db.proxyIdentity.findUniqueOrThrow({where:{id:endpoint.identityId!}})).owner).toBe('GENJY');
    expect(await db.proxyStatusEvent.findFirstOrThrow({where:{projectId,endpointId:endpoint.id}})).toMatchObject({kind:'SHEET_IMPORT',occurredAt:null,sourceRef:'final!A1'});
    expect(await db.proxySourceReference.findFirstOrThrow({where:{snapshotId:ref.id,endpointId:endpoint.id}})).toMatchObject({sourceRef:'final!A1',owner:'GENJY'});
    const replay=await service.preview(scope,{kind:'SHEET',snapshotIds:[ref.id],idempotencyKey:randomUUID()});
    expect(replay.ready).toBe(0);expect(await db.proxyIP.count({where:{projectId}})).toBe(1);
    await expect(service.preview(scope,{kind:'SHEET',snapshotIds:[ref.id,ref.id],idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'INVALID_INPUT'});
  }finally{
    await db.auditLog.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await db.projectMember.deleteMany({where:{projectId}});await db.project.delete({where:{id:projectId}});await db.user.delete({where:{id:userId}});await db.proxyIdentity.deleteMany({where:{ip:{in:['192.0.2.94','192.0.2.95']}}});
  }
});
