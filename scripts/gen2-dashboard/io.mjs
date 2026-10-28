import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const ORIGIN='https://wow.lalamail.sbs';
const nap=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const QUEUE_LIMITS=Object.freeze({targets:1000,items:1000,bytes:4*1024*1024,batch:100});
export function batchSize(value=1) {
 if(typeof value!=='number'&&(typeof value!=='string'||!/^\d{1,3}$/.test(value)))throw new Error('BATCH_SIZE_INVALID');
 const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>QUEUE_LIMITS.batch)throw new Error('BATCH_SIZE_INVALID');return n;
}
/** The entrypoint can pass the remaining args to its existing parser, and the two options to Bridge. */
export function parseTelemetryArgs(input=[]) {
 const args=[],values=new Map();
 for(let i=0;i<input.length;i++) {
  const flag=input[i];if(!['--batch-size','--server'].includes(flag)){args.push(flag);continue;}
  if(values.has(flag)||!input[i+1]||input[i+1].startsWith('--'))throw new Error('ARGUMENT_INVALID');
  values.set(flag,input[++i]);
 }
 const size=batchSize(values.get('--batch-size')),serverId=values.get('--server')??null;
 if(serverId!==null&&(!/^[A-Za-z0-9_-]{1,128}$/.test(serverId)||size===1))throw new Error('SERVER_FILTER_INVALID');
 return {args,batchSize:size,serverId};
}
const scanPath=/^vms\/[A-Za-z0-9_-]{1,128}\/scan-observations$/;
export function validBatch(body) {
 return body&&typeof body.projectId==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(body.projectId)&&
  Object.keys(body).every(k=>['projectId','items'].includes(k))&&Array.isArray(body.items)&&body.items.length>0&&body.items.length<=QUEUE_LIMITS.batch&&
  body.items.every(i=>i&&Object.keys(i).every(k=>['method','path','body','idempotencyKey'].includes(k))&&i.method==='POST'&&scanPath.test(i.path)&&i.body?.projectId===body.projectId&&typeof i.idempotencyKey==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(i.idempotencyKey))&&
  new Set(body.items.map(i=>i.idempotencyKey)).size===body.items.length;
}
export function assertQueueBounds(state) {
 const batches=state.batches??[];
 if(!Array.isArray(batches))throw new Error('STATE_INVALID');
 if(Object.keys(state.entries||{}).length>QUEUE_LIMITS.targets||batches.length>QUEUE_LIMITS.items||
  batches.reduce((n,b)=>n+(b.body?.items?.length||0),state.pending?1:0)>QUEUE_LIMITS.items||Buffer.byteLength(JSON.stringify(state),'utf8')>QUEUE_LIMITS.bytes)throw new Error('QUEUE_FULL');
}
export async function readSecret(file) {
 try{const v=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));if(typeof v.token!=='string'||!v.token||/[\r\n]/.test(v.token))throw new Error();return v.token;}
 catch{throw new Error('SECRET_UNAVAILABLE');}
}
/** @param {{token?:string,fetchImpl?:typeof fetch,now?:()=>number,sleep?:(ms:number)=>Promise<unknown>,onRequest?:(metric:object)=>unknown}} [options] */
export function createApi({token,fetchImpl=fetch,now=Date.now,sleep=nap,onRequest=()=>{}}={}) {
 let lastGet=-Infinity,lastPost=-Infinity,lastWasBatch=false,inFlight=false;
  async function request(method,route,body,key,options={}) {
  if(inFlight)throw new Error('HTTP_ALREADY_RUNNING');
  const batch=method==='POST'&&route==='/batch',heartbeat=method==='POST'&&/^\/servers\/[A-Za-z0-9_-]{1,64}\/monitor-heartbeat$/.test(route);
  const payload=body===undefined?undefined:JSON.stringify(body);
  if(method==='GET'?!/^\/(?:gen2-(?:targets|reminders)|monitor-policy)\?projectId=[A-Za-z0-9_%.-]+$/.test(route):batch?!payload||Buffer.byteLength(payload,'utf8')>QUEUE_LIMITS.bytes||!validBatch(JSON.parse(payload)):heartbeat?!payload||!validHeartbeat(JSON.parse(payload)):!/^\/vms\/[A-Za-z0-9_-]+\/scan-observations$/.test(route))throw new Error('ENDPOINT_REFUSED');
  const url=new URL('/api/ops/v1'+route,ORIGIN);if(url.origin!==ORIGIN||url.protocol!=='https:')throw new Error('ORIGIN_REFUSED');
   const timeoutMs=options.timeoutMs??30000;
   if(Object.keys(options).some(k=>k!=='timeoutMs')||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw Error('HTTP_TIMEOUT_INVALID');
  inFlight=true;
   const started=now(),kind=batch?'batch':heartbeat?'heartbeat':method==='POST'?'scan':route.startsWith('/gen2-targets?')?'targets':route.startsWith('/gen2-reminders?')?'reminders':'policy';
   let waitMs=0,httpStarted=null,status=null,outcome='UNKNOWN',itemStatuses=null;
  try {
   const min=method==='POST'?(batch||lastWasBatch?6500:2300):550,last=method==='POST'?lastPost:lastGet;
    const delay=Math.max(0,min-(now()-last));if(delay){const waiting=now();await sleep(delay);waitMs=Math.max(0,now()-waiting);}
   if(method==='POST'){lastPost=now();lastWasBatch=batch;}else lastGet=now();
    httpStarted=now();let response;try{response=await fetchImpl(url.href,{method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(payload?{body:payload}:{})});}catch{throw new Error('HTTP_UNKNOWN');}
    status=response.status;
   if(response.status===401||response.status===403) {
     outcome='AUTH_REQUIRED';
    if(method==='GET')throw new Error('AUTH_REQUIRED');
    return {status:response.status,data:null,errorCode:null};
   }
   let envelope;try{envelope=await response.json();}catch{throw new Error('HTTP_UNKNOWN');}
    if(batch&&Array.isArray(envelope?.data?.items)&&envelope.data.items.length<=QUEUE_LIMITS.batch){itemStatuses={};for(const row of envelope.data.items){const code=Number.isInteger(row?.status)&&row.status>=100&&row.status<=599?String(row.status):'INVALID';itemStatuses[code]=(itemStatuses[code]??0)+1;}}
    outcome='RESPONSE';
   if(method==='GET'){if(!response.ok||envelope?.ok!==true)throw new Error('TARGET_READ_REFUSED');return envelope.data;}
   return {status:response.status,data:envelope?.ok===true?envelope.data:null,
    errorCode:envelope?.ok===false&&envelope.data===null&&typeof envelope?.error?.code==='string'&&typeof envelope.error.message==='string'?envelope.error.code:null};
   }finally{inFlight=false;try{onRequest({method,kind,durationMs:Math.max(0,now()-started),waitMs,httpMs:httpStarted===null?0:Math.max(0,now()-httpStarted),status,outcome,...(itemStatuses?{itemStatuses}:{})});}catch{/* Diagnostics must never alter delivery/retry semantics. */}}
 }
  return {get:route=>request('GET',route),post:(route,body,key,options)=>request('POST',route,body,key,options)};
}
function validateState(state) {
 if(state?.version!==1||typeof state.projectId!=='string'||!state.entries||typeof state.entries!=='object'||Array.isArray(state.entries))throw new Error('STATE_INVALID');
 assertQueueBounds(state);
 const scan=(v)=>{if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(/token|password|secret|authorization|cookie|chat.?id|thread.?id/i.test(k))throw new Error('STATE_SECRET_REFUSED');scan(x);}};scan(state);
 if(state.pending){const p=state.pending;if(!/^gen2-[a-f0-9-]+$/.test(p.key)||typeof p.vmId!=='string'||!p.body||p.body.projectId!==state.projectId)throw new Error('STATE_INVALID');
  const allowed=new Set(['projectId','expectedCycle','expectedVmRevision','machineUuid','configurationId','observedAt','earning','problem','money','earningObservedAt','monitor']);if(Object.keys(p.body).some(k=>!allowed.has(k)))throw new Error('STATE_INVALID');
 }
 const keys=new Set();
 for(const b of state.batches??[]) {
  if(!/^gen2-batch-[a-f0-9-]+$/.test(b.key)||!validBatch(b.body)||b.body.projectId!==state.projectId||!Array.isArray(b.events)||b.events.length!==b.body.items.length||typeof b.attempted!=='boolean')throw new Error('STATE_INVALID');
  for(const [index,event] of b.events.entries()) {
   const item=b.body.items[index];
   if(!event||typeof event.identity!=='string'||item.path!==`vms/${event.vmId}/scan-observations`||keys.has(item.idempotencyKey))throw new Error('STATE_INVALID');
   keys.add(item.idempotencyKey);
   const allowed=new Set(['projectId','expectedCycle','expectedVmRevision','machineUuid','configurationId','observedAt','earning','problem','money','earningObservedAt','monitor']);
   if(Object.keys(item.body).some(k=>!allowed.has(k)))throw new Error('STATE_INVALID');
  }
 }
}
export async function loadState(dir,projectId) {
 try {const file=path.join(dir,'state.json');if((await fs.stat(file)).size>QUEUE_LIMITS.bytes)throw new Error('QUEUE_FULL');const state=JSON.parse(await fs.readFile(file,'utf8'));validateState(state);if(state.projectId!==projectId)throw new Error('PROJECT_STATE_MISMATCH');return state;}
 catch(e){if(e.code==='ENOENT')return {version:1,projectId,entries:{},pending:null};throw new Error(e.message==='QUEUE_FULL'?'QUEUE_FULL':'STATE_UNREADABLE_DO_NOT_RESET');}
}
export async function saveState(dir,state) {
 validateState(state);const final=path.join(dir,'state.json'),temp=path.join(dir,`.state-${process.pid}-${randomUUID()}.tmp`);
 await fs.mkdir(dir,{recursive:true,mode:0o700});const file=await fs.open(temp,'wx',0o600);
 try{try{await file.writeFile(JSON.stringify(state));await file.sync();}finally{await file.close();}}
 catch{await fs.unlink(temp).catch(()=>{});throw new Error('STATE_COMMIT_FAILED');}
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

export function validHeartbeat(b){
 if(!b||Object.keys(b).some(k=>!['projectId','source','serverUuid','instanceUuid','startedAt','seq','configVersion','observedAt','counts'].includes(k)))return false;
 const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
 return typeof b.projectId==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(b.projectId)&&['CENTRAL','AGENT'].includes(b.source)&&uuid.test(b.serverUuid)&&uuid.test(b.instanceUuid)&&
 Number.isSafeInteger(b.seq)&&b.seq>=0&&b.seq<=2147483647&&Number.isInteger(b.configVersion)&&b.configVersion>=1&&b.configVersion<=100000&&
 typeof b.startedAt==='string'&&typeof b.observedAt==='string'&&Number.isFinite(Date.parse(b.startedAt))&&Date.parse(b.startedAt)<=Date.parse(b.observedAt)&&
 b.counts&&Object.keys(b.counts).length===5&&['managed','inventory','guest','proxy','app'].every(k=>Number.isInteger(b.counts[k])&&b.counts[k]>=0&&b.counts[k]<=100000&&b.counts[k]<=b.counts.managed);
}
