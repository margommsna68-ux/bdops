import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCache, matchTargets, readCaches } from '../cache.mjs';
import { Bridge } from '../bridge.mjs';
import { createApi, readSecret, acquireLock, loadState, saveState } from '../io.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID='7873c1ec-3cfb-4afc-a8ca-30dd89c86d0c';
const T0='2026-10-26T01:00:00.000Z', T1='2026-10-26T02:00:00.000Z', T2='2026-10-26T03:00:00.000Z';
const target=()=>({id:'vm1',serverId:'web1',serverCode:'MOON01',code:'VM_001',machineUuid:UUID,expectedCycle:1,expectedVmRevision:2,configurationId:'cfg1',sdkId:'sdk1',sdkRevision:3});
const cache=()=>({fleet:{schemaVersion:1,kind:'GEN_FLEET_LATEST_V1',servers:[{serverId:'gen1',serverName:'moon-1',vms:[{vmName:'VM_001',vmId:UUID,health:{status:'GREEN',at:T1},income:{state:'GROWING',currentMicros:9990000,at:T1},money:{readable:true,currentMicros:7000000,currency:'USD',at:T0}}]}]},localHealth:{schemaVersion:1,kind:'GEN_HEALTH_LAST_SCAN',serverId:'gen1',hostId:'host1',savedAt:T1,rows:[{vmName:'VM_001',vmUuid:UUID,result:{uuid:UUID,vm:'VM_001',probed_at:T1,vm_state:'RUNNING',guest:{observed_at:T1,earnapp_process_count:1,earnapp:{running:true}},earning_state:'NO_PROOF',income:{state:'GROWING',currentMicros:8250000,deltaMicros:250000,metricType:'ACCOUNT_BALANCE',observedAt:T1}}}]}});
const observations=()=>projectCache(cache(),{now:Date.parse(T2)}).observations;

test('uses individual fresh balance over stale money and ignores GEN2 withdrawal readiness',()=>{
 const [o]=observations();assert.equal(o.money.amount,'8.25');assert.equal(o.money.observedAt,T1);assert.equal(o.earning,true);assert.equal(o.problem,null);
});
test('a newer fleet fault keeps its own clock and is not hidden by older healthy raw data',()=>{
 const c=cache();c.fleet.servers[0].vms[0].health={status:'PROXY_AUTH',at:T2};
 const [o]=projectCache(c,{now:Date.parse(T2)}).observations;
 assert.equal(o.problem,'PROXY_AUTH');assert.equal(o.observedAt,T2);assert.equal(o.earning,false);
});
test('an older fleet fault cannot overwrite a newer verified raw scan',()=>{
 const c=cache();c.fleet.servers[0].vms[0].health={status:'PROXY_AUTH',at:T0};
 const [o]=projectCache(c,{now:Date.parse(T2)}).observations;
 assert.equal(o.problem,null);assert.equal(o.observedAt,T1);assert.equal(o.earning,true);
});
test('NO_PROOF without growth is unknown; fleet GREEN alone is unknown',()=>{
 const c=cache();c.localHealth.rows[0].result.income.state='OBSERVING';c.localHealth.rows[0].result.income.deltaMicros=0;
 assert.equal(projectCache(c,{now:Date.parse(T2)}).observations[0].earning,null);
 delete c.localHealth;assert.equal(projectCache(c,{now:Date.parse(T2)}).observations[0].earning,null);
 // Fleet income.at is a scan completion timestamp, not a precise balance reading.
 assert.equal(projectCache(c,{now:Date.parse(T2)}).observations[0].money.amount,'7');
});
test('remote health money uses baseline plus elapsed, never fleet report completion time',()=>{
 const c=cache();delete c.localHealth;
 Object.assign(c.fleet.servers[0].vms[0].income,{baselineAt:T0,elapsedMs:3600000,currentMicros:8250000});
 c.fleet.servers[0].vms[0].health.reportId='report1';c.fleet.servers[0].vms[0].health.at=T2;
 let o=projectCache(c,{now:Date.parse(T2)}).observations[0];assert.equal(o.money.amount,'8.25');assert.equal(o.money.observedAt,T1);assert.equal(o.earning,null);
 c.diagnostics=[{server:{serverId:'gen1'},reportId:'report1',machines:[{vmId:UUID,vmName:'VM_001',processCount:1,processIds:[123],verifiedGreen:true,incomeState:'GROWING',currentMicros:8250000,deltaMicros:250000,baselineAt:T0,incomeElapsedMs:3600000}]}];
 o=projectCache(c,{now:Date.parse(T2)}).observations[0];assert.equal(o.earning,true);assert.equal(o.observedAt,T1);
 c.diagnostics[0].reportId='old';assert.equal(projectCache(c,{now:Date.parse(T2)}).observations[0].earning,null);
});
test('remote reconstruction outside source report interval is refused',()=>{
 const c=cache();delete c.localHealth;Object.assign(c.fleet.servers[0].vms[0].income,{baselineAt:T1,elapsedMs:99999999});
 assert.equal(projectCache(c,{now:Date.parse(T2)}).observations[0].money.amount,'7');
});
test('server aliases colliding across web server IDs are refused',()=>{
 const other={...target(),id:'vm2',serverId:'web2',serverCode:'MOON-1',machineUuid:'8873c1ec-3cfb-4afc-a8ca-30dd89c86d0c'};
 assert.equal(matchTargets([target(),other],observations()).matches.length,0);
});
test('stopped EarnApp and explicit proxy errors never become healthy',()=>{
 const c=cache();c.localHealth.rows[0].result.guest.earnapp.running=false;
 let o=projectCache(c,{now:Date.parse(T2)}).observations[0];assert.equal(o.problem,'EARNAPP');assert.equal(o.earning,false);
 c.localHealth.rows[0].result.proxy_block_check='BLOCKED';o=projectCache(c,{now:Date.parse(T2)}).observations[0];assert.equal(o.problem,'PROXY_BLOCKED');
});
test('newer unreadable money is not replaced by an older readable value; zero stays zero',()=>{
 const c=cache();c.fleet.servers[0].vms[0].money={readable:false,currentMicros:null,at:T2};
 assert.equal(projectCache(c,{now:Date.parse(T2)}).observations[0].money.amount,null);
 c.fleet.servers[0].vms[0].money={readable:true,currentMicros:0,currency:'USD',at:T2};
 assert.equal(projectCache(c,{now:Date.parse(T2)}).observations[0].money.amount,'0');
});
test('UUID + VM code + normalized server are all required and ambiguity is refused',()=>{
 const o=observations();assert.equal(matchTargets([target()],o).matches.length,1);
 assert.equal(matchTargets([{...target(),code:'VM_002'}],o).matches.length,0);
 assert.equal(matchTargets([{...target(),machineUuid:null}],o).matches.length,0);
 assert.equal(matchTargets([target(),{...target(),id:'vm2'}],o).matches.length,0);
 assert.equal(matchTargets([target()],[...o,{...o[0],serverId:'other'}]).matches.length,0);
 assert.equal(matchTargets([target()],[...o,o[0]]).matches.length,0);
});
function harness({capturedAt=T0,obs=observations(),outcomes=[]}={}){
 const state={version:1,projectId:'p',entries:{},pending:null};let targets=[target()];const calls=[],saves=[];
 const api={get:async()=>({capturedAt,items:targets}),post:async(route,body,key)=>{calls.push({route,body:structuredClone(body),key});const outcome=outcomes.shift();if(outcome instanceof Error)throw outcome;return outcome??{status:200,data:{recorded:{vmId:'vm1',cycle:1,observedAt:body.observedAt}}};}};
 const b=new Bridge({state,projectId:'p',api,readCache:async()=>({observations:obs,rejected:[]}),persist:async s=>saves.push(structuredClone(s)),now:()=>Date.parse(T2)});
 return {b,state,calls,saves,setTargets:v=>{targets=v;},setCapture:v=>{capturedAt=v;}};
}
test('first capture cannot bind old money; following scan can write with captured identity',async()=>{
 const h=harness({capturedAt:T2});await h.b.tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.money,undefined);
 const o=observations();o[0].observedAt='2026-10-26T03:10:00.000Z';o[0].money.observedAt=o[0].observedAt;
 h.b.readCache=async()=>({observations:o,rejected:[]});await h.b.tick();assert.equal(h.calls[1].body.money.capturedAt,T2);assert.equal(h.calls[1].body.money.expectedSdkRevision,3);
});
test('unknown timeout keeps original body/key on replay, persisted before sending',async()=>{
 const h=harness({outcomes:[new Error('secret must not reach journal')]});await h.b.tick();const original=structuredClone(h.state.pending);
 assert.ok(h.saves.some(s=>s.pending?.key===original.key));h.setTargets([{...target(),sdkId:'changed',sdkRevision:9}]);await h.b.tick();
 assert.equal(h.calls[0].key,h.calls[1].key);assert.deepEqual(h.calls[0].body,h.calls[1].body);assert.equal(h.state.pending,null);assert.ok(!JSON.stringify(h.saves).includes('secret must'));
});
test('a refused retry cannot settle an earlier unknown write',async()=>{
 for(const status of [400,404,409,410,422]){
  const h=harness({outcomes:[new Error('timeout'),{status,errorCode:'REVISION_CONFLICT'}]});
  await h.b.tick();const p=structuredClone(h.state.pending);await h.b.tick();
  assert.equal(h.state.pending?.key,p.key);assert.deepEqual(h.state.pending?.body,p.body);
 }
});
test('a non-contract 4xx never discards an in-flight command',async()=>{
 const h=harness({outcomes:[{status:409}]});await h.b.tick();assert.ok(h.state.pending);
});
test('restart replays durable pending without reading targets or rebinding identity',async()=>{
 const h=harness({outcomes:[new Error('timeout')]});await h.b.tick();const saved=structuredClone(h.state),p=structuredClone(saved.pending);let sent;
 const b=new Bridge({state:saved,projectId:'p',api:{get:()=>{throw new Error('must not refresh');},post:async(route,body,key)=>{sent={body,key};return {status:503};}},persist:async()=>{},readCache:()=>{throw new Error('must not reread');}});
 await b.tick();assert.deepEqual(sent,{body:p.body,key:p.key});assert.deepEqual(saved.pending,p);
});

test('failed journal before send prevents HTTP; retry must first make original body durable',async()=>{
 const h=harness();let diskFails=true;
 h.b.persist=async s=>{if(s.pending&&diskFails)throw new Error('disk full');};
 await assert.rejects(()=>h.b.tick());assert.equal(h.calls.length,0);const pending=structuredClone(h.state.pending);
 await assert.rejects(()=>h.b.tick());assert.equal(h.calls.length,0);
 diskFails=false;await h.b.tick();assert.equal(h.calls[0].key,pending.key);assert.deepEqual(h.calls[0].body,pending.body);
});

test('failed acknowledgement journal preserves pending in memory and replays same key',async()=>{
 const h=harness();let diskFails=true;
 h.b.persist=async s=>{if(h.calls.length&&!s.pending&&diskFails)throw new Error('disk full');};
 await assert.rejects(()=>h.b.tick());assert.ok(h.state.pending);const key=h.state.pending.key;
 diskFails=false;await h.b.tick();assert.equal(h.calls[1].key,key);assert.equal(h.state.pending,null);
});

test('new money cannot regress previously recorded health time',async()=>{
 const h=harness();await h.b.tick();const o=observations();o[0].observedAt=T0;o[0].money.observedAt=T2;
 h.b.readCache=async()=>({observations:o});await h.b.tick();assert.equal(h.calls.length,1);assert.equal(h.state.entries.vm1.lastHealthAt,T1);
});
test('conflict drops refused body and recaptures, waiting for a newer scan',async()=>{
 const h=harness({outcomes:[{status:409,errorCode:'REVISION_CONFLICT'}]});await h.b.tick();assert.equal(h.state.pending,null);h.setCapture(T2);await h.b.tick();assert.equal(h.calls.length,1);
});
test('unexplained SDK revision change resets capture rather than rebinding cached money',async()=>{
 const h=harness();await h.b.tick();h.setTargets([{...target(),sdkRevision:4}]);h.setCapture(T2);await h.b.tick();assert.equal(h.state.entries.vm1.capturedAt,T2);assert.equal(h.calls.length,1);
});
test('only explicit acknowledgement revisions allow keeping capture after own write',async()=>{
 const h=harness({outcomes:[{status:200,data:{recorded:{vmId:'vm1',cycle:1,observedAt:T1,vmRevisionAfter:2,sdkRevisionAfter:4}}}]});await h.b.tick();h.setTargets([{...target(),sdkRevision:4}]);h.setCapture(T2);await h.b.tick();assert.equal(h.state.entries.vm1.capturedAt,T0);
});
test('no current SDK produces health only; no cache duplicate posts',async()=>{
 const h=harness();h.setTargets([{...target(),sdkId:null,sdkRevision:null}]);await h.b.tick();await h.b.tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.money,undefined);
});
test('HTTPS exact origin, no redirects, fixed endpoint allowlist and pacing',async()=>{
 const calls=[],waits=[];let now=0;const api=createApi({token:'TEST_SECRET',now:()=>now,sleep:async ms=>{waits.push(ms);now+=ms;},fetchImpl:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({ok:true,data:{items:[]}}),{status:200});}});
 await api.get('/gen2-targets?projectId=p');await api.post('/vms/vm1/scan-observations',{projectId:'p'},'key1');await api.post('/vms/vm1/scan-observations',{projectId:'p'},'key2');
 assert.equal(calls[0].url,'https://wow.lalamail.sbs/api/ops/v1/gen2-targets?projectId=p');assert.equal(calls[0].init.redirect,'error');assert.ok(waits.some(ms=>ms>=2300));
 await assert.rejects(()=>api.get('https://evil.invalid/'));await assert.rejects(()=>api.post('/notify',{},'k'));
});
test('durable files contain no secrets, reload pending, and lock refuses a second process',async()=>{
 const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'.tmp-'+process.pid);await fs.mkdir(root,{recursive:true});
 try{
  const secret=path.join(root,'secret.json');await fs.writeFile(secret,JSON.stringify({token:'TEST_SECRET'}));assert.equal(await readSecret(secret),'TEST_SECRET');
  const unlock=await acquireLock(root);await assert.rejects(()=>acquireLock(root));
  const state={version:1,projectId:'p',entries:{},pending:null};await saveState(root,state);assert.deepEqual(await loadState(root,'p'),state);assert.ok(!(await fs.readFile(path.join(root,'state.json'),'utf8')).includes('TEST_SECRET'));await unlock();
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('raw cached report follows the per-agent latest pointer; traversal is refused',async()=>{
 const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'.tmp-cache-'+process.pid);
 const c=cache();delete c.localHealth;const sid='9873c1ec-3cfb-4afc-a8ca-30dd89c86d0c';c.fleet.servers[0].serverId=sid;
 const vm=c.fleet.servers[0].vms[0];vm.health.reportId='r1';Object.assign(vm.income,{baselineAt:T0,elapsedMs:3600000});
 const dir=path.join(root,'data/diagnostics/inbox',sid);
 try{
  await fs.mkdir(dir,{recursive:true});await fs.mkdir(path.join(root,'data/fleet'),{recursive:true});
  await fs.writeFile(path.join(root,'data/fleet/fleet-latest.json'),JSON.stringify(c.fleet));
  await fs.writeFile(path.join(dir,'latest.json'),JSON.stringify({serverId:sid,reportId:'r1',fileName:'AS-r1.json'}));
  await fs.writeFile(path.join(dir,'AS-r1.json'),JSON.stringify({server:{serverId:sid},reportId:'r1',machines:[{vmId:UUID,vmName:'VM_001',processCount:1,processIds:[123],verifiedGreen:true,incomeState:'GROWING',deltaMicros:1000,baselineAt:T0,incomeElapsedMs:3600000}]}));
  assert.equal((await readCaches(root,{now:Date.parse(T2)})).observations[0].earning,true);
  await fs.writeFile(path.join(dir,'latest.json'),JSON.stringify({serverId:sid,reportId:'r1',fileName:'../AS-r1.json'}));
  assert.equal((await readCaches(root,{now:Date.parse(T2)})).observations[0].earning,null);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('cache credentials and API extra fields never enter command or journal',async()=>{
 const c=cache();c.fleet.token='DO_NOT_PERSIST';c.localHealth.rows[0].result.proxy_observation={credentials:'DO_NOT_PERSIST'};
 const h=harness({obs:projectCache(c,{now:Date.parse(T2)}).observations});h.setTargets([{...target(),token:'DO_NOT_PERSIST'}]);
 await h.b.tick();assert.ok(!JSON.stringify(h.saves).includes('DO_NOT_PERSIST'));assert.ok(!JSON.stringify(h.calls).includes('DO_NOT_PERSIST'));
});
