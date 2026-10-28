import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Journal} from '../../fleet-control/journal.mjs';
import {aeArgs,parseAnswer,requestId,vmStateOf,AeError} from '../ae.mjs';
import {codeFromCapture} from '../sdk.mjs';
import {perform,reconcile} from '../actions.mjs';
import {FleetOpsWorker,parseConfig,captureCommand} from '../worker.mjs';

const SCRIPT='C:/Users/Administrator/Desktop/Claude Fleet/ae.ps1';
const server={projectId:'p1',serverId:'s1',serverUuid:'332ec214-e130-4d8a-8371-cca9aac37cd9',hostAlias:'moon-02'};
const op=randomUUID(),vmUuid='3aa28db5-f9bb-4c99-b70e-ff64941eb090';
const view=(action,extra={})=>({operationId:op,projectId:'p1',serverId:'s1',serverUuid:server.serverUuid,vmId:'vm1',vmCode:'m_901',machineUuid:vmUuid,expectedCycle:1,expectedVmRevision:3,configurationId:null,action,state:'CLAIMED',leaseEpoch:1,leaseUntil:new Date(Date.now()+60000).toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),createdAt:new Date().toISOString(),workerId:null,dispatchedAt:null,cancelRequestedAt:null,...extra});
const info=(state,uuid=vmUuid)=>({ok:true,code:'VM_INFO',message:'m_901 '+state+'.',data:{vm:'m_901',uuid,classification:{Machine:{State:state}}}});

/** Scripted AE: answers by command name in order; records every call. */
function fakeAe(script){const calls=[];return {calls,async call(o){calls.push(o);const q=script[o.cmd];if(!q||!q.length)throw new AeError('AE_OUTCOME_UNKNOWN','unscripted '+o.cmd);const a=q.shift();return typeof a==='function'?a(o):a;}};}
function fakeApi(v,{permit=true}={}){
 const calls=[];let state=v.state,epoch=v.leaseEpoch;
 return {calls,
  async claim(b){calls.push(['claim',b]);return {command:{...v,state,leaseEpoch:epoch,workerId:b.workerId},reconciliationOnly:state==='UNKNOWN'};},
  async detail(){return {...v,state,leaseEpoch:epoch,workerId:calls[0][1].workerId};},
  async renew(id,b){calls.push(['renew',b]);return {...v,state,leaseEpoch:epoch,workerId:b.workerId};},
  async step(id,b){calls.push(['step',b]);state='DISPATCHED';return {command:{...v,state,leaseEpoch:epoch,dispatchedAt:new Date().toISOString()},permit:permit?{...v,leaseEpoch:epoch}:null};},
  async complete(id,b){calls.push(['complete',b]);state=b.outcome;return {...v,state};},
  async request(method,route,body){calls.push([method,route,body]);
   if(route.startsWith('sdks?'))return {items:[]};
   if(route.endsWith('/claim'))return {recorded:{job:{id:'job1'}}};
   if(route.endsWith('/proxy-credentials'))return {recorded:{configurationId:'cfg1'},proxy:{host:'10.0.0.1',port:5432,username:'u',password:'secret-pass'}};
   if(route.endsWith('/recreated'))return {cycle:2,machineUuid:body.machineUuid,uuidWritten:true};
   if(route.startsWith('vms/vm1?'))return {expectedVmRevision:4};
   return {};
  }};
}
function worker(v,script,o={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-ops-test-'));
 const api=fakeApi(v,o),ae=fakeAe(script),sdk=o.sdk??{async read(){return {code:'sdk-win-0123456789abcdef0123456789abad3f',tail:'ad3f'};}};
 const w=new FleetOpsWorker({api,ae,sdk,journal:new Journal(dir),config:parseConfig({version:1,baseUrl:'https://wow.lalamail.sbs/api/ops/v1',servers:[server]}),renewEveryMs:5,sleep:ms=>new Promise(r=>setTimeout(r,Math.min(ms,5)))});
 return {w,api,ae,dir};
}

test('ae argv is an allow-list; -Set refuses secrets and pipes; request ids are stable per operation and step',()=>{
 const a=aeArgs(SCRIPT,{cmd:'vm-power-off',host:'moon-02',vm:'m_901',uuid:vmUuid.toUpperCase(),set:{reason:'x y'},id:requestId(op,'stop'),timeoutSec:120});
 assert.deepEqual(a.slice(5),[SCRIPT,'vm-power-off','-Host','moon-02','-Vm','m_901','-Uuid',vmUuid,'-Set','reason=x y','-Id','mth-'+op+'-stop','-TimeoutSec','120']);
 assert.throws(()=>aeArgs(SCRIPT,{cmd:'vm-delete',host:'moon-02',vm:'m_901'}),/COMMAND_DENIED/);
 assert.throws(()=>aeArgs(SCRIPT,{cmd:'vm-info',host:'moon-02;rm',vm:'m_901'}),/BAD_HOST/);
 assert.throws(()=>aeArgs(SCRIPT,{cmd:'proxy-draft-import',host:'moon-02',set:{password:'x'}}),/BAD_SET/);
 assert.throws(()=>aeArgs(SCRIPT,{cmd:'proxy-draft-import',host:'moon-02',set:{file:'a|b'}}),/BAD_SET/);
 assert.equal(parseAnswer('noise\n{"v":1,"id":"x","ok":true,"code":"VM_INFO"}').code,'VM_INFO');
 assert.throws(()=>parseAnswer('garbage'),/AE_PROTOCOL_ERROR/);
 assert.equal(vmStateOf('poweroff'),'POWERED_OFF');assert.equal(vmStateOf('weird'),'UNKNOWN');
 assert.equal(codeFromCapture({guest:{candidateFiles:[{code:'sdk-win-0123456789abcdef0123456789abad3f'}]}}),'sdk-win-0123456789abcdef0123456789abad3f');
 assert.equal(codeFromCapture({guest:{candidateFiles:[{code:'sdk-win-0123456789abcdef0123456789abad3f'},{code:'sdk-win-ffffffffffffffffffffffffffffffff'}]}}),null);
});

test('config and command capture refuse mismatched server identity',()=>{
 assert.throws(()=>parseConfig({version:1,baseUrl:'x',servers:[server,server]}),/CONFIG_DUPLICATE/);
 assert.equal(parseConfig({version:1,baseUrl:'x',servers:[server]}).proxyKind,'SOCKS5');
 assert.throws(()=>captureCommand(view('START_VM',{serverUuid:randomUUID()}),server),/COMMAND_SERVER_MISMATCH/);
 assert.throws(()=>captureCommand(view('DELETE_VM'),server),/COMMAND_INVALID/);
});

test('START_VM: dispatch permit, AE start, verified RUNNING evidence, journal receipt, idempotent re-run',async()=>{
 const {w,api,ae}=worker(view('START_VM'),{'vm-start-headless':[{ok:true,code:'POWER_ON',message:'m_901: đã chạy nền'}],'vm-info':[info('running'),info('running')]});
 const r=await w.tick();
 assert.equal(r.outcome,'SUCCEEDED');assert.equal(r.evidence.vmState,'RUNNING');assert.equal(r.evidence.detail.code,'POWER_ON');assert.equal(r.reported,true);
 assert.ok(api.calls.some(c=>c[0]==='step'));assert.equal(ae.calls[0].cmd,'vm-start-headless');assert.equal(ae.calls[0].uuid,vmUuid);
 // second claim of the same operation (e.g. lost ACK) replays the receipt without any AE call
 const before=ae.calls.length;const again=await w.tick();assert.equal(again.outcome,'SUCCEEDED');assert.equal(ae.calls.length,before);
});

test('POWER_OFF_VM uncertain AE answer becomes UNKNOWN (unverified); reconciliation reads the machine state only',async()=>{
 const {w,ae}=worker(view('POWER_OFF_VM'),{'vm-power-off':[{ok:false,code:'STILL_STOPPING',message:'stopping'}],'vm-info':[info('running'),info('poweroff')]});
 const first=await w.tick();assert.equal(first.outcome,'UNKNOWN');assert.equal(first.evidence.verified,false);
 const second=await w.tick();assert.equal(second.outcome,'SUCCEEDED');assert.equal(second.evidence.detail.code,'RECONCILED');
 assert.ok(!ae.calls.slice(1).some(c=>c.cmd==='vm-power-off'),'never re-issues the power command');
});

test('READ_SDK posts the full code to the web only, evidence keeps the tail',async()=>{
 const {w,api}=worker(view('READ_SDK'),{'vm-info':[info('running')]});
 const r=await w.tick();
 assert.equal(r.outcome,'SUCCEEDED');assert.deepEqual(r.evidence.detail,{code:'DONE',message:'SDK …ad3f đã ghi lên web',sdkTail:'ad3f'});
 const post=api.calls.find(c=>c[0]==='POST'&&c[1]==='vms/vm1/sdk-observations');
 assert.equal(post[2].sdks[0].code,'sdk-win-0123456789abcdef0123456789abad3f');assert.equal(post[2].expectedVmRevision,3);
 assert.ok(!JSON.stringify(api.calls.filter(c=>c[0]==='complete')).includes('0123456789abcdef'),'complete body never carries the code');
});

test('REPLACE_PROXY: job → credentials → inbox → draft → preview (exactly this VM) → replace → finish-proxy; secret only in the inbox file',async()=>{
 let inboxContent='';
 const ae={'inbox-put':[o=>{inboxContent=fs.readFileSync(o.source,'utf8');return {ok:true,code:'INBOX_PUT',data:{file:'in-1.txt'}};}],'proxy-draft-import':[{ok:true,code:'DRAFT_SAVED',message:'1 line'}],
  'proxy-replace-preview':[{ok:true,code:'REPLACE_PLAN',message:'plan',data:{planToken:'tok',vms:[{vm:'m_901',change:true}]}}],'proxy-replace':[{ok:true,code:'REPLACED',message:'m_901 replaced'}],'vm-info':[info('running')]};
 const {w,api}=worker(view('REPLACE_PROXY',{configurationId:'cfg1'}),ae);
 const r=await w.tick();
 assert.equal(r.outcome,'SUCCEEDED');assert.equal(r.evidence.detail.code,'REPLACED');
 assert.equal(inboxContent,'m_901 10.0.0.1:5432:u:secret-pass\n');
 assert.ok(api.calls.some(c=>c[1]==='jobs/job1/finish-proxy'&&c[2].result==='OK'&&c[2].configurationId==='cfg1'));
 assert.ok(!JSON.stringify(api.calls.filter(c=>c[0]==='complete')).includes('secret-pass'));
});

test('REPLACE_PROXY aborts before proxy-replace when the preview touches another VM, and releases the job',async()=>{
 const ae={'inbox-put':[{ok:true,code:'INBOX_PUT',data:{file:'in-1.txt'}}],'proxy-draft-import':[{ok:true,code:'DRAFT_SAVED'}],'proxy-replace-preview':[{ok:true,code:'REPLACE_PLAN',data:{planToken:'tok',vms:[{vm:'m_901'},{vm:'VM_036'}]}}],'proxy-replace':[{ok:true,code:'REPLACED'}]};
 const {w,api,ae:fake}=worker(view('REPLACE_PROXY',{configurationId:'cfg1'}),ae);
 const r=await w.tick();
 assert.equal(r.outcome,'FAILED');assert.equal(r.evidence.detail.code,'PLAN_SCOPE');
 assert.ok(!fake.calls.some(c=>c.cmd==='proxy-replace'));assert.ok(api.calls.some(c=>c[1]==='jobs/job1/release'));
});

test('RECREATE_VM: preview confirm text, recreate, new UUID → web recreated + SDK; same UUID → UNKNOWN',async()=>{
 const fresh=randomUUID();
 const ae={'vm-recreate-preview':[{ok:true,code:'RECREATE_PLAN',data:{planToken:'pt',confirm:'TAO LAI m_901',vms:['m_901']}}],'vm-recreate':[{ok:true,code:'RECREATED',message:'m_901 tạo lại xong'}],'vm-info':[info('running',fresh),info('running',fresh),info('running',fresh)]};
 const {w,api,ae:fake}=worker(view('RECREATE_VM'),ae);
 const r=await w.tick();
 assert.equal(r.outcome,'SUCCEEDED');assert.equal(r.evidence.detail.code,'RECREATED');assert.equal(r.evidence.detail.newMachineUuid,fresh);assert.equal(r.evidence.detail.sdkTail,'ad3f');
 assert.deepEqual(fake.calls.find(c=>c.cmd==='vm-recreate').set,{planToken:'pt',confirm:'TAO LAI m_901'});
 const rec=api.calls.find(c=>c[1]==='vms/vm1/recreated');assert.equal(rec[2].machineUuid,fresh);assert.equal(rec[2].expectedCycle,1);
 const sdk=api.calls.find(c=>c[1]==='vms/vm1/sdk-observations');assert.equal(sdk[2].expectedCycle,2);assert.equal(sdk[2].expectedVmRevision,4);
 const same=worker(view('RECREATE_VM'),{'vm-recreate-preview':[{ok:true,code:'RECREATE_PLAN',data:{planToken:'pt',confirm:'TAO LAI m_901'}}],'vm-recreate':[{ok:true,code:'RECREATED'}],'vm-info':[info('running')]});
 const u=await same.w.tick();assert.equal(u.outcome,'UNKNOWN');assert.equal(u.evidence.detail.code,'UUID_UNCHANGED');assert.ok(!same.api.calls.some(c=>c[1]==='vms/vm1/recreated'));
});

test('reconcile RECREATE_VM by stored AE result under the same -Id',async()=>{
 const fresh=randomUUID();
 const {w,ae}=worker(view('RECREATE_VM',{state:'UNKNOWN',leaseEpoch:2}),{result:[{ok:true,code:'RECREATED',message:'done'}],'vm-info':[info('running',fresh)]});
 const r=await w.tick();assert.equal(r.outcome,'SUCCEEDED');assert.equal(r.evidence.detail.newMachineUuid,fresh);
 assert.equal(ae.calls[0].cmd,'result');assert.equal(ae.calls[0].request,'mth-'+op+'-recreate');
});

test('CHECK_PROXY falls back to the pool view when AE has no EarnApp account for the VM',async()=>{
 const {w}=worker(view('CHECK_PROXY'),{'vm-info':[info('running')],'check-ip':[{ok:false,code:'ACCOUNT',message:'No single active EarnApp account'}],'proxy-pool':[{ok:true,code:'PROXY_POOL',data:{vms:[{vm:'m_901',proxy:null,policyMode:'fixed'}]}}]});
 const r=await w.tick();assert.equal(r.outcome,'SUCCEEDED');assert.equal(r.evidence.detail.code,'PROXY_POOL');assert.match(r.evidence.detail.message,/chưa có proxy/);
});
void perform;void reconcile;
