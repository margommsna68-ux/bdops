import {config,parse} from 'dotenv';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import bcrypt from 'bcryptjs';
import {encrypt} from '../src/lib/encryption';
import {createProxyBatchService} from '../src/server/proxy-management/batches';
config({quiet:true});
const target=new URL(process.env.DATABASE_URL||'');
if(target.hostname!=='127.0.0.1'||target.port!=='55432'||target.pathname!=='/proxy_app_trial') throw new Error('Trial bootstrap requires the dedicated localhost proxy_app_trial database');
mkdirSync('.runtime',{recursive:true});
const sourcePath=resolve('.runtime/genjy-demo.json').replace(/\\/g,'/');
writeFileSync(sourcePath,JSON.stringify({spreadsheetId:'demo-only',tabs:[{id:'1',name:'PC',hidden:false,cells:[{a1:'A1',row:1,column:1,value:'192.0.2.210'}]}]}));
const source=JSON.stringify({key:'GENJY',spreadsheetId:'demo-only',credentialRef:'GOOGLE_SHEETS',mode:'LOCAL_SNAPSHOT',localSnapshotPath:sourcePath});
const envText=readFileSync('.env','utf8').replace(/^APP_ENV=.*\r?\n/gm,'').replace(/^GENJY_SOURCE_JSON=.*\r?\n/gm,'');
writeFileSync('.env',envText+`APP_ENV=trial\nGENJY_SOURCE_JSON='${source}'\n`);process.env.GENJY_SOURCE_JSON=source;process.env.APP_ENV='trial';
const db=new PrismaClient();
async function main(){
  const project=await db.project.upsert({where:{code:'PROXY_TRIAL'},create:{code:'PROXY_TRIAL',name:'Proxy & VM — Bản thử',settings:{businessMode:'PROXY_VM'}},update:{}});
  // Synthetic QA credentials, exclusively on the guarded localhost trial database.
  const user=await db.user.upsert({where:{username:'proxy-trial'},create:{username:'proxy-trial',email:'proxy-trial@example.invalid',name:'Bản thử',password:await bcrypt.hash('DemoOnly_Proxy_2026!',12),pin:await bcrypt.hash('123456',12)},update:{pin:await bcrypt.hash('123456',12)}});
  await db.projectMember.upsert({where:{userId_projectId:{userId:user.id,projectId:project.id}},create:{userId:user.id,projectId:project.id,role:'ADMIN'},update:{}});
  await db.proxyProviderAccount.upsert({where:{projectId_code:{projectId:project.id,code:'231243'}},create:{projectId:project.id,code:'231243',label:'231243',credentialCipher:encrypt(JSON.stringify({username:'demo',password:'demo-only'}))},update:{}});
  const scope={userId:user.id,projectId:project.id,role:'ADMIN' as const,capabilities:[]};const service=createProxyBatchService(db);
  if(!await db.proxyIP.count({where:{projectId:project.id}})){
    const key=randomUUID(),p=await service.preview(scope,{kind:'NEW',owner:'SELF',text:[101,102,103,104,105,106].map(n=>`192.0.2.${n}:5432:demo:demo-only`).join('\n'),idempotencyKey:key});await service.commit(scope,p.token,key);
    const bKey=randomUUID(),blocked=await service.preview(scope,{kind:'BLOCKED',text:'192.0.2.103\n192.0.2.104',idempotencyKey:bKey});await service.commit(scope,blocked.token,bKey);
    const rKey=randomUUID(),replaced=await service.preview(scope,{kind:'REPLACE',removedText:'192.0.2.104',addedText:'198.51.100.104',receivedDate:'2026-10-14',idempotencyKey:rKey});await service.commit(scope,replaced.token,rKey);
  }
  console.log('Local synthetic trial ready. Project PROXY_TRIAL; no production or provider data imported.');
}
main().finally(()=>db.$disconnect());
