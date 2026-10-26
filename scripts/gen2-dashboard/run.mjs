import path from 'node:path';
import fs from 'node:fs/promises';
import {parseMonitorConfig,readNativeSnapshots} from './native-monitor.mjs';
import {createHeartbeatLoop} from './heartbeats.mjs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { Bridge } from './bridge.mjs';
import { readCaches } from './cache.mjs';
import { acquireLock,createApi,loadState,readSecret,saveState,parseTelemetryArgs } from './io.mjs';
import {createReminderHook} from './reminders.mjs';

export async function main(args=process.argv.slice(2)) {
 const telemetry=parseTelemetryArgs(args);args=telemetry.args;
 const values=new Map();let once=false;
 for(let i=0;i<args.length;i++){if(args[i]==='--once'){once=true;continue;}if(!['--project','--machine-root','--state-dir','--secret-file','--interval-ms','--monitor-config'].includes(args[i])||!args[i+1]||values.has(args[i]))throw new Error('ARGUMENT_INVALID');values.set(args[i],args[++i]);}
 const projectId=values.get('--project');if(!/^[A-Za-z0-9_-]{1,64}$/.test(projectId||''))throw new Error('PROJECT_REQUIRED');
 const machineRoot=path.resolve(values.get('--machine-root')||path.join(process.env.APPDATA||path.join(os.homedir(),'AppData/Roaming'),'gen-tool-pro/machine'));
 const stateDir=path.resolve(values.get('--state-dir')||path.join(os.homedir(),'.mth/gen2-dashboard',projectId));
 const secretFile=path.resolve(values.get('--secret-file')||path.join(os.homedir(),'.mth/wow-ops-secret.json'));
 const relative=path.relative(machineRoot,stateDir);if(relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw new Error('STATE_INSIDE_GEN2_REFUSED');
 const interval=Number(values.get('--interval-ms')||60000);if(!Number.isFinite(interval)||interval<30000)throw new Error('INTERVAL_TOO_SHORT');
 const monitorConfig=values.has('--monitor-config')?parseMonitorConfig(JSON.parse(await fs.readFile(values.get('--monitor-config'),'utf8')),projectId):null;
 if(monitorConfig&&telemetry.serverId&&telemetry.serverId!==monitorConfig.bindings[0].serverId)throw Error('MONITOR_SERVER_MISMATCH');
 const unlock=await acquireLock(stateDir);let stopping=false,wake=null;
 const stop=()=>{stopping=true;wake?.();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 let heartbeatTimer=null,heartbeatCall=null;
 try {
  const token=await readSecret(secretFile),state=await loadState(stateDir,projectId);
  const api=createApi({token}),reminders=createReminderHook({projectId,machineRoot,stateDir,api});
  const bridge=new Bridge({state,projectId,api,monitorConfig,batchSize:telemetry.batchSize,serverId:telemetry.serverId,readCache:async()=>({...await readCaches(machineRoot),...(monitorConfig?{nativeSnapshots:await readNativeSnapshots(machineRoot,monitorConfig)}:{})}),persist:s=>saveState(stateDir,s),shouldStop:()=>stopping,
   afterSync:async context=>{const result=await reminders(context);if(result.polled||!['IDLE','THROTTLED'].includes(result.state))process.stdout.write(JSON.stringify({at:new Date().toISOString(),reminders:result})+'\n');}});
  if(monitorConfig){
   const heartbeats=await createHeartbeatLoop({config:monitorConfig,projectId,stateDir,api:createApi({token}),readSources:()=>readNativeSnapshots(machineRoot,monitorConfig),bridgeState:state});
   const pulse=()=>{if(stopping||heartbeatCall)return;heartbeatCall=heartbeats.tick().then(r=>{if(r.state==='AUTH_REQUIRED'){stopping=true;wake?.();}process.stdout.write(JSON.stringify({at:new Date().toISOString(),monitorHeartbeat:r.state,sources:r.results})+'\n');}).catch(()=>process.stdout.write(JSON.stringify({at:new Date().toISOString(),monitorHeartbeat:'UNKNOWN'})+'\n')).finally(()=>{heartbeatCall=null;});};
   pulse();if(!once)heartbeatTimer=setInterval(pulse,60000);
  }
  do {
   try{const result=await bridge.tick();process.stdout.write(JSON.stringify({at:new Date().toISOString(),...result})+'\n');if(result.state==='AUTH_REQUIRED')break;}
   catch(error){if(error?.message==='AUTH_REQUIRED'){process.stdout.write(JSON.stringify({at:new Date().toISOString(),state:'AUTH_REQUIRED'})+'\n');break;}process.stdout.write(JSON.stringify({at:new Date().toISOString(),state:'UNAVAILABLE_RETRY_LATER'})+'\n');}
   if(once||stopping)break;
   await new Promise(resolve=>{const timer=setTimeout(resolve,interval);wake=()=>{clearTimeout(timer);resolve();};});wake=null;
  }while(!stopping);
 }finally{if(heartbeatTimer)clearInterval(heartbeatTimer);if(heartbeatCall)await heartbeatCall;process.off('SIGINT',stop);process.off('SIGTERM',stop);await unlock();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{process.stderr.write('GEN2_BRIDGE_STOPPED_CHECK_LOCAL_STATE\n');process.exitCode=1;});
