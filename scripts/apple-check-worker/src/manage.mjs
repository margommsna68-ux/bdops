import * as fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {noLinks,atomicJson} from './store.mjs';
import {inside,validateConfig,secureDirectory} from './platform.mjs';
const VERSION=/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;
async function maybe(file){await noLinks(file);try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function stopped(root){if((await status(root)).locked||await maybe(path.join(root,'state','launcher.json')))throw new Error('STOP_WORKER_FIRST');}
async function collect(source,relative=''){
  const files=[];await noLinks(path.join(source,relative));
  for(const name of await fs.readdir(path.join(source,relative))){
    const rel=path.join(relative,name),f=path.join(source,rel),s=await fs.lstat(f);
    if(s.isSymbolicLink())throw new Error('UNSAFE_LINK');
    if(s.isDirectory())files.push(...await collect(source,rel));else if(s.isFile())files.push(rel);else throw new Error('UNSAFE_FILE');
  }return files;
}
export async function installRelease({root,desktop,source,config,secure=directory=>secureDirectory(directory,{apply:true})}){
  const parent=path.join(desktop,'MoneyToHome');
  if(!inside(parent,root)||path.dirname(path.resolve(root))!==path.resolve(parent))throw new Error('INSTALL_ROOT');
  await noLinks(root);await fs.mkdir(root,{recursive:true});await noLinks(root);
  const existing=await fs.readdir(root);if(existing.length&&!await maybe(path.join(root,'installation.json')))throw new Error('INSTALL_ROOT_NOT_OWNED');
  await secure(root);await atomicJson(path.join(root,'installation.json'),{kind:'apple-check-worker'});await stopped(root);
  for(const name of ['private','state','releases','dependencies'])await fs.mkdir(path.join(root,name),{recursive:true,mode:0o700});
  const normalized=validateConfig(config,root);
  await noLinks(source);const pkg=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
  if(pkg.name!=='moneytohome-apple-check-worker'||!VERSION.test(pkg.version))throw new Error('RELEASE_VERSION');
  const files=['package.json','worker.mjs',...(await collect(path.join(source,'src'))).map(f=>path.join('src',f))];
  const release=path.join(root,'releases',pkg.version);await noLinks(release);
  const manifest={version:pkg.version,files:{}};
  for(const rel of files){await noLinks(path.join(source,rel));const bytes=await fs.readFile(path.join(source,rel));manifest.files[rel.replaceAll(path.sep,'/')]=createHash('sha256').update(bytes).digest('hex');}
  const prior=await maybe(path.join(root,'active.json'));
  const installed=await maybe(path.join(release,'manifest.json'));
  if(installed){if(JSON.stringify(installed)!==JSON.stringify(manifest))throw new Error('RELEASE_IMMUTABLE');}
  else{
    const stage=path.join(root,'releases',`.stage-${randomUUID()}`);await fs.mkdir(stage);
    for(const rel of files){const dest=path.join(stage,rel);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(source,rel),dest,fs.constants.COPYFILE_EXCL);}
    await atomicJson(path.join(stage,'manifest.json'),manifest);await noLinks(release);await fs.rename(stage,release);
  }
  if(!await maybe(path.join(root,'config.json')))await atomicJson(path.join(root,'config.json'),normalized);
  await atomicJson(path.join(root,'active.json'),{version:pkg.version,previousVersion:prior?.version===pkg.version?prior.previousVersion:prior?.version??null});
  return {version:pkg.version};
}
export async function verifyRelease(root,version){
  if(!VERSION.test(version))throw new Error('RELEASE_VERSION');const directory=path.join(root,'releases',version);
  const manifest=await maybe(path.join(directory,'manifest.json'));if(!manifest||manifest.version!==version)throw new Error('RELEASE_MANIFEST');
  for(const [rel,digest] of Object.entries(manifest.files)){
    const file=path.join(directory,rel);if(!inside(directory,file))throw new Error('RELEASE_PATH');await noLinks(file);
    if(createHash('sha256').update(await fs.readFile(file)).digest('hex')!==digest)throw new Error('RELEASE_TAMPERED');
  }
  return path.join(directory,'worker.mjs');
}
export async function status(root){
  const active=await maybe(path.join(root,'active.json')),lock=await maybe(path.join(root,'state','worker.lock'));
  const last=await maybe(path.join(root,'state','status.json')),pending=await maybe(path.join(root,'state','pending.json'));
  const claim=await maybe(path.join(root,'state','claim-inflight.json')),q=await maybe(path.join(root,'state','quarantine.json'));
  const slots=[];
  for(let slot=1;slot<=5;slot++){
    const directory=path.join(root,'state','slots',`slot${slot}`),held=await maybe(path.join(directory,'worker.lock'));
    const p=await maybe(path.join(directory,'pending.json')),c=await maybe(path.join(directory,'claim-inflight.json')),quarantine=await maybe(path.join(directory,'quarantine.json')),s=await maybe(path.join(directory,'status.json'));
    slots.push({slot,locked:!!held,state:quarantine||p?.report?.cleanup==='FAILED'?'CLEANUP_FAILED':held?'BUSY':p?'PENDING':c?'PENDING_CLAIM':s?.state??'IDLE'});
  }
  const activeCount=Math.max(slots.filter(s=>s.locked).length,lock&&Number.isInteger(last?.activeCount)?Math.min(5,Math.max(0,last.activeCount)):0);
  const legacyState=q||pending?.report?.cleanup==='FAILED'?'CLEANUP_FAILED':pending?'PENDING':claim?'PENDING_CLAIM':'IDLE';
  const state=legacyState==='CLEANUP_FAILED'||slots.some(s=>s.state==='CLEANUP_FAILED')?'CLEANUP_FAILED':activeCount?'BUSY':legacyState!=='IDLE'?legacyState:
    ['PENDING','PENDING_CLAIM'].find(s=>slots.some(x=>x.state===s))??last?.state??'STOPPED';
  return {version:active?.version??null,previousVersion:active?.previousVersion??null,locked:!!lock||slots.some(s=>s.locked),pid:Number.isInteger(lock?.pid)?lock.pid:null,
    state,activeCount,slots,legacyState,lastSeenAt:last?.at??null};
}
export async function recoverLocks(root,{isAlive=async pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}},verifyNoBrowser}={}){
  const stateRoot=path.join(root,'state');const files=Array.from({length:5},(_,i)=>path.join(stateRoot,'slots',`slot${i+1}`,'worker.lock'));files.push(path.join(stateRoot,'worker.lock'));
  const locks=[];
  for(const file of files){const lock=await maybe(file);if(!lock)continue;if(!Number.isInteger(lock.pid)||lock.pid<1)throw new Error('LOCK_IDENTITY_INVALID');if(await isAlive(lock.pid))throw new Error('WORKER_STILL_RUNNING');locks.push({file,lock});}
  if(!verifyNoBrowser||!await verifyNoBrowser(stateRoot))throw new Error('OWNED_BROWSER_UNRESOLVED');
  for(const {file,lock} of locks){if(JSON.stringify(await maybe(file))!==JSON.stringify(lock))throw new Error('LOCK_IDENTITY_CHANGED');await noLinks(file);await fs.unlink(file);}
  return {lockRecovered:true};
}
export async function requestStop(root){await atomicJson(path.join(root,'state','stop.json'),{requested:true});return {stopRequested:true};}
export async function rollback(root){
  await stopped(root);const active=await maybe(path.join(root,'active.json'));
  for(let slot=1;slot<=5;slot++)for(const name of ['pending.json','claim-inflight.json','quarantine.json']){
    const file=path.join(root,'state','slots',`slot${slot}`,name);await noLinks(file);
    try{await fs.lstat(file);throw new Error('ROLLBACK_UNRESOLVED_SLOT_STATE');}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  if(!active?.previousVersion)throw new Error('ROLLBACK_UNAVAILABLE');await verifyRelease(root,active.previousVersion);
  await atomicJson(path.join(root,'active.json'),{version:active.previousVersion,previousVersion:active.version});return {version:active.previousVersion};
}
export async function start(root){
  await stopped(root);await secureDirectory(root);const active=await maybe(path.join(root,'active.json'));
  const entry=await verifyRelease(root,active?.version);await noLinks(path.join(root,'state','stop.json'));await fs.unlink(path.join(root,'state','stop.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});
  const claim=path.join(root,'state','launcher.json');const guard=await fs.open(claim,'wx',0o600);await guard.writeFile(JSON.stringify({at:new Date().toISOString()}));await guard.close();
  try{
    const child=spawn(process.execPath,[entry,'loop','--root',root],{cwd:root,windowsHide:true,detached:true,stdio:'ignore',env:{...process.env,DEBUG:'',PWDEBUG:''}});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return {started:true,pid:child.pid};
  }finally{await noLinks(claim);await fs.unlink(claim);}
}
