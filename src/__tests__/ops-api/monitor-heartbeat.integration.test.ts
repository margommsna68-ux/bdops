import {afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {businessDB as db,businessFixture} from '../proxy-management/business-fixture';
import {api} from './ops-fixture';
import {createOpsToken,revokeOpsToken} from '@/server/ops-api/tokens';
import {expectConforms} from './openapi-conform';
import {readMonitorHeartbeats,recordMonitorHeartbeat} from '@/server/dashboard/monitor';
import {runWithOpsAuth} from '@/server/ops-api/context';
afterAll(()=>db.$disconnect());
async function fixture(){
 const f=await businessFixture(),serverUuid=randomUUID();
 const prior=process.env.FLEET_MONITOR_CANARY;
 process.env.FLEET_MONITOR_CANARY=JSON.stringify(['AGENT','CENTRAL'].map(source=>({projectId:f.scope.projectId,serverId:f.server.id,serverUuid,source})));
 await db.user.update({where:{id:f.worker.userId},data:{password:await bcrypt.hash('Synthetic-monitor-only',4)}});
 await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{serverScope:'SELECTED',allowedServerIds:[f.server.id]}});
 const t=await createOpsToken(f.scope.userId,{projectId:f.scope.projectId,userId:f.worker.userId,name:'canary-monitor',scopes:['READ','VM_OPS'],expiresInDays:30,pin:'123456'},db);
 const token=t.token!,path='servers/'+f.server.id+'/monitor-heartbeat';
 const body={projectId:f.scope.projectId,source:'AGENT',serverUuid,instanceUuid:randomUUID(),startedAt:new Date(Date.now()-60000).toISOString(),seq:1,configVersion:1,observedAt:new Date(Date.now()-1000).toISOString(),counts:{managed:1,inventory:1,guest:0,proxy:0,app:0}};
 return {...f,token,tokenId:t.id,path,body,cleanup:async()=>{if(prior===undefined)delete process.env.FLEET_MONITOR_CANARY;else process.env.FLEET_MONITOR_CANARY=prior;await db.opsAudit.deleteMany({where:{projectId:f.scope.projectId}});await db.opsToken.deleteMany({where:{userId:f.worker.userId}});await f.cleanup();}};
}
describe('canary monitor HTTP boundaries and bounded snapshots',()=>{
 it('rechecks revoked token and changed member/server rights inside the service transaction, including current replay',async()=>{
  const f=await fixture();try{
   const key=randomUUID(),write=()=>runWithOpsAuth({tokenId:f.tokenId,userId:f.worker.userId,operation:'VM_OPS',targets:{serverId:f.server.id}},()=>recordMonitorHeartbeat(f.worker,f.server.id,key,f.body,db));
   await write();
   await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{allowedServerIds:[]}});
   await expect(write()).rejects.toMatchObject({code:'NOT_FOUND'});
   await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{allowedServerIds:[f.server.id],role:'VIEWER'}});
   await expect(write()).rejects.toMatchObject({code:'FORBIDDEN'});
   await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{role:'USER'}});
   await db.opsToken.update({where:{id:f.tokenId},data:{scopes:['READ']}});
   await expect(write()).rejects.toMatchObject({code:'FORBIDDEN'});
   await db.opsToken.update({where:{id:f.tokenId},data:{scopes:['READ','VM_OPS'],revokedAt:new Date()}});
   await expect(write()).rejects.toMatchObject({reason:'TOKEN_REVOKED'});
   expect(await db.monitorHeartbeat.count({where:{serverId:f.server.id}})).toBe(1);
  }finally{await f.cleanup();}
 });
 it('adds only safe endpoint identity and an address-only fingerprint without reading credentials or implying applied configuration',async()=>{
  const f=await fixture();let configId:string|undefined,endpointId:string|undefined;
  try{
   const p=await db.proxyIP.create({data:{projectId:f.scope.projectId,address:'203.0.113.42:8080',host:'203.0.113.42',port:8080,credentialCipher:'PRIVATE-CREDENTIAL-NEVER-SELECT'}});endpointId=p.id;
   const c=await db.vMConfiguration.create({data:{projectId:f.scope.projectId,vmId:f.vm.id,version:1,endpointId:p.id,snapshotCipher:'PRIVATE-SNAPSHOT-NEVER-SELECT',configurationHash:'not-an-address-fingerprint',createdById:f.scope.userId}});configId=c.id;
   await db.virtualMachine.update({where:{id:f.vm.id},data:{desiredConfigurationId:c.id}});
   const r=await api('GET','gen2-targets?projectId='+f.scope.projectId,{token:f.token});expect(r.status).toBe(200);expectConforms('GET','gen2-targets',r);
   expect(r.json.data.items[0]).toMatchObject({endpointId:p.id,configurationId:c.id,machineUuid:null});
   expect(r.json.data.items[0].proxyAddressFingerprint).toBe('147f2af7c3fb829a1f6614db3bedeacee4a7fbb07819d3634f797942b57650d7');
   expect(r.text).not.toMatch(/PRIVATE-|203\.0\.113\.42|not-an-address-fingerprint/);
  }finally{
   await db.virtualMachine.update({where:{id:f.vm.id},data:{desiredConfigurationId:null}});
   if(configId)await db.vMConfiguration.delete({where:{id:configId}});if(endpointId)await db.proxyIP.delete({where:{id:endpointId}});
   await f.cleanup();
  }
 });
 it('shows delayed heartbeats stale from observedAt and unsupported policy explicitly; replay never renews receipt',async()=>{
  const f=await fixture();try{
   const now=new Date(),key=randomUUID(),body={...f.body,startedAt:new Date(now.getTime()-600000).toISOString(),observedAt:new Date(now.getTime()-180000).toISOString()};
   const first=await api('POST',f.path,{token:f.token,body,key});expect(first.status).toBe(200);
   const replay=await api('POST',f.path,{token:f.token,body,key});expect(replay.json.data.receivedAt).toBe(first.json.data.receivedAt);
   let rows=await readMonitorHeartbeats(f.scope.projectId,[f.server],db,now);expect(rows[0]).toMatchObject({agent:{freshness:'STALE'},central:{freshness:'UNKNOWN'}});
   expect((await api('POST',f.path,{token:f.token,body:{...f.body,seq:2,configVersion:2,startedAt:body.startedAt}})).status).toBe(200);
   rows=await readMonitorHeartbeats(f.scope.projectId,[f.server],db,new Date());expect(rows[0].agent.freshness).toBe('UNSUPPORTED');
   expect(await readMonitorHeartbeats(f.scope.projectId,[],db,now)).toEqual([]);
  }finally{await f.cleanup();}
 });
 it('exposes version 1 and stores Central independently without manufacturing an agent heartbeat',async()=>{
  const f=await fixture();try{
   const p=await api('GET','monitor-policy?projectId='+f.scope.projectId,{token:f.token});expect(p.status).toBe(200);expect(p.json.data.policy).toMatchObject({version:1,healthStaleSeconds:1200,heartbeatStaleSeconds:180});expectConforms('GET','monitor-policy',p);
   const r=await api('POST',f.path,{token:f.token,body:{...f.body,source:'CENTRAL'}});expect(r.status).toBe(200);expectConforms('POST',f.path,r);
   const rows=await db.monitorHeartbeat.findMany({where:{serverId:f.server.id}});expect(rows).toHaveLength(1);expect(rows[0].source).toBe('CENTRAL');expect(rows[0].observedAt.toISOString()).toBe(f.body.observedAt);
   expect(await db.operationJournal.count({where:{projectId:f.scope.projectId}})).toBe(0);
  }finally{await f.cleanup();}
 });
 it('replays only the exact current record and rejects conflicting/older sequences, keys and epochs',async()=>{
  const f=await fixture();try{
   const key=randomUUID(),send=(body:unknown,k=key)=>api('POST',f.path,{token:f.token,body,key:k});
   expect((await send(f.body)).status).toBe(200);
   expect((await send({...f.body,source:'CENTRAL'})).status).toBe(409);
   const before=await db.monitorHeartbeat.findFirstOrThrow({where:{serverId:f.server.id}});
   expect((await send(f.body)).json.data.replay).toBe(true);
   expect((await send({...f.body,counts:{...f.body.counts,guest:1}})).status).toBe(409);
   expect((await send({...f.body,seq:0},randomUUID())).status).toBe(409);
   expect((await send({...f.body,seq:2})).status).toBe(409);
   expect((await send({...f.body,seq:2},randomUUID())).status).toBe(200);
   expect((await send(f.body)).status).toBe(409);
   expect((await send({...f.body,instanceUuid:randomUUID()},randomUUID())).status).toBe(409);
   expect((await send({...f.body,instanceUuid:randomUUID(),startedAt:new Date(Date.now()-10000).toISOString()},randomUUID())).status).toBe(200);
   const after=await db.monitorHeartbeat.findMany({where:{serverId:f.server.id}});expect(after).toHaveLength(1);expect(after[0].receivedAt.getTime()).toBeGreaterThanOrEqual(before.receivedAt.getTime());
  }finally{await f.cleanup();}
 });
 it('requires current server rights, VM_OPS and authoritative configured server UUID, including replay',async()=>{
  const f=await fixture();try{
   const other=await db.server.create({data:{projectId:f.scope.projectId,code:'other-monitor',managed:true}});
   expect((await api('POST','servers/'+other.id+'/monitor-heartbeat',{token:f.token,body:f.body})).status).toBe(404);
   expect((await api('POST',f.path,{token:f.token,body:{...f.body,serverUuid:randomUUID()}})).status).toBe(403);
   const key=randomUUID();expect((await api('POST',f.path,{token:f.token,body:f.body,key})).status).toBe(200);
   await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{allowedServerIds:[]}});
   expect((await api('POST',f.path,{token:f.token,body:f.body,key})).status).toBe(404);
   await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{allowedServerIds:[f.server.id]}});
   await db.opsToken.update({where:{id:f.tokenId},data:{scopes:['READ']}});
   expect((await api('POST',f.path,{token:f.token,body:f.body,key})).status).toBe(403);
   await revokeOpsToken(f.scope.userId,{projectId:f.scope.projectId,tokenId:f.tokenId},db);
   expect((await api('POST',f.path,{token:f.token,body:f.body,key})).status).toBe(401);
  }finally{await f.cleanup();}
 });
 it('rejects absent canary config, bad time/counts/enums and arbitrary secret fields',async()=>{
  const f=await fixture();try{
   for(const extra of [{source:'HOST'},{seq:-1},{error:'password=secret'},{counts:{...f.body.counts,guest:2}},{startedAt:new Date(Date.now()+60000).toISOString()}])expect((await api('POST',f.path,{token:f.token,body:{...f.body,...extra}})).status).toBe(422);
   delete process.env.FLEET_MONITOR_CANARY;
   expect((await api('POST',f.path,{token:f.token,body:f.body})).status).toBe(403);
   expect(await db.monitorHeartbeat.count({where:{serverId:f.server.id}})).toBe(0);
  }finally{await f.cleanup();}
 });
});
