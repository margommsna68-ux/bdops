import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,access,symlink,mkdir} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {Store} from '../src/store.mjs';import {WorkerPool} from '../src/worker.mjs';
import {ApiError} from '../src/api.mjs';
const waitUntil=async predicate=>{const end=Date.now()+3000;while(!predicate()){if(Date.now()>end)throw new Error('TEST_WAIT_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,5));}};
async function fixture({block=false,cleanupFail=false,resultFailSlot=0,gate=async()=> 'IDLE'}={}){
  const store=await Store.open(path.join(await mkdtemp(path.join(os.tmpdir(),'apple-pool-')),'state'));
  const calls=[],profiles=[],held=new Map(),claimed=new Set();let active=0,peak=0;
  const api={call:async(action,body)=>{
    calls.push({action,body});
    if(action==='heartbeat')return {workerId:'worker',enabled:true};
    if(action==='claim'){
      const slot=body.slot??1;if(claimed.has(slot))return {job:null};claimed.add(slot);
      return {job:{id:`job-${slot}`,accountId:`account-${slot}`,accountRevision:1,leaseToken:`lease-${slot}`,expiresAt:new Date(Date.now()+90000).toISOString()}};
    }
    if(action==='heartbeat-job')return {cancelRequested:false};
    if(action==='route')return {proxy:{server:'http://synthetic.invalid:80',username:'',password:''}};
    if(action==='submit'){
      const slot=Number(body.jobId.split('-')[1]);assert.equal((await (await store.slot(slot)).load()).phase,'SUBMITTING');
      return {email:`account-${slot}@example.invalid`,password:'synthetic'};
    }
    if(action==='result'){if(body.jobId===`job-${resultFailSlot}`)throw new Error('OFFLINE');return {id:body.jobId,phase:'DONE'};}
    if(action==='cleanup-recovered')return {id:body.jobId,phase:'DONE'};
  }};
  const adapter={create:()=>{let slot,opened=false;return {
    open:async({profilePath})=>{slot=Number(profilePath.match(/slot([1-5])/)[1]);profiles.push(profilePath);opened=true;active++;peak=Math.max(peak,active);},
    probe:async()=>{},submit:async(credentials,{signal})=>{
      if(block)await new Promise((resolve,reject)=>{held.set(slot,resolve);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
      return {result:'LOGIN_SUCCESS',authenticated:true,identity:credentials.email};
    },close:async()=>{if(opened){active--;opened=false;}if(cleanupFail&&slot===1)throw new Error('CLOSE_FAILED');},
  };}};
  const pool=new WorkerPool({store,api,adapter,gate,activeGate:async()=> 'IDLE',verifyNoBrowser:async()=>true,heartbeatMs:20,jobTimeoutMs:3000,maxSlots:5});
  return {store,pool,api,calls,profiles,held,claimed,get active(){return active;},get peak(){return peak;}};
}
test('five independent browsers overlap under one global supervisor and bounded slot locks',async()=>{
  const f=await fixture({block:true});const controller=new AbortController();const running=f.pool.once({signal:controller.signal});
  try{
    await waitUntil(()=>f.held.size===5);assert.equal(f.peak,5);assert.equal(new Set(f.profiles).size,5);
    await assert.rejects(f.store.lock(),/LOCKED/);
    for(let slot=1;slot<=5;slot++)await assert.rejects((await f.store.slot(slot)).lock(),/LOCKED/);
    for(const release of f.held.values())release();assert.equal(await running,'DONE');
    assert.deepEqual(f.calls.filter(c=>c.action==='claim').map(c=>c.body.slot).sort(),[1,2,3,4,5]);
    assert.equal(f.calls.filter(c=>c.action==='result').length,5);
    for(const profile of f.profiles)await assert.rejects(access(profile));
  }finally{controller.abort();for(const release of f.held.values())release();await running.catch(()=>{});}
});
test('shared stop aborts and drains all active jobs before releasing global lock',async()=>{
  const f=await fixture({block:true}),stop=new AbortController();const running=f.pool.loop({signal:stop.signal,pollMs:10000});
  await waitUntil(()=>f.held.size===5);stop.abort();assert.equal(await running,'STOPPED');assert.equal(f.active,0);
  assert.equal(f.calls.filter(c=>c.action==='result').length,5);await (await f.store.lock())();
  for(let slot=1;slot<=5;slot++)assert.equal(await (await f.store.slot(slot)).load(),null);
});

for(const failure of [new ApiError('API_TIMEOUT'),new ApiError('API_NETWORK'),new ApiError('API_REJECTED',500),new ApiError('API_REJECTED',429)]){
 test(`an idle slot ${failure.code}/${failure.status} does not interrupt an admitted login`,async()=>{
  let f,failed=false;
  f=await fixture({block:true,gate:async({slot})=>{if(slot>1)await waitUntil(()=>f.held.has(1));return 'IDLE';}});
  const original=f.api.call;f.api.call=async(a,b,o)=>{if(a==='heartbeat'&&f.held.has(1)&&!failed){failed=true;throw failure;}return original(a,b,o);};
  const stop=new AbortController(),running=f.pool.once({signal:stop.signal});
  try{await waitUntil(()=>failed);await new Promise(r=>setTimeout(r,60));assert.ok(f.active>=1);assert.equal(f.calls.some(c=>c.action==='result'&&c.body.jobId==='job-1'),false);
   for(const release of f.held.values())release();await running;
   assert.equal(f.calls.find(c=>c.action==='result'&&c.body.jobId==='job-1').body.result,'LOGIN_SUCCESS');
  }finally{stop.abort();for(const release of f.held.values())release();await running.catch(()=>{});}
 });
}

test('a forbidden idle heartbeat still drains all active login work',async()=>{
 let f,failed=false;f=await fixture({block:true,gate:async({slot})=>{if(slot>1)await waitUntil(()=>f.held.has(1));return 'IDLE';}});
 const original=f.api.call;f.api.call=async(a,b,o)=>{if(a==='heartbeat'&&f.held.has(1)&&!failed){failed=true;throw new ApiError('API_REJECTED',403);}return original(a,b,o);};
 const result=await f.pool.once();assert.equal(result,'DISABLED');assert.equal(f.active,0);
 assert.notEqual(f.calls.find(c=>c.action==='result'&&c.body.jobId==='job-1').body.result,'LOGIN_SUCCESS');
});
test('resource admissions reserve independently and never kill already admitted jobs',async()=>{
  const counts=[];const f=await fixture({block:true,gate:async({activeSlots})=>{counts.push(activeSlots);return activeSlots<2?'IDLE':'WAITING_RESOURCES';}});
  const controller=new AbortController(),running=f.pool.once({signal:controller.signal});
  try{await waitUntil(()=>f.held.size===2);await new Promise(resolve=>setTimeout(resolve,80));assert.equal(f.active,2);assert.equal(f.calls.filter(c=>c.action==='result').length,0);
    for(const release of f.held.values())release();await running;assert.equal(f.peak,2);assert.ok(counts.includes(0)&&counts.includes(1)&&counts.includes(2));
  }finally{controller.abort();for(const release of f.held.values())release();await running.catch(()=>{});}
});
test('one failed cleanup quarantines its slot, globally stops admissions and drains other jobs',async()=>{
  const f=await fixture({block:true,cleanupFail:true}),controller=new AbortController();const running=f.pool.once({signal:controller.signal});
  try{await waitUntil(()=>f.held.size===5);f.held.get(1)();assert.equal(await running,'CLEANUP_FAILED');assert.equal(f.active,0);
    assert.equal((await (await f.store.slot(1)).read('quarantine.json')).jobId,'job-1');
    const count=f.calls.filter(c=>c.action==='claim').length;assert.equal(await f.pool.once(),'CLEANUP_FAILED');assert.equal(f.calls.filter(c=>c.action==='claim').length,count);
  }finally{controller.abort();for(const release of f.held.values())release();await running.catch(()=>{});}
});
test('pending result is isolated and exact-replayed without authenticating again',async()=>{
  const f=await fixture({resultFailSlot:2,block:true});const running=f.pool.once();await waitUntil(()=>f.held.size===5);for(const release of f.held.values())release();assert.equal(await running,'PENDING');
  const slot2=await f.store.slot(2),pending=await slot2.load();assert.equal(pending.phase,'REPORTING');
  assert.equal(f.profiles.length,5);assert.equal(await f.pool.once(),'PENDING');assert.equal(f.profiles.length,5);
  const reports=f.calls.filter(c=>c.action==='result'&&c.body.jobId==='job-2');assert.deepEqual(reports[0].body,reports[1].body);
  for(const slot of [1,3,4,5])assert.equal(await (await f.store.slot(slot)).load(),null);
});
test('legacy root recovery completes before any fresh slot claim',async()=>{
  const f=await fixture();const profile=await f.store.createProfile();await f.store.save({jobId:'legacy',leaseToken:'legacy-lease',profileId:profile.id,phase:'CLAIMED'});
  assert.equal(await f.pool.once(),'DONE');const results=f.calls.filter(c=>c.action==='result');assert.equal(results[0].body.jobId,'legacy');assert.equal(results[0].body.result,'UNKNOWN');
  assert.ok(f.calls.findIndex(c=>c.action==='result'&&c.body.jobId==='legacy')<f.calls.findIndex(c=>c.action==='claim'));
});
test('slot directories refuse out-of-range IDs and linked roots',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'apple-pool-link-'));const store=await Store.open(path.join(root,'state'));
  for(const slot of [0,6,'../foreign',1.5])await assert.rejects(store.slot(slot),/SLOT/);
  await mkdir(path.join(root,'state','slots'));await mkdir(path.join(root,'foreign'));await symlink(path.join(root,'foreign'),path.join(root,'state','slots','slot1'),'junction');
  await assert.rejects(store.slot(1),/LINK/);
});
test('ambiguous claim persists and replays its original slot and key before new admissions',async()=>{
  const f=await fixture();const slot=await f.store.slot(3);await slot.write('claim-inflight.json',{slot:3,key:'persisted-slot-key',startedAt:new Date().toISOString()});
  const original=f.api.call;const claims=[];f.api.call=async(a,b,o)=>{if(a==='claim'&&b.key==='persisted-slot-key'){claims.push(b);f.claimed.add(3);return {job:{id:'job-3',accountId:'account-3',accountRevision:1,leaseToken:'lease-3',expiresAt:new Date().toISOString(),recoveryOnly:true}};}return original(a,b,o);};
  await f.pool.once();assert.deepEqual(claims,[{key:'persisted-slot-key',slot:3}]);assert.equal(f.profiles.some(p=>/slot3/.test(p)),false);
  const report=f.calls.find(c=>c.action==='result'&&c.body.jobId==='job-3').body;assert.equal(report.result,'UNKNOWN');
});
test('idle loop polls no faster than fifteen seconds even when configured faster',async()=>{
  const f=await fixture();f.api.call=async(a,b)=>{f.calls.push({action:a,body:b});return a==='claim'?{job:null}:{enabled:true};};
  const controller=new AbortController(),running=f.pool.loop({signal:controller.signal,pollMs:1});
  await waitUntil(()=>f.calls.filter(c=>c.action==='claim').length===5);await new Promise(resolve=>setTimeout(resolve,100));controller.abort();await running;
  assert.equal(f.calls.filter(c=>c.action==='claim').length,5);
  assert.ok(f.calls.filter(c=>c.action==='heartbeat').every(c=>c.body.state==='IDLE'));
});
test('shared shutdown retains unacknowledged slot reports while draining every browser',async()=>{
  const f=await fixture({block:true,resultFailSlot:2}),controller=new AbortController();const running=f.pool.loop({signal:controller.signal});
  await waitUntil(()=>f.held.size===5);controller.abort();assert.equal(await running,'STOPPED');assert.equal(f.active,0);
  const pending=await (await f.store.slot(2)).load();assert.equal(pending.phase,'REPORTING');assert.equal(pending.report.result,'CANCELLED');
  for(const slot of [1,3,4,5])assert.equal(await (await f.store.slot(slot)).load(),null);
});
test('every persisted slot acknowledgement is a global barrier before any fresh claim',async()=>{
  const f=await fixture();const slot=await f.store.slot(2),profile=await slot.createProfile();
  await slot.save({jobId:'old-slot2',leaseToken:'old-lease',profileId:profile.id,phase:'REPORTING',report:{result:'UNKNOWN',reasonCode:'UNKNOWN',cleanup:'OK',observedAt:'2026-10-25T01:00:00.000Z'}});
  let release,entered=false;const original=f.api.call;
  f.api.call=async(a,b,o)=>{if(a==='result'&&b.jobId==='old-slot2'){entered=true;await new Promise(resolve=>{release=resolve;});return {id:b.jobId,phase:'DONE'};}return original(a,b,o);};
  const controller=new AbortController(),running=f.pool.once({signal:controller.signal});
  try{await waitUntil(()=>entered);await new Promise(resolve=>setTimeout(resolve,50));assert.equal(f.calls.some(c=>c.action==='claim'),false);
    release();assert.equal(await running,'DONE',JSON.stringify({calls:f.calls.map(c=>({action:c.action,jobId:c.body?.jobId,result:c.body?.result,reasonCode:c.body?.reasonCode})),status:await f.store.read('status.json')}));
  }finally{controller.abort();release?.();await running.catch(()=>{});}
});
test('quarantine blocks admissions but all five mixed journals still recover and preserve pending acknowledgements',async()=>{
  const f=await fixture(),recovered=[];let release,entered=false;
  for(let i=1;i<=5;i++){
    const store=await f.store.slot(i),profile=await store.createProfile();
    if(i===1)await store.write('quarantine.json',{jobId:'old-1',leaseToken:'old-lease-1',profileId:profile.id,reason:'FAILED'});
    else if(i===3)await store.write('claim-inflight.json',{key:'old-key-3',slot:3,job:{id:'old-3',leaseToken:'old-lease-3',accountId:'old-account-3',accountRevision:1,expiresAt:new Date().toISOString()}});
    else await store.save({jobId:`old-${i}`,leaseToken:`old-lease-${i}`,profileId:profile.id,phase:i===2?'CLAIMED':'REPORTING',...(i===2?{}:{report:{result:'UNKNOWN',reasonCode:'UNKNOWN',cleanup:'OK',observedAt:'2026-10-25T01:00:00.000Z'}})});
  }
  const original=f.api.call;f.api.call=async(a,b,o)=>{
    if(a==='result'&&b.jobId?.startsWith('old-')){recovered.push(b.jobId);if(b.jobId==='old-5'){entered=true;await new Promise(resolve=>{release=resolve;});}if(b.jobId==='old-4')throw new Error('ACK_LOST');return {id:b.jobId,phase:'DONE'};}
    return original(a,b,o);
  };
  const controller=new AbortController(),running=f.pool.once({signal:controller.signal});
  try{await waitUntil(()=>entered);assert.equal(f.calls.some(c=>c.action==='claim'),false);release();assert.equal(await running,'CLEANUP_FAILED');
    assert.deepEqual(recovered.sort(),['old-2','old-3','old-4','old-5']);
    assert.equal(await (await f.store.slot(2)).load(),null);assert.equal(await (await f.store.slot(3)).load(),null);assert.equal(await (await f.store.slot(5)).load(),null);
    assert.equal((await (await f.store.slot(4)).load()).phase,'REPORTING');assert.equal((await (await f.store.slot(1)).read('quarantine.json')).jobId,'old-1');
  }finally{controller.abort();release?.();await running.catch(()=>{});}
});
