import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AeError,requestId,vmStateOf} from './ae.mjs';
// One executor per fleet action. Every executor returns {outcome, vmState, detail} where detail={code,message[,newMachineUuid][,sdkTail]}.
// Messages are AE summaries only: never a proxy credential, never a full SDK code.
export const ACTIONS=Object.freeze(['START_VM','SHUTDOWN_VM','POWER_OFF_VM','CHECK_HEALTH','CHECK_PROXY','REPLACE_PROXY','RECREATE_VM','READ_SDK']);
/** Upper bound of one AE operation per action (seconds). Lease renewals keep the web fence alive meanwhile. */
export const TIMEOUT_SEC=Object.freeze({START_VM:180,SHUTDOWN_VM:120,POWER_OFF_VM:120,CHECK_HEALTH:60,CHECK_PROXY:180,REPLACE_PROXY:1500,RECREATE_VM:3000,READ_SDK:180});
const clip=s=>String(s??'').replace(/\s+/g,' ').trim().slice(0,500);
const scrub=s=>clip(s).replace(/\b\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}:\S+/g,'<proxy>').replace(/sdk-win-[0-9a-f]{28}/gi,'sdk-win-…');
const sleep=(ctx,ms)=>(ctx.sleep??(x=>new Promise(r=>setTimeout(r,x))))(ms);
export class Refusal extends Error{constructor(code,message){super(message||code);this.code=code;}}
/** vm-info with identity check: the VM named by the command must still carry the command's UUID. */
export async function inspect(ctx,{expectUuid=ctx.command.machineUuid}={}){
 const r=await ctx.ae.call({cmd:'vm-info',host:ctx.host,vm:ctx.command.vmCode,timeoutSec:60});
 if(!r.ok)throw new Refusal(r.code,r.message);
 const uuid=String(r.data?.uuid||'').toLowerCase();
 if(expectUuid&&uuid!==expectUuid.toLowerCase())throw new Refusal('IDENTITY_CHANGED','VM '+ctx.command.vmCode+' mang UUID khác');
 return {uuid,vmState:vmStateOf(r.data?.classification?.Machine?.State??r.data?.state),raw:r};
}
const power=(code)=>({code,message:''});
async function startVm(ctx){
 const r=await ctx.ae.call({cmd:'vm-start-headless',host:ctx.host,vm:ctx.command.vmCode,uuid:ctx.command.machineUuid,id:requestId(ctx.command.operationId,'start'),timeoutSec:TIMEOUT_SEC.START_VM});
 if(!r.ok&&r.code!=='ALREADY_RUNNING')return {outcome:'FAILED',vmState:(await inspect(ctx)).vmState,detail:{code:r.code,message:scrub(r.message)}};
 await sleep(ctx,5000);const i=await inspect(ctx);
 return {outcome:i.vmState==='RUNNING'?'SUCCEEDED':'FAILED',vmState:i.vmState,detail:{code:r.code,message:scrub(r.message)}};
}
async function stopVm(ctx,cmd){
 const r=await ctx.ae.call({cmd,host:ctx.host,vm:ctx.command.vmCode,uuid:ctx.command.machineUuid,set:{reason:'MoneyToHome fleet '+ctx.command.action+' '+ctx.command.operationId},id:requestId(ctx.command.operationId,'stop'),timeoutSec:TIMEOUT_SEC[ctx.command.action]});
 await sleep(ctx,3000);const i=await inspect(ctx);
 const ok=r.ok||['ALREADY_OFF','NOT_RUNNING'].includes(r.code);
 return {outcome:ok&&i.vmState==='POWERED_OFF'?'SUCCEEDED':i.vmState==='POWERED_OFF'?'SUCCEEDED':r.code==='STILL_STOPPING'||r.code==='READ_TIMEOUT'?'UNKNOWN':'FAILED',vmState:i.vmState,detail:{code:r.code,message:scrub(r.message)}};
}
async function checkHealth(ctx){const i=await inspect(ctx);return {outcome:i.vmState==='UNKNOWN'?'FAILED':'SUCCEEDED',vmState:i.vmState,detail:{code:'VM_INFO',message:scrub(i.raw.message)}};}
async function checkProxy(ctx){
 const i=await inspect(ctx);
 const r=await ctx.ae.call({cmd:'check-ip',host:ctx.host,vm:ctx.command.vmCode,id:requestId(ctx.command.operationId,'checkip'),timeoutSec:TIMEOUT_SEC.CHECK_PROXY});
 if(r.ok||r.code==='IP_ISSUES')return {outcome:'SUCCEEDED',vmState:i.vmState,detail:{code:r.code,message:scrub(r.message)}};
 if(r.code!=='ACCOUNT')return {outcome:'FAILED',vmState:i.vmState,detail:{code:r.code,message:scrub(r.message)}};
 // No EarnApp account in AE for this VM: fall back to the pool view (proxy assigned on the machine or not).
 const p=await ctx.ae.call({cmd:'proxy-pool',host:ctx.host,vms:[ctx.command.vmCode],timeoutSec:120});
 if(!p.ok)return {outcome:'FAILED',vmState:i.vmState,detail:{code:p.code,message:scrub(p.message)}};
 const row=(p.data?.vms||[]).find(v=>v.vm===ctx.command.vmCode);
 return {outcome:'SUCCEEDED',vmState:i.vmState,detail:{code:'PROXY_POOL',message:row?(row.proxy?'Máy có proxy '+scrub(row.proxy.endpoint||'')+' · policy '+row.policyMode:'Máy chưa có proxy trong AE')+' · không có tài khoản EarnApp để check-ip':'VM không có trong pool AE'}};
}
async function readSdkToWeb(ctx,{uuid=ctx.command.machineUuid,expectedCycle=ctx.command.expectedCycle,expectedVmRevision=ctx.command.expectedVmRevision}={}){
 const read=await ctx.sdk.read({host:ctx.host,vm:ctx.command.vmCode,uuid});
 if(!read)return {code:'NO_SDK',message:'Không thấy SDK trong máy (chưa cài EarnApp?)'};
 const found=await ctx.api.request('GET','sdks?'+new URLSearchParams({projectId:ctx.command.projectId,code:read.code}));
 const known=(found?.items||[]).find(x=>x.code===read.code),expectedSdkRevision=known?known.revision:null;
 const body={projectId:ctx.command.projectId,expectedCycle,expectedVmRevision,observedAt:new Date().toISOString(),source:'fleet-ops AE/guest read '+ctx.host,evidence:'fleet '+ctx.command.operationId,sdks:[{code:read.code,expectedSdkRevision,current:true}]};
 try{await ctx.api.request('POST','vms/'+ctx.command.vmId+'/sdk-observations',body);}
 catch(e){
  if(e.code!=='SDK_CONFLICT')throw e;
  // The web already has another current code: record this one in the VM's list without swapping the current code.
  await ctx.api.request('POST','vms/'+ctx.command.vmId+'/sdk-observations',{...body,sdks:[{code:read.code,expectedSdkRevision}]});
 }
 return {code:'DONE',message:'SDK …'+read.tail+' đã ghi lên web',sdkTail:read.tail};
}
async function readSdk(ctx){
 const i=await inspect(ctx);
 if(i.vmState!=='RUNNING')return {outcome:'FAILED',vmState:i.vmState,detail:{code:'VM_NOT_RUNNING',message:'VM phải đang chạy để đọc SDK'}};
 const d=await readSdkToWeb(ctx);
 return {outcome:d.code==='DONE'?'SUCCEEDED':'FAILED',vmState:i.vmState,detail:d};
}
function planMentionsOnly(data,vmCode){
 const text=JSON.stringify(data??{}),vms=new Set((text.match(/\b(?:VM_|m_)\d{1,4}\b/g)||[]));
 return vms.size===1&&vms.has(vmCode);
}
async function replaceProxy(ctx){
 const c=ctx.command,proj={projectId:c.projectId},note='fleet '+c.operationId;
 const claim=await ctx.api.request('POST','vms/'+c.vmId+'/claim',{...proj,expectedCycle:c.expectedCycle,kind:'PROXY_APPLY',ttlMinutes:60});
 const jobId=claim?.recorded?.job?.id;if(!jobId)throw new Refusal('JOB_UNAVAILABLE','Web không cấp việc PROXY_APPLY');
 let dir=null;
 try{
  const cred=await ctx.api.request('POST','vms/'+c.vmId+'/proxy-credentials',{...proj,jobId,expectedCycle:c.expectedCycle});
  const p=cred?.proxy;if(!p?.host||!p?.port||!p?.username||!p?.password)throw new Refusal('PROXY_INCOMPLETE','Proxy trên web chưa đủ IP:port:user:pass');
  if(cred.recorded?.configurationId!==c.configurationId)throw new Refusal('CONFIGURATION_CHANGED','Cấu hình proxy trên web đã đổi');
  // Secret goes into AE through its inbox file (never argv/log). The draft line names the exact VM, so the import touches only its row.
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'mth-fleet-'));const file=path.join(dir,'proxy.txt');
  fs.writeFileSync(file,c.vmCode+' '+p.host+':'+p.port+':'+p.username+':'+p.password+'\n',{mode:0o600});
  const put=await ctx.ae.call({cmd:'inbox-put',host:ctx.host,source:file,timeoutSec:60});
  fs.rmSync(dir,{recursive:true,force:true});dir=null;
  if(!put.ok||!put.data?.file)throw new Refusal(put.code,scrub(put.message));
  const imp=await ctx.ae.call({cmd:'proxy-draft-import',host:ctx.host,set:{file:put.data.file,kind:ctx.proxyKind},id:requestId(c.operationId,'draft'),timeoutSec:60});
  if(!imp.ok)throw new Refusal(imp.code,scrub(imp.message));
  const prev=await ctx.ae.call({cmd:'proxy-replace-preview',host:ctx.host,vms:[c.vmCode],timeoutSec:120});
  if(!prev.ok||prev.code!=='REPLACE_PLAN'||!prev.data?.planToken)throw new Refusal(prev.code,scrub(prev.message));
  if(!planMentionsOnly(prev.data,c.vmCode))throw new Refusal('PLAN_SCOPE','Kế hoạch thay proxy chạm VM khác; dừng');
  const rep=await ctx.ae.call({cmd:'proxy-replace',host:ctx.host,vms:[c.vmCode],set:{planToken:prev.data.planToken},id:requestId(c.operationId,'replace'),timeoutSec:TIMEOUT_SEC.REPLACE_PROXY});
  if(!rep.ok)return {outcome:['CANCELLED','PLAN_CHANGED','NO_DRAFT','PLAN_INVALID','RESOURCE_BUSY'].includes(rep.code)?'FAILED':'UNKNOWN',vmState:(await inspect(ctx)).vmState,detail:{code:rep.code,message:scrub(rep.message)}};
  await ctx.api.request('POST','jobs/'+jobId+'/finish-proxy',{...proj,configurationId:c.configurationId,result:'OK',note:'AE proxy-replace REPLACED · '+note});
  const i=await inspect(ctx);
  return {outcome:i.vmState==='RUNNING'?'SUCCEEDED':'UNKNOWN',vmState:i.vmState,detail:{code:'REPLACED',message:scrub(rep.message)}};
 }catch(e){
  if(dir)fs.rmSync(dir,{recursive:true,force:true});
  try{await ctx.api.request('POST','jobs/'+jobId+'/release',{...proj,note:'fleet REPLACE_PROXY dừng: '+(e.code||'ERROR')});}catch{/* job expires by itself */}
  if(e instanceof Refusal||e instanceof AeError)return {outcome:'FAILED',vmState:'UNKNOWN',detail:{code:e.code,message:scrub(e.message)}};
  throw e;
 }
}
async function recreateVm(ctx){
 const c=ctx.command;
 const prev=await ctx.ae.call({cmd:'vm-recreate-preview',host:ctx.host,vm:c.vmCode,timeoutSec:300});
 if(!prev.ok||prev.code!=='RECREATE_PLAN'||!prev.data?.planToken)return {outcome:'FAILED',vmState:(await inspect(ctx)).vmState,detail:{code:prev.code,message:scrub(prev.message)}};
 const text=JSON.stringify(prev.data),confirm=(text.match(/TAO LAI[^"]{0,120}/)||[])[0];
 if(!confirm||!planMentionsOnly(prev.data,c.vmCode))return {outcome:'FAILED',vmState:'UNKNOWN',detail:{code:'PLAN_SCOPE',message:'Kế hoạch tạo lại không đúng một VM / thiếu chuỗi xác nhận'}};
 const rec=await ctx.ae.call({cmd:'vm-recreate',host:ctx.host,vm:c.vmCode,set:{planToken:prev.data.planToken,confirm},id:requestId(c.operationId,'recreate'),timeoutSec:TIMEOUT_SEC.RECREATE_VM});
 if(!rec.ok)return {outcome:['PLAN_CHANGED','CONFIRM_MISMATCH','CANCELLED'].includes(rec.code)?'FAILED':'UNKNOWN',vmState:'UNKNOWN',detail:{code:rec.code,message:scrub(rec.message)}};
 // New hardware: the VM name is the same, the UUID must differ.
 const i=await inspect(ctx,{expectUuid:null});
 if(!i.uuid||i.uuid===c.machineUuid.toLowerCase())return {outcome:'UNKNOWN',vmState:i.vmState,detail:{code:'UUID_UNCHANGED',message:'AE báo tạo lại nhưng UUID máy không đổi; cần đối soát'}};
 const web=await ctx.api.request('POST','vms/'+c.vmId+'/recreated',{projectId:c.projectId,expectedCycle:c.expectedCycle,machineUuid:i.uuid,note:'AE vm-recreate · fleet '+c.operationId});
 let sdkNote='',sdkTail;
 try{
  const vm=await ctx.api.request('GET','vms/'+c.vmId+'?'+new URLSearchParams({projectId:c.projectId}));
  for(let k=0;k<6&&(await inspect(ctx,{expectUuid:i.uuid})).vmState!=='RUNNING';k++)await sleep(ctx,20000);
  const d=await readSdkToWeb(ctx,{uuid:i.uuid,expectedCycle:web?.cycle??c.expectedCycle+1,expectedVmRevision:vm?.expectedVmRevision??vm?.revision});
  sdkNote=' · '+d.message;sdkTail=d.sdkTail;
 }catch(e){sdkNote=' · SDK chưa lấy được ('+(e.code||'ERROR')+'); chạy "Lấy SDK lên web" sau';}
 const f=await inspect(ctx,{expectUuid:i.uuid});
 return {outcome:'SUCCEEDED',vmState:f.vmState,detail:{code:'RECREATED',message:scrub(rec.message)+' · lượt web '+(web?.cycle??'?')+sdkNote,newMachineUuid:i.uuid,...(sdkTail?{sdkTail}:{})}};
}
export async function perform(ctx){
 switch(ctx.command.action){
  case 'START_VM':return startVm(ctx);
  case 'SHUTDOWN_VM':return stopVm(ctx,'vm-shutdown');
  case 'POWER_OFF_VM':return stopVm(ctx,'vm-power-off');
  case 'CHECK_HEALTH':return checkHealth(ctx);
  case 'CHECK_PROXY':return checkProxy(ctx);
  case 'REPLACE_PROXY':return replaceProxy(ctx);
  case 'RECREATE_VM':return recreateVm(ctx);
  case 'READ_SDK':return readSdk(ctx);
  default:throw new Refusal('ACTION_UNKNOWN',ctx.command.action);
 }
}
/** Reconciliation after a lost answer: read-only. Power/health by machine state; long AE effects by their stored result under the same -Id. */
export async function reconcile(ctx){
 const c=ctx.command;
 if(['CHECK_HEALTH','CHECK_PROXY','READ_SDK'].includes(c.action))return perform(ctx);
 if(c.action==='START_VM'||c.action==='SHUTDOWN_VM'||c.action==='POWER_OFF_VM'){
  const i=await inspect(ctx);const want=c.action==='START_VM'?'RUNNING':'POWERED_OFF';
  return {outcome:i.vmState===want?'SUCCEEDED':i.vmState==='UNKNOWN'?'UNKNOWN':'FAILED',vmState:i.vmState,detail:{code:'RECONCILED',message:'Đối soát theo trạng thái máy: '+i.vmState}};
 }
 const step=c.action==='REPLACE_PROXY'?'replace':'recreate';
 const r=await ctx.ae.call({cmd:'result',host:ctx.host,request:requestId(c.operationId,step),timeoutSec:30});
 if(!r.ok||r.code==='NOT_FOUND'||r.code==='RUNNING')return {outcome:'UNKNOWN',vmState:'UNKNOWN',detail:{code:r.code,message:scrub(r.message)}};
 if(c.action==='REPLACE_PROXY'){const i=await inspect(ctx);return {outcome:r.code==='REPLACED'&&i.vmState==='RUNNING'?'SUCCEEDED':'UNKNOWN',vmState:i.vmState,detail:{code:r.code,message:scrub(r.message)}};}
 const i=await inspect(ctx,{expectUuid:null});
 if(r.code==='RECREATED'&&i.uuid&&i.uuid!==c.machineUuid.toLowerCase()){
  try{await ctx.api.request('POST','vms/'+c.vmId+'/recreated',{projectId:c.projectId,expectedCycle:c.expectedCycle,machineUuid:i.uuid,note:'AE vm-recreate (đối soát) · fleet '+c.operationId});}catch(e){if(e.code!=='CYCLE_CHANGED'&&e.code!=='STALE_PREVIEW')throw e;}
  return {outcome:'SUCCEEDED',vmState:i.vmState,detail:{code:'RECREATED',message:scrub(r.message)+' · đối soát; chạy "Lấy SDK lên web" nếu SDK chưa có',newMachineUuid:i.uuid}};
 }
 return {outcome:'UNKNOWN',vmState:i.vmState,detail:{code:r.code,message:scrub(r.message)}};
}
