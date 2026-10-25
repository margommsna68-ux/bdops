#!/usr/bin/env node
import * as fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {ApiClient} from './src/api.mjs';import {Store,noLinks} from './src/store.mjs';
import {WorkerPool} from './src/worker.mjs';import {CloakAdapter} from './src/browser.mjs';
import {desktopPath,loadConfig,resourceGate,noOwnedBrowser,secureDirectory,cachedDesktopProbe} from './src/platform.mjs';
import {installRelease,rollback,status,requestStop,start,recoverLocks} from './src/manage.mjs';

async function main(){
  const [command,...args]=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){if(!['--root','--config'].includes(args[i])||!args[i+1]||options[args[i]])throw new Error('ARGUMENTS');options[args[i]]=args[i+1];}
  const source=path.dirname(fileURLToPath(import.meta.url));
  if(command==='version')return {version:JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8')).version};
  if(!['install','start','status','stop','rollback','once','loop','cleanup-recovered','recover-lock'].includes(command))throw new Error('COMMAND');
  const desktop=options['--root']&&command!=='install'?null:await desktopPath();
  const root=options['--root']??path.join(desktop,'MoneyToHome','AppleCheckWorker');
  if(!path.isAbsolute(root))throw new Error('ROOT_ABSOLUTE_REQUIRED');
  await noLinks(root);
  if(command==='install'){
    if(!options['--config'])throw new Error('CONFIG_REQUIRED');await noLinks(options['--config']);
    return installRelease({root,desktop,source,config:JSON.parse(await fs.readFile(options['--config'],'utf8'))});
  }
  if(command==='status')return status(root);
  await secureDirectory(root);
  if(command==='start')return start(root);
  if(command==='stop')return requestStop(root);
  if(command==='rollback')return rollback(root);
  const store=await Store.open(path.join(root,'state'));
  if(command==='recover-lock'){
    return recoverLocks(root,{verifyNoBrowser:noOwnedBrowser});
  }
  // Prevent debug namespaces from printing Playwright options, browser URLs or credentials.
  process.env.DEBUG='';process.env.PWDEBUG='';
  const {config,token}=await loadConfig(options['--config']??path.join(root,'config.json'),root);
  const api=new ApiClient({baseUrl:config.baseUrl,token});
  const adapter=new CloakAdapter({executablePath:config.executablePath,modulePath:config.modulePath});
  const desktopProbe=cachedDesktopProbe();
  const worker=new WorkerPool({store,api,adapter,maxSlots:config.maxSlots,
    gate:({activeSlots=0}={})=>resourceGate({desktopProbe,minFreeMemoryMb:config.minFreeMemoryMb+activeSlots*512}),
    activeGate:()=>resourceGate({desktopProbe,checkMemory:false}),heartbeatMs:config.heartbeatMs,jobTimeoutMs:config.jobTimeoutMs});
  if(command==='cleanup-recovered')return {state:await worker.recoverCleanup()};
  const controller=new AbortController();const abort=()=>controller.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  const stopWatch=setInterval(()=>{void store.read('stop.json').then(s=>{if(s.requested)abort();}).catch(e=>{if(e.code!=='ENOENT')abort();});},500);
  stopWatch.unref();
  try{
    const state=command==='once'?await worker.once({signal:controller.signal}):await worker.loop({signal:controller.signal,pollMs:config.pollMs});
    return {state};
  }finally{clearInterval(stopWatch);process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
try{console.log(JSON.stringify(await main()));}catch{console.error(JSON.stringify({error:'WORKER_COMMAND_FAILED',hint:'Inspect private state with status; see apple-check-worker runbook.'}));process.exitCode=1;}
