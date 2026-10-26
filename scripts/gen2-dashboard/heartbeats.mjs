import {validHeartbeat} from './io.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const nowIso=n=>new Date(n).toISOString();
const fresh=(s,now,maxAge=1200000)=>Number.isFinite(Date.parse(s))&&Date.parse(s)<=now&&now-Date.parse(s)<maxAge;
async function store(file,state){const bytes=JSON.stringify(state);if(Buffer.byteLength(bytes)>65536)throw Error('HEARTBEAT_QUEUE_FULL');const tmp=file+'.'+randomUUID()+'.tmp';let h;
 try{h=await fs.open(tmp,'wx',0o600);await h.writeFile(bytes);await h.sync();await h.close();h=null;await fs.rename(tmp,file);}
 finally{if(h)await h.close().catch(()=>{});await fs.unlink(tmp).catch(()=>{});}}
export async function createHeartbeatLoop({config,projectId,stateDir,api,readSources,bridgeState,now=Date.now}){
 const file=path.join(stateDir,'monitor-heartbeats.json'),binding=config.bindings[0],configHash=hash(config);
 let state;try{const st=await fs.stat(file);if(st.size>65536)throw Error();state=JSON.parse(await fs.readFile(file,'utf8'));if(state.version!==1||state.configHash!==configHash||Object.keys(state.rows??{}).some(k=>!['AGENT','CENTRAL'].includes(k)))throw Error();}catch(e){if(e.code!=='ENOENT')throw Error('HEARTBEAT_STATE_UNREADABLE_DO_NOT_RESET');state={version:1,configHash,rows:{}};}
 for(const [role,row] of Object.entries(state.rows)){if(!row||Object.keys(row).some(k=>!['pending','lastHash'].includes(k))||row.lastHash&&!/^[0-9a-f]{64}$/.test(row.lastHash)||row.pending&&(!/^gen2-heartbeat-[0-9a-f-]{36}$/.test(row.pending.key)||!validHeartbeat(row.pending.body)||row.pending.body.projectId!==projectId||row.pending.body.source!==role||row.pending.body.serverUuid!==(role==='CENTRAL'?config.centralUuid:binding.serverUuid)))throw Error('HEARTBEAT_STATE_UNREADABLE_DO_NOT_RESET');}
 const instanceUuid=randomUUID(),startedAt=nowIso(now());let seq=0,busy=false;
 const ownCounts=()=>{const entries=Object.values(bridgeState.entries).filter(e=>e.target?.serverId===binding.serverId),counts={managed:entries.length,inventory:0,guest:0,proxy:0,app:0};
  for(const e of entries)if(e.monitorVersion===1){if(fresh(e.monitorAcks?.vmState,now(),120000))counts.inventory++;for(const k of ['guest','proxy','app'])if(fresh(e.monitorAcks?.[k],now()))counts[k]++;}return counts;};
 async function tick(){if(busy)return {state:'BUSY'};busy=true;const results=[];try{
  const sources=await readSources(),matches=sources.filter(s=>s.serverUuid===binding.serverUuid),source=matches.length===1?matches[0]:null;
  for(const role of ['CENTRAL','AGENT']){
   const row=state.rows[role]??{},candidate=role==='CENTRAL'?{projectId,source:role,serverUuid:config.centralUuid,instanceUuid,startedAt,seq:seq+1,configVersion:1,observedAt:nowIso(now()),counts:ownCounts()}:source?{projectId,source:role,serverUuid:source.serverUuid,instanceUuid:source.instanceUuid,startedAt:source.startedAt,seq:source.seq,configVersion:source.configVersion,observedAt:source.observedAt,counts:source.counts}:null;
   if(!row.pending){if(!candidate){results.push({source:role,state:'UNKNOWN'});continue;}const digest=hash(candidate);if(role==='AGENT'&&row.lastHash===digest){results.push({source:role,state:'UNCHANGED'});continue;}
    row.pending={key:'gen2-heartbeat-'+randomUUID(),body:candidate};if(role==='CENTRAL')seq++;state.rows[role]=row;await store(file,state);
   }
   await store(file,state); // also required after any earlier persistence failure
   const p=row.pending;let response;try{response=await api.post('/servers/'+binding.serverId+'/monitor-heartbeat',p.body,p.key);}catch{results.push({source:role,state:'UNKNOWN'});continue;}
   if(response.status===401||response.status===403)return {state:'AUTH_REQUIRED',results};
   const d=response.data;
   if(response.status===200&&d?.serverId===binding.serverId&&d.source===role&&d.seq===p.body.seq&&d.observedAt===p.body.observedAt&&typeof d.receivedAt==='string'&&Number.isFinite(Date.parse(d.receivedAt))){
    const next=structuredClone(state);next.rows[role]={lastHash:hash(p.body)};await store(file,next);state=next;results.push({source:role,state:'SAVED'});
   }else results.push({source:role,state:'UNKNOWN'});
  }return {state:results.some(r=>r.state==='UNKNOWN')?'UNKNOWN':'OK',results};
 }finally{busy=false;}}
 return {tick};
}
