import { randomUUID } from 'node:crypto';
import { matchTargets,uuidOf } from './cache.mjs';

const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const rev=v=>Number.isSafeInteger(v)&&v>=0;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function cleanTarget(t) {
 if(!id(t?.id)||!id(t.serverId)||!uuidOf(t.machineUuid)||!Number.isSafeInteger(t.expectedCycle)||t.expectedCycle<1||!rev(t.expectedVmRevision)||!(t.configurationId===null||id(t.configurationId))||!(t.sdkId===null||id(t.sdkId))||!(t.sdkRevision===null||rev(t.sdkRevision)))return null;
 return {id:t.id,serverId:t.serverId,serverCode:String(t.serverCode||''),code:String(t.code||''),machineUuid:uuidOf(t.machineUuid),expectedCycle:t.expectedCycle,expectedVmRevision:t.expectedVmRevision,configurationId:t.configurationId,sdkId:t.sdkId,sdkRevision:t.sdkRevision};
}
const identity=t=>JSON.stringify([t.serverId,t.machineUuid,t.expectedCycle,t.configurationId,t.sdkId]);
const revisions=t=>[t.expectedVmRevision,t.sdkRevision];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export class Bridge {
 constructor({state,projectId,api,readCache,persist,now=Date.now,afterSync=null,shouldStop=()=>false}) {
  if(state.projectId!==projectId)throw new Error('PROJECT_STATE_MISMATCH');
  Object.assign(this,{state,projectId,api,readCache,persist,now,afterSync,shouldStop});this.busy=false;
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
 async run() {
  if(this.state.pending)return {state:await this.flush(),saved:0};
  const response=await this.api.get(`/gen2-targets?projectId=${encodeURIComponent(this.projectId)}`);
  if(!stamp(response?.capturedAt)||Date.parse(response.capturedAt)>this.now()+300000||!Array.isArray(response.items))throw new Error('INVALID_TARGET_SNAPSHOT');
  const targets=response.items.map(cleanTarget).filter(Boolean),capture=new Date(response.capturedAt).toISOString();
  const counts={state:'IDLE',saved:0,rejected:response.items.length-targets.length};
  for(const t of targets) {
   const previous=this.state.entries[t.id],ident=identity(t);
   if(!previous||previous.identity!==ident||previous.reset||(!same(revisions(previous.target),revisions(t))&&!same(previous.ownAfter,revisions(t)))) {
    this.state.entries[t.id]={identity:ident,target:t,capturedAt:capture,lastHealthAt:previous?.identity===ident?previous.lastHealthAt:null,lastMoneyAt:previous?.identity===ident?previous.lastMoneyAt:null,waitNewScan:!!previous,ownAfter:null,reset:false};
   }else{previous.target=t;previous.ownAfter=null;}
  }
  for(const key of Object.keys(this.state.entries))if(!targets.some(t=>t.id===key))delete this.state.entries[key];
  await this.persist(this.state); // capture must be durable BEFORE reading the cache
  const projected=await this.readCache(),matched=matchTargets(targets,projected.observations);
  counts.rejected+=matched.rejected.length+(projected.rejected?.length||0);
  for(const {target:t,observation:o} of matched.matches) {
   if(this.shouldStop())break;
   const entry=this.state.entries[t.id];
   if(entry.lastHealthAt&&Date.parse(o.observedAt)<Date.parse(entry.lastHealthAt))continue;
   if(entry.waitNewScan&&Date.parse(o.observedAt)<=Date.parse(entry.capturedAt))continue;
   const healthNew=!entry.lastHealthAt||Date.parse(o.observedAt)>Date.parse(entry.lastHealthAt);
   const money=o.money,timing=money&&Date.parse(money.observedAt)>Date.parse(entry.capturedAt);
   const moneyNew=t.sdkId&&rev(t.sdkRevision)&&timing&&(!entry.lastMoneyAt||Date.parse(money.observedAt)>Date.parse(entry.lastMoneyAt));
   if(!healthNew&&!moneyNew)continue;
   const body={projectId:this.projectId,expectedCycle:t.expectedCycle,expectedVmRevision:t.expectedVmRevision,machineUuid:t.machineUuid,configurationId:t.configurationId,observedAt:o.observedAt,earning:o.earning,problem:o.problem};
   if(moneyNew)body.money={sdkId:t.sdkId,expectedSdkRevision:t.sdkRevision,capturedAt:entry.capturedAt,observedAt:money.observedAt,amount:money.amount};
   this.state.pending={key:'gen2-'+randomUUID(),vmId:t.id,identity:entry.identity,body};
   // flush durably saves the original body/key before every attempt, including a restart.
   counts.state=await this.flush();if(counts.state==='SAVED')counts.saved++;
   if(this.state.pending||counts.state==='REFUSED')break;
  }
  // Optional future reminder module owns its own durable dedup/UNKNOWN policy. Core never notifies.
  if(this.afterSync&&!this.state.pending)await this.afterSync({projectId:this.projectId,counts:{...counts}});
  return counts;
 }
}
