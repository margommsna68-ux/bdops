import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {noOwnedBrowser} from './platform.mjs';

export const REASONS=Object.freeze(Object.fromEntries(['LOGIN_SUCCESS','LIVE_2FA','APPLE_LOCKED','CHALLENGE_REQUIRED','INVALID_CREDENTIALS','PROXY_ERROR','NETWORK_ERROR','TIMEOUT','UNKNOWN','CANCELLED'].map(s=>[s,s])));
const DIAGNOSTICS=new Set(['EMAIL_FORM_MISSING','PASSWORD_FORM_MISSING','SUBMIT_BUTTON_MISSING','RESPONSE_UNRECOGNIZED','BROWSER_INTERRUPTED','CREDENTIAL_DELIVERY_FAILED','EMAIL_ENTRY_FAILED','PASSWORD_SUBMIT_FAILED','RESPONSE_READ_FAILED']);
export function classify(outcome,email){
  if(!outcome||!Object.hasOwn(REASONS,outcome.result))return 'UNKNOWN';
  if(outcome.result==='LOGIN_SUCCESS'&&!(outcome.authenticated===true&&typeof outcome.identity==='string'&&outcome.identity.trim().toLowerCase()===email.trim().toLowerCase()))return 'UNKNOWN';
  if(['LIVE_2FA','APPLE_LOCKED','INVALID_CREDENTIALS','CHALLENGE_REQUIRED'].includes(outcome.result)&&outcome.explicit!==true)return 'UNKNOWN';
  return outcome.result;
}
export class Worker {
  constructor({store,api,adapter,gate,verifyNoBrowser=noOwnedBrowser,heartbeatMs=10000,jobTimeoutMs=180000}){
    Object.assign(this,{store,api,adapter,gate,verifyNoBrowser,heartbeatMs,jobTimeoutMs});this.running=false;
  }
  async once({signal}={}){
    if(this.running)throw new Error('WORKER_RUNNING');this.running=true;let unlock;
    try{unlock=await this.store.lock();return await this.tick(signal);}finally{if(unlock)await unlock();this.running=false;}
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
      if(await this.store.load())throw new Error('REPORT_PENDING');
      const q=await this.store.read('quarantine.json');
      if(!await verifyNoBrowser(this.store.profilePath(q.profileId)))throw new Error('OWNED_BROWSER_UNRESOLVED');
      await this.store.cleanup(q.profileId);
      await this.api.call('cleanup-recovered',{jobId:q.jobId,leaseToken:q.leaseToken});
      await this.store.remove('quarantine.json');return 'RECOVERED';
    }finally{await unlock();}
  }
  async tick(signal){
    const pending=await this.store.load();
    let inflight;try{inflight=await this.store.read('claim-inflight.json');}catch(e){if(e.code!=='ENOENT')throw e;}
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
      let job;try{({job}=await this.api.call('claim',{key:inflight.key}));}catch{return 'PENDING_CLAIM';}
      if(!job){await this.store.remove('claim-inflight.json');return 'IDLE';}
      inflight={...inflight,job};await this.store.write('claim-inflight.json',inflight);
    }
    if(inflight?.job){
      const profile=await this.store.createProfile(),job=inflight.job;
      const recovered={jobId:job.id,leaseToken:job.leaseToken,claim:job,profileId:profile.id,phase:'CLAIMED'};
      await this.store.save(recovered);await this.store.remove('claim-inflight.json');return this.recover(recovered);
    }
    try{await this.store.read('quarantine.json');await this.api.call('heartbeat',{state:'CLEANUP_FAILED'});return 'CLEANUP_FAILED';}catch(e){if(e.code!=='ENOENT')throw e;}
    if(signal?.aborted)return 'STOPPED';
    const state=await this.gate();const hello=await this.api.call('heartbeat',{state},{signal});
    if(!hello.enabled)return 'DISABLED';if(state!=='IDLE')return state;
    const attempt={key:randomUUID(),startedAt:new Date().toISOString()};await this.store.write('claim-inflight.json',attempt);
    const claimStarted=Date.parse(attempt.startedAt);
    let job;try{({job}=await this.api.call('claim',{key:attempt.key}, {signal}));}catch{return 'PENDING_CLAIM';}
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
    let monitorStop=false,monitorWake=new AbortController(),browser,result='UNKNOWN',reasonCode='UNKNOWN',stage='LEASE';
    const check=async()=>{
      active.throwIfAborted();const lease=await this.api.call('heartbeat-job',identity,{signal:active});
      if(lease.cancelRequested){control.abort(new Error('CANCELLED'));active.throwIfAborted();}
      active.throwIfAborted();
    };
    const monitor=(async()=>{
      try{while(!monitorStop){await delay(this.heartbeatMs,undefined,{signal:monitorWake.signal});if(monitorStop)break;await check();
        if(await this.gate()!=='IDLE'){control.abort(new Error('DESKTOP_OR_RESOURCES_LOST'));break;}
        const h=await this.api.call('heartbeat',{state:'BUSY'},{signal:active});if(!h.enabled)control.abort(new Error('CANCELLED'));
      }}catch{if(!monitorStop&&!active.aborted)control.abort(new Error('LEASE_LOST'));}
    })();
    try{
      await check();stage='ROUTE';const {proxy}=await this.api.call('route',identity,{signal:active});active.throwIfAborted();
      browser=this.adapter.create();await browser.open({profilePath:profile.path,proxy,signal:active});
      const preflight=await browser.probe({signal:active});await check();
      if(preflight?.result==='CHALLENGE_REQUIRED'&&preflight.explicit===true){result='CHALLENGE_REQUIRED';}
      else {
      stage='SUBMIT';pendingRecord={...pendingRecord,phase:'SUBMITTING'};await this.store.save(pendingRecord);active.throwIfAborted();
      // This endpoint is intentionally NEVER retried: delivery itself checkpoints the account.
      let credentials=await this.api.call('submit',identity,{signal:active});
      try{active.throwIfAborted();const outcome=await browser.submit(credentials,{signal:active});result=classify(outcome,credentials.email);reasonCode=result==='UNKNOWN'&&DIAGNOSTICS.has(outcome?.reasonCode)?outcome.reasonCode:REASONS[result];active.throwIfAborted();}
      finally{credentials=null;}
      }
    }catch{
      result=deadline.aborted?'TIMEOUT':signal?.aborted||control.signal.reason?.message==='CANCELLED'?'CANCELLED':active.aborted?'UNKNOWN':stage==='ROUTE'?'PROXY_ERROR':'UNKNOWN';
      reasonCode=result==='UNKNOWN'?(stage==='SUBMIT'?'CREDENTIAL_DELIVERY_FAILED':'BROWSER_INTERRUPTED'):REASONS[result];
    }finally{
      monitorStop=true;monitorWake.abort();await monitor;
    }
    let cleanup='OK';
    try{if(browser)await browser.close();if(!await this.verifyNoBrowser(profile.path))throw new Error('OWNED_BROWSER_ALIVE');await this.store.cleanup(profile.id);}catch{
      cleanup='FAILED';await this.store.write('quarantine.json',{jobId:job.id,leaseToken:job.leaseToken,profileId:profile.id,reason:'CLEANUP_FAILED'});
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
