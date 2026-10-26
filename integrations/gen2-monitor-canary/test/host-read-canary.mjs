// Bounded live validation harness, not a collector or VM operations route.
// Uses the exact staged product readers; never guestcontrol or power commands.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const args=process.argv.slice(2),values=new Map();
for(let i=0;i<args.length;i+=2){if(!['--runtime','--machine-root','--expected','--output'].includes(args[i])||!args[i+1]||values.has(args[i]))throw Error('ARGUMENT_INVALID');values.set(args[i],args[i+1]);}
if(values.size!==4)throw Error('FOUR_ARGUMENTS_REQUIRED');
const runtime=path.resolve(values.get('--runtime')),machine=path.resolve(values.get('--machine-root'));
const expected=JSON.parse(fs.readFileSync(values.get('--expected'),'utf8'));
const identity=JSON.parse(fs.readFileSync(path.join(machine,'data/autoscan/server-id.json'),'utf8'));
if(identity.serverId!==expected.serverUuid||!Array.isArray(expected.vms)||!expected.vms.length)throw Error('SERVER_IDENTITY_UNVERIFIED');
const cfg=JSON.parse(fs.readFileSync(path.join(machine,'gentoolpro.config.json'),'utf8').replace(/^\uFEFF/,''));
const from=n=>import(pathToFileURL(path.join(runtime,'resources/app/engine',n)).href);
const {makeVbox,detectVBoxManage}=await from('vbox.mjs');
const {readNativeInventory,readNativeAppliedProxy}=await from('native-monitor-readers.mjs');
const {httpsGetThroughProxy}=await from('proxy-transport.mjs');
const detected=detectVBoxManage(cfg);if(!detected.found)throw Error('VBOX_MISSING');
const raw=makeVbox(detected.path,cfg.VBoxUserHome||'',{lowPriority:true,awaitCloseOnTimeout:true});
let calls=0;
const vbox=(a,t)=>{
 const allowed=a.length===3&&a[0]==='list'&&a[1]==='vms'&&a[2]==='-l'||a.length===3&&a[0]==='getextradata'&&a[2]==='enumerate'&&expected.vms.some(v=>v.uuid===a[1]);
 if(!allowed)throw Error('NON_READONLY_COMMAND_REFUSED');calls++;return raw(a,t);
};
const memoryBefore=process.memoryUsage().rss,cpuBefore=process.cpuUsage(),begin=performance.now();
const rows=await readNativeInventory(vbox),inventoryMs=performance.now()-begin;
const ids=rows.map(v=>v.uuid).sort(),wanted=expected.vms.map(v=>v.uuid).sort();
if(JSON.stringify(ids)!==JSON.stringify(wanted))throw Error('INVENTORY_UUID_MISMATCH');
const selected=rows.filter(r=>r.state==='RUNNING').slice(0,2),proxies=[];
await Promise.all(selected.map(async vm=>{
 const started=performance.now(),before=await readNativeAppliedProxy(vbox,vm);
 if(!before.verified){proxies.push({vm:vm.name,state:'APPLIED_PROXY_UNVERIFIED',provenance:'HOST'});return;}
 const result=await httpsGetThroughProxy(before.proxy,'https://api64.ipify.org?format=json',{timeoutMs:8000,maxBytes:4096,signal:AbortSignal.timeout(8000)});
 const after=await readNativeAppliedProxy(vbox,vm);
 proxies.push({vm:vm.name,provenance:'HOST',bindingUnchanged:after.verified&&after.routeRevision===before.routeRevision,
  state:result.ok===true&&result.status>=200&&result.status<300?'HOST_HTTPS_OK':result.code==='AUTH_FAILED'?'AUTH_FAILED':result.code==='TIMEOUT'?'TIMEOUT':'UNVERIFIED',durationMs:Math.round(performance.now()-started)});
}));
const cpu=process.cpuUsage(cpuBefore);
const output={kind:'ONE_SHOT_HOST_READ_TEST_NOT_NATIVE_INSTALL',serverUuid:identity.serverId,observedAt:new Date().toISOString(),
 inventory:{count:rows.length,running:rows.filter(r=>r.state==='RUNNING').length,uuidSetMatches:true,durationMs:Math.round(inventoryMs)},proxies,
 metrics:{testProcessOnly:true,durationMs:Math.round(performance.now()-begin),rssDeltaBytes:process.memoryUsage().rss-memoryBefore,cpuUserUs:cpu.user,cpuSystemUs:cpu.system,vboxCalls:calls,guestCalls:0,maxConcurrentProxyChecks:selected.length},
 nativeCollectorInstalled:false,guestEvidence:'NOT_TESTED',noVmChanges:true};
fs.writeFileSync(values.get('--output'),JSON.stringify(output,null,2),{flag:'wx'});
console.log(JSON.stringify(output));
