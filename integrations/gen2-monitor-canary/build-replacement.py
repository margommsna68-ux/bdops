from pathlib import Path
import json,hashlib
p=Path(__file__).resolve().parent
manifest=json.loads((p/'base-sha256.json').read_text(encoding='utf-8'))
for name,expected in manifest['base'].items():
 assert hashlib.sha256((p/'base'/name).read_bytes()).hexdigest()==expected, 'BASE_SHA_MISMATCH: '+name
s=(p/'base/engine/earnapp-monitor.mjs').read_text(encoding='utf-8')
def swap(old,new):
 global s
 assert s.count(old)==1,old[:80]
 s=s.replace(old,new)
swap("import { classify,", "import { createCanaryLanes, CANARY_POLICY } from './native-monitor-canary.mjs';\nimport { classify,")
swap('  const o = { ...MONITOR_DEFAULTS, ...options };', '''  const canary = options.canaryPolicyVersion === 1;
  if (options.canaryPolicyVersion != null && !canary) throw Error('UNSUPPORTED_MONITOR_POLICY');
  const o = { ...MONITOR_DEFAULTS, ...options, ...(canary ? { targetSec: 600, recheckDelayMs: 30000, probeTimeoutMs: 45000 } : {}) };
  let stepping = false, activeStep = null;
  const due = new Map(), rechecks = new Map();
  const lanes = canary ? createCanaryLanes({ listVms, acceptName, now, setTimer, clearTimer, serverId,
    readAppliedProxy: options.readAppliedProxy, proxyCheck: options.proxyCheck, proxyCheckUrl: options.proxyCheckUrl,
    readHostNetwork: options.readHostNetwork, onSnapshot: options.onSnapshot,
    canProbe: (r) => { try { return !paused() && !hostHold()?.active && !keepOff(r.uuid) && !peekBusy(r.uuid,r.name)?.busy; } catch { return false; } }
  }) : null;''')
swap('const targetMs = () => Math.max(30, Number(targetSec()) || o.targetSec) * 1000;', 'const targetMs = () => canary ? 600000 : Math.max(30, Number(targetSec()) || o.targetSec) * 1000;')
swap('try { list = await listVms(); }', 'try { list = canary ? lanes.getRows() : await listVms(); }')
swap('running: v.running === true }', "running: v.running === true && (!canary || v.state === 'RUNNING') }")
swap('    queue = rows.filter((r) => r.running);', '''    if (canary) {
      const ids = new Set(rows.map(r=>r.uuid));
      for (const id of due.keys()) if (!ids.has(id)) due.delete(id);
      for (const id of rechecks.keys()) if (!ids.has(id)) rechecks.delete(id);
    }
    queue = rows.filter((r) => r.running && (!canary || (due.get(r.uuid) ?? 0) <= now()));''')
swap('    const durationMs = now() - started;', '    let durationMs = now() - started;')
swap('    inflight = null; abort = null;', '    durationMs = now() - started;\n    inflight = null; abort = null;')
swap('  async function step() {', '''  function step() {
    if (canary && stepping) return Promise.resolve();
    if (canary) stepping = true;
    activeStep = runStep().finally(() => { stepping = false; activeStep = null; });
    return activeStep;
  }
  async function runStep() {''')
swap('    let target = null, isRecheck = false;', '''    let target = null, isRecheck = false;
    if (canary) {
      if (!queue.length) await startCycle(now());
      if (!running) return;
      const retry = [...rechecks.values()].find(r=>r.dueAt<=now());
      if (!queue.length && retry) { target=retry; rechecks.delete(retry.uuid); isRecheck=true; }
      else if (queue.length) { target=queue.shift(); due.set(target.uuid,now()+targetMs()); rechecks.delete(target.uuid); }
      else {
        const times=[...due.values(),...rechecks.values()].map(t=>typeof t==='number'?t:t.dueAt).filter(t=>t>now());
        schedule(Math.min(60000,Math.max(o.minGapMs,times.length?Math.min(...times)-now():60000)));return;
      }
      // Inventory may change during a long probe; never probe a newly stopped/deleted VM from an old queue.
      const live=lanes.getRows().find(r=>r.uuid===target.uuid);
      if (!live || live.state!=='RUNNING') { schedule(o.minGapMs); return; }
    }
    if (!canary) {''')
swap("    const hold = (() =>", "    }\n    const hold = (() =>")
swap('    if (!running) return;\n    counters.probes++;', '    if (canary && running) lanes.core(target, result, at);\n    if (!running) return;\n    counters.probes++;')
swap('    if (c.verdict.recheck) recheck = { uuid: target.uuid, name: target.name, dueAt: now() + o.recheckDelayMs };', '''    if (canary) {
      if (!isRecheck && c.verdict.recheck && rechecks.size < CANARY_POLICY.queueMaxItems)
        rechecks.set(target.uuid,{uuid:target.uuid,name:target.name,dueAt:now()+o.recheckDelayMs});
    } else if (c.verdict.recheck) recheck = { uuid: target.uuid, name: target.name, dueAt: now() + o.recheckDelayMs };''')
swap('    if (recheck) delay =', '''    if (canary) {
      // Fair first pass, no 50% rest when late; due-at survives cycle/recheck boundaries.
      delay = Math.max(o.minGapMs,slotMs-durationMs);
      if (!queue.length && rechecks.size) delay = Math.min(delay,Math.max(o.minGapMs,Math.min(...[...rechecks.values()].map(r=>r.dueAt))-now()));
    }
    if (recheck) delay =''')
swap('    schedule(o.minGapMs);\n    return { ok: true };', '''    if (canary) lanes.start().then(() => { if (running) schedule(o.minGapMs); });
    else schedule(o.minGapMs);
    return { ok: true };''')
swap('    if (inflight) await inflight;', '    if (inflight) await inflight;\n    if (canary) { await activeStep; await lanes.stop(); }')
swap('      running, paused:', '      ...(canary ? { health: lanes.snapshot(), configVersion:1 } : {}),\n      running, paused:')
(p/'engine/earnapp-monitor.mjs').write_text(s,encoding='utf-8',newline='\n')

# Native canary transport only: timeout cannot release an unclosed process slot.
v=(p/'base/engine/vbox.mjs').read_text(encoding='utf-8')
v=v.replace('{ lowPriority = false, onCall = null } = {})','{ lowPriority = false, onCall = null, awaitCloseOnTimeout = false, spawnProcess = spawn } = {})',1)
v=v.replace("let out = '', err = '', done = false;", "let out = '', err = '', done = false, timeoutPending = false;",1)
v=v.replace('const child = spawn(vboxPath, args,', 'const child = spawnProcess(vboxPath, args,',1)
v=v.replace("if (!done) { done = true; try { child.kill(); } catch { /* already gone */ } resolve({ ...transportKind, code: null, out, err, timedOut: true }); }", "if (!done) {\n          timeoutPending = true; try { child.kill(); } catch { /* retain slot until close */ }\n          if (!awaitCloseOnTimeout) { done = true; resolve({ ...transportKind, code: null, out, err, timedOut: true }); }\n        }",1)
v=v.replace("code, out: String(out), err: String(err), timedOut: false", "code, out: String(out), err: String(err), timedOut: timeoutPending",1)
(p/'engine/vbox.mjs').write_text(v,encoding='utf-8',newline='\n')

f=(p/'base/engine/fleet-health.mjs').read_text(encoding='utf-8')
f="import { sanitizeNativeSource } from './native-monitor-wire.mjs';\n"+f
f=f.replace('  if (earnapp) out.earnapp = earnapp;', "  const nativeMonitorV1 = h.nativeMonitorV1 === undefined ? null : sanitizeNativeSource(h.nativeMonitorV1);\n  if (nativeMonitorV1) out.nativeMonitorV1 = nativeMonitorV1;\n  if (earnapp) out.earnapp = earnapp;",1)
f=f.replace('{ earnapp, hostCache } = {})', '{ earnapp, hostCache, nativeMonitorV1 } = {})',1)
f=f.replace('    ...(hostCache ? { hostCache } : {})', '    ...(nativeMonitorV1 ? { nativeMonitorV1 } : {}),\n    ...(hostCache ? { hostCache } : {})',1)
(p/'engine/fleet-health.mjs').write_text(f,encoding='utf-8',newline='\n')

m=(p/'engine/earnapp-monitor.mjs').read_text(encoding='utf-8')
m=m.replace('let stepping = false, activeStep = null;', 'let stepping = false, activeStep = null;\n  let guestQuarantined = options.initialGuestQuarantine === true;',1)
m=m.replace('readAppliedProxy: options.readAppliedProxy,', 'initialGuestQuarantine: guestQuarantined, readAppliedProxy: options.readAppliedProxy,',1)
m=m.replace('    let target = null, isRecheck = false;', '    if (canary && guestQuarantined) { schedule(60000); return; }\n    let target = null, isRecheck = false;',1)
m=m.replace('    const { result, durationMs, at } = await probe(target);', '''    if (canary && !lanes.setGuestSlot('RUNNING')) {
      guestQuarantined = true; lanes.setGuestSlot('QUARANTINED','SOURCE_PERSIST_FAILED'); schedule(60000); return;
    }
    const { result, durationMs, at } = await probe(target);''',1)
m=m.replace("      counters.timeouts++;", "      counters.timeouts++;\n      if (canary) { guestQuarantined = true; lanes.core(target,{ok:false,reason:'MONITOR_TIMEOUT'},started); lanes.setGuestSlot('QUARANTINED','GUEST_CLEANUP_UNVERIFIED'); }",1)
m=m.replace('    durationMs = now() - started;\n    inflight = null;', '''    if (canary) {
      const uncertain = result?.guestCleanupUnverified === true || timedOut || abort.signal.aborted || /TIMEOUT/.test(result?.reason || '')
        || result?.transport?.timedOut || result?.transport?.guestTimedOut || result?.transport?.outerTimedOut
        || result?.readAttempts?.some(r=>r.timed_out || r.outer_timed_out || r.guest_timed_out);
      if (uncertain) guestQuarantined = true;
      lanes.setGuestSlot(guestQuarantined?'QUARANTINED':'IDLE',guestQuarantined?'GUEST_CLEANUP_UNVERIFIED':null);
    }
    durationMs = now() - started;
    inflight = null;''',1)
m=m.replace('    if (inflight) await inflight;\n    if (canary) { await activeStep; await lanes.stop(); }', '    const lanesStopping = canary ? lanes.stop() : null;\n    if (inflight) await inflight;\n    if (canary) { await activeStep; await lanesStopping; }',1)
(p/'engine/earnapp-monitor.mjs').write_text(m,encoding='utf-8',newline='\n')

h=(p/'base/engine/guest-helper.mjs').read_text(encoding='utf-8')
h=h.replace('sleeper=ms=>new Promise(r=>setTimeout(r,ms))})', 'sleeper=ms=>new Promise(r=>setTimeout(r,ms)),maxAttempts=2})',1)
h=h.replace('for(let attempt=1;attempt<=2;attempt++)', 'const attemptLimit=maxAttempts===1?1:2;\n  for(let attempt=1;attempt<=attemptLimit;attempt++)',1)
h=h.replace('attempts:attempt,maxAttempts:2', 'attempts:attempt,maxAttempts:attemptLimit',1)
h=h.replace("attempt===2||shouldStop()", "attempt===attemptLimit||shouldStop()",1)
h=h.replace('attempts:readAttempts.length,maxAttempts:2', 'attempts:readAttempts.length,maxAttempts:attemptLimit',1)
h=h.replace('username,{signal}={})', 'username,{signal,canarySingleAttempt=false}={})',1)
h=h.replace('runFreshHelperAttempts({shouldStop:', 'runFreshHelperAttempts({maxAttempts:canarySingleAttempt?1:2,shouldStop:',1)
(p/'engine/guest-helper.mjs').write_text(h,encoding='utf-8',newline='\n')


m=(p/'engine/earnapp-monitor.mjs').read_text(encoding='utf-8')
m=m.replace('    const c = classify(v.track, obs);', '''    const grace = canary && obs.valid && lanes.isStartupGrace(target.uuid);
    const c = grace ? { track:emptyTrack(), verdict:{valid:true,faults:[],cleared:[],pending:[],recheck:false,cls:'STARTUP_GRACE',gapReason:null} }
      : classify(v.track, obs, canary ? {recheckWindowMs:1200000} : {});''',1)
m=m.replace("const uncertain = result?.guestCleanupUnverified === true ||", "const uncertain = ['PROBE_EXCEPTION','HELPER_UNAVAILABLE','SCAN_ABORTED'].includes(result?.reason) || result?.guestCleanupUnverified === true ||",1)
(p/'engine/earnapp-monitor.mjs').write_text(m,encoding='utf-8',newline='\n')

h=(p/'engine/guest-helper.mjs').read_text(encoding='utf-8')
h=h.replace('async function ensureHelper(vbox,cfg,vm,username) {', 'async function ensureHelper(vbox,cfg,vm,username,{existingOnly=false}={}) {',1)
h=h.replace('  const copy=await guestCopyHelper(vbox,cfg,vm,username,helperFile,destination);\n  if(copy.code!==0 || copy.timedOut) return {ok:false,reason:\'HELPER_COPY_FAILED\',transport:copy};', '''  if(!existingOnly) {
    const copy=await guestCopyHelper(vbox,cfg,vm,username,helperFile,destination);
    if(copy.code!==0 || copy.timedOut) return {ok:false,reason:'HELPER_COPY_FAILED',transport:copy};
  }''',1)
h=h.replace('username,{signal,canarySingleAttempt=false}={})', 'username,{signal,canarySingleAttempt=false,canaryExistingHelperOnly=false}={})',1)
h=h.replace('const installed=await ensureHelper(vbox,cfg,vm,username);','const installed=await ensureHelper(vbox,cfg,vm,username,{existingOnly:canaryExistingHelperOnly});',1)
(p/'engine/guest-helper.mjs').write_text(h,encoding='utf-8',newline='\n')
