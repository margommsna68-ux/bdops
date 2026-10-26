import test from 'node:test';import assert from 'node:assert/strict';
import {parseMonitorConfig,mergeNativeObservations} from '../native-monitor.mjs';
const peer='577be21b-18b5-4c7d-b897-3e5c0093c4aa',central='dda631e2-3ce9-492c-a733-f2b96873dd02',machine='7873c1ec-3cfb-4afc-a8ca-30dd89c86d0c';
const config=parseMonitorConfig({version:1,centralUuid:central,bindings:[{projectId:'p',serverId:'web',serverCode:'moon05',serverUuid:peer}]},'p');
const target={id:'vm',serverId:'web',serverCode:'moon05',code:'VM_062',machineUuid:machine,endpointId:'endpoint',proxyAddressFingerprint:'a'.repeat(64)};
const base={serverId:peer,serverName:'moon-05',vmCode:'VM_062',uuid:machine,observedAt:'2026-10-26T01:00:00.000Z',earning:true,problem:null,money:{amount:'12',observedAt:'2026-10-26T01:00:00.000Z'}};
const at='2026-10-26T02:00:00.000Z',now=Date.parse(at);
const sample=()=>({machineUuid:machine,vmCode:'VM_062',monitor:{configVersion:1,vmState:{observedAt:at,state:'RUNNING'}},proxyEvidence:{observedAt:at,provenance:'HOST',proxyAddressFingerprint:'a'.repeat(64),tcp:'OK',auth:'OK',https:'OK'}});
const project=(samples=[sample()],observations=[base])=>({observations,nativeSnapshots:[{serverUuid:peer,observedAt:at,samples}]});
test('native inventory never makes old earnings or money appear current',()=>{
 const [o]=mergeNativeObservations(project(),[target],config,now).observations;
 assert.equal(o.observedAt,at);assert.equal(o.earning,null);assert.equal(o.problem,null);assert.deepEqual(o.money,base.money);
 assert.equal(o.monitor.proxy.appliedConfigurationId,null);assert.equal(o.monitor.proxy.provenance,'HOST');assert.equal(o.monitor.proxy.endpointId,'endpoint');
});
test('missing native source removes earning proof rather than manufacturing a new source time',()=>{
 const [o]=mergeNativeObservations({observations:[base],nativeSnapshots:[]},[target],config,now).observations;
 assert.equal(o.observedAt,base.observedAt);assert.equal(o.earning,null);assert.equal(o.monitor,undefined);
});
test('a declared native source can inventory paused VMs absent from the legacy scan',()=>{
 const s=sample();s.monitor.vmState.state='PAUSED';
 const [o]=mergeNativeObservations(project([s],[]),[target],config,now).observations;
 assert.equal(o.monitor.vmState.state,'PAUSED');assert.equal(o.earning,null);assert.equal(o.vmCode,'VM_062');
});
test('a conflicting legacy identity cannot be legitimized by native data',()=>{
 const out=mergeNativeObservations(project([sample()],[{...base,serverId:central}]),[target],config,now);
 assert.equal(out.observations.length,0);assert.equal(out.rejected[0].reason,'NATIVE_IDENTITY_UNVERIFIED');
});
test('wrong VM code and mismatching proxy addresses never produce verified axes',()=>{
 const s=sample();s.vmCode='VM_063';const [o]=mergeNativeObservations(project([s]),[target],config,now).observations;assert.equal(o.monitor,undefined);
 const p=sample();p.proxyEvidence.proxyAddressFingerprint='b'.repeat(64);const [v]=mergeNativeObservations(project([p]),[target],config,now).observations;assert.equal(v.monitor.proxy,undefined);
});
test('enrollment cannot silently expand to another project or multiple canary hosts',()=>{
 assert.throws(()=>parseMonitorConfig({...config,bindings:[{...config.bindings[0],projectId:'other'}]},'p'));
 assert.throws(()=>parseMonitorConfig({...config,bindings:[...config.bindings,...config.bindings]},'p'));
});

test('CLI rejects a server filter outside native enrollment before either lane starts',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{main}=await import('../run.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'monitor-config-')),file=path.join(dir,'config.json');
 try{await fs.writeFile(file,JSON.stringify(config));await assert.rejects(()=>main(['--project','p','--batch-size','25','--server','other','--monitor-config',file,'--state-dir',path.join(dir,'state')]),/MONITOR_SERVER_MISMATCH/);assert.deepEqual(await fs.readdir(dir),['config.json']);}
 finally{await fs.unlink(file);const state=path.join(dir,'state');try{for(const name of await fs.readdir(state))await fs.unlink(path.join(state,name));await fs.rmdir(state);}catch(e){if(e.code!=='ENOENT')throw e;}await fs.rmdir(dir);}
});
