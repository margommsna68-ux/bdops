import { randomUUID } from 'node:crypto';
import {mergeNativeObservations} from './native-monitor.mjs';
import { matchTargets,uuidOf } from './cache.mjs';
import {batchSize as parseBatchSize,QUEUE_LIMITS,assertQueueBounds} from './io.mjs';

const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const rev=v=>Number.isSafeInteger(v)&&v>=0;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function cleanTarget(t) {
 if(!id(t?.id)||!id(t.serverId)||!uuidOf(t.machineUuid)||!Number.isSafeInteger(t.expectedCycle)||t.expectedCycle<1||!rev(t.expectedVmRevision)||!(t.configurationId===null||id(t.configurationId))||!(t.sdkId===null||id(t.sdkId))||!(t.sdkRevision===null||rev(t.sdkRevision)))return null;
 return {id:t.id,serverId:t.serverId,serverCode:String(t.serverCode||''),code:String(t.code||''),machineUuid:uuidOf(t.machineUuid),expectedCycle:t.expectedCycle,expectedVmRevision:t.expectedVmRevision,configurationId:t.configurationId,endpointId:id(t.endpointId)?t.endpointId:null,proxyAddressFingerprint:typeof t.proxyAddressFingerprint==='string'&&/^[0-9a-f]{64}$/.test(t.proxyAddressFingerprint)?t.proxyAddressFingerprint:null,sdkId:t.sdkId,sdkRevision:t.sdkRevision};
}
const identity=t=>JSON.stringify([t.serverId,t.machineUuid,t.expectedCycle,t.configurationId,t.sdkId]);
const revisions=t=>[t.expectedVmRevision,t.sdkRevision];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function acknowledgeMonitor(entry,monitor){
 if(entry.monitorVersion!==monitor.configVersion)entry.monitorAcks={};
 entry.monitorVersion=monitor.configVersion;entry.monitorAcks??={};
 for(const k of ['vmState','guest','network','proxy','app'])if(monitor[k]&&(!entry.monitorAcks[k]||Date.parse(monitor[k].observedAt)>Date.parse(entry.monitorAcks[k])))entry.monitorAcks[k]=monitor[k].observedAt;
}
function identityServer(value) {
 try{const parts=JSON.parse(value);return Array.isArray(parts)&&typeof parts[0]==='string'?parts[0]:null;}catch{return null;}
}
export class Bridge {
 constructor({state,projectId,api,readCache,persist,now=Date.now,afterSync=null,shouldStop=()=>false,batchSize=1,serverId=null,monitorConfig=null}) {
  if(state.projectId!==projectId)throw new Error('PROJECT_STATE_MISMATCH');
  Object.assign(this,{state,projectId,api,readCache,persist,now,afterSync,shouldStop,serverId,monitorConfig});this.batchSize=parseBatchSize(batchSize);this.busy=false;
  if(serverId!==null&&(!id(serverId)||this.batchSize===1))throw new Error('SERVER_FILTER_INVALID');
 }
 async tick() {
  if(this.busy)throw new Error('LOOP_ALREADY_RUNNING');this.busy=true;
  try{return await this.run();}finally{this.busy=false;}
 }
 async flush() {
  const p=this.state.pending;if(!p)return 'IDLE';let res;
  const earlierAttempt=!!p.attempted;p.attempted=true;
  await this.persist(this.state); // also required when a previous disk write failed in this process
  try{res=await this.api.post(`/vms/${p.vmId}/scan-observations`,p.body,p.key);}catch{return 'UNKNOWN';}
  const before=structuredClone(this.state.entries[p.vmId]);
  const settle=async()=>{
   this.state.pending=null;
   try{await this.persist(this.state);}catch(error){this.state.pending=p;if(before)this.state.entries[p.vmId]=before;throw error;}
  };
  const status=res?.status,recorded=res?.data?.recorded;
  if(status>=200&&status<300&&status!==202&&recorded?.vmId===p.vmId&&recorded.cycle===p.body.expectedCycle&&recorded.observedAt===p.body.observedAt) {
   const entry=this.state.entries[p.vmId];
   if(entry&&entry.identity===p.identity) {
    entry.lastHealthAt=p.body.observedAt;
    if(p.body.monitor)acknowledgeMonitor(entry,p.body.monitor);
    if(p.body.money)entry.lastMoneyAt=p.body.money.observedAt;
    // Never infer revision ownership from a +1 coincidence. Backend may return these exact post-write revisions.
    if(rev(recorded.vmRevisionAfter)&&(recorded.sdkRevisionAfter===null||rev(recorded.sdkRevisionAfter)))entry.ownAfter=[recorded.vmRevisionAfter,recorded.sdkRevisionAfter];
   }
   await settle();return 'SAVED';
  }
  if(!earlierAttempt&&res?.errorCode&&[400,404,409,410,422].includes(status)) {
   const entry=this.state.entries[p.vmId];if(entry)entry.reset=true;
   await settle();return 'REFUSED';
  }
  // 401/403, 429, 5xx, timeout, malformed acknowledgement, 202: keep ORIGINAL body/key.
  return status===401||status===403?'AUTH_REQUIRED':'UNKNOWN';
 }
 makeBatch(items,events) {
  return {key:'gen2-batch-'+randomUUID(),body:{projectId:this.projectId,items},events,attempted:false};
 }
 async commit(next) {
  assertQueueBounds(next);
  // Copy-on-write: a failed disk commit never loses an ACK or original command in memory.
  await this.persist(next);Object.assign(this.state,next);
 }
 async flushBatch(batch) {
  const earlierAttempt=batch.attempted;
  batch.attempted=true;await this.persist(this.state);
  let res;try{res=await this.api.post('/batch',batch.body,batch.key);}catch{return {state:'UNKNOWN',saved:0};}
  if(res?.status===401||res?.status===403)return {state:'AUTH_REQUIRED',saved:0};
  const rows=res?.data?.items;
  // A missing/duplicate/out-of-range index makes the whole envelope ambiguous.
  if(res?.status!==200||res.data?.batchKey!==batch.key||!Array.isArray(rows)||rows.length!==batch.body.items.length||
   rows.some(r=>!Number.isSafeInteger(r?.index)||r.index<0||r.index>=rows.length)||new Set(rows.map(r=>r.index)).size!==rows.length)return {state:'UNKNOWN',saved:0};
  const next=structuredClone(this.state),remaining=[];let saved=0,refused=0,auth=false;
  for(const [index,item] of batch.body.items.entries()) {
   const row=rows.find(r=>r.index===index),event=batch.events[index],recorded=row.body?.data?.recorded;
   const bound=row.path===item.path&&(row.idempotencyKey===undefined||row.idempotencyKey===item.idempotencyKey);
   const accepted=bound&&row.status===200&&row.body?.ok===true&&id(recorded?.id)&&recorded.vmId===event.vmId&&
    recorded.cycle===item.body.expectedCycle&&recorded.observedAt===item.body.observedAt&&rev(recorded.vmRevisionAfter)&&(recorded.sdkRevisionAfter===null||rev(recorded.sdkRevisionAfter));
   const denied=bound&&!earlierAttempt&&row.body?.ok===false&&row.body.data===null&&typeof row.body.error?.code==='string'&&typeof row.body.error?.message==='string'&&[400,404,409,410,422].includes(row.status);
   const entry=next.entries[event.vmId];
   if(accepted) {
    saved++;
    if(entry?.identity===event.identity) {
     if(!entry.lastHealthAt||Date.parse(item.body.observedAt)>=Date.parse(entry.lastHealthAt)) {
      entry.lastHealthAt=item.body.observedAt;if(item.body.monitor)acknowledgeMonitor(entry,item.body.monitor);entry.ownAfter=[recorded.vmRevisionAfter,recorded.sdkRevisionAfter];
     }
     if(item.body.money&&(!entry.lastMoneyAt||Date.parse(item.body.money.observedAt)>Date.parse(entry.lastMoneyAt)))entry.lastMoneyAt=item.body.money.observedAt;
    }
   }else if(denied) {refused++;if(entry?.identity===event.identity)entry.reset=true;}
   else {
    if(bound&&(row.status===401||row.status===403))auth=true;
    remaining.push(index);
   }
  }
  if(!saved&&!refused)return {state:auth?'AUTH_REQUIRED':'UNKNOWN',saved:0};
  // A valid partial ACK permits regrouping. Unknown rows retain their original item key/body
  // and are isolated so a failing VM cannot hold the independent rows hostage.
  const replacements=remaining.map(index=>({...this.makeBatch([batch.body.items[index]],[batch.events[index]]),attempted:true}));
  next.batches.splice(next.batches.findIndex(b=>b.key===batch.key),1,...replacements);
  await this.commit(next);
  return {state:auth?'AUTH_REQUIRED':remaining.length?'UNKNOWN':refused?'REFUSED':'SAVED',saved};
 }
 async run() {
  // A canary must not replay an old command belonging to another server. Keep the
  // original journal intact for the unfiltered bridge to reconcile before handoff.
  if(this.serverId&&(this.state.pending&&identityServer(this.state.pending.identity)!==this.serverId||
   (this.state.batches??[]).some(b=>b.events.some(e=>identityServer(e.identity)!==this.serverId))))return {state:'SCOPE_MISMATCH',saved:0};
  if(this.state.pending)return {state:await this.flush(),saved:0};
  try{assertQueueBounds(this.state);}catch(error){if(error.message==='QUEUE_FULL')return {state:'QUEUE_FULL',saved:0};throw error;}
  const counts={state:'IDLE',saved:0,rejected:0};
  // Four rotating retries per tick bound outage work and reserve time for new observations.
  const pending=this.state.batches??[],cursor=pending.findIndex(b=>b.key===this.state.retryCursor)+1;
  const retry=[...pending.slice(cursor),...pending.slice(0,cursor)].slice(0,4);
  for(const candidate of retry) {
   if(this.shouldStop())return counts;
   // An earlier ACK commits a cloned queue; never mutate a detached batch reference.
   const batch=this.state.batches.find(b=>b.key===candidate.key);if(!batch)continue;
   this.state.retryCursor=batch.key;
   const result=await this.flushBatch(batch);counts.saved+=result.saved;counts.state=result.state;
   if(result.state==='AUTH_REQUIRED')return counts;
  }
  let response;
  try{response=await this.api.get(`/gen2-targets?projectId=${encodeURIComponent(this.projectId)}`);}
  catch(error){if(error.message==='AUTH_REQUIRED')return {...counts,state:'AUTH_REQUIRED'};throw error;}
  if(!stamp(response?.capturedAt)||Date.parse(response.capturedAt)>this.now()+300000||!Array.isArray(response.items))throw new Error('INVALID_TARGET_SNAPSHOT');
  if(response.items.length>QUEUE_LIMITS.targets)return {...counts,state:'QUEUE_FULL'};
  const selected=this.serverId?response.items.filter(t=>t?.serverId===this.serverId):response.items;
  const targets=selected.map(cleanTarget).filter(Boolean),capture=new Date(response.capturedAt).toISOString();
  counts.rejected=selected.length-targets.length;
  for(const t of targets) {
   const previous=this.state.entries[t.id],ident=identity(t);
   if(!previous||previous.identity!==ident||previous.reset||(!same(revisions(previous.target),revisions(t))&&!same(previous.ownAfter,revisions(t)))) {
    this.state.entries[t.id]={identity:ident,target:t,capturedAt:capture,lastHealthAt:previous?.identity===ident?previous.lastHealthAt:null,lastMoneyAt:previous?.identity===ident?previous.lastMoneyAt:null,waitNewScan:!!previous,ownAfter:null,reset:false};
   }else{previous.target=t;previous.ownAfter=null;}
  }
  for(const key of Object.keys(this.state.entries))if((!this.serverId||this.state.entries[key].target?.serverId===this.serverId)&&!targets.some(t=>t.id===key))delete this.state.entries[key];
  try{assertQueueBounds(this.state);}catch(error){if(error.message==='QUEUE_FULL')return {...counts,state:'QUEUE_FULL'};throw error;}
  await this.persist(this.state); // capture must be durable BEFORE reading the cache
  const cache=await this.readCache(),projected=this.monitorConfig?mergeNativeObservations(cache,targets,this.monitorConfig,this.now()):cache,matched=matchTargets(targets,projected.observations);
  counts.rejected+=matched.rejected.length+(projected.rejected?.length||0);
  const queued=new Map(),items=[],events=[];
  for(const b of this.state.batches??[])for(const [i,event] of b.events.entries()) {
   const key=JSON.stringify([event.vmId,event.identity]),body=b.body.items[i].body,previous=queued.get(key)||{};
   queued.set(key,{health:Math.max(previous.health||0,Date.parse(body.observedAt)),money:Math.max(previous.money||0,Date.parse(body.money?.observedAt)||0)});
  }
  for(const {target:t,observation:o} of matched.matches) {
   if(this.shouldStop())break;
   const entry=this.state.entries[t.id];
   if(entry.lastHealthAt&&Date.parse(o.observedAt)<Date.parse(entry.lastHealthAt))continue;
   if(entry.waitNewScan&&Date.parse(o.observedAt)<=Date.parse(entry.capturedAt))continue;
   const waiting=queued.get(JSON.stringify([t.id,entry.identity]));
   const healthNew=Date.parse(o.observedAt)>Math.max(Date.parse(entry.lastHealthAt)||0,waiting?.health||0);
   const money=o.money,timing=money&&Date.parse(money.observedAt)>Date.parse(entry.capturedAt);
   const moneyNew=t.sdkId&&rev(t.sdkRevision)&&timing&&Date.parse(money.observedAt)>Math.max(Date.parse(entry.lastMoneyAt)||0,waiting?.money||0);
   if(!healthNew&&!moneyNew)continue;
   const body={projectId:this.projectId,expectedCycle:t.expectedCycle,expectedVmRevision:t.expectedVmRevision,machineUuid:t.machineUuid,configurationId:t.configurationId,observedAt:o.observedAt,earning:o.earning,problem:o.problem};
   if(o.monitor)body.monitor=o.monitor;
   if(o.earningObservedAt)body.earningObservedAt=o.earningObservedAt;
   if(moneyNew)body.money={sdkId:t.sdkId,expectedSdkRevision:t.sdkRevision,capturedAt:entry.capturedAt,observedAt:money.observedAt,amount:money.amount};
   if(this.batchSize>1) {
    items.push({method:'POST',path:`vms/${t.id}/scan-observations`,body,idempotencyKey:'gen2-'+randomUUID()});
    events.push({vmId:t.id,identity:entry.identity});continue;
   }
   this.state.pending={key:'gen2-'+randomUUID(),vmId:t.id,identity:entry.identity,body};
   // flush durably saves the original body/key before every attempt, including a restart.
   counts.state=await this.flush();if(counts.state==='SAVED')counts.saved++;
   if(this.state.pending||counts.state==='REFUSED')break;
  }
  if(items.length) {
   const next=structuredClone(this.state);next.batches??=[];
   const added=[];
   for(let i=0;i<items.length;i+=this.batchSize){const b=this.makeBatch(items.slice(i,i+this.batchSize),events.slice(i,i+this.batchSize));next.batches.push(b);added.push(b.key);}
   try{await this.commit(next);}catch(error){if(error.message==='QUEUE_FULL')return {...counts,state:'QUEUE_FULL'};throw error;}
   for(const key of added) {
    if(this.shouldStop())break;
    const result=await this.flushBatch(this.state.batches.find(b=>b.key===key));counts.saved+=result.saved;counts.state=result.state;
    if(result.state==='AUTH_REQUIRED')return counts;
   }
  }
  // Optional future reminder module owns its own durable dedup/UNKNOWN policy. Core never notifies.
  if((this.state.batches?.length)&&counts.state!=='AUTH_REQUIRED')counts.state='UNKNOWN';
  if(this.afterSync&&!this.state.pending&&!this.state.batches?.length)await this.afterSync({projectId:this.projectId,counts:{...counts}});
  return counts;
 }
}
