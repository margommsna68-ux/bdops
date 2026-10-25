import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {noOwnedBrowser} from './platform.mjs';
import {safeDiagnostics} from './browser.mjs';
import {ApiError} from './api.mjs';

const transientApiFailure=error=>error instanceof ApiError&&(
 ['API_NETWORK','API_TIMEOUT','API_PROTOCOL'].includes(error.code)||
 error.code==='API_REJECTED'&&(error.status===429||error.status>=500&&error.status<=599));
const apiDiagnostic=(error,action)=>({
 action:['heartbeat','heartbeat-job','route','submit'].includes(action)?action:'NONE',
 code:error instanceof ApiError&&['API_NETWORK','API_TIMEOUT','API_PROTOCOL','API_REJECTED','API_CANCELLED','API_REDIRECT','API_ORIGIN'].includes(error.code)?error.code:'NONE',
 status:error instanceof ApiError&&Number.isInteger(error.status)&&error.status>=100&&error.status<=599?error.status:0,
});

export const REASONS=Object.freeze(Object.fromEntries(['LOGIN_SUCCESS','LIVE_2FA','APPLE_LOCKED','CHALLENGE_REQUIRED','INVALID_CREDENTIALS','PROXY_ERROR','NETWORK_ERROR','TIMEOUT','UNKNOWN','CANCELLED'].map(s=>[s,s])));
const DIAGNOSTICS=new Set(['EMAIL_FORM_MISSING','PASSWORD_FORM_MISSING','SUBMIT_BUTTON_MISSING','RESPONSE_UNRECOGNIZED','BROWSER_INTERRUPTED','CREDENTIAL_DELIVERY_FAILED','EMAIL_ENTRY_FAILED','PASSWORD_SUBMIT_FAILED','RESPONSE_READ_FAILED']);
const CLEANUP_CODES=new Set(['EACCES','EPERM','EBUSY','ENOTEMPTY','ENOENT','CLEANUP_TIMEOUT','OWNED_BROWSER_ALIVE','WINDOWS_PROBE_FAILED','LAUNCH_UNRESOLVED','PROFILE_OWNER','UNSAFE_LINK','UNSAFE_FILE']);
const cleanupDiagnostic=error=>CLEANUP_CODES.has(error?.code)?error.code:CLEANUP_CODES.has(error?.message)?error.message:'CLEANUP_ERROR';
export function classify(outcome,email){
  if(!outcome||!Object.hasOwn(REASONS,outcome.result))return 'UNKNOWN';
  if(outcome.result==='LOGIN_SUCCESS'&&!(outcome.authenticated===true&&typeof outcome.identity==='string'&&outcome.identity.trim().toLowerCase()===email.trim().toLowerCase()))return 'UNKNOWN';
  if(['LIVE_2FA','APPLE_LOCKED','INVALID_CREDENTIALS','CHALLENGE_REQUIRED'].includes(outcome.result)&&outcome.explicit!==true)return 'UNKNOWN';
  return outcome.result;
}
export class Worker {
  constructor({store,api,adapter,gate,activeGate,slot,verifyNoBrowser=noOwnedBrowser,heartbeatMs=10000,jobTimeoutMs=180000,cleanupWaitMs=5000,cleanupPollMs=200}){
    if(slot!==undefined&&(!Number.isInteger(slot)||slot<1||slot>5))throw new Error('SLOT_INVALID');
    Object.assign(this,{store,api,adapter,gate,activeGate,slot,verifyNoBrowser,heartbeatMs,jobTimeoutMs,cleanupWaitMs,cleanupPollMs});this.running=false;
  }
  async waitForBrowserExit(profilePath){
    const until=Date.now()+this.cleanupWaitMs;
    for(;;){
      if(await this.verifyNoBrowser(profilePath,{timeoutMs:Math.max(1,until-Date.now())}))return;
      if(Date.now()>=until)throw new Error('OWNED_BROWSER_ALIVE');
      await delay(Math.min(this.cleanupPollMs,until-Date.now()));
    }
  }
  claimBody(key){return {key,...(this.slot!==undefined?{slot:this.slot}:{})};}
  async once({signal,allowNewWork=true}={}){
    if(this.running)throw new Error('WORKER_RUNNING');this.running=true;let unlock;
    try{unlock=await this.store.lock();return await this.tick(signal,{allowNewWork});}finally{if(unlock)await unlock();this.running=false;}
  }
  async report(p,leaseToken){
    if(!leaseToken)return 'PENDING';
    try{await this.api.call('result',{jobId:p.jobId,leaseToken,...p.report});}catch{return 'PENDING';}
    await this.store.remove('pending.json');
    return p.report.cleanup==='FAILED'?'CLEANUP_FAILED':'DONE';
  }
  async recover(p){
    if(p.phase!=='REPORTING'){
      // A crashed process may have left an owned browser alive: verify, never assume.
      let cleanup='OK';
      try{
        if(!await this.verifyNoBrowser(this.store.profilePath(p.profileId)))throw new Error('OWNED_BROWSER_UNRESOLVED');
        await this.store.cleanup(p.profileId);
        let quarantine;try{quarantine=await this.store.read('quarantine.json');}catch(e){if(e.code!=='ENOENT')throw e;}
        if(quarantine?.jobId===p.jobId&&quarantine.profileId===p.profileId)await this.store.remove('quarantine.json');
      }catch{
        cleanup='FAILED';await this.store.write('quarantine.json',{jobId:p.jobId,leaseToken:p.leaseToken,profileId:p.profileId,reason:'INTERRUPTED_BROWSER'});
      }
      p={...p,phase:'REPORTING',report:{result:'UNKNOWN',reasonCode:REASONS.UNKNOWN,cleanup,observedAt:new Date().toISOString()}};
      await this.store.save(p);
    }
    return this.report(p,p.leaseToken);
  }
  async recoverCleanup({verifyNoBrowser}){
    const unlock=await this.store.lock();
    try{
      return await this.cleanupRecovery(verifyNoBrowser);
    }finally{await unlock();}
  }
  async cleanupRecovery(verifyNoBrowser=this.verifyNoBrowser){
    if(await this.store.load())throw new Error('REPORT_PENDING');
    const q=await this.store.read('quarantine.json');
    if(!await verifyNoBrowser(this.store.profilePath(q.profileId)))throw new Error('OWNED_BROWSER_UNRESOLVED');
    await this.store.cleanup(q.profileId);
    await this.api.call('cleanup-recovered',{jobId:q.jobId,leaseToken:q.leaseToken});
    await this.store.remove('quarantine.json');return 'RECOVERED';
  }
  async tick(signal,{allowNewWork=true}={}){
    const pending=await this.store.load();
    let inflight;try{inflight=await this.store.read('claim-inflight.json');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(inflight?.slot!==undefined&&inflight.slot!==(this.slot??1))throw new Error('CLAIM_SLOT_MISMATCH');
    if(pending){
      if(inflight){
        const job=inflight.job;
        const matches=job&&typeof pending.leaseToken==='string'&&job.id===pending.jobId&&job.leaseToken===pending.leaseToken&&
          (!pending.claim||['id','leaseToken','accountId','accountRevision'].every(key=>pending.claim[key]===job[key]));
        if(!matches){
          let quarantine;try{quarantine=await this.store.read('quarantine.json');}catch(e){if(e.code!=='ENOENT')throw e;}
          if(!quarantine)await this.store.write('quarantine.json',{jobId:pending.jobId,profileId:pending.profileId,reason:'JOURNAL_IDENTITY_MISMATCH'});
          throw new Error('JOURNAL_IDENTITY_MISMATCH');
        }
        // Reconcile the save-pending/remove-claim crash window BEFORE any report ack
        // can remove pending and leave the old claim capable of resurrecting the job.
        await this.store.remove('claim-inflight.json');
      }
      return this.recover(pending);
    }
    if(inflight&&!inflight.job){
      if(typeof inflight.key!=='string'||inflight.key.length<8||inflight.key.length>100)throw new Error('CLAIM_JOURNAL_INVALID');
      let job;try{({job}=await this.api.call('claim',this.claimBody(inflight.key)));}catch{return 'PENDING_CLAIM';}
      if(!job){await this.store.remove('claim-inflight.json');return 'IDLE';}
      inflight={...inflight,job};await this.store.write('claim-inflight.json',inflight);
    }
    if(inflight?.job){
      const profile=await this.store.createProfile(),job=inflight.job;
      const recovered={jobId:job.id,leaseToken:job.leaseToken,claim:job,profileId:profile.id,phase:'CLAIMED'};
      await this.store.save(recovered);await this.store.remove('claim-inflight.json');return this.recover(recovered);
    }
    try{await this.store.read('quarantine.json');await this.api.call('heartbeat',{state:'CLEANUP_FAILED'});return 'CLEANUP_FAILED';}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!allowNewWork)return 'IDLE';
    if(signal?.aborted)return 'STOPPED';
    const state=await this.gate();if(signal?.aborted)return 'STOPPED';const hello=await this.api.call('heartbeat',{state},{signal});
    if(!hello.enabled)return 'DISABLED';if(state!=='IDLE')return state;
    const attempt={key:randomUUID(),startedAt:new Date().toISOString(),...(this.slot!==undefined?{slot:this.slot}:{})};await this.store.write('claim-inflight.json',attempt);
    const claimStarted=Date.parse(attempt.startedAt);
    let job;try{({job}=await this.api.call('claim',this.claimBody(attempt.key), {signal}));}catch{return 'PENDING_CLAIM';}
    if(!job){await this.store.remove('claim-inflight.json');return 'IDLE';}
    // Save the raw capability immediately: profile creation, route and submit follow it.
    await this.store.write('claim-inflight.json',{...attempt,job});
    const profile=await this.store.createProfile();
    let pendingRecord={jobId:job.id,leaseToken:job.leaseToken,claim:job,profileId:profile.id,phase:'CLAIMED'};
    await this.store.save(pendingRecord);await this.store.remove('claim-inflight.json');
    if(job.recoveryOnly)return this.recover(pendingRecord);
    const control=new AbortController();const deadline=AbortSignal.timeout(Math.max(1,Math.min(this.jobTimeoutMs,180000)-(Date.now()-claimStarted)));
    const active=AbortSignal.any([control.signal,deadline,...(signal?[signal]:[])]);
    const identity={jobId:job.id,leaseToken:job.leaseToken};
    let monitorStop=false,monitorWake=new AbortController(),browser,result='UNKNOWN',reasonCode='UNKNOWN',stage='LEASE',monitorAction='heartbeat-job',abortSource='NONE',apiFailure=apiDiagnostic(null),diagnostic;
    const started=performance.now();
    const check=async()=>{
      active.throwIfAborted();const lease=await this.api.call('heartbeat-job',identity,{signal:active});
      if(lease.cancelRequested){control.abort(new Error('CANCELLED'));active.throwIfAborted();}
      active.throwIfAborted();
    };
    const monitor=(async()=>{
      try{while(!monitorStop){await delay(this.heartbeatMs,undefined,{signal:monitorWake.signal});if(monitorStop)break;monitorAction='heartbeat-job';await check();
        monitorAction='ACTIVE_GATE';if(await (this.activeGate??this.gate)()!=='IDLE'){abortSource='ACTIVE_GATE';control.abort(new Error('DESKTOP_OR_RESOURCES_LOST'));break;}
        monitorAction='heartbeat';
        // Lease renewal above is authoritative. A transient presence update must
        // not interrupt authentication after the same round just renewed it.
        try{const h=await this.api.call('heartbeat',{state:'BUSY'},{signal:active});if(!h.enabled)control.abort(new Error('CANCELLED'));}
        catch(error){if(!transientApiFailure(error))throw error;}
      }}catch(error){if(!monitorStop&&!active.aborted){apiFailure=apiDiagnostic(error,monitorAction);abortSource=monitorAction==='ACTIVE_GATE'?'ACTIVE_GATE':monitorAction==='heartbeat'?'WORKER_HEARTBEAT':'JOB_HEARTBEAT';control.abort(new Error('LEASE_LOST'));}}
    })();
    try{
      await check();stage='ROUTE';const {proxy}=await this.api.call('route',identity,{signal:active});active.throwIfAborted();
      stage='BROWSER';browser=this.adapter.create();await browser.open({profilePath:profile.path,proxy,signal:active});
      stage='ROUTE';const preflight=await browser.probe({signal:active});await check();
      if(preflight?.result==='CHALLENGE_REQUIRED'&&preflight.explicit===true){result='CHALLENGE_REQUIRED';}
      else {
      stage='SUBMIT';pendingRecord={...pendingRecord,phase:'SUBMITTING'};await this.store.save(pendingRecord);active.throwIfAborted();
      // This endpoint is intentionally NEVER retried: delivery itself checkpoints the account.
      let credentials=await this.api.call('submit',identity,{signal:active});
      try{active.throwIfAborted();stage='BROWSER_SUBMIT';const outcome=await browser.submit(credentials,{signal:active});result=classify(outcome,credentials.email);reasonCode=result==='UNKNOWN'&&DIAGNOSTICS.has(outcome?.reasonCode)?outcome.reasonCode:REASONS[result];active.throwIfAborted();}
      finally{credentials=null;}
      }
    }catch(error){
      if(abortSource==='NONE')abortSource=deadline.aborted?'DEADLINE':signal?.aborted?'EXTERNAL_STOP':control.signal.reason?.message==='CANCELLED'?'SERVER_CANCELLED':'OPERATION_FAILED';
      if(error instanceof ApiError&&apiFailure.code==='NONE')apiFailure=apiDiagnostic(error,stage==='SUBMIT'?'submit':stage==='ROUTE'?'route':'heartbeat-job');
      result=deadline.aborted?'TIMEOUT':signal?.aborted||control.signal.reason?.message==='CANCELLED'?'CANCELLED':active.aborted?'UNKNOWN':error instanceof ApiError?'NETWORK_ERROR':stage==='ROUTE'?'PROXY_ERROR':'UNKNOWN';
      reasonCode=result==='UNKNOWN'?(stage==='SUBMIT'?'CREDENTIAL_DELIVERY_FAILED':'BROWSER_INTERRUPTED'):REASONS[result];
    }finally{
      monitorStop=true;monitorWake.abort();await monitor;
    }
    const needsDiagnostic=['UNKNOWN','PROXY_ERROR','NETWORK_ERROR','TIMEOUT'].includes(result);
    if(needsDiagnostic&&typeof browser?.diagnostics==='function'){
      let timer;
      try{diagnostic=await Promise.race([browser.diagnostics(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DIAGNOSTIC_TIMEOUT')),2000);})]);}catch{}
      finally{clearTimeout(timer);}
    }
    let cleanup='OK',cleanupStage='CLOSE',cleanupCode='NONE';
    try{if(browser)await browser.close();cleanupStage='VERIFY';await this.waitForBrowserExit(profile.path);cleanupStage='DELETE';await this.store.cleanup(profile.id);cleanupStage='OK';}catch(error){
      cleanupCode=cleanupDiagnostic(error);
      cleanup='FAILED';await this.store.write('quarantine.json',{jobId:job.id,leaseToken:job.leaseToken,profileId:profile.id,reason:'CLEANUP_FAILED'});
    }
    if(needsDiagnostic||cleanup==='FAILED'){
      try{await this.store.write('last-diagnostic.json',{jobId:job.id,at:new Date().toISOString(),...safeDiagnostics(diagnostic),runtime:{stage,abortSource,api:apiFailure,cleanupStage,cleanupCode,elapsedMs:Math.min(300000,Math.round(performance.now()-started))}});}catch{}
    }
    pendingRecord={...pendingRecord,phase:'REPORTING',report:{result,reasonCode:result==='UNKNOWN'?reasonCode:REASONS[result],cleanup,observedAt:new Date().toISOString()}};
    await this.store.save(pendingRecord);return this.report(pendingRecord,job.leaseToken);
  }
  async loop({signal,pollMs=15000,onState=()=>{}}={}){
    if(this.running)throw new Error('WORKER_RUNNING');this.running=true;let unlock;
    try{
      unlock=await this.store.lock();
      while(!signal?.aborted){
        let state;try{state=await this.tick(signal);}catch{state='ERROR';}await onState(state);
        if(['CLEANUP_FAILED','DISABLED','STOPPED'].includes(state))return state;
        try{await delay(pollMs,undefined,signal?{signal}:{});}catch{break;}
      }
      return 'STOPPED';
    }finally{if(unlock)await unlock();this.running=false;}
  }
}

export class WorkerPool {
  constructor({store,api,adapter,gate,activeGate,verifyNoBrowser=noOwnedBrowser,heartbeatMs=10000,jobTimeoutMs=180000,maxSlots=5}){
    if(!Number.isInteger(maxSlots)||maxSlots<1||maxSlots>5)throw new Error('SLOT_INVALID');
    Object.assign(this,{store,api,adapter,gate,activeGate:activeGate??(async()=>{const state=await gate({monitor:true,activeSlots:0});return state==='WAITING_RESOURCES'?'IDLE':state;}),verifyNoBrowser,heartbeatMs,jobTimeoutMs,maxSlots});this.running=false;
  }
  once(options={}){return this.run({...options,once:true});}
  loop(options={}){return this.run({...options,once:false});}
  async recoverCleanup(){
    const unlock=await this.store.lock();
    try{
      const stores=[this.store];for(let slot=1;slot<=5;slot++)stores.push(await this.store.slot(slot));
      let result='RECOVERED';
      for(let index=0;index<stores.length;index++){
        const store=stores[index];let release;
        try{
          if(index)release=await store.lock();
          const worker=new Worker({store,api:this.api,adapter:this.adapter,gate:this.gate,slot:index||undefined,verifyNoBrowser:this.verifyNoBrowser});
          if(await store.load()||await store.read('claim-inflight.json').catch(e=>{if(e.code==='ENOENT')return null;throw e;}))await worker.tick(undefined,{allowNewWork:false});
          const state=await store.recoveryState();
          if(state==='CLEANUP_FAILED'&&!await store.load())await worker.cleanupRecovery();
          else if(state!=='IDLE'&&result!=='CLEANUP_FAILED')result='PENDING';
        }catch{result='CLEANUP_FAILED';}
        finally{if(release)await release();}
      }
      await this.store.write('status.json',{state:result,activeCount:0,at:new Date().toISOString()});return result;
    }finally{await unlock();}
  }
  async run({signal,once=false,pollMs=15000,onState=async()=>{}}={}){
    if(this.running)throw new Error('WORKER_RUNNING');this.running=true;let unlock;
    const control=new AbortController(),active=signal?AbortSignal.any([signal,control.signal]):control.signal;
    const reserved=new Set(),occupied=new Set(),blocked=new Set(),states=Array.from({length:5},(_,i)=>({slot:i+1,state:'IDLE'}));
    let fatal=null,admissionTail=Promise.resolve(),publishTail=Promise.resolve();
    const fail=state=>{if(!fatal||state==='CLEANUP_FAILED')fatal=state;control.abort();};
    const aggregate=()=>fatal??(active.aborted?'STOPPED':reserved.size?'BUSY':
      ['PENDING','PENDING_CLAIM','WAITING_DESKTOP','WAITING_RESOURCES','DISABLED','ERROR','DONE'].find(s=>states.some(x=>x.state===s))??'IDLE');
    const publish=()=>{
      const next=publishTail.then(async()=>{
        const snapshot={state:aggregate(),activeCount:reserved.size,slots:states.map(x=>({...x})),at:new Date().toISOString()};
        await this.store.write('status.json',snapshot);await onState(snapshot.state,snapshot);
      });publishTail=next.catch(()=>{});return next;
    };
    try{
      unlock=await this.store.lock();
      const stores=[];for(let slot=1;slot<=5;slot++)stores.push(await this.store.slot(slot));
      const failedCleanup=async()=>{
        for(const store of [this.store,...stores])if(await store.recoveryState()==='CLEANUP_FAILED')return true;
        return false;
      };
      const options={api:this.api,adapter:this.adapter,gate:this.gate,activeGate:this.activeGate,verifyNoBrowser:this.verifyNoBrowser,heartbeatMs:this.heartbeatMs,jobTimeoutMs:this.jobTimeoutMs};
      const legacy=new Worker({...options,store:this.store});
      const workers=stores.map((store,index)=>{
        const slot=index+1;
        const gated=()=>{
          const next=admissionTail.then(async()=>{
            if(active.aborted)return 'WAITING_RESOURCES';
            if(await failedCleanup()){fail('CLEANUP_FAILED');return 'WAITING_RESOURCES';}
            if(blocked.size)return 'WAITING_RESOURCES';
            const state=await this.gate({slot,activeSlots:reserved.size});
            if(state==='IDLE'&&!active.aborted)reserved.add(slot);
            return state;
          });admissionTail=next.catch(()=>{});return next;
        };
        const api={call:async(action,body,options)=>{
          const data=await this.api.call(action,action==='heartbeat'?{...body,state:fatal==='CLEANUP_FAILED'?'CLEANUP_FAILED':occupied.size?'BUSY':body.state}:body,options);
          if(action==='claim'&&data.job)occupied.add(slot);
          return data;
        }};
        return new Worker({...options,store,slot,api,gate:gated});
      });
      // Global startup barrier: process EVERY root/slot recovery before deciding
      // whether quarantine/unacknowledged reports permit any fresh claim.
      for(;;){
        const recoveries=await Promise.all([
          legacy.tick(active,{allowNewWork:false}).catch(()=> 'ERROR'),
          ...workers.map(async(worker,index)=>{
            let state;try{state=await worker.once({signal:active,allowNewWork:false});}catch{state='ERROR';}
            occupied.delete(index+1);states[index].state=state;
            await worker.store.write('status.json',{state,at:new Date().toISOString()});return state;
          }),
        ]);
        if(recoveries.includes('CLEANUP_FAILED')||await failedCleanup())fail('CLEANUP_FAILED');
        else if(recoveries.includes('ERROR'))fail('ERROR');
        const unresolved=recoveries.find(state=>!['IDLE','DONE'].includes(state));
        await publish();
        if(fatal)return fatal;
        if(!unresolved)break;
        if(once||active.aborted)return active.aborted?'STOPPED':unresolved;
        try{await delay(Math.max(15000,pollMs),undefined,{signal:active});}catch{return 'STOPPED';}
      }
      const runSlot=async(worker,index)=>{
        const slot=index+1;
        try{
          do{
            if(active.aborted)break;
            states[index].state='BUSY';await publish();
            let state;
            try{state=await worker.once({signal:active,allowNewWork:slot<=this.maxSlots});}
            catch(error){state=[401,403].includes(error?.status)?'DISABLED':'ERROR';if(!transientApiFailure(error))fail(state);}
            finally{reserved.delete(slot);occupied.delete(slot);}
            states[index].state=state;
            if(['PENDING','PENDING_CLAIM'].includes(state))blocked.add(slot);else blocked.delete(slot);
            await worker.store.write('status.json',{state,at:new Date().toISOString()});
            if(await worker.store.recoveryState()==='CLEANUP_FAILED')fail('CLEANUP_FAILED');
            if(state==='DISABLED')fail('DISABLED');
            await publish();
            if(once||active.aborted)break;
            try{await delay(Math.max(15000,pollMs),undefined,{signal:active});}catch{break;}
          }while(!active.aborted);
        }catch{states[index].state='ERROR';fail('ERROR');}
      };
      await Promise.all(stores.map((_,i)=>runSlot(workers[i],i)));
      await publish();return aggregate();
    }finally{control.abort();await publishTail;if(unlock)await unlock();this.running=false;}
  }
}
