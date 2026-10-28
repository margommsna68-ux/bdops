import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {acquireLock} from './io.mjs';

const WEB_ORIGIN='https://wow.lalamail.sbs';
const NOTIFY_URL='http://127.0.0.1:8768/notify';
const HOUR=3600000;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const only=(v,keys)=>Object.keys(v).every(k=>keys.includes(k));
function dueKey(key,projectId){
 if(typeof key!=='string'||!key.startsWith(projectId+':'))return null;
 const rest=key.slice(projectId.length+1),split=rest.indexOf(':');
 return id(rest.slice(0,split))&&iso(rest.slice(split+1))?rest.slice(split+1):null;
}
function validateState(s,projectId){
 if(!object(s)||!only(s,['version','projectId','lastPollAt','entries'])||s.version!==1||s.projectId!==projectId||
  !(s.lastPollAt===null||(Number.isSafeInteger(s.lastPollAt)&&s.lastPollAt>=0))||!object(s.entries)||Object.keys(s.entries).length>20000)throw new Error('REMINDER_STATE_INVALID');
 for(const [key,e] of Object.entries(s.entries)){
  if(!dueKey(key,projectId)||!object(e)||!only(e,['status','attemptedAt','doneAt'])||!iso(e.attemptedAt)||
   !['UNKNOWN','DONE'].includes(e.status)||(e.status==='DONE'?!iso(e.doneAt):e.doneAt!==undefined))throw new Error('REMINDER_STATE_INVALID');
 }
}
export async function loadReminderState(dir,projectId){
 try{
  const file=path.join(dir,'reminders.json'),stat=await fs.stat(file);if(!stat.isFile()||stat.size>8*1024*1024)throw new Error();
  const state=JSON.parse(await fs.readFile(file,'utf8'));validateState(state,projectId);return state;
 }catch(e){if(e.code==='ENOENT')return {version:1,projectId,lastPollAt:null,entries:{}};throw new Error('REMINDER_STATE_UNREADABLE');}
}
export async function saveReminderState(dir,state){
 validateState(state,state.projectId);await fs.mkdir(dir,{recursive:true,mode:0o700});
 const temp=path.join(dir,`.reminders-${process.pid}-${randomUUID()}.tmp`);let file;
 try{
  file=await fs.open(temp,'wx',0o600);await file.writeFile(JSON.stringify(state));await file.sync();await file.close();file=null;
  await fs.rename(temp,path.join(dir,'reminders.json'));
 }catch{throw new Error('REMINDER_STATE_COMMIT_FAILED');}
 finally{if(file)await file.close().catch(()=>{});await fs.unlink(temp).catch(()=>{});}
}
async function lock(dir){
 try{return await acquireLock(path.join(dir,'notification-lock'));}
 catch{throw new Error('REMINDER_BUSY');}
}
async function localToken(machineRoot){
 try{
  const file=path.join(machineRoot,'data','local-port','token');const stat=await fs.stat(file);
  if(!stat.isFile()||stat.size>4096)throw new Error();
  return (await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'').trim();
 }catch{throw new Error('LOCAL_NOTIFY_UNAVAILABLE');}
}
const validToken=t=>typeof t==='string'&&t.length>0&&t.length<=4096&&/^[A-Za-z0-9._~+/-]+={0,2}$/.test(t);
function cleanItem(raw,projectId){
 if(!object(raw)||!iso(raw.dueAt)||dueKey(raw.key,projectId)!==raw.dueAt||!Number.isSafeInteger(raw.daysLeft)||
  typeof raw.packageCode!=='string'||!raw.packageCode.trim()||raw.packageCode.length>128||/[\x00-\x1f\x7f]/.test(raw.packageCode)||
  !(raw.amount===null||(typeof raw.amount==='string'&&/^\d{1,18}(\.\d{1,6})?$/.test(raw.amount)))||
  !(raw.currency===null||['USD','USD_PAYPAL','USDT','VND'].includes(raw.currency))||
  typeof raw.link!=='string'||raw.link.length>2048||/[\x00-\x20\x7f]/.test(raw.link))return null;
 let url;try{url=new URL(raw.link,WEB_ORIGIN);}catch{return null;}
 if(url.origin!==WEB_ORIGIN||url.protocol!=='https:'||url.username||url.password)return null;
 return {key:raw.key,packageCode:raw.packageCode.trim(),dueAt:raw.dueAt,daysLeft:raw.daysLeft,amount:raw.amount,currency:raw.currency,link:url.href};
}
function amountText(amount,currency){
 if(amount===null)return 'xem web';
 const [whole,fraction='']=amount.split('.'),micros=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
 const cents=(micros+5000n)/10000n,decimals=String(cents%100n).padStart(2,'0').replace(/0+$/,'');
 const value=(cents/100n).toLocaleString('en-US')+(decimals?'.'+decimals:'');
 if(currency==='USD'||currency==='USD_PAYPAL')return '$'+value+(currency==='USD_PAYPAL'?' PayPal':'');
 return value+(currency==='VND'?' ₫':currency==='USDT'?' USDT':' (xem đơn vị tiền trên web)');
}
function message(item){
 const due=new Date(item.dueAt).toLocaleDateString('vi-VN',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric'});
 const timing=item.daysLeft<0?`Quá hạn ${-item.daysLeft} ngày`:item.daysLeft===0?'Đến hạn hôm nay':`Còn ${item.daysLeft} ngày`;
 return `Gói proxy ${item.packageCode}\n${timing} · đến hạn ${due}\nChi phí: ${amountText(item.amount,item.currency)}\nXem và xử lý trên web: ${item.link}`;
}

/** Wire under the existing bridge lock: afterSync: createReminderHook({projectId,machineRoot,stateDir,api}).
 * api is io.mjs createApi (HTTPS exact web origin, redirect:error); it owns the source token.
 * Only this module reads the existing local-port token. No Telegram credentials or destination are accepted.
 * State is separate reminders.json. UNKNOWN is written before any notification, and is NEVER retried automatically.
 * Optional fetchImpl/readToken/load/persist support synthetic tests; production needs no overrides.
 */
export function createReminderHook({projectId,machineRoot,stateDir=path.join(os.homedir(),'.mth','gen2-dashboard',String(projectId)),api,
 fetchImpl=fetch,now=Date.now,readToken=()=>localToken(machineRoot),load=()=>loadReminderState(stateDir,projectId),persist=s=>saveReminderState(stateDir,s)}={}){
 if(!id(projectId)||typeof machineRoot!=='string'||!machineRoot||typeof api?.get!=='function')throw new Error('REMINDER_CONFIG_INVALID');
 const relative=path.relative(path.resolve(machineRoot),path.resolve(stateDir));
 if(relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw new Error('REMINDER_STATE_INSIDE_GEN2');
 let busy=false;
 return async function afterSync(context={}){
  const summary={state:'IDLE',polled:false,sent:0,unknown:0,skipped:0,rejected:0};
  if(context.projectId!==undefined&&context.projectId!==projectId)return {...summary,state:'PROJECT_MISMATCH'};
  if(busy)return {...summary,state:'BUSY'};busy=true;let unlock;
  try{
   try{unlock=await lock(stateDir);}catch(e){return {...summary,state:e.message==='REMINDER_BUSY'?'BUSY':'STATE_UNAVAILABLE'};}
   let state;try{state=structuredClone(await load());validateState(state,projectId);}catch{return {...summary,state:'STATE_UNAVAILABLE'};}
   const clock=now();if(!Number.isSafeInteger(clock)||clock<0)return {...summary,state:'CLOCK_INVALID'};
   if(state.lastPollAt!==null&&clock-state.lastPollAt<HOUR)return {...summary,state:'THROTTLED'};
   // Even source-read failures are rate-limited across restarts.
   state.lastPollAt=clock;
   try{await persist(structuredClone(state));}catch{return {...summary,state:'STATE_UNAVAILABLE'};}
   summary.polled=true;let response;
   try{response=await api.get('/gen2-reminders?projectId='+encodeURIComponent(projectId));}catch{return {...summary,state:'SOURCE_UNAVAILABLE'};}
   if(!Array.isArray(response?.items)||response.items.length>1000)return {...summary,state:'SOURCE_INVALID'};
   let token;
   for(const raw of response.items){
    const item=cleanItem(raw,projectId);if(!item){summary.rejected++;continue;}
    if(item.daysLeft>3){summary.skipped++;continue;}
    const previous=state.entries[item.key];
    if(previous){summary.skipped++;if(previous.status==='UNKNOWN')summary.unknown++;continue;}
    if(token===undefined){try{token=await readToken();if(!validToken(token))throw new Error();}catch{return {...summary,state:'NOTIFY_UNAVAILABLE'};}}
    const attemptedAt=new Date(clock).toISOString();state.entries[item.key]={status:'UNKNOWN',attemptedAt};
    try{await persist(structuredClone(state));}catch{return {...summary,state:'STATE_UNAVAILABLE'};}
    let confirmed=false;
    try{
     const result=await fetchImpl(NOTIFY_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({server:'central',text:message(item),kind:'ALERT'})});
     if(result.status===200&&!result.redirected&&(!result.url||result.url===NOTIFY_URL))confirmed=(await result.json())?.ok===true;
    }catch{/* Unknown delivery is already durable. Never store or return transport errors/headers/body. */}
    if(!confirmed){summary.unknown++;continue;}
    state.entries[item.key]={status:'DONE',attemptedAt,doneAt:new Date(now()).toISOString()};
    try{await persist(structuredClone(state));summary.sent++;}catch{return {...summary,state:'STATE_UNAVAILABLE',unknown:summary.unknown+1};}
   }
   summary.state=summary.unknown?'UNKNOWN':summary.sent?'DONE':'IDLE';return summary;
  }finally{busy=false;if(unlock)await unlock().catch(()=>{});}
 };
}
