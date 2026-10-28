import {randomUUID} from 'node:crypto';
import {ACTIONS,TIMEOUT_SEC,perform as defaultPerform,reconcile as defaultReconcile,Refusal} from './actions.mjs';
import {AeError} from './ae.mjs';
// Operational fleet worker (Central). One claim per server per tick; one command at a time; the web lease is renewed every 20 s
// while AE works. Any uncertainty is reported as UNKNOWN with the same operation id and re-read on a later claim (reconciliation).
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,ID=/^[A-Za-z0-9_-]{1,64}$/;
const need=(ok,code)=>{if(!ok)throw new Error(code);};
export function parseConfig(v){
 need(v&&v.version===1&&typeof v.baseUrl==='string'&&Array.isArray(v.servers)&&v.servers.length>=1&&v.servers.length<=50,'CONFIG_INVALID');
 const seen=new Set();
 for(const s of v.servers){
  need(Object.keys(s).every(k=>['projectId','serverId','serverUuid','hostAlias','enabled'].includes(k)),'CONFIG_INVALID');
  need(ID.test(s.projectId)&&ID.test(s.serverId)&&UUID.test(s.serverUuid)&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s.hostAlias),'CONFIG_INVALID');
  const key=s.projectId+'/'+s.serverId;need(!seen.has(key),'CONFIG_DUPLICATE');seen.add(key);
 }
 const pollMs=v.pollMs??15000;need(Number.isInteger(pollMs)&&pollMs>=5000&&pollMs<=300000,'CONFIG_INVALID');
 const proxyKind=v.proxyKind??'SOCKS5';need(['SOCKS5','HTTP'].includes(proxyKind),'CONFIG_INVALID');
 return {version:1,baseUrl:v.baseUrl,servers:v.servers.filter(s=>s.enabled!==false).map(s=>({...s})),pollMs,proxyKind,aeScript:v.aeScript??'C:/Users/Administrator/Desktop/Claude Fleet/ae.ps1',sdkHelper:v.sdkHelper??'C:/AVC-SECRETS/codex-tools/mth-machine-read.ps1'};
}
export function captureCommand(view,server){
 const c=view;
 need(UUID.test(c.operationId)&&UUID.test(c.machineUuid)&&UUID.test(c.serverUuid),'COMMAND_INVALID');
 need(c.projectId===server.projectId&&c.serverId===server.serverId&&c.serverUuid.toLowerCase()===server.serverUuid.toLowerCase(),'COMMAND_SERVER_MISMATCH');
 need(ACTIONS.includes(c.action)&&/^(VM_|m_)\d{1,4}$/.test(c.vmCode)&&ID.test(c.vmId),'COMMAND_INVALID');
 need(Number.isInteger(c.expectedCycle)&&c.expectedCycle>=1&&Number.isInteger(c.expectedVmRevision)&&c.expectedVmRevision>=0,'COMMAND_INVALID');
 return {operationId:c.operationId,projectId:c.projectId,serverId:c.serverId,serverUuid:c.serverUuid.toLowerCase(),vmId:c.vmId,vmCode:c.vmCode,machineUuid:c.machineUuid.toLowerCase(),expectedCycle:c.expectedCycle,expectedVmRevision:c.expectedVmRevision,configurationId:c.configurationId??null,action:c.action};
}
const expired=(v,now)=>!Number.isFinite(Date.parse(v.leaseUntil))||Date.parse(v.leaseUntil)<=now;
export class FleetOpsWorker{
 constructor({api,ae,sdk,journal,config,workerId=randomUUID(),perform=defaultPerform,reconcile=defaultReconcile,log=()=>{},clock=Date.now,renewEveryMs=20000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  need(UUID.test(workerId),'WORKER_ID');
  Object.assign(this,{api,ae,sdk,journal,config,workerId,perform,reconcile,log,clock,renewEveryMs,sleep});
  this.stopped=false;this.busy=false;this.cursor=0;
 }
 stop(){this.stopped=true;}
 /** One tick: claim on the next server in turn; run at most one command. Returns the result or null. */
 async tick(){
  if(this.stopped||this.busy||!this.config.servers.length)return null;
  const server=this.config.servers[this.cursor++%this.config.servers.length];
  this.busy=true;
  try{
   const claim=await this.api.claim({projectId:server.projectId,serverId:server.serverId,workerId:this.workerId});
   if(!claim?.command)return null;
   return await this.handle(claim,server);
  }catch(e){
   this.log({at:new Date(this.clock()).toISOString(),server:server.serverId,error:e.code||e.message});
   if(['TOKEN_REVOKED','TOKEN_EXPIRED','FORBIDDEN','AUTH_STOP'].includes(e.code))this.stop();
   return null;
  }finally{this.busy=false;}
 }
 ctx(command,server){return {command,host:server.hostAlias,ae:this.ae,sdk:this.sdk,api:this.api,proxyKind:this.config.proxyKind,log:this.log,sleep:this.sleep};}
 async handle(claim,server){
  const command=captureCommand(claim.command,server),view=claim.command,fence={projectId:command.projectId,workerId:this.workerId,leaseEpoch:view.leaseEpoch};
  const record=this.journal.prepare(command),prior=this.journal.inspect(command.operationId);
  this.log({at:new Date(this.clock()).toISOString(),op:command.operationId,action:command.action,vm:command.vmCode,state:view.state,reconciliationOnly:!!claim.reconciliationOnly});
  if(prior.receipt)return this.publish(command,view,prior.receipt);
  const reconcileOnly=claim.reconciliationOnly||!!prior.dispatch||['UNKNOWN','DISPATCHED'].includes(view.state);
  if(reconcileOnly)return this.finish(command,view,fence,()=>this.reconcile(this.ctx(command,server)));
  const current=await this.api.detail(command.operationId,command.projectId);
  if(['SUCCEEDED','FAILED','CANCELLED','EXPIRED','REFUSED'].includes(current.state))return {outcome:current.state};
  if(current.cancelRequestedAt)return {outcome:'CANCEL_REQUESTED'};
  need(current.workerId===this.workerId&&current.leaseEpoch===view.leaseEpoch&&!expired(current,this.clock()),'LEASE_LOST');
  const renewed=await this.api.renew(command.operationId,fence);
  need(renewed.leaseEpoch===view.leaseEpoch&&!renewed.cancelRequestedAt,'LEASE_LOST');
  const step={...fence,stepId:record.stepId,phase:'DISPATCH'};
  if(!this.journal.beginDispatch(command.operationId,{step,startedAt:new Date(this.clock()).toISOString()}))return this.finish(command,view,fence,()=>this.reconcile(this.ctx(command,server)));
  let dispatch;
  try{dispatch=await this.api.step(command.operationId,step);}catch{return this.publish(command,view,this.unknown(command,'DISPATCH_UNCONFIRMED'));}
  if(!dispatch.permit)return this.finish(command,view,fence,()=>this.reconcile(this.ctx(command,server)));
  for(const k of ['operationId','projectId','serverId','vmId','vmCode','machineUuid','expectedCycle','expectedVmRevision','configurationId','action'])need(String(dispatch.permit[k]).toLowerCase()===String(command[k]).toLowerCase(),'PERMIT_MISMATCH');
  this.journal.immutable(command.operationId,'authorization',{permit:dispatch.permit,dispatchedAt:dispatch.command.dispatchedAt});
  return this.finish(command,view,fence,()=>this.perform(this.ctx(command,server)));
 }
 /** Runs AE work while renewing the lease; a lost lease aborts reporting (the next claim reconciles). */
 async finish(command,view,fence,work){
  let lost=false,renewBusy=false;
  const renew=setInterval(async()=>{if(renewBusy)return;renewBusy=true;try{const v=await this.api.renew(command.operationId,fence);if(v.leaseEpoch!==view.leaseEpoch||v.workerId!==this.workerId)lost=true;}catch(e){if(['TOKEN_REVOKED','TOKEN_EXPIRED','FORBIDDEN','AUTH_STOP'].includes(e.code)){lost=true;this.stop();}}finally{renewBusy=false;}},this.renewEveryMs);
  renew.unref?.();
  let result;
  try{
   const budget=(TIMEOUT_SEC[command.action]+600)*1000;let timer;
   try{result=await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new AeError('AE_OUTCOME_UNKNOWN','budget')),budget);timer.unref?.();})]);}
   finally{clearTimeout(timer);}
  }catch(e){
   result=e instanceof Refusal?{outcome:'FAILED',vmState:'UNKNOWN',detail:{code:e.code,message:String(e.message).slice(0,500)}}:this.unknown(command,e.code||'ERROR');
  }finally{clearInterval(renew);}
  if(lost)return {outcome:'LEASE_LOST'};
  const evidence={operationId:command.operationId,aeOperationId:command.operationId,machineUuid:command.machineUuid,verified:result.outcome!=='UNKNOWN',observedAt:new Date(this.clock()).toISOString(),vmState:result.vmState||'UNKNOWN',detail:result.detail};
  const receipt=result.outcome==='UNKNOWN'?{outcome:'UNKNOWN',evidence}:this.journal.immutable(command.operationId,'receipt',{outcome:result.outcome,evidence});
  return this.publish(command,view,receipt);
 }
 unknown(command,code){return {outcome:'UNKNOWN',vmState:'UNKNOWN',detail:{code:/^[A-Z][A-Z0-9_]{1,39}$/.test(code)?code:'UNKNOWN',message:'Chưa rõ kết quả; đối soát ở lượt nhận lệnh sau'}};}
 async publish(command,view,result){
  const epoch=view.leaseEpoch;if(!(Number.isInteger(epoch)&&epoch>=1&&epoch<=16))return {outcome:'RECONCILIATION_BUDGET_EXHAUSTED'};
  const kind=(result.outcome==='UNKNOWN'?'unknown':'completion')+'-'+epoch;
  const body=this.journal.read(command.operationId,kind)??this.journal.immutable(command.operationId,kind,{projectId:command.projectId,workerId:this.workerId,leaseEpoch:epoch,completionId:randomUUID(),outcome:result.outcome,evidence:result.evidence});
  try{await this.api.complete(command.operationId,body);this.log({at:new Date(this.clock()).toISOString(),op:command.operationId,done:body.outcome,code:body.evidence.detail?.code});return {outcome:body.outcome,evidence:body.evidence,reported:true};}
  catch(e){this.log({at:new Date(this.clock()).toISOString(),op:command.operationId,completeError:e.code||e.message});if(['TOKEN_REVOKED','TOKEN_EXPIRED','FORBIDDEN','AUTH_STOP'].includes(e.code))this.stop();return {outcome:body.outcome,evidence:body.evidence,reported:false};}
 }
}
