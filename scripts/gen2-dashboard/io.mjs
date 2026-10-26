import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const ORIGIN='https://wow.lalamail.sbs';
const nap=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function readSecret(file) {
 try{const v=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));if(typeof v.token!=='string'||!v.token||/[\r\n]/.test(v.token))throw new Error();return v.token;}
 catch{throw new Error('SECRET_UNAVAILABLE');}
}
export function createApi({token,fetchImpl=fetch,now=Date.now,sleep=nap}={}) {
 let lastGet=-Infinity,lastPost=-Infinity,inFlight=false;
 async function request(method,route,body,key) {
  if(inFlight)throw new Error('HTTP_ALREADY_RUNNING');
  if(method==='GET'?!/^\/gen2-(?:targets|reminders)\?projectId=[A-Za-z0-9_%.-]+$/.test(route):!/^\/vms\/[A-Za-z0-9_-]+\/scan-observations$/.test(route))throw new Error('ENDPOINT_REFUSED');
  const url=new URL('/api/ops/v1'+route,ORIGIN);if(url.origin!==ORIGIN||url.protocol!=='https:')throw new Error('ORIGIN_REFUSED');
  inFlight=true;
  try {
   const min=method==='POST'?2300:550,last=method==='POST'?lastPost:lastGet;
   const delay=Math.max(0,min-(now()-last));if(delay)await sleep(delay);
   if(method==='POST')lastPost=now();else lastGet=now();
   let response;try{response=await fetchImpl(url.href,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new Error('HTTP_UNKNOWN');}
   let envelope;try{envelope=await response.json();}catch{throw new Error('HTTP_UNKNOWN');}
   if(method==='GET'){if(!response.ok||envelope?.ok!==true)throw new Error('TARGET_READ_REFUSED');return envelope.data;}
   return {status:response.status,data:envelope?.ok===true?envelope.data:null,
    errorCode:envelope?.ok===false&&envelope.data===null&&typeof envelope?.error?.code==='string'&&typeof envelope.error.message==='string'?envelope.error.code:null};
  }finally{inFlight=false;}
 }
 return {get:route=>request('GET',route),post:(route,body,key)=>request('POST',route,body,key)};
}
function validateState(state) {
 if(state?.version!==1||typeof state.projectId!=='string'||!state.entries||typeof state.entries!=='object'||Array.isArray(state.entries))throw new Error('STATE_INVALID');
 const scan=(v)=>{if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(/token|password|secret|authorization|cookie|chat.?id|thread.?id/i.test(k))throw new Error('STATE_SECRET_REFUSED');scan(x);}};scan(state);
 if(state.pending){const p=state.pending;if(!/^gen2-[a-f0-9-]+$/.test(p.key)||typeof p.vmId!=='string'||!p.body||p.body.projectId!==state.projectId)throw new Error('STATE_INVALID');
  const allowed=new Set(['projectId','expectedCycle','expectedVmRevision','machineUuid','configurationId','observedAt','earning','problem','money']);if(Object.keys(p.body).some(k=>!allowed.has(k)))throw new Error('STATE_INVALID');
 }
}
export async function loadState(dir,projectId) {
 try {const state=JSON.parse(await fs.readFile(path.join(dir,'state.json'),'utf8'));validateState(state);if(state.projectId!==projectId)throw new Error('PROJECT_STATE_MISMATCH');return state;}
 catch(e){if(e.code==='ENOENT')return {version:1,projectId,entries:{},pending:null};throw new Error('STATE_UNREADABLE_DO_NOT_RESET');}
}
export async function saveState(dir,state) {
 validateState(state);const final=path.join(dir,'state.json'),temp=path.join(dir,`.state-${process.pid}-${randomUUID()}.tmp`);
 await fs.mkdir(dir,{recursive:true,mode:0o700});const file=await fs.open(temp,'wx',0o600);
 try{await file.writeFile(JSON.stringify(state));await file.sync();}finally{await file.close();}
 try{await fs.rename(temp,final);}catch{await fs.unlink(temp).catch(()=>{});throw new Error('STATE_COMMIT_FAILED');}
}
/** Only a valid lock with an OS-confirmed dead PID can be reclaimed. */
async function recoverDeadLock(file) {
 const guardFile=file+'.recovery',guard=await fs.open(guardFile,'wx',0o600);
 try {
  const before=await fs.readFile(file),record=JSON.parse(before.toString('utf8'));
  if(!record||Array.isArray(record)||Object.keys(record).length!==2||
   !Number.isSafeInteger(record.pid)||record.pid<1||record.pid>2147483647||
   typeof record.startedAt!=='string'||!Number.isFinite(Date.parse(record.startedAt))||
   new Date(record.startedAt).toISOString()!==record.startedAt)throw new Error('LOCK_INVALID');
  let dead=false;
  try{process.kill(record.pid,0);}catch(error){if(error.code!=='ESRCH')throw error;dead=true;}
  if(!dead)throw new Error('LOCK_OWNER_ALIVE');
  // Guard serializes cooperating recoveries. A normal wx claim cannot replace this
  // existing file until it is removed; a changed/replaced record is never removed.
  if(!before.equals(await fs.readFile(file)))throw new Error('LOCK_CHANGED');
  await fs.unlink(file);
 }finally{
  await guard.close();await fs.unlink(guardFile);
 }
}
/** No age-based recovery; live, EPERM, malformed or ambiguous locks remain untouched. */
export async function acquireLock(dir) {
 await fs.mkdir(dir,{recursive:true,mode:0o700});const file=path.join(dir,'bridge.lock');let handle;
 try{
  try{handle=await fs.open(file,'wx',0o600);}
  catch(error){if(error.code!=='EEXIST')throw error;await recoverDeadLock(file);handle=await fs.open(file,'wx',0o600);}
  await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));await handle.sync();
 }
 catch{if(handle)await handle.close();throw new Error('LOCK_HELD_OR_UNAVAILABLE');}
 return async()=>{await handle.close();await fs.unlink(file);};
}
