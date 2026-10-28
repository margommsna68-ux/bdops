import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createHeartbeatLoop} from '../heartbeats.mjs';
import {createHash} from 'node:crypto';
const central='dda631e2-3ce9-492c-a733-f2b96873dd02',peer='577be21b-18b5-4c7d-b897-3e5c0093c4aa',instance='7873c1ec-3cfb-4afc-a8ca-30dd89c86d0c';
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'heartbeat-'));t.after(async()=>{for(const name of await fs.readdir(dir))await fs.unlink(path.join(dir,name));await fs.rmdir(dir);});
 const h={dir,now:Date.parse('2026-10-26T05:00:00.000Z'),sources:[],calls:[],outcome:null};
 h.config={version:1,centralUuid:central,bindings:[{projectId:'p',serverId:'s',serverCode:'moon05',serverUuid:peer}]};
 h.source={serverUuid:peer,instanceUuid:instance,startedAt:'2026-10-26T04:59:00.000Z',seq:1,configVersion:1,observedAt:'2026-10-26T05:00:00.000Z',counts:{managed:91,inventory:91,guest:20,proxy:30,app:20}};
 h.options={config:h.config,projectId:'p',stateDir:dir,now:()=>h.now,bridgeState:{entries:{}},readSources:async()=>h.sources,api:{post:async(route,body,key)=>{h.calls.push({route,body:structuredClone(body),key});const serverId=route.split('/')[2],persisted=JSON.parse(await fs.readFile(path.join(dir,'monitor-heartbeats.json'),'utf8'));assert.equal(persisted.rows[persisted.version===1?body.source:serverId+'/'+body.source].pending.key,key);if(h.outcome)return h.outcome(body,key);return {status:200,data:{serverId,source:body.source,seq:body.seq,observedAt:body.observedAt,receivedAt:body.observedAt}};}}};
 h.loop=await createHeartbeatLoop(h.options);return h;
}
test('missing agent source reports only Central, never fabricates an agent heartbeat',async t=>{const h=await fixture(t);await h.loop.tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.source,'CENTRAL');assert.equal(h.calls[0].body.counts.inventory,0);});
test('lost ACK keeps exact heartbeat key/body across source updates and restarts',async t=>{const h=await fixture(t);h.sources=[h.source];h.outcome=(b)=>{if(b.source==='CENTRAL')throw Error('lost');return {status:200,data:{serverId:'s',source:b.source,seq:b.seq,observedAt:b.observedAt,receivedAt:b.observedAt}};};await h.loop.tick();const original=h.calls[0];h.now+=60000;h.outcome=null;h.loop=await createHeartbeatLoop(h.options);await h.loop.tick();const retried=h.calls.find((x,i)=>i>0&&x.body.source==='CENTRAL');assert.equal(retried.key,original.key);assert.deepEqual(retried.body,original.body);assert.equal(h.calls.filter(x=>x.body.source==='AGENT').length,1);});
test('heartbeat ACK must match source, sequence, VM host and observation time',async t=>{const h=await fixture(t);h.outcome=b=>({status:200,data:{serverId:'wrong',source:b.source,seq:b.seq,observedAt:b.observedAt,receivedAt:b.observedAt}});await h.loop.tick();assert.ok(JSON.parse(await fs.readFile(path.join(h.dir,'monitor-heartbeats.json'),'utf8')).rows['s/CENTRAL'].pending);});
test('authorization refusal stops the lane and retains original pending',async t=>{const h=await fixture(t);h.sources=[h.source];h.outcome=()=>({status:403});assert.equal((await h.loop.tick()).state,'AUTH_REQUIRED');assert.equal(h.calls.length,1);assert.ok(JSON.parse(await fs.readFile(path.join(h.dir,'monitor-heartbeats.json'),'utf8')).rows['s/CENTRAL'].pending);});
test('corrupt heartbeat state is not silently reset or sent',async t=>{const h=await fixture(t),file=path.join(h.dir,'monitor-heartbeats.json');await fs.writeFile(file,'corrupt');await assert.rejects(()=>createHeartbeatLoop(h.options),/DO_NOT_RESET/);assert.equal(await fs.readFile(file,'utf8'),'corrupt');assert.equal(h.calls.length,0);});

test('failed or partial delivery never logs an aggregate successful heartbeat',async t=>{
 const h=await fixture(t);h.sources=[h.source];h.outcome=()=>{throw Error('timeout');};
 const lost=await h.loop.tick();assert.equal(lost.state,'UNKNOWN');assert.equal(lost.results.length,2);assert.ok(lost.results.every(r=>r.state==='UNKNOWN'));
});

test('Central reported inventory coverage expires independently of longer guest evidence',async t=>{const h=await fixture(t),old=new Date(h.now-120000).toISOString();h.options.bridgeState.entries.v={target:{serverId:'s'},monitorVersion:1,monitorAcks:{vmState:old,guest:old}};await h.loop.tick();assert.equal(h.calls[0].body.counts.inventory,0);assert.equal(h.calls[0].body.counts.guest,1);});

function addCentral(h){h.config={...h.config,bindings:[...h.config.bindings,{projectId:'p',serverId:'moon-web',serverCode:'MOON01',serverUuid:central}]};h.options.config=h.config;}
const readJournal=h=>fs.readFile(path.join(h.dir,'monitor-heartbeats.json'),'utf8').then(JSON.parse);
test('single-to-two binding migration preserves old UNKNOWN key/body on the original endpoint and independently publishes both roles',async t=>{
 const h=await fixture(t);h.sources=[h.source];h.outcome=()=>{throw Error('lost');};await h.loop.tick();
 // Seed an actual v1 journal: this is the deployed pre-multi-binding shape.
 const oldRows=Object.fromEntries(h.calls.map(c=>[c.body.source,{pending:{key:c.key,body:c.body}}]));
 const legacy={version:1,configHash:createHash('sha256').update(JSON.stringify(h.config)).digest('hex'),rows:oldRows};
 await fs.writeFile(path.join(h.dir,'monitor-heartbeats.json'),JSON.stringify(legacy));const original=structuredClone(h.calls);
 addCentral(h);h.calls=[];h.outcome=null;h.sources=[{...h.source,seq:2,observedAt:new Date(h.now+60000).toISOString()},{...h.source,serverUuid:central}];h.now+=60000;
 h.loop=await createHeartbeatLoop(h.options);await h.loop.tick();
 for(const old of original){const retry=h.calls.find(c=>c.route===old.route&&c.body.source===old.body.source);assert.equal(retry.key,old.key);assert.deepEqual(retry.body,old.body);}
 assert.equal(h.calls.length,4);assert.equal(h.calls.find(c=>c.route.includes('moon-web')&&c.body.source==='AGENT').body.serverUuid,central);
 const state=await readJournal(h);assert.equal(state.version,2);assert.equal(state.config.bindings.length,2);assert.equal(state.configHash,createHash('sha256').update(JSON.stringify(h.config)).digest('hex'));
});

test('two-host auth refusal stops all later sends, preserves exact pending and restart resumes original endpoint',async t=>{
 const h=await fixture(t);addCentral(h);h.sources=[h.source,{...h.source,serverUuid:central}];h.outcome=()=>({status:403});
 h.loop=await createHeartbeatLoop(h.options);assert.equal((await h.loop.tick()).state,'AUTH_REQUIRED');assert.equal(h.calls.length,1);const old=h.calls[0];
 h.now+=60000;h.outcome=null;h.loop=await createHeartbeatLoop(h.options);await h.loop.tick();
 assert.equal(h.calls[1].route,old.route);assert.equal(h.calls[1].key,old.key);assert.deepEqual(h.calls[1].body,old.body);assert.equal(h.calls.length,5);
});

test('each endpoint uses its own real agent source/time and ACK coverage clocks; Central never invents the missing peer',async t=>{
 const h=await fixture(t);addCentral(h);const stale=new Date(h.now-600000).toISOString();h.sources=[{...h.source,startedAt:stale,observedAt:stale}];
 h.options.bridgeState.entries={old:{target:{serverId:'s'},monitorVersion:1,monitorAcks:{vmState:stale,guest:stale}},fresh:{target:{serverId:'moon-web'},monitorVersion:1,monitorAcks:{vmState:new Date(h.now).toISOString()}}};
 h.loop=await createHeartbeatLoop(h.options);const r=await h.loop.tick();
 assert.equal(r.state,'UNKNOWN');assert.equal(h.calls.length,3);assert.equal(h.calls.filter(c=>c.body.source==='AGENT').length,1);
 assert.equal(h.calls.find(c=>c.body.source==='AGENT').body.observedAt,stale);
 assert.equal(h.calls.find(c=>c.route.includes('/s/')&&c.body.source==='CENTRAL').body.counts.inventory,0);
 assert.equal(h.calls.find(c=>c.route.includes('/moon-web/')&&c.body.source==='CENTRAL').body.counts.inventory,1);
 assert.ok(r.results.some(x=>x.serverId==='moon-web'&&x.source==='AGENT'&&x.state==='UNKNOWN'));
 h.now+=60000;h.sources.push({...h.source,serverUuid:central,seq:2,observedAt:new Date(h.now).toISOString()});await h.loop.tick();
 assert.equal(h.calls.filter(c=>c.body.source==='AGENT'&&c.body.serverUuid===peer).length,1);
 assert.equal(h.calls.filter(c=>c.body.source==='AGENT'&&c.body.serverUuid===central).length,1);
});

test('config hash corruption or rebinding is refused without changing old durable pending',async t=>{
 const h=await fixture(t);h.outcome=()=>{throw Error('lost');};await h.loop.tick();const file=path.join(h.dir,'monitor-heartbeats.json'),before=await fs.readFile(file,'utf8');
 h.options.config={...h.config,bindings:[{...h.config.bindings[0],serverUuid:central}]};await assert.rejects(()=>createHeartbeatLoop(h.options),/DO_NOT_RESET/);assert.equal(await fs.readFile(file,'utf8'),before);
 const bad=JSON.parse(before);bad.configHash='0'.repeat(64);await fs.writeFile(file,JSON.stringify(bad));const corrupt=await fs.readFile(file,'utf8');h.options.config=h.config;
 await assert.rejects(()=>createHeartbeatLoop(h.options),/DO_NOT_RESET/);assert.equal(await fs.readFile(file,'utf8'),corrupt);
});

test('a lost agent ACK retains a detached immutable body while source objects advance in the same publisher',async t=>{
 const h=await fixture(t);addCentral(h);h.sources=[h.source,{...h.source,serverUuid:central,counts:{...h.source.counts}}];
 h.outcome=b=>{if(b.source==='AGENT'&&b.serverUuid===central)throw Error('lost');return {status:200,data:{serverId:h.calls.at(-1).route.split('/')[2],source:b.source,seq:b.seq,observedAt:b.observedAt,receivedAt:b.observedAt}};};
 h.loop=await createHeartbeatLoop(h.options);await h.loop.tick();const original=h.calls.find(c=>c.body.source==='AGENT'&&c.body.serverUuid===central);
 h.sources[1].counts.guest=42;h.sources[1].seq++;h.now+=60000;h.sources[1].observedAt=new Date(h.now).toISOString();await h.loop.tick();
 const replay=h.calls.filter(c=>c.body.source==='AGENT'&&c.body.serverUuid===central).at(-1);assert.equal(replay.key,original.key);assert.deepEqual(replay.body,original.body);
});

test('migration write failure prevents every send and preserves the legacy journal for a later retry',async t=>{
 const h=await fixture(t);h.outcome=()=>{throw Error('lost');};await h.loop.tick();
 const old={version:1,configHash:createHash('sha256').update(JSON.stringify(h.config)).digest('hex'),rows:{CENTRAL:{pending:{key:h.calls[0].key,body:h.calls[0].body}}}};
 const file=path.join(h.dir,'monitor-heartbeats.json');await fs.writeFile(file,JSON.stringify(old));const bytes=await fs.readFile(file,'utf8');addCentral(h);
 const rename=fs.rename;fs.rename=async()=>{throw Error('disk failure');};
 try{await assert.rejects(()=>createHeartbeatLoop(h.options),/disk failure/);}finally{fs.rename=rename;}
 assert.equal(await fs.readFile(file,'utf8'),bytes);assert.equal(h.calls.length,1);assert.deepEqual(await fs.readdir(h.dir),['monitor-heartbeats.json']);
 h.outcome=null;h.loop=await createHeartbeatLoop(h.options);await h.loop.tick();assert.equal(h.calls[1].key,old.rows.CENTRAL.pending.key);assert.deepEqual(h.calls[1].body,old.rows.CENTRAL.pending.body);
});

test('legacy pending is replayed before any new heartbeat even if the added host is first in config',async t=>{
 const h=await fixture(t);h.sources=[h.source];h.outcome=()=>{throw Error('lost');};await h.loop.tick();
 const original=structuredClone(h.calls),file=path.join(h.dir,'monitor-heartbeats.json');
 await fs.writeFile(file,JSON.stringify({version:1,configHash:createHash('sha256').update(JSON.stringify(h.config)).digest('hex'),rows:Object.fromEntries(original.map(c=>[c.body.source,{pending:{key:c.key,body:c.body}}]))}));
 addCentral(h);h.config.bindings.reverse();h.options.config=h.config;h.calls=[];h.outcome=null;
 h.sources=[h.source,{...h.source,serverUuid:central}];h.loop=await createHeartbeatLoop(h.options);await h.loop.tick();
 assert.deepEqual(h.calls.slice(0,2),original);assert.ok(h.calls.slice(2).every(c=>c.route.includes('/moon-web/')));
});
