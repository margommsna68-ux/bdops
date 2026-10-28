import {validHeartbeat} from './io.mjs';
import {parseMonitorConfig} from './native-monitor.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const nowIso=n=>new Date(n).toISOString();
const fresh=(s,now,maxAge=1200000)=>Number.isFinite(Date.parse(s))&&Date.parse(s)<=now&&now-Date.parse(s)<maxAge;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const only=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const roles=['CENTRAL','AGENT'],rowKey=(b,role)=>b.serverId+'/'+role;
async function store(file,state){const bytes=JSON.stringify(state);if(Buffer.byteLength(bytes)>65536)throw Error('HEARTBEAT_QUEUE_FULL');const tmp=file+'.'+randomUUID()+'.tmp';let h;
 try{h=await fs.open(tmp,'wx',0o600);await h.writeFile(bytes);await h.sync();await h.close();h=null;await fs.rename(tmp,file);}
 finally{if(h)await h.close().catch(()=>{});await fs.unlink(tmp).catch(()=>{});}}
function validRow(row,role,b,config,projectId){
 if(!only(row,['pending','lastHash'])||row.lastHash!==undefined&&!digest(row.lastHash))return false;
 if(row.pending===undefined)return true;
 const p=row.pending;
 return only(p,['key','body'])&&/^gen2-heartbeat-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p.key)&&validHeartbeat(p.body)&&p.body.projectId===projectId&&p.body.source===role&&p.body.serverUuid===(role==='CENTRAL'?config.centralUuid:b.serverUuid);
}
function expandState(state,config,projectId){
 let old,rows;
 if(state.version===1){
  if(!only(state,['version','configHash','rows'])||!object(state.rows))throw Error();
  // The v1 hash must prove one exact prior binding still in the expanded config.
  const matches=config.bindings.filter(b=>state.configHash===hash({...config,bindings:[b]}));
  if(matches.length!==1)throw Error();old={...config,bindings:matches};rows={};
  for(const [role,row] of Object.entries(state.rows)){
   if(!roles.includes(role)||!validRow(row,role,matches[0],old,projectId))throw Error();
   rows[rowKey(matches[0],role)]=row;
  }
 }else if(state.version===2){
  if(!only(state,['version','configHash','config','rows'])||!object(state.rows))throw Error();
  old=parseMonitorConfig(state.config,projectId);if(state.configHash!==hash(old))throw Error();rows=state.rows;
  const owners=new Map(old.bindings.flatMap(b=>roles.map(role=>[rowKey(b,role),{b,role}])));
  for(const [key,row] of Object.entries(rows)){const owner=owners.get(key);if(!owner||!validRow(row,owner.role,owner.b,old,projectId))throw Error();}
 }else throw Error();
 // Only exact additions/reordering migrate. Never drop/rebind an old endpoint,
 // change Central identity, clear UNKNOWN or ignore a failed configuration hash.
 if(old.centralUuid!==config.centralUuid||old.bindings.some(b=>!config.bindings.some(next=>JSON.stringify(next)===JSON.stringify(b))))throw Error();
 return {version:2,configHash:hash(config),config,rows};
}
export async function createHeartbeatLoop({config,projectId,stateDir,api,readSources,bridgeState,now=Date.now}){
 config=parseMonitorConfig(config,projectId);
 const file=path.join(stateDir,'monitor-heartbeats.json');let state;
 try{const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>65536)throw Error();state=expandState(JSON.parse(await fs.readFile(file,'utf8')),config,projectId);}
 catch(e){if(e.code!=='ENOENT')throw Error('HEARTBEAT_STATE_UNREADABLE_DO_NOT_RESET');state={version:2,configHash:hash(config),config,rows:{}};}
 await store(file,state); // Complete atomic migration before any network call.
 const instanceUuid=randomUUID(),startedAt=nowIso(now());let seq=0,busy=false;
 const ownCounts=b=>{const entries=Object.values(bridgeState.entries).filter(e=>e.target?.serverId===b.serverId),counts={managed:entries.length,inventory:0,guest:0,proxy:0,app:0};
  for(const e of entries)if(e.monitorVersion===1){if(fresh(e.monitorAcks?.vmState,now(),120000))counts.inventory++;for(const k of ['guest','proxy','app'])if(fresh(e.monitorAcks?.[k],now()))counts[k]++;}return counts;};
 async function tick(){if(busy)return {state:'BUSY'};busy=true;const results=[];try{
  let sources=null;
  const slots=config.bindings.flatMap(binding=>roles.map(role=>({binding,role})));
  const pending=slot=>!!state.rows[rowKey(slot.binding,slot.role)]?.pending;
  // Original durable bodies go first even if the expanded config reorders hosts.
  const scheduled=[...slots.filter(pending),...slots.filter(slot=>!pending(slot))];
  for(const {binding,role} of scheduled){
    // Resolve live journal objects after every preceding ACK deep-clone commit.
    const key=rowKey(binding,role),row=state.rows[key]??{},result=status=>results.push({serverId:binding.serverId,source:role,state:status});
    if(!row.pending){
     if(role==='AGENT'&&sources===null)sources=await readSources();
     const matches=role==='AGENT'?sources.filter(s=>s.serverUuid===binding.serverUuid):[],source=matches.length===1?matches[0]:null;
     const candidate=role==='CENTRAL'?{projectId,source:role,serverUuid:config.centralUuid,instanceUuid,startedAt,seq:seq+1,configVersion:1,observedAt:nowIso(now()),counts:ownCounts(binding)}:source?{projectId,source:role,serverUuid:source.serverUuid,instanceUuid:source.instanceUuid,startedAt:source.startedAt,seq:source.seq,configVersion:source.configVersion,observedAt:source.observedAt,counts:source.counts}:null;
     if(!candidate||!validHeartbeat(candidate)||Date.parse(candidate.observedAt)>now()){result('UNKNOWN');continue;}
     const digest=hash(candidate);if(role==='AGENT'&&row.lastHash===digest){result('UNCHANGED');continue;}
     row.pending={key:'gen2-heartbeat-'+randomUUID(),body:structuredClone(candidate)};if(role==='CENTRAL')seq++;state.rows[key]=row;await store(file,state);
    }
    await store(file,state); // Also required after any prior persistence failure.
    const p=row.pending;let response;try{response=await api.post('/servers/'+binding.serverId+'/monitor-heartbeat',p.body,p.key);}catch{result('UNKNOWN');continue;}
    if(response.status===401||response.status===403){result('AUTH_REQUIRED');return {state:'AUTH_REQUIRED',results};}
    const d=response.data;
    if(response.status===200&&d?.serverId===binding.serverId&&d.source===role&&d.seq===p.body.seq&&d.observedAt===p.body.observedAt&&typeof d.receivedAt==='string'&&Number.isFinite(Date.parse(d.receivedAt))){
     const next=structuredClone(state);next.rows[key]={lastHash:hash(p.body)};await store(file,next);state=next;result('SAVED');
    }else result('UNKNOWN');
  }return {state:results.some(r=>r.state==='UNKNOWN')?'UNKNOWN':'OK',results};
 }finally{busy=false;}}
 return {tick};
}
