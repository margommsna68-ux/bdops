import {afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {recordGen2Scan,ScanBody} from '@/server/dashboard/scan';
import {readOverview} from '@/server/dashboard/overview';
import bcrypt from 'bcryptjs';
import {createOpsToken} from '@/server/ops-api/tokens';
import {api} from '../ops-api/ops-fixture';
import {recordMonitorHeartbeat} from '@/server/dashboard/monitor';
afterAll(()=>db.$disconnect());
async function fixture(){
 const f=await businessFixture(),uuid=randomUUID(),serverUuid=randomUUID(),prior=process.env.FLEET_MONITOR_CANARY;
 const enrollment=(source:'AGENT'|'CENTRAL')=>({projectId:f.scope.projectId,serverId:f.server.id,source,serverUuid});
 process.env.FLEET_MONITOR_CANARY=JSON.stringify([enrollment('AGENT'),enrollment('CENTRAL')]);
 const updated=await db.virtualMachine.update({where:{id:f.vm.id},data:{notes:'UUID máy: '+uuid,createdAt:new Date(Date.now()-3600000)}});
 const at=new Date(Date.now()-1000).toISOString();
 const b={key:randomUUID(),vmId:f.vm.id,projectId:f.scope.projectId,expectedCycle:1,expectedVmRevision:updated.revision,machineUuid:uuid,configurationId:null,observedAt:at,earning:null,problem:null};
 const pulse=async()=>(await readOverview(f.scope,{month:'2026-10',part:'operations'},db)).operations!.pulse;
 const heartbeat=(source:'AGENT'|'CENTRAL',more:Record<string,unknown>={})=>recordMonitorHeartbeat(f.scope,f.server.id,randomUUID(),{projectId:f.scope.projectId,source,serverUuid,instanceUuid:randomUUID(),startedAt:new Date(Date.now()-600000).toISOString(),seq:1,configVersion:1,observedAt:at,counts:{managed:1,inventory:1,guest:0,proxy:0,app:0},...more},db);
 return {...f,b,at,pulse,heartbeat,cleanup:async()=>{if(prior===undefined)delete process.env.FLEET_MONITOR_CANARY;else process.env.FLEET_MONITOR_CANARY=prior;await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await db.opsAudit.deleteMany({where:{projectId:f.scope.projectId}});await db.opsBatchKey.deleteMany({where:{projectId:f.scope.projectId}});await db.opsToken.deleteMany({where:{userId:f.worker.userId}});await f.cleanup();}};
}
describe('independent bound GEN2 monitor observations',()=>{
 it('requires fresh AGENT contact for enrolled canary GOOD, while preserving nonenrolled legacy evidence',async()=>{
  const f=await fixture();try{
   await recordGen2Scan(f.scope,{...f.b,earning:true},db);
   expect((await f.pulse()).rows[0]).toMatchObject({health:'UNKNOWN',earning:null});
   await f.heartbeat('CENTRAL');
   expect((await f.pulse()).rows[0].health).toBe('UNKNOWN');
   const agent=await f.heartbeat('AGENT',{observedAt:new Date(Date.now()-181000).toISOString()});
   expect((await f.pulse()).rows[0].health).toBe('UNKNOWN');
   await db.monitorHeartbeat.update({where:{serverId_source:{serverId:f.server.id,source:'AGENT'}},data:{observedAt:new Date(f.at),configVersion:2}});
   expect((await f.pulse()).rows[0].health).toBe('UNKNOWN');
   await db.monitorHeartbeat.update({where:{serverId_source:{serverId:f.server.id,source:'AGENT'}},data:{configVersion:1}});
   expect((await f.pulse()).rows[0]).toMatchObject({health:'GOOD',earning:true});
   expect(agent.source).toBe('AGENT');
   delete process.env.FLEET_MONITOR_CANARY;
   await db.monitorHeartbeat.deleteMany({where:{serverId:f.server.id}});
   expect((await f.pulse()).rows[0]).toMatchObject({health:'GOOD',earning:true});
  }finally{await f.cleanup();}
 });
 it.each([null,'EARNAPP'] as const)('selects newer negative proof (%s) independently of newer enclosing inventory',async problem=>{
  const f=await fixture();try{
   await f.heartbeat('AGENT');
   const t=(minutes:number)=>new Date(Date.now()-minutes*60000).toISOString(),proofTrue=t(7),proofFalse=t(3),envelopeFalse=t(2),envelopeCached=t(1);
   await recordGen2Scan(f.scope,{...f.b,observedAt:envelopeFalse,earning:false,problem,earningObservedAt:proofFalse},db);
   await recordGen2Scan(f.scope,{...f.b,key:randomUUID(),observedAt:envelopeCached,earning:true,earningObservedAt:proofTrue,monitor:{configVersion:1,vmState:{observedAt:envelopeCached,state:'RUNNING'}}},db);
   expect((await f.pulse()).rows[0]).toMatchObject({health:problem?'ERROR':'UNKNOWN',earning:false,problem,checkedAt:envelopeCached,earningCheckedAt:proofFalse,monitor:{running:true}});
   // A newer inventory-only envelope is not earning/problem evidence either.
   await recordGen2Scan(f.scope,{...f.b,key:randomUUID()},db);
   expect((await f.pulse()).rows[0]).toMatchObject({health:problem?'ERROR':'UNKNOWN',earning:false,problem,checkedAt:f.at,earningCheckedAt:proofFalse,monitor:{running:true}});
  }finally{await f.cleanup();}
 });
 it('never refreshes cached earning evidence with a fresh native inventory timestamp',async()=>{
  const f=await fixture();try{
   const earningObservedAt=new Date(Date.now()-1201000).toISOString();
   await recordGen2Scan(f.scope,{...f.b,earning:true,earningObservedAt,monitor:{configVersion:1,vmState:{observedAt:f.at,state:'RUNNING'}}},db);
   const row=(await f.pulse()).rows[0];expect(row).toMatchObject({health:'UNKNOWN',earning:null,checkedAt:f.at,earningCheckedAt:earningObservedAt,monitor:{running:true,vmState:'FRESH'}});
   const event=await db.vmOpsEvent.findFirstOrThrow({where:{vmId:f.vm.id}});expect(event.detail).toMatchObject({at:f.at,observedAt:f.at,earningObservedAt});
   for(const time of [new Date().toISOString(),new Date(Date.now()-7200000).toISOString()])await expect(recordGen2Scan(f.scope,{...f.b,key:randomUUID(),earning:true,earningObservedAt:time},db)).rejects.toBeTruthy();
  }finally{await f.cleanup();}
 });
 it('uses the existing generic batch with per-item refusal/replay and no financial permissions',async()=>{
  const f=await fixture();try{
   await db.user.update({where:{id:f.worker.userId},data:{password:await bcrypt.hash('Synthetic-batch-monitor-only',4)}});
   const t=await createOpsToken(f.scope.userId,{projectId:f.scope.projectId,userId:f.worker.userId,name:'monitor-batch',scopes:['READ','VM_OPS'],expiresInDays:30,pin:'123456'},db);
   const {key,vmId,...body}=f.b,path='vms/'+vmId+'/scan-observations';
   const batch={projectId:f.scope.projectId,items:[{path,idempotencyKey:key,body:{...body,monitor:{configVersion:1,vmState:{observedAt:f.at,state:'RUNNING'}}}},{path,idempotencyKey:randomUUID(),body:{...body,monitor:{configVersion:1,guest:{observedAt:f.at,additions:'UNKNOWN',response:'unbounded-secret-error'}}}}]};
   const batchKey=randomUUID(),send=()=>api('POST','batch',{token:t.token,body:batch,key:batchKey});
   const first=await send();expect(first.status).toBe(200);expect(first.json.data.items.map((i:{status:number})=>i.status)).toEqual([200,422]);
   const retry=await send();expect(retry.json.data.items[0].body.data.replay).toBe(true);
   expect(await db.vmOpsEvent.count({where:{vmId}})).toBe(1);expect((await f.pulse()).rows[0]).toMatchObject({health:'UNKNOWN',monitor:{running:true}});
  }finally{await f.cleanup();}
 });
 it('stores source/receipt and complete binding, preserves lifecycle and money; merges lanes by axis source time',async()=>{
  const f=await fixture();try{
   const older=new Date(Date.now()-60000).toISOString();
   await recordGen2Scan(f.scope,{...f.b,monitor:{configVersion:1,guest:{observedAt:older,additions:'PRESENT',response:'RESPONSIVE'}}},db);
   await recordGen2Scan(f.scope,{...f.b,key:randomUUID(),monitor:{configVersion:1,vmState:{observedAt:f.at,state:'RUNNING'}}},db);
   // Late arrival cannot replace the newer VM-state sample.
   await recordGen2Scan(f.scope,{...f.b,key:randomUUID(),observedAt:older,monitor:{configVersion:1,vmState:{observedAt:older,state:'ABORTED'}}},db);
   const p=await f.pulse();expect(p.rows[0]).toMatchObject({health:'UNKNOWN',earning:null,monitor:{vmState:'FRESH',guest:'FRESH',running:true}});
   const e=await db.vmOpsEvent.findFirstOrThrow({where:{vmId:f.vm.id},orderBy:{createdAt:'asc'}});
   expect(e.detail).toMatchObject({at:f.at,observedAt:f.at,projectId:f.scope.projectId,serverId:f.server.id,machineUuid:f.b.machineUuid,cycle:1,vmRevision:f.b.expectedVmRevision,configurationId:null});expect((e.detail as any).receivedAt).toBeTruthy();
   expect(await db.vmOperation.count({where:{vmId:f.vm.id}})).toBe(0);expect(await db.fundTransaction.count({where:{projectId:f.scope.projectId}})).toBe(0);
   expect(p.heartbeats?.[0]).toMatchObject({agent:{freshness:'UNKNOWN'},central:{freshness:'UNKNOWN'}});
  }finally{await f.cleanup();}
 });
 it('rejects future axes, wrong endpoint/configuration provenance, and missing canary; legacy scans still work',async()=>{
  const f=await fixture();try{
   await expect(recordGen2Scan(f.scope,{...f.b,monitor:{configVersion:1,guest:{observedAt:new Date().toISOString(),additions:'UNKNOWN',response:'TIMEOUT'}}},db)).rejects.toBeTruthy();
   await expect(recordGen2Scan(f.scope,{...f.b,monitor:{configVersion:1,proxy:{observedAt:f.at,provenance:'GUEST',endpointId:'wrong',appliedConfigurationId:null,tcp:'OK',auth:'OK',https:'OK'}}},db)).rejects.toBeTruthy();
   delete process.env.FLEET_MONITOR_CANARY;
   await expect(recordGen2Scan(f.scope,{...f.b,monitor:{configVersion:1}},db)).rejects.toMatchObject({code:'FORBIDDEN'});
   await recordGen2Scan(f.scope,f.b,db);expect((await f.pulse()).rows[0].monitor.vmState).toBe('UNKNOWN');
   expect(ScanBody.safeParse({...f.b,key:undefined,vmId:undefined,monitor:{configVersion:1,error:'secret'}}).success).toBe(false);
  }finally{await f.cleanup();}
 });
 it('does not project monitor evidence after revision/UUID changes or an unsupported policy',async()=>{
  const f=await fixture();try{
   await recordGen2Scan(f.scope,{...f.b,monitor:{configVersion:2,vmState:{observedAt:f.at,state:'RUNNING'}}},db);
   expect((await f.pulse()).rows[0].monitor).toMatchObject({vmState:'UNSUPPORTED',running:false});
   await db.virtualMachine.update({where:{id:f.vm.id},data:{revision:{increment:1}}});
   expect((await f.pulse()).rows[0].monitor.vmState).toBe('UNKNOWN');
   await db.virtualMachine.update({where:{id:f.vm.id},data:{notes:null}});
   expect((await f.pulse()).rows[0].checkedAt).toBeNull();
  }finally{await f.cleanup();}
 });
});
