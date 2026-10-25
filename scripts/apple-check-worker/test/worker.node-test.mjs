import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {Store} from '../src/store.mjs';
import {Worker} from '../src/worker.mjs';

async function fixture(options={}){
  const store=await Store.open(await mkdtemp(path.join(os.tmpdir(),'apple-flow-')));
  const calls=[];let submissions=0;let secretCalls=0;
  const secrets=new Map();const vault={save:async(id,s)=>secrets.set(id,s),load:async id=>secrets.get(id),remove:async id=>secrets.delete(id)};
  const api={call:async(action,body)=>{
    calls.push({action,body});
    if(options.api)return options.api(action,body);
    if(action==='heartbeat')return {workerId:'w',enabled:true};
    if(action==='claim')return {job:{id:'j1',leaseToken:'lease-secret',accountId:'a1',accountRevision:1,expiresAt:new Date(Date.now()+60000).toISOString()}};
    if(action==='heartbeat-job')return {cancelRequested:!!options.cancel};
    if(action==='route')return {proxy:{server:'http://proxy.example:8080',username:'proxy-user',password:'proxy-pass'}};
    if(action==='submit'){secretCalls++;assert.equal((await store.load()).phase,'SUBMITTING');return {email:'one@example.test',password:'account-pass'};}
    if(action==='result'){if(options.reportFail)throw new Error('offline');return {id:'j1',phase:'DONE'};}
  }};
  const adapter={create:()=>({
    open:async()=>{},probe:async()=>{if(options.probeFail)throw new Error('route');if(options.challenge)return {result:'CHALLENGE_REQUIRED',explicit:true};},
    submit:async(credentials,{signal})=>{submissions++;assert.equal(credentials.password,'account-pass');
      if(options.wait)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
      if(options.crash)throw new Error('secret error from browser');
      return options.outcome??{result:'LOGIN_SUCCESS',authenticated:true,identity:'one@example.test'};
    },close:async()=>{if(options.cleanupFail)throw new Error('failed close');},
  })};
  const worker=new Worker({store,vault,api,adapter,verifyNoBrowser:async()=>options.browserAlive!==true,gate:async()=>options.gate??'IDLE',heartbeatMs:5,jobTimeoutMs:500});
  return {store,worker,calls,vault,get submissions(){return submissions;},get secretCalls(){return secretCalls;}};
}
test('route probe and durable checkpoint precede the only secret delivery and browser submit',async()=>{
  const f=await fixture();assert.equal(await f.worker.once(),'DONE');assert.equal(f.submissions,1);assert.equal(f.secretCalls,1);
  const report=f.calls.find(x=>x.action==='result').body;
  assert.equal(report.result,'LOGIN_SUCCESS');assert.equal(report.cleanup,'OK');
  assert.equal(await f.store.load(),null);
  assert.ok(f.calls.findIndex(x=>x.action==='route')<f.calls.findIndex(x=>x.action==='submit'));
});
test('probe failure never reveals account secrets',async()=>{
  const f=await fixture({probeFail:true});await f.worker.once();assert.equal(f.secretCalls,0);assert.equal(f.submissions,0);
  assert.equal(f.calls.find(x=>x.action==='result').body.result,'PROXY_ERROR');
});

test('secret-delivery transport failure is distinct from browser failure and never repeated',async()=>{
 const f=await fixture({api:async(action)=>{
  if(action==='heartbeat')return {enabled:true};if(action==='claim')return {job:{id:'j1',leaseToken:'lease-secret',accountId:'a1',accountRevision:1}};
  if(action==='heartbeat-job')return {};if(action==='route')return {proxy:{}};if(action==='submit')throw Error('private failure');if(action==='result')return {};
 }});await f.worker.once();assert.equal(f.calls.find(x=>x.action==='result').body.reasonCode,'CREDENTIAL_DELIVERY_FAILED');assert.equal(f.calls.filter(x=>x.action==='submit').length,1);
});

test('post-password 2FA is reported Live and UNKNOWN preserves only safe diagnostic codes',async()=>{
  for(const outcome of [{result:'LIVE_2FA',explicit:true},{result:'UNKNOWN',reasonCode:'PASSWORD_FORM_MISSING'},{result:'UNKNOWN',reasonCode:'password-secret'}]){
    const f=await fixture({outcome});await f.worker.once();const report=f.calls.find(x=>x.action==='result').body;
    assert.equal(report.result,outcome.result);
    assert.equal(report.reasonCode,outcome.result==='LIVE_2FA'?'LIVE_2FA':outcome.reasonCode==='PASSWORD_FORM_MISSING'?'PASSWORD_FORM_MISSING':'UNKNOWN');
  }
});
test('success without authenticated matching identity is UNKNOWN',async()=>{
  for(const outcome of [{result:'LOGIN_SUCCESS',authenticated:true,identity:'other@example.test'},{result:'LOGIN_SUCCESS',identity:'one@example.test'},{}]){
    const f=await fixture({outcome});await f.worker.once();assert.equal(f.calls.find(x=>x.action==='result').body.result,'UNKNOWN');
  }
});
test('desktop and RAM gates do not claim or launch',async()=>{
  for(const gate of ['WAITING_DESKTOP','WAITING_RESOURCES']){const f=await fixture({gate});assert.equal(await f.worker.once(),gate);assert.equal(f.calls.length,1);assert.equal(f.submissions,0);}
});
test('cleanup failure preserves independent auth result and quarantines further work',async()=>{
  const f=await fixture({cleanupFail:true});assert.equal(await f.worker.once(),'CLEANUP_FAILED');
  assert.equal(f.calls.find(x=>x.action==='result').body.result,'LOGIN_SUCCESS');assert.equal(f.calls.find(x=>x.action==='result').body.cleanup,'FAILED');
  const claims=f.calls.filter(x=>x.action==='claim').length;assert.equal(await f.worker.once(),'CLEANUP_FAILED');assert.equal(f.calls.filter(x=>x.action==='claim').length,claims);
});
test('failed result delivery replays exact terminal payload without another login',async()=>{
  const f=await fixture({reportFail:true});assert.equal(await f.worker.once(),'PENDING');const before=await f.store.load();
  assert.equal(before.phase,'REPORTING');assert.equal((await readFile(path.join(f.store.root,'pending.json'),'utf8')).includes('pass'),false);
  assert.equal(await f.worker.once(),'PENDING');assert.equal(f.submissions,1);assert.equal(f.secretCalls,1);
  const reports=f.calls.filter(x=>x.action==='result');assert.deepEqual(reports[0].body,reports[1].body);
});
test('interrupted SUBMITTING with unresolved browser is UNKNOWN with FAILED cleanup and never resubmitted',async()=>{
  const f=await fixture({browserAlive:true});const p=await f.store.createProfile();await f.store.save({jobId:'j1',leaseToken:'lease-secret',profileId:p.id,phase:'SUBMITTING'});
  assert.equal(await f.worker.once(),'CLEANUP_FAILED');assert.equal(f.submissions,0);assert.equal(f.secretCalls,0);
  const report=f.calls.find(x=>x.action==='result').body;assert.equal(report.result,'UNKNOWN');assert.equal(report.cleanup,'FAILED');
});
test('result reason code equals its result and timestamp is zulu',async()=>{
  const f=await fixture();await f.worker.once();const body=f.calls.find(x=>x.action==='result').body;
  assert.equal(body.reasonCode,body.result);assert.match(body.observedAt,/Z$/);
});
test('lost claim response retries the same durably persisted key and clears only confirmed null',async()=>{
  const keys=[];let persisted;const f=await fixture({api:async (action,body)=>{
    if(action==='heartbeat')return {workerId:'w',enabled:true};
    if(action==='claim'){keys.push(body.key);persisted=await f.store.read('claim-inflight.json');if(keys.length===1)throw new Error('lost response');return {job:null};}
  }});
  assert.equal(await f.worker.once(),'PENDING_CLAIM');assert.equal(await f.worker.once(),'IDLE');assert.equal(keys.length,2);
  assert.match(keys[0],/^[a-z0-9-]{8,100}$/);assert.equal(keys[0],keys[1]);assert.equal(persisted.key,keys[0]);
  await assert.rejects(f.store.read('claim-inflight.json'),{code:'ENOENT'});
});
test('claim recoveryOnly never opens browser or requests credentials',async()=>{
  const f=await fixture();const original=f.worker.api.call;
  f.worker.api.call=async(a,b,o)=>{const data=await original(a,b,o);if(a==='claim')data.job.recoveryOnly=true;return data;};
  await f.worker.once();assert.equal(f.secretCalls,0);assert.equal(f.submissions,0);assert.equal(f.calls.some(c=>c.action==='route'),false);
  assert.equal(f.calls.find(c=>c.action==='result').body.result,'UNKNOWN');
});
test('raw claim capability is durable before route, no account or proxy credentials journaled',async()=>{
  const f=await fixture();const original=f.worker.api.call;let raw;
  f.worker.api.call=async(a,b,o)=>{if(a==='route')raw=await f.store.load();return original(a,b,o);};await f.worker.once();
  assert.equal(raw.leaseToken,'lease-secret');assert.equal(raw.claim.accountId,'a1');assert.equal(raw.claim.id,'j1');
});
test('cleanup-recovered only releases quarantine after verified owned cleanup without authentication',async()=>{
  const f=await fixture({cleanupFail:true});await f.worker.once();
  await assert.rejects(f.worker.recoverCleanup({verifyNoBrowser:async()=>false}),/BROWSER/);
  assert.equal(f.calls.some(c=>c.action==='cleanup-recovered'),false);
  assert.equal(await f.worker.recoverCleanup({verifyNoBrowser:async()=>true}),'RECOVERED');
  assert.equal(f.calls.filter(c=>c.action==='submit').length,1);
  assert.deepEqual(f.calls.find(c=>c.action==='cleanup-recovered').body,{jobId:'j1',leaseToken:'lease-secret'});
});
test('cancellation before secret delivery stops immediately',async()=>{
  const f=await fixture({cancel:true});await f.worker.once();assert.equal(f.secretCalls,0);assert.equal(f.calls.find(x=>x.action==='result').body.result,'CANCELLED');
});
test('lease heartbeat cancellation closes the browser while a submission waits',async()=>{
  const f=await fixture({wait:true});const original=f.worker.api.call;
  f.worker.api.call=async(a,b,o)=>a==='heartbeat-job'?{cancelRequested:f.submissions>0}:original(a,b,o);
  await f.worker.once();assert.equal(f.submissions,1);assert.equal(f.calls.find(x=>x.action==='result').body.result,'CANCELLED');
});
test('a concurrent once cannot overlap the owned browser',async()=>{
  const f=await fixture({wait:true});const abort=new AbortController();const first=f.worker.once({signal:abort.signal});
  await assert.rejects(f.worker.once(),/RUNNING/);abort.abort();await first;
});
test('submit delivery loss is UNKNOWN and never repeats submit, including result replay',async()=>{
  const f=await fixture({reportFail:true});const original=f.worker.api.call;let requests=0;
  f.worker.api.call=async(a,b,o)=>{if(a==='submit'){requests++;throw new Error('secret delivery lost');}return original(a,b,o);};
  await f.worker.once();await f.worker.once();assert.equal(requests,1);assert.equal(f.submissions,0);
  const reports=f.calls.filter(c=>c.action==='result');assert.equal(reports[0].body.result,'UNKNOWN');assert.deepEqual(reports[0].body,reports[1].body);
});
test('lease transport failure during submit aborts and reports UNKNOWN with owned cleanup',async()=>{
  const f=await fixture({wait:true});const original=f.worker.api.call;
  f.worker.api.call=async(a,b,o)=>{if(a==='heartbeat-job'&&f.submissions)throw new Error('revoked');return original(a,b,o);};
  await f.worker.once();const report=f.calls.find(c=>c.action==='result').body;assert.equal(report.result,'UNKNOWN');assert.equal(report.cleanup,'OK');
});
test('persistent loop keeps its exclusive lock across idle polls and awaits status writes',async()=>{
  const f=await fixture({api:async a=>a==='heartbeat'?{workerId:'w',enabled:true}:{job:null}});const controller=new AbortController();
  let blocked=false,done=false;
  await f.worker.loop({signal:controller.signal,pollMs:1,onState:async()=>{
    await assert.rejects(f.store.lock(),/LOCKED/);blocked=true;await new Promise(resolve=>setImmediate(resolve));done=true;controller.abort();
  }});
  assert.equal(blocked,true);assert.equal(done,true);
});
test('process verification failure quarantines and never deletes the owned profile',async()=>{
  const f=await fixture({browserAlive:true});let deletions=0;
  const cleanup=f.store.cleanup.bind(f.store);f.store.cleanup=async id=>{deletions++;return cleanup(id);};
  assert.equal(await f.worker.once(),'CLEANUP_FAILED');assert.equal(deletions,0);
  assert.equal(f.calls.find(c=>c.action==='result').body.cleanup,'FAILED');
});
test('desktop disconnect during submit aborts active browser and cleans up',async()=>{
  const f=await fixture({wait:true});f.worker.gate=async()=>f.submissions?'WAITING_DESKTOP':'IDLE';
  await f.worker.once();assert.equal(f.submissions,1);const report=f.calls.find(c=>c.action==='result').body;assert.equal(report.result,'UNKNOWN');assert.equal(report.cleanup,'OK');
});
test('preflight challenge reports challenge without API secret delivery or credential submit',async()=>{
  const f=await fixture({challenge:true});await f.worker.once();assert.equal(f.secretCalls,0);assert.equal(f.submissions,0);
  assert.equal(f.calls.find(c=>c.action==='result').body.result,'CHALLENGE_REQUIRED');
});
test('raw claim-inflight capability recovers before revoked heartbeat or desktop gate',async()=>{
  const f=await fixture({gate:'WAITING_DESKTOP'});await f.store.write('claim-inflight.json',{key:'durable-key',job:{id:'j1',leaseToken:'lease-secret',accountId:'a1',accountRevision:1,expiresAt:new Date().toISOString()}});
  const original=f.worker.api.call;f.worker.api.call=async(a,b,o)=>{if(a!=='result')throw new Error('revoked');return original(a,b,o);};
  assert.equal(await f.worker.once(),'DONE');assert.equal(f.submissions,0);assert.equal(f.calls.find(c=>c.action==='result').body.result,'UNKNOWN');
});
test('lost claim response then disable replays persisted key before heartbeat/gate and verifies cleanup without quarantine',async()=>{
  let disabled=false;const calls=[],keys=[];let browserCreations=0,gateCalls=0;
  const f=await fixture();f.worker.adapter.create=()=>{browserCreations++;throw new Error('MUST_NOT_OPEN');};
  f.worker.gate=async()=>{gateCalls++;if(disabled)throw new Error('MUST_NOT_GATE_RECOVERY');return 'IDLE';};
  f.worker.api.call=async(action,body)=>{
    calls.push(action);
    if(action==='heartbeat'){if(disabled)throw new Error('FORBIDDEN');return {workerId:'w',enabled:true};}
    if(action==='claim'){
      keys.push(body.key);
      if(!disabled){disabled=true;throw new Error('response lost then worker disabled');}
      return {job:{id:'j1',leaseToken:'lease-secret',accountId:'a1',accountRevision:1,expiresAt:new Date().toISOString(),recoveryOnly:true}};
    }
    if(action==='result')return {id:'j1',phase:'DONE'};
    throw new Error('NO_NEW_WORK');
  };
  assert.equal(await f.worker.once(),'PENDING_CLAIM');
  const persisted=await f.store.read('claim-inflight.json');calls.length=0;let report;
  const original=f.worker.api.call;f.worker.api.call=async(a,b,o)=>{if(a==='result')report=b;return original(a,b,o);};
  assert.equal(await f.worker.once(),'DONE');assert.deepEqual(calls,['claim','result']);assert.equal(gateCalls,1);
  assert.deepEqual(keys,[persisted.key,persisted.key]);assert.equal(browserCreations,0);assert.equal(report.result,'UNKNOWN');assert.equal(report.cleanup,'OK');
  assert.equal(await f.store.load(),null);await assert.rejects(f.store.read('claim-inflight.json'),{code:'ENOENT'});await assert.rejects(f.store.read('quarantine.json'),{code:'ENOENT'});
});
test('matching overlapping claim and pending journals replay one exact report and never resurrect a second job',async()=>{
  for(const phase of ['REPORTING','CLAIMED']){
    const f=await fixture();const profile=await f.store.createProfile();
    const claim={id:'j1',leaseToken:'lease-secret',accountId:'a1',accountRevision:1,expiresAt:new Date().toISOString()};
    const report={result:'UNKNOWN',reasonCode:'UNKNOWN',cleanup:'OK',observedAt:'2026-10-25T01:00:00.000Z'};
    await f.store.write('claim-inflight.json',{key:'same-claim-key',job:claim});
    await f.store.save({jobId:'j1',leaseToken:'lease-secret',profileId:profile.id,claim,phase,...(phase==='REPORTING'?{report}:{})});
    const original=f.worker.api.call;let overlapDuringReport;
    f.worker.api.call=async(a,b,o)=>{
      if(a==='claim')return {job:null};
      if(a==='result')try{overlapDuringReport=await f.store.read('claim-inflight.json');}catch(e){if(e.code!=='ENOENT')throw e;}
      return original(a,b,o);
    };
    assert.equal(await f.worker.once(),'DONE');assert.equal(overlapDuringReport,undefined);
    const sent=f.calls.filter(c=>c.action==='result');assert.equal(sent.length,1);
    if(phase==='REPORTING')assert.deepEqual(sent[0].body,{jobId:'j1',leaseToken:'lease-secret',...report});
    assert.equal(await f.worker.once(),'IDLE');assert.equal(f.calls.filter(c=>c.action==='result').length,1);
    assert.equal(f.secretCalls,0);assert.equal(f.submissions,0);assert.equal(await f.store.load(),null);
    await assert.rejects(f.store.read('claim-inflight.json'),{code:'ENOENT'});
  }
});
test('mismatched overlapping journals quarantine without reporting or deleting either identity',async()=>{
  for(const change of [{id:'foreign-job'},{leaseToken:'foreign-lease'},{accountId:'foreign-account'},{accountRevision:2}]){
    const f=await fixture();const profile=await f.store.createProfile();
    const claim={id:'j1',leaseToken:'lease-secret',accountId:'a1',accountRevision:1,expiresAt:new Date().toISOString()};
    await f.store.save({jobId:'j1',leaseToken:'lease-secret',profileId:profile.id,claim,phase:'CLAIMED'});
    const foreign={key:'foreign-claim-key',job:{...claim,...change}};await f.store.write('claim-inflight.json',foreign);
    const before=await f.store.load();
    await assert.rejects(f.worker.once(),/JOURNAL_IDENTITY_MISMATCH/);
    assert.deepEqual(await f.store.load(),before);assert.deepEqual(await f.store.read('claim-inflight.json'),foreign);
    assert.equal(f.calls.length,0);assert.equal((await f.store.read('quarantine.json')).reason,'JOURNAL_IDENTITY_MISMATCH');
  }
});
