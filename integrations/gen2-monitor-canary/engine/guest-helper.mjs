// Small content-addressed collector shared by HEALTH and MONEY.
// Installation writes only this immutable helper file in Windows\Temp.
// All observations afterwards are read-only; never start/stop/move EarnApp.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { guestRunCmd, guestRunHelper, guestCopyHelper, classifyGuestError } from './guest.mjs';
import { identityFromDeepGuest, classifyEarnAppVariant, EARNAPP_VARIANT } from './earnapp-variant.mjs';
import { readStableEarnAppFrame } from './earnapp-frame.mjs';
import { readGuestUia, guestUiaFirstEnabled, guestUiaVerdict, guestUiaFrame, guestUiaTrace } from './guest-uia-reader.mjs';

const helperFile=path.join(path.dirname(fileURLToPath(import.meta.url)),'helper','GenProbe.exe');
const prepared=new WeakMap();
const int=(n)=>Number.isInteger(n)&&n>0;
const digest=(b)=>crypto.createHash('sha256').update(b).digest('hex');
export const HELPER_BUILD='1.6.52-native2';

export function helperSteps(out,requestId) {
  return [...String(out||'').matchAll(/<<<GTPHELPERSTEP>>>(.*?)<<<GTPHELPERSTEPEND>>>/g)].slice(0,8).flatMap(m=>{
    let s;try{s=JSON.parse(m[1]);}catch{return [];}
    return s.build===HELPER_BUILD&&s.request_id===requestId&&['BEGIN','SETTINGS_DONE','PROCESSES_DONE','WINDOWS_DONE','TCP_DONE'].includes(s.stage)
      &&Number.isInteger(s.elapsed_ms)&&s.elapsed_ms>=0?[{stage:s.stage,elapsed_ms:s.elapsed_ms}]:[];
  });
}

export function parseHelperCore(out, requestId) {
  const matches=[...String(out||'').matchAll(/<<<GTPHELPERCORE>>>\s*([\s\S]*?)\s*<<<GTPHELPERCOREEND>>>/g)];
  if(matches.length!==1) return null;
  let g; try { g=JSON.parse(matches[0][1]); } catch { return null; }
  if(!g || g.schema!==1 || g.build!==HELPER_BUILD || g.request_id!==requestId
    || !g.settings || !Array.isArray(g.settings.version_values) || !Array.isArray(g.settings.pause_values)
    || g.settings.version_count!==g.settings.version_values.length || g.settings.pause_key_count!==g.settings.pause_values.length
    || !Number.isInteger(g.earnapp_process_count) || g.earnapp_process_count<0
    || !Array.isArray(g.earnapp_process_ids) || g.earnapp_process_ids.length!==g.earnapp_process_count
    || !g.earnapp_process_ids.every(int) || new Set(g.earnapp_process_ids).size!==g.earnapp_process_count
    || !g.earnapp || !g.updater || !g.network || !Array.isArray(g.windows)
    || !g.earnapp_conn || !g.updater_conn) return null;
  if(g.earnapp_process_count===1 && (g.earnapp.running!==true || g.earnapp.pid!==g.earnapp_process_ids[0])) return null;
  // Multiple processes mean ambiguous identity, never "EarnApp is stopped".
  // The native collector deliberately does not select one of them.
  if(g.earnapp_process_count>1) g.earnapp={running:true,ambiguous:true};
  for(const c of [g.earnapp_conn,g.updater_conn]) {
    if(!Number.isInteger(c.established)||c.established<0||!Array.isArray(c.list)) return null;
  }
  return g;
}

export function helperWindowProof(guest) {
  const app=guest&&guest.earnapp;
  if(!guest || guest.earnapp_process_count!==1 || !app || app.running!==true || !int(app.pid)
    || !/^\d{10,}$/.test(String(app.start_token||''))
    || !/^C:\\Program Files \(x86\)\\EarnApp\\earnapp\.exe$/i.test(String(app.path||''))
    || !Number.isInteger(app.session) || app.session<0 || app.session>=0xffffffff
    || guest.collector_session!==app.session) return null;
  const visible=guest.windows.filter(w=>w.visible===true && w.rect && w.rect.w>100 && w.rect.h>50);
  /* 2.2.3 — EarnApp's own "New EarnApp version is available for upgrade" prompt is a
   * SECOND visible window of the same process (title "EarnApp", header_owned=false;
   * the shape postbootPromptPins() already recognises). Refusing every 2-window case
   * left the stable header badge unread for hours (UNKNOWN / UI_STATUS_UNSTABLE on
   * VMs that were "Earning income"). Tolerate exactly that one prompt; the proof still
   * binds ONLY the dashboard window, so the prompt appearing/disappearing between the
   * two OCR samples does not change identity. Anything else stays ambiguous. */
  const prompts=visible.filter(w=>w.pid===app.pid && w.header_owned===false && w.minimized===false
    && /^earnapp$/i.test(String(w.title||'').trim()));
  const dashboards=visible.filter(w=>!prompts.includes(w));
  if(dashboards.length!==1 || prompts.length>1) return null;
  const w=dashboards[0], r=w.rect;
  if(w.pid!==app.pid || !/^earnapp$/i.test(String(w.title||'').trim()) || w.minimized!==false
    || w.header_owned!==true || !/^\d+$/.test(String(w.hwnd)) || Number(w.hwnd)<=0
    || ![r.x,r.y,r.w,r.h].every(Number.isFinite) || r.w<500 || r.h<150) return null;
  return { source:'GUEST_HELPER_WIN32', pid:app.pid, start_token:app.start_token,
    session:app.session, hwnd:String(w.hwnd), title:w.title, rect:r, header_owned:true };
}

export function helperWindowFailure(g) {
  const pid=g?.earnapp?.pid;
  // Later hides its old prompt HWND without destroying it. Only a visible
  // candidate participates; two visible windows still remain ambiguous.
  const windows=(g?.windows||[]).filter(w=>w.pid===pid && w.visible!==false && /^earnapp$/i.test(w.title||''));
  return g?.earnapp_process_count===1 && windows.length===1 && windows[0].minimized===true
    ? 'HELPER_WINDOW_MINIMIZED' : 'HELPER_WINDOW_NOT_PROVEN';
}

export function sameHelperIdentity(a,b) {
  if(!a || !b) return false;
  const wa=helperWindowProof(a), wb=helperWindowProof(b);
  return !!(wa && wb && JSON.stringify(wa)===JSON.stringify(wb)
    && a.settings.version_count===1 && b.settings.version_count===1
    && a.settings.version===b.settings.version
    && JSON.stringify(a.settings.pause_values)===JSON.stringify(b.settings.pause_values));
}

async function ensureHelper(vbox,cfg,vm,username,{existingOnly=false}={}) {
  const bytes=fs.readFileSync(helperFile), hash=digest(bytes);
  const destination='C:\\Windows\\Temp\\GenProbe-'+hash.slice(0,16)+'.exe';
  let entries=prepared.get(vbox); if(!entries) { entries=new Map();prepared.set(vbox,entries); }
  const key=String(vm).toLowerCase()+'\0'+username+'\0'+hash;
  if(entries.has(key)) return {ok:true,destination,hash,key,cached:true};
  if(!existingOnly) {
    const copy=await guestCopyHelper(vbox,cfg,vm,username,helperFile,destination);
    if(copy.code!==0 || copy.timedOut) return {ok:false,reason:'HELPER_COPY_FAILED',transport:copy};
  }
  const verified=await guestRunCmd(vbox,cfg,vm,username,['/d','/c','certutil -hashfile '+destination+' SHA256'],15000);
  const hashes=String(verified.out||'').split(/\r?\n/).map(s=>s.replace(/\s/g,'').toLowerCase()).filter(s=>/^[a-f0-9]{64}$/.test(s));
  if(verified.code!==0 || verified.timedOut || hashes.length!==1 || hashes[0]!==hash) return {ok:false,reason:'HELPER_HASH_UNVERIFIED',transport:verified};
  entries.set(key,true); return {ok:true,destination,hash,key,cached:false};
}

// Guestcontrol can time out even for the unmanaged helper under host pressure.
// Retry that transport failure ONCE, with a new nonce and no stale observations.
// Keep the artifact already hash-verified; do not recopy/restart anything.
export async function runFreshHelperAttempts({run,shouldStop=()=>false,sleeper=ms=>new Promise(r=>setTimeout(r,ms)),maxAttempts=2}) {
  const readAttempts=[];let transport=null,reason='SCAN_ABORTED';
  const attemptLimit=maxAttempts===1?1:2;
  for(let attempt=1;attempt<=attemptLimit;attempt++) {
    if(shouldStop()) {reason='SCAN_ABORTED';break;}
    const requestId=crypto.randomBytes(16).toString('hex'),start=Date.now();
    transport=await run(requestId);
    const guest=transport.code===0&&!transport.timedOut?parseHelperCore(transport.out,requestId):null;
    reason=guest?null:classifyGuestError(transport).code;
    readAttempts.push({attempt,ok:!!guest,reason,elapsed_ms:Date.now()-start,exit_code:transport.code,
      timed_out:reason==='GUEST_EXEC_TIMEOUT',outer_timed_out:transport.outerTimedOut===true,guest_timed_out:transport.guestTimedOut===true,
      steps:helperSteps(transport.out,requestId),collector_ms:guest?.collector_ms??null});
    if(guest) return {ok:true,guest,transport:{...transport,attempts:attempt,maxAttempts:attemptLimit},readAttempts,
      recoveredTimeouts:readAttempts.filter(a=>a.timed_out).length,reason:null};
    if(reason!=='GUEST_EXEC_TIMEOUT'||attempt===attemptLimit||shouldStop())break;
    await sleeper(1200);
  }
  return {ok:false,guest:null,transport:transport?{...transport,attempts:readAttempts.length,maxAttempts:attemptLimit}:null,
    readAttempts,recoveredTimeouts:0,reason:shouldStop()?'SCAN_ABORTED':reason};
}

export async function readGuestHelperCore(vbox,cfg,vm,username,{signal,canarySingleAttempt=false,canaryExistingHelperOnly=false}={}) {
  const start=Date.now();
  try {
    const installed=await ensureHelper(vbox,cfg,vm,username,{existingOnly:canaryExistingHelperOnly});
    if(!installed.ok) return {...installed,elapsedMs:Date.now()-start};
    const configured=Number(cfg.GuestHelperTimeoutSec);
    const budget=Math.max(5000,Math.min(30000,(Number.isFinite(configured)&&configured>0?configured:15)*1000));
    const observed=await runFreshHelperAttempts({maxAttempts:canarySingleAttempt?1:2,shouldStop:()=>!!signal?.aborted,
      run:requestId=>guestRunHelper(vbox,cfg,vm,username,installed.destination,['--core-only','--request='+requestId],budget)});
    if(!observed.ok) prepared.get(vbox)?.delete(installed.key); // invalidate this VM only, not the whole fleet
    return {...observed,elapsedMs:Date.now()-start,helperHash:installed.hash,source:'GUEST_HELPER'};
  } catch(error) { return {ok:false,reason:'HELPER_UNAVAILABLE',error:String(error.message||error),elapsedMs:Date.now()-start}; }
}

/* 3.1.15 — guest UIA FIRST, helper+OCR as fallback. Runs only where OCR would run (NEW
 * identity + helper-proven, visible, header-owned window), so it never claims anything for a
 * minimized/absent/ambiguous window. A conclusive read is bracketed by two identical helper
 * identities (PID, start token, session, HWND, rect, version, pause values) — the same window
 * re-validation the OCR path performs between its screenshots. Returns the frame to use, or
 * null to fall through; the attempt is always recorded in `trace`. */
async function guestUiaFirst({vbox,cfg,vm,username,signal,purpose,initial,binding,result,readCore,uiaReader}) {
  let read;
  try { read=await uiaReader({vbox,cfg,vm,username,signal}); }
  catch(error) { read={ok:false,reason:'UIA_EXCEPTION',outcome:'UIA_EXCEPTION',error:String(error&&error.message||error)}; }
  const verdict=guestUiaVerdict(read,{pid:binding.pid,purpose});
  const trace=guestUiaTrace(read,{purpose,why:verdict.why});
  if(!verdict.use || (signal && signal.aborted)) return {frame:null,trace:{...trace,why:verdict.why||'SCAN_ABORTED'}};
  const next=await readCore(vbox,cfg,vm,username,{signal}); result.samples++;
  result.sample_timings_ms.push(next.elapsedMs);
  result.readAttempts.push(...(next.readAttempts||[]).map(a=>({...a,sample:result.samples})));
  result.recoveredTimeouts=(result.recoveredTimeouts||0)+(next.recoveredTimeouts||0);
  if(!next.ok || !sameHelperIdentity(initial.guest,next.guest)) return {frame:null,trace:{...trace,why:'UIA_IDENTITY_CHANGED'}};
  return {frame:guestUiaFrame(read,binding,{identitySamples:2}),guest:next.guest,trace:{...trace,used:true,why:null,use:verdict.use}};
}

export async function collectHelperEvidence({vbox,cfg,vm,username,tmpDir,capture,recognize,signal,purpose='HEALTH',
  readCore=readGuestHelperCore,uiaReader=readGuestUia}) {
  const started=Date.now();
  if(signal && signal.aborted) return {ok:false,reason:'SCAN_ABORTED',elapsedMs:0};
  const initial=await readCore(vbox,cfg,vm,username,{signal});
  if(!initial.ok) return initial;
  const identity=classifyEarnAppVariant(identityFromDeepGuest(initial.guest));
  const binding=helperWindowProof(initial.guest);
  const result={...initial,identity,frame:null,samples:1,sample_timings_ms:[initial.elapsedMs],
    readAttempts:initial.readAttempts.map(a=>({...a,sample:1}))};
  if(identity.variant!==EARNAPP_VARIANT.NEW || !binding) {
    result.frame={ok:false,why:binding?'HELPER_IDENTITY_NOT_COMPATIBLE':helperWindowFailure(initial.guest)};
    return result;
  }
  let latest=initial.guest;
  if(guestUiaFirstEnabled(cfg) && typeof uiaReader==='function') {
    const tier=await guestUiaFirst({vbox,cfg,vm,username,signal,purpose,initial,binding,result,readCore,uiaReader});
    result.guest_uia=tier.trace;
    if(tier.frame) {
      result.frame=tier.frame; result.guest=tier.guest;
      result.elapsedMs=Date.now()-started;
      return result;
    }
  }
  result.frame=await readStableEarnAppFrame({vbox,vm,tmpDir,waitMs:1000,capture,recognize,
    shouldStop:()=>!!(signal && signal.aborted),
    windowProof:binding,
    validateWindow:async()=>{
      if(signal && signal.aborted) return false;
      const next=await readCore(vbox,cfg,vm,username,{signal}); result.samples++;
      result.sample_timings_ms.push(next.elapsedMs);
      result.readAttempts.push(...(next.readAttempts||[]).map(a=>({...a,sample:result.samples})));
      result.recoveredTimeouts+=next.recoveredTimeouts||0;
      if(!next.ok || !sameHelperIdentity(initial.guest,next.guest)) return false;
      latest=next.guest; return true;
    }});
  result.guest=latest;
  result.elapsedMs=Date.now()-started;
  return result;
}
