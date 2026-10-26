// Single bounded latest source file for bridge pickup; no journal/history, no raw guest data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {validatePreflightProof} from './native-monitor-preflight.mjs';
export function sourceWriteError(error){
  const allowed=new Set(['EPERM','EACCES','EBUSY','ENOENT','ENOSPC','EROFS','EIO']);
  const code=allowed.has(error?.code)?error.code:/^SOURCE_[A-Z_0-9]+$/.test(error?.message||'')?error.message:'SOURCE_WRITE_FAILED';
  const phase=['VALIDATE','CLOCK','MKDIR','TEMP_WRITE','RENAME'].includes(error?.sourcePhase)?error.sourcePhase:'UNKNOWN';
  const out={code,phase};for(const key of ['sourceObservedAt','writerStartedAt','nowAt'])if(typeof error?.[key]==='string'&&Number.isFinite(Date.parse(error[key])))out[key]=error[key];return out;
}
const fields=new Set(['configVersion','serverId','sequence','sourceAt','inventoryAt','inventoryReason','inventoryFreshness','guestSlot',
  'policy','proxyInFlight','samples','uuid','vmCode','vmState','observedAt','state','guest','additions','response','app','earnApp','sdk','connection',
  'network','provenance','ncsi','https','service','appliedProxy','proxy','probeReason','vmStateFreshness','healthFreshness','monitoringGap',
  'endpointId','appliedConfigurationId','proxyAddressFingerprint','tcp','auth','reason',
  'version','inventorySeconds','guestSeconds','proxySeconds','healthStaleSeconds','heartbeatSeconds','heartbeatStaleSeconds','startupGraceSeconds',
  'recheckSeconds','guestTimeoutSeconds','inventoryTimeoutSeconds','proxyTimeoutSeconds','guestConcurrency','proxyConcurrency','retryLimit',
  'retryBackoffSeconds','telemetryFlushSeconds','queueMaxItems','logMaxBytes','logRetentionDays','moneySeconds']);
const code=/^[A-Z][A-Z_0-9]{0,63}$/;
const iso=s=>typeof s==='string'&&s.length<=40&&Number.isFinite(Date.parse(s));
function validate(x,key='') {
  if(x==null||typeof x==='boolean')return;
  if(typeof x==='number'){if(!Number.isFinite(x)||x<0)throw Error('SOURCE_NUMBER');return;}
  if(typeof x==='string'){
    const good=key==='vmCode'?/^[A-Za-z0-9_.-]{1,40}$/.test(x):key==='proxyAddressFingerprint'?/^[0-9a-f]{64}$/.test(x):key==='uuid'?/^[0-9a-f-]{36}$/i.test(x):key==='endpointId'||key==='appliedConfigurationId'?/^(native|applied)_[0-9a-f]{40}$/.test(x)
      :key.endsWith('At')?iso(x):key==='serverId'?/^[A-Za-z0-9_-]{1,64}$/.test(x):code.test(x);
    if(!good)throw Error('SOURCE_VALUE');return;
  }
  if(Array.isArray(x)){if(key!=='samples'||x.length>1000)throw Error('SOURCE_BOUND');for(const r of x)validate(r);return;}
  if(typeof x!=='object')throw Error('SOURCE_TYPE');
  for(const [k,v] of Object.entries(x)){if(!fields.has(k))throw Error('SOURCE_FIELD');validate(v,k);}
}
export function createMonitorSourceWriter({file,serverUuid,instanceUuid=crypto.randomUUID(),now=()=>Date.now()}={}) {
  const startedAt=new Date(now()).toISOString();let seq=0;
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(serverUuid||'')
    ||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(instanceUuid))throw Error('SOURCE_IDENTITY');
  return snapshot=>{
    try{validate(snapshot);}catch(error){error.sourcePhase='VALIDATE';throw error;}
    if(seq>=2147483647)throw Error('SOURCE_SEQUENCE_EXHAUSTED');
    const observedAt=snapshot.sourceAt||new Date(now()).toISOString(),at=Date.parse(observedAt);
    if(at<Date.parse(startedAt)||at>now())throw Object.assign(Error('SOURCE_CLOCK'),{sourcePhase:'CLOCK',sourceObservedAt:observedAt,writerStartedAt:startedAt,nowAt:new Date(now()).toISOString()});
    const fresh=(axis,seconds)=>axis&&Number.isFinite(Date.parse(axis.observedAt))&&at>=Date.parse(axis.observedAt)&&at-Date.parse(axis.observedAt)<seconds*1000;
    const samples=(snapshot.samples||[]).map(s=>{
      const monitor={configVersion:1};if(s.vmState)monitor.vmState=s.vmState;
      if(s.probeReason&&s.probeReason!=='NOT_OBSERVED')for(const key of ['guest','app','network'])if(s[key])monitor[key]=s[key];
      if(!/^[A-Za-z0-9_.-]{1,40}$/.test(s.vmCode||''))throw Error('SOURCE_VM_CODE');
      return {machineUuid:s.uuid,vmCode:s.vmCode,observedAt,monitor,
        unknowns:{service:'UNKNOWN',ncsi:'UNKNOWN',guestHttps:'UNKNOWN',guestAppliedProxy:'UNKNOWN',earning:'UNKNOWN'},
        ...(s.proxy?{proxyEvidence:{observedAt:s.proxy.observedAt,provenance:s.proxy.provenance,
          proxyAddressFingerprint:s.proxy.proxyAddressFingerprint??null,tcp:s.proxy.tcp,auth:s.proxy.auth,https:s.proxy.https,
          reason:s.proxy.reason}}:{})};
    });
    // Exactly the heartbeat field names in fleet-monitor-v1.md; project/server web IDs are resolved by bridge.
    const counts={managed:samples.length,inventory:0,guest:0,proxy:0,app:0};
    for(const s of samples){if(fresh(s.monitor.vmState,60))counts.inventory++;if(fresh(s.monitor.guest,1200))counts.guest++;
      if(fresh(s.monitor.app,1200))counts.app++;if(fresh(s.proxyEvidence,1200))counts.proxy++;}
    const value={schema:1,source:'AGENT',serverUuid,instanceUuid,startedAt,seq:seq+1,configVersion:1,observedAt,sourceAt:observedAt,
      counts,policy:snapshot.policy,guestSlot:snapshot.guestSlot??{state:'IDLE',observedAt,reason:null},inventoryAt:snapshot.inventoryAt??null,inventoryReason:snapshot.inventoryReason??null,samples};
    const bytes=JSON.stringify(value);
    if(Buffer.byteLength(bytes)>1048576)throw Error('SOURCE_TOO_LARGE');
    const temporary=file+'.tmp';
    let phase='MKDIR';
    try{fs.mkdirSync(path.dirname(file),{recursive:true});phase='TEMP_WRITE';fs.writeFileSync(temporary,bytes,{mode:0o600});phase='RENAME';fs.renameSync(temporary,file);seq++;return JSON.parse(bytes);}
    catch(error){error.sourcePhase=phase;throw error;}
    finally{try{fs.unlinkSync(temporary);}catch{/* successfully renamed or absent */}}
  };
}
export function readGuestQuarantine(file,serverUuid,{reconcilePreflight=false,previousBuildFingerprint=null,onPreflightRecovered=()=>{}}={}){
  try{if(fs.statSync(file).size>1048576)return true;const bytes=fs.readFileSync(file),s=JSON.parse(bytes.toString('utf8'));
    if(reconcilePreflight){
      const audit=path.join(path.dirname(file),'preflight-reconciliation.json');
      try{const st=fs.lstatSync(audit);if(st.isFile()&&!st.isSymbolicLink()&&st.size<=8192){const proof=JSON.parse(fs.readFileSync(audit,'utf8'));
        if(validatePreflightProof(bytes,serverUuid,previousBuildFingerprint,proof)){onPreflightRecovered(proof);return false;}
      }}catch{/* Missing or conflicting audit never relaxes quarantine. */}
    }
    return s.serverUuid!==serverUuid||!['IDLE'].includes(s.guestSlot?.state);
  }catch(e){return e.code!=='ENOENT';}
}
