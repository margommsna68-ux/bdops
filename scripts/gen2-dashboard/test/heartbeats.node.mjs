import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createHeartbeatLoop} from '../heartbeats.mjs';
const central='dda631e2-3ce9-492c-a733-f2b96873dd02',peer='577be21b-18b5-4c7d-b897-3e5c0093c4aa',instance='7873c1ec-3cfb-4afc-a8ca-30dd89c86d0c';
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'heartbeat-'));t.after(async()=>{for(const name of await fs.readdir(dir))await fs.unlink(path.join(dir,name));await fs.rmdir(dir);});
 const h={dir,now:Date.parse('2026-10-26T05:00:00.000Z'),sources:[],calls:[],outcome:null};
 h.config={version:1,centralUuid:central,bindings:[{serverId:'s',serverUuid:peer,projectId:'p',serverCode:'moon05'}]};
 h.source={serverUuid:peer,instanceUuid:instance,startedAt:'2026-10-26T04:59:00.000Z',seq:1,configVersion:1,observedAt:'2026-10-26T05:00:00.000Z',counts:{managed:91,inventory:91,guest:20,proxy:30,app:20}};
 h.options={config:h.config,projectId:'p',stateDir:dir,now:()=>h.now,bridgeState:{entries:{}},readSources:async()=>h.sources,api:{post:async(route,body,key)=>{h.calls.push({route,body:structuredClone(body),key});const persisted=JSON.parse(await fs.readFile(path.join(dir,'monitor-heartbeats.json'),'utf8'));assert.equal(persisted.rows[body.source].pending.key,key);if(h.outcome)return h.outcome(body,key);return {status:200,data:{serverId:'s',source:body.source,seq:body.seq,observedAt:body.observedAt,receivedAt:body.observedAt}};}}};
 h.loop=await createHeartbeatLoop(h.options);return h;
}
test('missing agent source reports only Central, never fabricates an agent heartbeat',async t=>{const h=await fixture(t);await h.loop.tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.source,'CENTRAL');assert.equal(h.calls[0].body.counts.inventory,0);});
test('lost ACK keeps exact heartbeat key/body across source updates and restarts',async t=>{const h=await fixture(t);h.sources=[h.source];h.outcome=(b)=>{if(b.source==='CENTRAL')throw Error('lost');return {status:200,data:{serverId:'s',source:b.source,seq:b.seq,observedAt:b.observedAt,receivedAt:b.observedAt}};};await h.loop.tick();const original=h.calls[0];h.now+=60000;h.outcome=null;h.loop=await createHeartbeatLoop(h.options);await h.loop.tick();const retried=h.calls.find((x,i)=>i>0&&x.body.source==='CENTRAL');assert.equal(retried.key,original.key);assert.deepEqual(retried.body,original.body);assert.equal(h.calls.filter(x=>x.body.source==='AGENT').length,1);});
test('heartbeat ACK must match source, sequence, VM host and observation time',async t=>{const h=await fixture(t);h.outcome=b=>({status:200,data:{serverId:'wrong',source:b.source,seq:b.seq,observedAt:b.observedAt,receivedAt:b.observedAt}});await h.loop.tick();assert.ok(JSON.parse(await fs.readFile(path.join(h.dir,'monitor-heartbeats.json'),'utf8')).rows.CENTRAL.pending);});
test('authorization refusal stops the lane and retains original pending',async t=>{const h=await fixture(t);h.sources=[h.source];h.outcome=()=>({status:403});assert.equal((await h.loop.tick()).state,'AUTH_REQUIRED');assert.equal(h.calls.length,1);assert.ok(JSON.parse(await fs.readFile(path.join(h.dir,'monitor-heartbeats.json'),'utf8')).rows.CENTRAL.pending);});
test('corrupt heartbeat state is not silently reset or sent',async t=>{const h=await fixture(t),file=path.join(h.dir,'monitor-heartbeats.json');await fs.writeFile(file,'corrupt');await assert.rejects(()=>createHeartbeatLoop(h.options),/DO_NOT_RESET/);assert.equal(await fs.readFile(file,'utf8'),'corrupt');assert.equal(h.calls.length,0);});

test('failed or partial delivery never logs an aggregate successful heartbeat',async t=>{
 const h=await fixture(t);h.sources=[h.source];h.outcome=()=>{throw Error('timeout');};
 const lost=await h.loop.tick();assert.equal(lost.state,'UNKNOWN');assert.equal(lost.results.length,2);assert.ok(lost.results.every(r=>r.state==='UNKNOWN'));
});

test('Central reported inventory coverage expires independently of longer guest evidence',async t=>{const h=await fixture(t),old=new Date(h.now-120000).toISOString();h.options.bridgeState.entries.v={target:{serverId:'s'},monitorVersion:1,monitorAcks:{vmState:old,guest:old}};await h.loop.tick();assert.equal(h.calls[0].body.counts.inventory,0);assert.equal(h.calls[0].body.counts.guest,1);});
