import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Bridge} from '../bridge.mjs';
import {createApi,saveState,loadState,batchSize} from '../io.mjs';
import * as io from '../io.mjs';

const T0='2026-10-26T01:00:00.000Z', T1='2026-10-26T02:00:00.000Z';
function fixture(n=3,batchSize=25) {
 const targets=Array.from({length:n},(_,i)=>({id:`vm${i}`,serverId:'s',serverCode:'moon-1',code:`VM_${i}`,machineUuid:`7873c1ec-3cfb-4afc-a8ca-${String(i).padStart(12,'0')}`,expectedCycle:1,expectedVmRevision:2,configurationId:'cfg',sdkId:`sdk${i}`,sdkRevision:3}));
 const obs=targets.map(t=>({uuid:t.machineUuid,serverName:'moon-1',serverId:'g',vmCode:t.code,observedAt:T1,earning:null,problem:null,money:{amount:'1.25',observedAt:T1}}));
 const state={version:1,projectId:'p',entries:{},pending:null},calls=[],saves=[];
 const h={targets,obs,state,calls,saves,outcome:null};
 h.options={state,projectId:'p',batchSize,now:()=>Date.parse(T1),persist:async s=>saves.push(structuredClone(s)),readCache:async()=>{
  assert.ok(saves.some(s=>Object.keys(s.entries).length===n));return {observations:obs};
 },api:{get:async()=>({capturedAt:T0,items:targets}),post:async(route,body,key)=>{
  const call={route,body:structuredClone(body),key};calls.push(call);
  assert.ok(saves.some(s=>JSON.stringify(s).includes(key)),'key/body durable before HTTP');
  if(h.outcome)return h.outcome(call);
  return ack(call);
 }}};
 h.bridge=new Bridge(h.options);return h;
}
function ack(call,change=()=>{}) {
 const items=call.body.items.map((item,index)=>({index,path:item.path,status:200,body:{ok:true,data:{recorded:{id:`event${index}`,vmId:item.path.split('/')[1],cycle:item.body.expectedCycle,observedAt:item.body.observedAt,vmRevisionAfter:2,sdkRevisionAfter:4}}}}));
 change(items);return {status:200,data:{batchKey:call.key,items,summary:{ok:items.length}}};
}

test('batch captures before cache and persists exact per-item money bodies before transport',async()=>{
 const h=fixture();const result=await h.bridge.tick();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].route,'/batch');assert.equal(h.calls[0].body.items.length,3);
 assert.equal(result.saved,3);assert.equal(h.calls[0].body.items[0].body.money.capturedAt,T0);
 assert.equal(new Set(h.calls[0].body.items.map(i=>i.idempotencyKey)).size,3);
 assert.equal(h.state.batches.length,0);
});

test('lost ACK restart resends exact envelope even with a different grouping size',async()=>{
 const h=fixture();h.outcome=()=>{throw Error('timeout');};await h.bridge.tick();const original=structuredClone(h.calls[0]);
 const state=structuredClone(h.state);h.outcome=null;
 const b=new Bridge({...h.options,state,batchSize:2,readCache:async()=>({observations:[]})});await b.tick();
 assert.deepEqual(h.calls[1],original);assert.equal(state.batches.length,0);
});

test('partial result isolates unknown item with original key; independent observations progress',async()=>{
 const h=fixture();h.outcome=call=>ack(call,items=>{items[0]={...items[0],status:503,body:{ok:false,data:null,error:{code:'BUSY',message:'later'}}};});
 assert.equal((await h.bridge.tick()).saved,2);
 const old=h.calls[0].body.items[0];assert.equal(h.state.batches.length,1);
 h.obs[1].observedAt='2026-10-26T02:01:00.000Z';h.obs[1].money.observedAt=h.obs[1].observedAt;
 await h.bridge.tick();assert.deepEqual(h.calls[1].body.items,[old]);
 assert.ok(h.calls.slice(2).some(c=>c.body.items.some(i=>i.path==='vms/vm1/scan-observations')));
 assert.equal(h.state.batches[0].body.items[0].idempotencyKey,old.idempotencyKey);
});

test('refused retry remains unknown and retains money; auth stops before further reads or writes',async()=>{
 const h=fixture();h.outcome=()=>{throw Error('timeout');};await h.bridge.tick();const original=structuredClone(h.calls[0]);
 h.outcome=call=>ack(call,items=>items.forEach(i=>Object.assign(i,{status:409,body:{ok:false,data:null,error:{code:'REVISION_CONFLICT',message:'stale'}}})));
 await h.bridge.tick();assert.equal(h.state.batches.reduce((n,b)=>n+b.body.items.length,0),3);
 assert.deepEqual(h.state.batches.flatMap(b=>b.body.items),original.body.items);
 h.outcome=()=>({status:403});h.bridge.api.get=()=>{throw Error('auth must stop');};
 assert.equal((await h.bridge.tick()).state,'AUTH_REQUIRED');
});

for(const corrupt of ['index','duplicate','path','vm','cycle','time','key','event','revision'])test(`malformed ${corrupt} ACK never confirms observations`,async()=>{
 const h=fixture();h.outcome=call=>{
  const response=ack(call,items=>{
   if(corrupt==='index')items[0].index=99;
   if(corrupt==='duplicate')items[1].index=0;
   if(corrupt==='path')items[0].path='vms/other/scan-observations';
   if(corrupt==='vm')items[0].body.data.recorded.vmId='other';
   if(corrupt==='cycle')items[0].body.data.recorded.cycle=2;
   if(corrupt==='time')items[0].body.data.recorded.observedAt=T0;
   if(corrupt==='event')delete items[0].body.data.recorded.id;
   if(corrupt==='revision')items[0].body.data.recorded.vmRevisionAfter=-1;
  });if(corrupt==='key')response.data.batchKey='wrong';return response;
 };await h.bridge.tick();assert.ok(h.state.batches.some(b=>b.body.items.some(i=>i.path==='vms/vm0/scan-observations')));
 assert.equal(h.state.entries.vm0.lastMoneyAt,null);
});

test('legacy pending is flushed unchanged FIRST without reading cache/targets',async()=>{
 const h=fixture();h.state.pending={key:'gen2-1234',vmId:'old',identity:'old',body:{projectId:'p',expectedCycle:1,observedAt:T0}};
 h.bridge.api.get=()=>{throw Error('legacy first');};h.outcome=()=>({status:503});
 await h.bridge.tick();assert.equal(h.calls[0].route,'/vms/old/scan-observations');assert.equal(h.calls[0].key,'gen2-1234');
});

test('batch size and target count are bounded before any cache read',async()=>{
 for(const batchSize of [0,101,1.5,NaN])assert.throws(()=>fixture(1,batchSize),/BATCH_SIZE_INVALID/);
 const h=fixture(1001);h.bridge.readCache=()=>{throw Error('must not read');};
 assert.equal((await h.bridge.tick()).state,'QUEUE_FULL');assert.equal(h.calls.length,0);
});

test('durable state refuses byte/entry overflow without overwriting last good file',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'batch-state-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const state=fixture().state;await saveState(dir,state);
 await assert.rejects(()=>saveState(dir,{...state,entries:Object.fromEntries(Array.from({length:1001},(_,i)=>[i,{}]))}),/QUEUE_FULL/);
 await assert.rejects(()=>saveState(dir,{...state,padding:'x'.repeat(4*1024*1024)}),/QUEUE_FULL/);
 assert.deepEqual(await loadState(dir,'p'),state);
});

test('batch route only allows bounded same-project scan POST items and conservatively paces mixed traffic',async()=>{
 let now=0;const times=[],calls=[];const api=createApi({token:'synthetic',now:()=>now,sleep:async ms=>{now+=ms;},fetchImpl:async(url,init)=>{
  times.push(now);calls.push({url,init});return new Response(JSON.stringify({ok:true,data:{}}),{status:200});
 }});
 const body={projectId:'p',items:[{method:'POST',path:'vms/vm1/scan-observations',body:{projectId:'p'},idempotencyKey:'gen2-1234'}]};
 await api.post('/batch',body,'outer1');await api.post('/vms/vm1/scan-observations',{projectId:'p'},'single');await api.post('/batch',body,'outer2');
 assert.ok(times[1]-times[0]>=6500);assert.ok(times[2]-times[1]>=6500);
 for(const bad of [[],Array(101).fill(body.items[0]),[{...body.items[0],path:'withdrawals/prepare'}],[{...body.items[0],path:'https://evil.invalid/vms/x/scan-observations'}],[{...body.items[0],method:'GET'}],[{...body.items[0],body:{projectId:'other'}}]])await assert.rejects(()=>api.post('/batch',{projectId:'p',items:bad},'outer'),/ENDPOINT_REFUSED/);
 assert.equal(calls.length,3);assert.equal(calls[0].init.redirect,'error');
});

test('batch size parses optional CLI values with a backward-compatible default',()=>{
 assert.equal(batchSize(),1);assert.equal(batchSize('25'),25);
 for(const value of ['',null,true,'1e2','25.0',' 25 '])assert.throws(()=>batchSize(value),/BATCH_SIZE_INVALID/);
});

test('pending money samples are appended, never coalesced or silently skipped',async()=>{
 const h=fixture(1);h.outcome=()=>{throw Error('lost');};await h.bridge.tick();
 const first=structuredClone(h.calls[0]);h.obs[0].observedAt='2026-10-26T02:01:00.000Z';h.obs[0].money={amount:'2.5',observedAt:h.obs[0].observedAt};
 await h.bridge.tick();const items=h.state.batches.flatMap(b=>b.body.items);
 assert.equal(items.length,2);assert.deepEqual(items[0],first.body.items[0]);assert.equal(items[1].body.money.amount,'2.5');
 await h.bridge.tick();assert.equal(h.state.batches.flatMap(b=>b.body.items).length,2);
});

test('disk failure before HTTP prevents sends, ACK commit failure preserves exact batch across reload',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'batch-crash-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const h=fixture();let fail='capture';
 h.bridge.readCache=async()=>({observations:h.obs});
 h.bridge.persist=async state=>{if(fail==='capture'&&state.batches?.length)throw Error('disk');if(fail==='ack'&&state.batches?.length===0)throw Error('disk');await saveState(dir,state);};
 await assert.rejects(()=>h.bridge.tick(),/disk/);assert.equal(h.calls.length,0);
 fail='ack';// Use real durable journal rather than fixture's recording persist.
 h.options.api.post=async(route,body,key)=>{const call={route,body:structuredClone(body),key};h.calls.push(call);return ack(call);};
 await assert.rejects(()=>h.bridge.tick(),/disk/);assert.equal(h.state.batches.length,1);
 const state=await loadState(dir,'p');const original=h.calls[0];fail=null;
 const b=new Bridge({...h.options,state,persist:s=>saveState(dir,s),readCache:async()=>({observations:[]})});await b.tick();assert.deepEqual(h.calls[1],original);
});

test('a full pending queue fails closed and retains every original money sample',async()=>{
 const h=fixture(1);h.outcome=()=>{throw Error('lost');};await h.bridge.tick();
 const base=h.state.batches[0];h.state.batches=Array.from({length:1000},(_,i)=>{
  const b=structuredClone(base);b.key=`gen2-batch-${i.toString(16)}`;b.body.items[0].idempotencyKey=`gen2-${i.toString(16)}`;return b;
 });const original=structuredClone(h.state.batches);
 h.obs[0].observedAt='2026-10-26T02:01:00.000Z';h.obs[0].money.observedAt=h.obs[0].observedAt;
 assert.equal((await h.bridge.tick()).state,'QUEUE_FULL');assert.deepEqual(h.state.batches,original);
 assert.ok(h.calls.length<=5,'retry work is bounded per tick');
});

test('per-item auth error stops new snapshots while preserving other ACKs',async()=>{
 const h=fixture();h.outcome=call=>ack(call,rows=>Object.assign(rows[0],{status:401,body:{ok:false,data:null,error:{code:'UNAUTHORIZED',message:'no'}}}));
 const result=await h.bridge.tick();assert.equal(result.state,'AUTH_REQUIRED');assert.equal(result.saved,2);assert.equal(h.state.batches.length,1);
});

test('target authentication failure is surfaced as a stop result',async()=>{
 const api=createApi({token:'synthetic',fetchImpl:async()=>new Response(JSON.stringify({ok:false,data:null,error:{code:'UNAUTHORIZED',message:'no'}}),{status:401})});
 const h=fixture();h.bridge.api=api;h.bridge.readCache=()=>{throw Error('auth must stop cache');};
 assert.equal((await h.bridge.tick()).state,'AUTH_REQUIRED');
});

test('batch allowlist validates the exact immutable payload sent after pacing',async()=>{
 let now=0,change=()=>{};const calls=[];
 const api=createApi({token:'synthetic',now:()=>now,sleep:async ms=>{change();now+=ms;},fetchImpl:async(url,init)=>{calls.push(JSON.parse(init.body));return new Response('{"ok":true,"data":{}}');}});
 const body={projectId:'p',items:[{method:'POST',path:'vms/vm1/scan-observations',body:{projectId:'p'},idempotencyKey:'gen2-1234'}]};
 await api.post('/batch',body,'first');change=()=>{body.items[0].path='withdrawals/prepare';};
 await api.post('/batch',body,'second');assert.equal(calls[1].items[0].path,'vms/vm1/scan-observations');
});

test('batch size 100 splits 101 observations without losing item identities',async()=>{
 const h=fixture(101,100);const result=await h.bridge.tick();assert.equal(result.saved,101);
 assert.deepEqual(h.calls.map(c=>c.body.items.length),[100,1]);
});

test('rotating retry budget reaches later unavailable envelopes across restart',async()=>{
 const h=fixture(6,2);h.outcome=call=>ack(call,rows=>{rows[0].status=503;rows[0].body={ok:false,data:null,error:{code:'BUSY',message:'later'}};});await h.bridge.tick();
 // Three singleton survivors plus three more independent unknown envelopes.
 h.state.batches.push(...structuredClone(h.state.batches).map((b,i)=>({...b,key:`gen2-batch-abc${i}`,body:{...b.body,items:b.body.items.map(it=>({...it,idempotencyKey:`gen2-abc${i}`}))}})));
 h.outcome=()=>{throw Error('lost');};h.bridge.readCache=async()=>({observations:[]});
 const keys=h.state.batches.map(b=>b.key);h.calls.length=0;await h.bridge.tick();assert.equal(h.calls.length,1);
 let state=structuredClone(h.state);for(let i=1;i<keys.length;i++){const b=new Bridge({...h.options,state,readCache:async()=>({observations:[]})});await b.tick();state=structuredClone(state);}
 assert.ok(keys.every(key=>h.calls.some(c=>c.key===key)));
});

test('durable batch reload rejects route tampering and secrets instead of resetting pending',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'batch-invalid-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const h=fixture();h.outcome=()=>{throw Error('lost');};await h.bridge.tick();
 await saveState(dir,h.state);assert.deepEqual(await loadState(dir,'p'),h.state);
 const invalid=structuredClone(h.state);invalid.batches[0].body.items[0].path='withdrawals/prepare';
 await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(invalid));await assert.rejects(()=>loadState(dir,'p'),/STATE_UNREADABLE_DO_NOT_RESET/);
 const secret=structuredClone(h.state);secret.batches[0].body.items[0].body.token='synthetic';await assert.rejects(()=>saveState(dir,secret),/STATE_SECRET_REFUSED/);
});

test('optional telemetry CLI parser leaves existing arguments intact and validates exact server IDs',()=>{
 assert.deepEqual(io.parseTelemetryArgs(['--project','p','--batch-size','25','--server','web-moon05','--once']),{args:['--project','p','--once'],batchSize:25,serverId:'web-moon05'});
 assert.deepEqual(io.parseTelemetryArgs(['--once']),{args:['--once'],batchSize:1,serverId:null});
 for(const args of [['--batch-size'],['--batch-size','0'],['--batch-size','25','--batch-size','25'],['--server','s'],['--batch-size','25','--server',''],['--batch-size','25','--server','../s'],['--batch-size','25','--server','s','--server','s']])assert.throws(()=>io.parseTelemetryArgs(args));
});

test('canary filter matches exact web server ID and preserves other server journal entries',async()=>{
 const h=fixture(2);h.targets[1].serverId='other';h.state.entries.untouched={target:{serverId:'other'},lastMoneyAt:T0};
 h.bridge=new Bridge({...h.options,serverId:'s',readCache:async()=>({observations:h.obs})});
 await h.bridge.tick();assert.deepEqual(h.calls[0].body.items.map(i=>i.path),['vms/vm0/scan-observations']);
 assert.equal(h.state.entries.untouched.lastMoneyAt,T0);assert.equal(h.state.entries.vm1,undefined);
 const other=fixture();other.bridge=new Bridge({...other.options,serverId:'S',readCache:async()=>({observations:other.obs})});
 await other.bridge.tick();assert.equal(other.calls.length,0);
});

test('canary refuses legacy or batch pending outside scope before any HTTP',async()=>{
 const h=fixture();h.outcome=()=>{throw Error('lost');};await h.bridge.tick();
 let gets=0;const api={...h.options.api,get:async()=>{gets++;throw Error('must stop');}};
 const b=new Bridge({...h.options,api,serverId:'other'});const calls=h.calls.length;
 assert.equal((await b.tick()).state,'SCOPE_MISMATCH');assert.equal(h.calls.length,calls);assert.equal(gets,0);
 h.state.pending={key:'gen2-1234',vmId:'legacy',identity:JSON.stringify(['s']),body:{projectId:'p'}};
 assert.equal((await b.tick()).state,'SCOPE_MISMATCH');assert.equal(h.calls.length,calls);
});

test('POST auth failures stop even when the server returns a non-JSON page',async()=>{
 for(const status of [401,403]) {
  const api=createApi({token:'synthetic',fetchImpl:async()=>new Response('no',{status})});
  assert.equal((await api.post('/vms/v/scan-observations',{projectId:'p'},'k')).status,status);
 }
});

test('failed state write cleans its temporary file and preserves the durable journal',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'batch-disk-full-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const state=fixture().state;await saveState(dir,state);const original=await fs.readFile(path.join(dir,'state.json'),'utf8'),open=fs.open.bind(fs);
 t.mock.method(fs,'open',async(...args)=>{const handle=await open(...args);return {writeFile:async()=>{throw Error('disk full');},sync:()=>handle.sync(),close:()=>handle.close()};});
 await assert.rejects(()=>saveState(dir,state));assert.deepEqual(await fs.readdir(dir),['state.json']);assert.equal(await fs.readFile(path.join(dir,'state.json'),'utf8'),original);
});

test('oversized persisted journal reports QUEUE_FULL without resetting it',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'batch-load-cap-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'state.json'),'x'.repeat(4*1024*1024+1));await assert.rejects(()=>loadState(dir,'p'),/QUEUE_FULL/);
 assert.equal((await fs.stat(path.join(dir,'state.json'))).size,4*1024*1024+1);
});

test('retry resolves live batch objects after an earlier ACK replaces the queue',async()=>{
 const h=fixture(3,2);h.outcome=()=>({status:401,data:null});
 await h.bridge.tick();assert.equal(h.state.batches.length,2);
 const [a,b]=h.state.batches.map(x=>x.key),original=structuredClone(h.state.batches[1].body);
 assert.equal(h.state.batches[1].attempted,false);
 h.outcome=call=>{if(call.key===a)return ack(call);throw Error('second command committed but response lost');};
 await h.bridge.tick();
 // The one-request retry budget moves B to the next tick, after A's ACK commit.
 await h.bridge.tick();
 const saved=h.saves.at(-1).batches.find(x=>x.key===b);
 assert.equal(saved.attempted,true,'second command attempt is durable after first ACK deep-clones queue');
 assert.deepEqual(saved.body,original);
 h.outcome=call=>ack(call,rows=>{for(const row of rows){row.status=409;row.body={ok:false,data:null,error:{code:'REVISION_CONFLICT',message:'synthetic refusal on retry'}};}});
 await h.bridge.tick();const pending=h.state.batches.find(x=>x.key===b);
 assert.ok(pending,'a refused retry cannot settle an uncertain original write');assert.deepEqual(pending.body,original);
});

for(const size of [1,25])test(`independent acknowledged axis clocks survive inventory-only packets (batch ${size})`,async()=>{
 const h=fixture(1,size);h.obs[0].money=null;
 if(size===1)h.outcome=c=>({status:200,data:{recorded:{id:'event',vmId:'vm0',cycle:1,observedAt:c.body.observedAt,vmRevisionAfter:2,sdkRevisionAfter:3}}});
 h.obs[0].monitor={configVersion:1,guest:{observedAt:T1,additions:'PRESENT',response:'RESPONSIVE'}};
 await h.bridge.tick();assert.equal(h.state.entries.vm0.monitorAcks.guest,T1);
 const newer='2026-10-26T02:01:00.000Z';h.obs[0].observedAt=newer;h.obs[0].monitor={configVersion:1,vmState:{observedAt:newer,state:'RUNNING'}};
 await h.bridge.tick();assert.deepEqual(h.state.entries.vm0.monitorAcks,{guest:T1,vmState:newer});
 h.obs[0].observedAt='2026-10-26T02:02:00.000Z';h.obs[0].monitor={configVersion:1,guest:{observedAt:T0,additions:'UNKNOWN',response:'UNKNOWN'}};
 await h.bridge.tick();assert.equal(h.state.entries.vm0.monitorAcks.guest,T1);
});

test('70 native VMs: one changed axis schedules one row; source-envelope clock alone schedules none',async()=>{
 const h=fixture(70);for(const o of h.obs){o.money=null;o.monitor={configVersion:1,vmState:{observedAt:T1,state:'RUNNING'},guest:{observedAt:T1,additions:'PRESENT',response:'RESPONSIVE'}};}
 await h.bridge.tick();assert.equal(h.calls.flatMap(c=>c.body.items).length,70);h.calls.length=0;
 const t2='2026-10-26T02:00:10.000Z';for(const o of h.obs)o.observedAt=t2;h.obs[9].monitor.guest.observedAt=t2;
 await h.bridge.tick();assert.deepEqual(h.calls.flatMap(c=>c.body.items.map(i=>i.path)),['vms/vm9/scan-observations']);h.calls.length=0;
 for(const o of h.obs)o.observedAt='2026-10-26T02:00:20.000Z';await h.bridge.tick();assert.equal(h.calls.length,0);
});

test('every queued same-identity axis participates in native dedup; newer money and legacy health still publish',async()=>{
 const h=fixture(1);h.obs[0].money=null;h.obs[0].monitor={configVersion:1,vmState:{observedAt:T1,state:'RUNNING'}};h.outcome=()=>{throw Error('lost');};await h.bridge.tick();
 const original=structuredClone(h.state.batches[0]);h.obs[0].observedAt='2026-10-26T02:01:00.000Z';
 h.obs[0].monitor={configVersion:1,guest:{observedAt:h.obs[0].observedAt,additions:'PRESENT',response:'RESPONSIVE'}};await h.bridge.tick();assert.equal(h.state.batches.length,2);
 h.obs[0].observedAt='2026-10-26T02:02:00.000Z';h.obs[0].monitor.vmState={observedAt:T1,state:'RUNNING'};const before=h.state.batches.map(b=>b.key);await h.bridge.tick();assert.deepEqual(h.state.batches.map(b=>b.key),before);assert.deepEqual(h.state.batches[0].body,original.body);
 h.outcome=null;h.obs[0].money={observedAt:h.obs[0].observedAt,amount:'9.00'};await h.bridge.tick();assert.ok(h.calls.at(-1).body.items[0].body.money);
 const legacy=fixture(1);await legacy.bridge.tick();legacy.calls.length=0;legacy.obs[0].observedAt='2026-10-26T02:03:00.000Z';await legacy.bridge.tick();assert.equal(legacy.calls.length,1);
});

test('retry budget permits one original request before fresh capture and rotates fairly across restarts',async()=>{
 const h=fixture(5,2);h.outcome=()=>{throw Error('lost');};await h.bridge.tick();const keys=h.state.batches.map(b=>b.key),bodies=structuredClone(h.state.batches.map(b=>b.body));
 const calls=[];let beforeGet=0;
 h.options.api.post=async(route,body,key,options)=>{calls.push({key,body:structuredClone(body),options});throw Error('retry timeout');};h.options.api.get=async()=>{beforeGet=calls.length;return {capturedAt:T0,items:h.targets};};
 let state=h.state;
 for(let i=0;i<keys.length;i++){const b=new Bridge({...h.options,state,readCache:async()=>({observations:[]})});await b.tick();assert.equal(beforeGet,i+1);state=structuredClone(state);}
 assert.deepEqual(calls.map(c=>c.key),keys);assert.deepEqual(calls.map(c=>c.body),bodies);assert.ok(calls.every(c=>c.options?.timeoutMs===5000));
});

test('monitor config without --server restricts two bindings and preserves unrelated legacy entries and UNKNOWN',async()=>{
 const h=fixture(3);const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 h.targets[1].serverId='second';h.targets[1].serverCode='AN01';h.obs[0].serverId=a;h.obs[1].serverId=b;h.obs[1].serverName='AN01';h.targets[2].serverId='outside';h.targets[2].serverCode='MOON09';h.obs[2].serverName='MOON09';
 h.state.entries.untouched={target:{serverId:'outside'},lastMoneyAt:T0};
 const config={version:1,centralUuid:a,bindings:[{projectId:'p',serverId:'s',serverCode:'MOON01',serverUuid:a},{projectId:'p',serverId:'second',serverCode:'AN01',serverUuid:b}]};
 h.bridge=new Bridge({...h.options,monitorConfig:config,readCache:async()=>({observations:h.obs})});await h.bridge.tick();
 assert.deepEqual(h.calls.flatMap(c=>c.body.items.map(i=>i.path)),['vms/vm0/scan-observations','vms/vm1/scan-observations']);assert.equal(h.state.entries.vm2,undefined);assert.equal(h.state.entries.untouched.lastMoneyAt,T0);
 h.state.pending={key:'gen2-original',vmId:'outside',identity:JSON.stringify(['outside']),body:{projectId:'p',money:{amount:'3'}}};const pending=structuredClone(h.state.pending),n=h.calls.length;
 assert.equal((await h.bridge.tick()).state,'SCOPE_MISMATCH');assert.deepEqual(h.state.pending,pending);assert.equal(h.calls.length,n);
 h.state.pending=null;h.state.batches=[{key:'gen2-batch-original',body:{projectId:'p',items:[{method:'POST',path:'vms/outside/scan-observations',body:{projectId:'p'},idempotencyKey:'gen2-original'}]},events:[{vmId:'outside',identity:JSON.stringify(['outside'])}],attempted:true}];
 const original=structuredClone(h.state.batches);assert.equal((await h.bridge.tick()).state,'SCOPE_MISMATCH');assert.deepEqual(h.state.batches,original);assert.equal(h.calls.length,n);
});

test('older-envelope ACK still credits its independent newer axis after a newer envelope was acknowledged',async()=>{
 const h=fixture(1);h.obs[0].money=null;h.obs[0].monitor={configVersion:1,guest:{observedAt:T1,additions:'PRESENT',response:'RESPONSIVE'}};
 h.outcome=()=>{throw Error('lost');};await h.bridge.tick();const original=h.state.batches[0].key;
 const newer='2026-10-26T02:01:00.000Z';h.obs[0].observedAt=newer;h.obs[0].monitor={configVersion:1,vmState:{observedAt:newer,state:'RUNNING'}};
 h.outcome=c=>{if(c.key===original)throw Error('lost');return ack(c);};await h.bridge.tick();assert.equal(h.state.entries.vm0.lastHealthAt,newer);
 h.outcome=null;await h.bridge.tick();assert.deepEqual(h.state.entries.vm0.monitorAcks,{vmState:newer,guest:T1});
 const n=h.calls.length;h.obs[0].observedAt='2026-10-26T02:02:00.000Z';await h.bridge.tick();assert.equal(h.calls.length,n);
});
