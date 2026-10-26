import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const stamp=s=>typeof s==='string'&&s.length<=40&&Number.isFinite(Date.parse(s));
const keys=(x,allowed)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>allowed.includes(k));
const one=(x,allowed)=>allowed.includes(x);
const probes=['OK','FAILED','TIMEOUT','HTTP_403','HTTP_429','UNKNOWN'];
export function canarySourceAllowed(serverUuid,raw){try{
  const ids=JSON.parse(raw||'null');return uuid.test(serverUuid||'')&&Array.isArray(ids)&&ids.length>0&&ids.length<=100
    &&ids.every(id=>typeof id==='string'&&uuid.test(id))&&new Set(ids).size===ids.length&&ids.includes(serverUuid);
}catch{return false;}}
const axisKeys={vmState:['observedAt','state'],guest:['observedAt','additions','response'],network:['observedAt','provenance','ncsi','https'],
  app:['observedAt','earnApp','sdk','connection']};
const enums={state:['RUNNING','PAUSED','ABORTED','POWERED_OFF','STARTING','STOPPING','UNKNOWN'],additions:['PRESENT','ABSENT','UNKNOWN'],
  response:['RESPONSIVE','AUTH_FAILED','TIMEOUT','UNAVAILABLE','UNKNOWN'],provenance:['HOST','GUEST'],ncsi:['INTERNET','LIMITED','NONE','UNKNOWN'],
  https:probes,earnApp:['RUNNING','STOPPED','UNKNOWN'],sdk:['RUNNING','STOPPED','UNKNOWN'],connection:['VERIFIED','NOT_OBSERVED','UNKNOWN']};
export function sanitizeNativeSource(value){try{
  const bytes=JSON.stringify(value);if(!bytes||Buffer.byteLength(bytes)>1048576)return null;
  const s=JSON.parse(bytes);
  if(!keys(s,['schema','source','serverUuid','instanceUuid','startedAt','seq','configVersion','observedAt','sourceAt','counts','policy','guestSlot','inventoryAt','inventoryReason','samples'])
    ||s.schema!==1||s.source!=='AGENT'||!uuid.test(s.serverUuid)||!uuid.test(s.instanceUuid)||s.configVersion!==1
    ||!Number.isInteger(s.seq)||s.seq<0||s.seq>2147483647||!stamp(s.startedAt)||!stamp(s.observedAt)
    ||s.sourceAt!==s.observedAt||Date.parse(s.startedAt)>Date.parse(s.observedAt)||!Array.isArray(s.samples)||s.samples.length>1000)return null;
  if(s.inventoryAt!==null&&(!stamp(s.inventoryAt)||Date.parse(s.inventoryAt)>Date.parse(s.observedAt)))return null;
  if(!one(s.inventoryReason,[null,'INVENTORY_TIMEOUT','INVENTORY_UNAVAILABLE']))return null;
  if(s.guestSlot&&(!keys(s.guestSlot,['state','observedAt','reason'])||!one(s.guestSlot.state,['IDLE','RUNNING','QUARANTINED'])
    ||!stamp(s.guestSlot.observedAt)||Date.parse(s.guestSlot.observedAt)>Date.parse(s.observedAt)
    ||!one(s.guestSlot.reason,[null,'GUEST_CLEANUP_UNVERIFIED','SOURCE_PERSIST_FAILED','PREVIOUS_PROBE_UNVERIFIED'])))return null;
  if(!keys(s.counts,['managed','inventory','guest','proxy','app'])||Object.keys(s.counts).length!==5||s.counts.managed!==s.samples.length
    ||Object.values(s.counts).some(n=>!Number.isInteger(n)||n<0||n>s.samples.length))return null;
  if(s.policy&&(!keys(s.policy,['version','inventorySeconds','guestSeconds','proxySeconds','healthStaleSeconds','heartbeatSeconds','heartbeatStaleSeconds','startupGraceSeconds',
    'recheckSeconds','guestTimeoutSeconds','inventoryTimeoutSeconds','proxyTimeoutSeconds','guestConcurrency','proxyConcurrency','retryLimit','retryBackoffSeconds',
    'telemetryFlushSeconds','queueMaxItems','logMaxBytes','logRetentionDays','moneySeconds'])||Object.values(s.policy).some(n=>!Number.isInteger(n)||n<0||n>100000000)))return null;
  const ids=new Set();
  for(const r of s.samples){
    if(!keys(r,['machineUuid','vmCode','observedAt','monitor','unknowns','proxyEvidence'])||!uuid.test(r.machineUuid)||ids.has(r.machineUuid)||!/^[A-Za-z0-9_.-]{1,40}$/.test(r.vmCode||'')
      ||r.observedAt!==s.observedAt||!keys(r.monitor,['configVersion',...Object.keys(axisKeys)])||r.monitor.configVersion!==1)return null;
    ids.add(r.machineUuid);
    if(!keys(r.unknowns,['service','ncsi','guestHttps','guestAppliedProxy','earning'])||Object.values(r.unknowns).some(v=>v!=='UNKNOWN'))return null;
    for(const [name,fields] of Object.entries(axisKeys)){const a=r.monitor[name];if(!a)continue;
      if(!keys(a,fields)||Object.keys(a).length!==fields.length||!stamp(a.observedAt)||Date.parse(a.observedAt)>Date.parse(s.observedAt))return null;
      for(const k of fields)if(k!=='observedAt'&&!one(a[k],enums[k]))return null;
    }
    const p=r.proxyEvidence;
    if(p&&(!keys(p,['observedAt','provenance','proxyAddressFingerprint','tcp','auth','https','reason'])
      ||Object.keys(p).length!==7||!stamp(p.observedAt)||Date.parse(p.observedAt)>Date.parse(s.observedAt)||p.provenance!=='HOST'
      ||(p.proxyAddressFingerprint!==null&&!/^[0-9a-f]{64}$/.test(p.proxyAddressFingerprint))||!one(p.tcp,probes)||!one(p.https,probes)
      ||!one(p.auth,['OK','FAILED','NOT_TESTED','UNKNOWN'])||!one(p.reason,['HOST_HTTPS_OK','AUTH_FAILED','TIMEOUT','APPLIED_PROXY_UNVERIFIED','APPLIED_PROXY_CHANGED','HOST_NETWORK_UNAVAILABLE','ENDPOINT_OR_TRANSPORT_ERROR','PROXY_UNREADABLE'])))return null;
  }
  return s;
}catch{return null;}}
const digest=s=>crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');
export function persistNativeSource({dir,expectedServerUuid,snapshot,now=()=>Date.now()}={}){
  const s=sanitizeNativeSource(snapshot);
  if(!s||s.serverUuid!==expectedServerUuid||!uuid.test(expectedServerUuid)||Date.parse(s.observedAt)>now())throw Error('NATIVE_SOURCE_INVALID');
  const file=path.join(dir,expectedServerUuid+'.json');let previous=null;
  try{if(fs.statSync(file).size>1049000)throw Error('NATIVE_SOURCE_TOO_LARGE');previous=JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw Error('NATIVE_SOURCE_UNREADABLE');}
  if(previous){const {receivedAt,...old}=previous;
    if(old.instanceUuid===s.instanceUuid&&old.seq===s.seq){if(digest(old)!==digest(s))throw Error('NATIVE_SOURCE_CONFLICT');return {stored:false,replay:true};}
    if(Date.parse(s.observedAt)<Date.parse(old.observedAt)||
      (old.instanceUuid===s.instanceUuid?(s.seq<=old.seq||s.startedAt!==old.startedAt):Date.parse(s.startedAt)<=Date.parse(old.startedAt)))throw Error('NATIVE_SOURCE_REGRESSION');
  }
  fs.mkdirSync(dir,{recursive:true});const tmp=file+'.tmp';
  try{fs.writeFileSync(tmp,JSON.stringify({...s,receivedAt:new Date(now()).toISOString()}),{mode:0o600});fs.renameSync(tmp,file);}
  finally{try{fs.unlinkSync(tmp);}catch{/* renamed */}}
  return {stored:true,replay:false};
}
