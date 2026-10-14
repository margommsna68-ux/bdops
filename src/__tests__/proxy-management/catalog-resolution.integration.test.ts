import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {saveProviderAccount} from '@/server/proxy-management/catalog-management';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {persistSourceSnapshot} from '@/server/proxy-management/sources';
import {encrypt} from '@/lib/encryption';
import type {ActorScope} from '@/server/proxy-management/types';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
it('registering an unknown package restores only receipts quarantined for package matching',async()=>{
  const projectId=randomUUID(),userId=randomUUID();
  await db.project.create({data:{id:projectId,code:projectId,name:'Catalog fixture',settings:{businessMode:'PROXY_VM'}}});await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});await db.projectMember.create({data:{projectId,userId,role:'ADMIN'}});
  const scope:ActorScope={projectId,userId,role:'ADMIN',capabilities:[]};
  try{
    const service=createProxyBatchService(db,{refreshSource:async()=>persistSourceSnapshot(projectId,{id:randomUUID(),sourceKey:'GENJY',hash:'empty',fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[]},db)});
    const key=randomUUID(),preview=await service.preview(scope,{kind:'NEW',text:'192.0.2.97:80:catalog-u:catalog-secret',idempotencyKey:key});await service.commit(scope,preview.token,key);
    const identity=await db.proxyIdentity.create({data:{ip:'192.0.2.98',owner:'UNKNOWN'}});
    await db.proxyIP.create({data:{projectId,identityId:identity.id,address:'192.0.2.98:80',host:'192.0.2.98',port:80,inventoryState:'QUARANTINED',credentialCipher:encrypt(JSON.stringify({username:'catalog-u',password:'catalog-secret'})),notesCipher:encrypt(JSON.stringify({legacyAddress:'historic row'}))}});
    expect((await db.proxyIP.findFirstOrThrow({where:{projectId,host:'192.0.2.97'}})).inventoryState).toBe('QUARANTINED');
    const result=await saveProviderAccount(scope,{code:'231243',label:'231243',username:'catalog-u',password:'catalog-secret'},db);
    expect(result.resolved).toBe(1);
    expect(await db.proxyIP.findFirstOrThrow({where:{projectId,host:'192.0.2.97'}})).toMatchObject({inventoryState:'NEW',packageCode:'231243'});
    expect(await db.proxyIP.findFirstOrThrow({where:{projectId,host:'192.0.2.98'}})).toMatchObject({inventoryState:'QUARANTINED'});
    expect(JSON.stringify(await db.auditLog.findMany({where:{projectId}}))).not.toContain('catalog-secret');
    await expect(saveProviderAccount(scope,{code:'ambiguous',label:'Duplicate pair',username:'catalog-u',password:'catalog-secret'},db)).rejects.toMatchObject({code:'DUPLICATE_INPUT'});
    await db.projectMember.update({where:{userId_projectId:{userId,projectId}},data:{role:'VIEWER'}});
    await expect(saveProviderAccount(scope,{code:'231243',label:'231243',username:'u',password:'secret'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  }finally{
    const identities=await db.proxyIdentity.findMany({where:{endpoints:{some:{projectId}}},select:{id:true}});
    await db.auditLog.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await db.projectMember.deleteMany({where:{projectId}});await db.project.delete({where:{id:projectId}});await db.user.delete({where:{id:userId}});await db.proxyIdentity.deleteMany({where:{id:{in:identities.map(i=>i.id)}}});
  }
});
