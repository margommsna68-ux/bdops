#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Journal} from '../fleet-control/journal.mjs';
import {createOpsApi} from './api.mjs';
import {createAe} from './ae.mjs';
import {createSdkReader} from './sdk.mjs';
import {FleetOpsWorker,parseConfig} from './worker.mjs';
// node run.mjs --config <file> [--state-dir <dir>] [--secret-file <file>] [--once]
// Secret file = the Central publisher's existing {"token":"…"} (~/.mth/wow-ops-secret.json). Nothing secret is logged.
const args=process.argv.slice(2),values=new Map();let once=false;
for(let i=0;i<args.length;i++){if(args[i]==='--once'){once=true;continue;}if(!['--config','--state-dir','--secret-file'].includes(args[i])||!args[i+1])throw new Error('ARGUMENT_INVALID');values.set(args[i],args[++i]);}
const configFile=path.resolve(values.get('--config')||path.join(os.homedir(),'.mth/fleet-ops/config.json'));
const stateDir=path.resolve(values.get('--state-dir')||path.join(os.homedir(),'.mth/fleet-ops'));
const secretFile=path.resolve(values.get('--secret-file')||path.join(os.homedir(),'.mth/wow-ops-secret.json'));
const config=parseConfig(JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^﻿/,'')));
const secret=JSON.parse(fs.readFileSync(secretFile,'utf8').replace(/^﻿/,''));
if(typeof secret.token!=='string'||!secret.token)throw new Error('SECRET_UNAVAILABLE');
const log=o=>process.stdout.write(JSON.stringify(o)+'\n');
const worker=new FleetOpsWorker({api:createOpsApi({baseUrl:config.baseUrl,token:secret.token}),ae:createAe({script:config.aeScript}),sdk:createSdkReader({helper:config.sdkHelper}),journal:new Journal(path.join(stateDir,'journal'),{maxOperations:1000}),config,log});
log({at:new Date().toISOString(),start:true,servers:config.servers.map(s=>s.serverId+'@'+s.hostAlias),pollMs:config.pollMs});
let stopping=false;
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stopping=true;worker.stop();});
do{
 await worker.tick();
 if(once||stopping||worker.stopped)break;
 await new Promise(r=>setTimeout(r,config.pollMs));
}while(true);
log({at:new Date().toISOString(),stop:true,stopped:worker.stopped});
