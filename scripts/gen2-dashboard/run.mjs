import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { Bridge } from './bridge.mjs';
import { readCaches } from './cache.mjs';
import { acquireLock,createApi,loadState,readSecret,saveState } from './io.mjs';
import {createReminderHook} from './reminders.mjs';

export async function main(args=process.argv.slice(2)) {
 const values=new Map();let once=false;
 for(let i=0;i<args.length;i++){if(args[i]==='--once'){once=true;continue;}if(!['--project','--machine-root','--state-dir','--secret-file','--interval-ms'].includes(args[i])||!args[i+1]||values.has(args[i]))throw new Error('ARGUMENT_INVALID');values.set(args[i],args[++i]);}
 const projectId=values.get('--project');if(!/^[A-Za-z0-9_-]{1,64}$/.test(projectId||''))throw new Error('PROJECT_REQUIRED');
 const machineRoot=path.resolve(values.get('--machine-root')||path.join(process.env.APPDATA||path.join(os.homedir(),'AppData/Roaming'),'gen-tool-pro/machine'));
 const stateDir=path.resolve(values.get('--state-dir')||path.join(os.homedir(),'.mth/gen2-dashboard',projectId));
 const secretFile=path.resolve(values.get('--secret-file')||path.join(os.homedir(),'.mth/wow-ops-secret.json'));
 const relative=path.relative(machineRoot,stateDir);if(relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw new Error('STATE_INSIDE_GEN2_REFUSED');
 const interval=Number(values.get('--interval-ms')||60000);if(!Number.isFinite(interval)||interval<30000)throw new Error('INTERVAL_TOO_SHORT');
 const unlock=await acquireLock(stateDir);let stopping=false,wake=null;
 const stop=()=>{stopping=true;wake?.();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try {
  const token=await readSecret(secretFile),state=await loadState(stateDir,projectId);
  const api=createApi({token}),reminders=createReminderHook({projectId,machineRoot,stateDir,api});
  const bridge=new Bridge({state,projectId,api,readCache:()=>readCaches(machineRoot),persist:s=>saveState(stateDir,s),shouldStop:()=>stopping,
   afterSync:async context=>{const result=await reminders(context);if(result.polled||!['IDLE','THROTTLED'].includes(result.state))process.stdout.write(JSON.stringify({at:new Date().toISOString(),reminders:result})+'\n');}});
  do {
   try{const result=await bridge.tick();process.stdout.write(JSON.stringify({at:new Date().toISOString(),...result})+'\n');if(result.state==='AUTH_REQUIRED')break;}
   catch{process.stdout.write(JSON.stringify({at:new Date().toISOString(),state:'UNAVAILABLE_RETRY_LATER'})+'\n');}
   if(once||stopping)break;
   await new Promise(resolve=>{const timer=setTimeout(resolve,interval);wake=()=>{clearTimeout(timer);resolve();};});wake=null;
  }while(!stopping);
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);await unlock();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{process.stderr.write('GEN2_BRIDGE_STOPPED_CHECK_LOCAL_STATE\n');process.exitCode=1;});
