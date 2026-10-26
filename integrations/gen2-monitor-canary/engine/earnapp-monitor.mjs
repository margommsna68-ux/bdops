// 3.1.16 EarnApp monitor (policy EARNAPP-ALERT-MAINTENANCE-20261024 §3). DETECTION ONLY.
// · Round-robin over this host's RUNNING VMs, at most ONE guest probe in flight per host (a timed-out probe is still
//   awaited before the next one starts), target `targetSec` per VM per cycle (default 120 s).
// · The probe is injected (`readCore`) and is the light native collector (GenProbe --core-only): processes, settings,
//   windows, established TCP. No window is opened/moved, nothing is clicked, no OCR, no PowerShell.
// · Skips (defers) VMs under host hold, keep-off, VM Guard busy (repair/creation/host operation) or not running; the
//   deferral is labelled on the VM's incidents and the observation age keeps growing — stale is never healthy.
// · Over budget = slow down, not hide: the rest gap grows with the probe duration, cycle duration/coverage are kept,
//   and a cycle that stays far over target opens a host MONITORING_GAP (COVERAGE_SLOW).
// · Paused while a scan / FIX / NAT refresh runs (the caller's `paused()`); paused time is not counted as slowness.
// The only side effects are the injected readCore, the incident store, onEvents and log.
// 3.1.18:
// · VM scope = engine/vm-name.mjs isMonitoredVmName(): the configured pattern OR VM_### / m_### on EVERY host
//   (a VM_ host skipped its m_969 canary). Canary VMs (m_9##) are probed like any VM and flagged `canary` in status.
// · ONE log line per cycle, `earnapp-monitor-cycle` (start/end, duration, scope, probed/ok/alerting/pending,
//   skipped by reason, timeouts, errors, VBoxManage calls per probe), the same summary in status().lastCycle and
//   rolling totals in status().totals. Counts and reason codes only: no VM output, no names, no secrets.
// · Host cache: an AE automatic stop (last-result.json autoStopped, or the legacy stop text) becomes ONE
//   HOST_CACHE_AUTO_STOPPED event per AE operationId (incidents.oneShot), separate from HOST_CACHE_CHECK.
import { createCanaryLanes, CANARY_POLICY } from './native-monitor-canary.mjs';
import { classify, observationFromProbe, emptyTrack, FAULT } from './earnapp-monitor-classify.mjs';
import { MAINTENANCE } from './earnapp-incidents.mjs';
import { hostCacheVerdict, hostCacheAutoStop, autoStopReasonCode } from './host-cache-result.mjs';
import { isMonitoredVmName, isCanaryVmName } from './vm-name.mjs';

export const MONITOR_DEFAULTS = Object.freeze({
  targetSec: 120, probeTimeoutMs: 45_000, recheckDelayMs: 15_000, pauseRetryMs: 5_000, minGapMs: 1_000,
  restRatio: 0.5, coverageSlowFactor: 3, coverageSlowCycles: 2, durationsKept: 50
});
export const clampTargetSec = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(3600, Math.max(30, Math.round(n))) : 120; };
/** Gap reasons counted as timeouts in the cycle line; every other unreadable sample is an error. */
export const TIMEOUT_GAP_REASONS = Object.freeze(['MONITOR_TIMEOUT', 'GUEST_EXEC_TIMEOUT', 'GUEST_SLOT_TIMEOUT']);
const TIMEOUTS = new Set(TIMEOUT_GAP_REASONS);
const iso = (ms) => new Date(ms).toISOString();
const bump = (obj, key, n = 1) => { obj[key] = (obj[key] || 0) + n; };
const vboxCallsOf = (r) => (r && Number.isInteger(r.vboxCalls) && r.vboxCalls >= 0 && r.vboxCalls < 1000 ? r.vboxCalls : null);

export function createEarnAppMonitor({
  serverId, listVms, readCore, incidents, onEvents = () => {},
  peekBusy = () => ({ busy: false }), keepOff = () => null, hostHold = () => ({ active: false }), paused = () => false,
  readHostCache = null, targetSec = () => MONITOR_DEFAULTS.targetSec, acceptName = isMonitoredVmName,
  now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h),
  log = () => {}, ...options
} = {}) {
  const canary = options.canaryPolicyVersion === 1;
  if (options.canaryPolicyVersion != null && !canary) throw Error('UNSUPPORTED_MONITOR_POLICY');
  const o = { ...MONITOR_DEFAULTS, ...options, ...(canary ? { targetSec: 600, recheckDelayMs: 30000, probeTimeoutMs: 45000 } : {}) };
  let stepping = false, activeStep = null;
  let guestQuarantined = options.initialGuestQuarantine === true;
  const due = new Map(), rechecks = new Map();
  const lanes = canary ? createCanaryLanes({ listVms, acceptName, now, setTimer, clearTimer, serverId,
    initialGuestQuarantine: guestQuarantined, readAppliedProxy: options.readAppliedProxy, proxyCheck: options.proxyCheck, proxyCheckUrl: options.proxyCheckUrl,
    readHostNetwork: options.readHostNetwork, onSnapshot: options.onSnapshot,
    canProbe: (r) => { try { return !paused() && !hostHold()?.active && !keepOff(r.uuid) && !peekBusy(r.uuid,r.name)?.busy; } catch { return false; } }
  }) : null;
  const vms = new Map();             // uuid -> { name, canary, track, lastObservedAt, lastValidAt, cls, deferred, gapReason }
  let queue = [];
  let cycle = null;
  let lastCycle = null;
  let lastHostCache = null;
  let slowCycles = 0;
  let recheck = null;                // { uuid, name, dueAt }
  let running = false, timer = null, inflight = null, abort = null, pausedSince = null;
  const durations = [];
  const counters = { probes: 0, timeouts: 0, gaps: 0, deferred: {}, cycles: 0 };
  // 3.1.18 rolling totals since start (the cycle line carries the per-cycle numbers).
  const totals = { since: null, cycles: 0, probes: 0, rechecks: 0, ok: 0, pending: 0, alerting: 0, unreadable: 0,
    timeouts: 0, errors: 0, skipped: {}, vboxCalls: 0, vboxProbes: 0, cacheStopEvents: 0 };

  const targetMs = () => canary ? 600000 : Math.max(30, Number(targetSec()) || o.targetSec) * 1000;
  const emit = (events) => { if (events && events.length) { try { onEvents(events); } catch (e) { log('earnapp-monitor-onevents-failed', { error: String(e && e.message || e) }); } } };
  const vmState = (uuid, name) => {
    if (!vms.has(uuid)) vms.set(uuid, { name, canary: isCanaryVmName(name), track: emptyTrack(), lastObservedAt: null, lastValidAt: null, cls: null, deferred: null, gapReason: null });
    const v = vms.get(uuid); if (name) { v.name = name; v.canary = isCanaryVmName(name); } return v;
  };

  function schedule(ms) {
    if (!running) return;
    if (timer) clearTimer(timer);
    timer = setTimer(() => { timer = null; return step(); }, Math.max(0, Math.round(ms)));
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function newCycle(at, rows, extra = {}) {
    return { startedAt: at, targets: 0, probed: 0, deferred: 0, pausedMs: 0, inScope: rows.length,
      canaryInScope: rows.filter((r) => isCanaryVmName(r.name)).length,
      probes: 0, rechecks: 0, timeouts: 0, errors: 0, gapReasons: {}, skipped: {}, outcome: new Map(),
      vboxCalls: 0, vboxProbes: 0, probeMsTotal: 0, probeMsMax: 0, lastProbeEndAt: null, ...extra };
  }

  function finishCycle(at, { partial = false } = {}) {
    if (!cycle) return;
    const c = cycle;
    const activeMs = Math.max(0, at - c.startedAt - c.pausedMs);
    const outcomes = { ok: 0, pending: 0, alerting: 0, unreadable: 0 };
    let canaryProbed = 0, canaryAlerting = 0;
    for (const [uuid, out] of c.outcome) {
      bump(outcomes, out);
      if (vms.get(uuid)?.canary) { canaryProbed++; if (out === 'alerting') canaryAlerting++; }
    }
    const summary = {
      startedAt: iso(c.startedAt), endedAt: iso(at), lastProbeEndAt: c.lastProbeEndAt === null ? null : iso(c.lastProbeEndAt),
      durationMs: activeMs, wallMs: Math.max(0, at - c.startedAt), pausedMs: c.pausedMs, targetSec: targetMs() / 1000,
      inScope: c.inScope, targets: c.targets, probed: c.probed, probes: c.probes, rechecks: c.rechecks, deferred: c.deferred,
      ok: outcomes.ok, pending: outcomes.pending, alerting: outcomes.alerting, unreadable: outcomes.unreadable,
      timeouts: c.timeouts, errors: c.errors, gapReasons: { ...c.gapReasons }, skipped: { ...c.skipped },
      coverage: c.targets ? +(c.probed / c.targets).toFixed(3) : 1, overBudget: activeMs > targetMs(),
      avgProbeMs: c.probes ? Math.round(c.probeMsTotal / c.probes) : null, maxProbeMs: c.probes ? c.probeMsMax : null,
      vboxCalls: c.vboxProbes ? c.vboxCalls : null, vboxCallsPerProbe: c.vboxProbes ? +(c.vboxCalls / c.vboxProbes).toFixed(2) : null,
      canaryInScope: c.canaryInScope, canaryProbed, canaryAlerting,
      listFailed: c.listFailed === true, partial
    };
    lastCycle = summary;
    counters.cycles++;
    totals.cycles++;
    for (const k of ['ok', 'pending', 'alerting', 'unreadable']) totals[k] += outcomes[k];
    // Coverage judged only on cycles that had work; a far-over-target cycle twice in a row = monitoring gap for the host.
    if (c.targets > 0) {
      slowCycles = activeMs > o.coverageSlowFactor * targetMs() ? slowCycles + 1 : 0;
      const verdict = slowCycles >= o.coverageSlowCycles
        ? { faults: [FAULT.MONITORING_GAP], cleared: [], gapReason: 'COVERAGE_SLOW' }
        : slowCycles === 0 ? { faults: [], cleared: [FAULT.MONITORING_GAP] } : { faults: [], cleared: [] };
      emit(incidents.observe({ serverId, uuid: 'host', vmName: 'HOST', verdict, stableOk: 1 }));
    }
    try { log('earnapp-monitor-cycle', { cycle: counters.cycles, ...summary, slowCycles }); } catch { /* logging never stops the monitor */ }
    cycle = null;
  }

  function readCache() {
    if (!readHostCache) return;
    let read = null;
    try { read = readHostCache(); }
    catch (e) { log('earnapp-monitor-host-cache-failed', { error: String(e && e.message || e).slice(0, 200) }); return; }
    try { emit(incidents.observe({ serverId, uuid: 'host', vmName: 'HOST', verdict: hostCacheVerdict(read), stableOk: 1 })); }
    catch (e) { log('earnapp-monitor-host-cache-failed', { error: String(e && e.message || e).slice(0, 200) }); }
    const stop = hostCacheAutoStop(read);
    lastHostCache = { state: read ? read.state : null, decision: read?.value?.decision || null, operationId: read?.value?.operationId || null,
      autoStopped: !!stop, autoStoppedReason: stop ? stop.reason : null, autoStoppedSource: stop ? stop.source : null, readAt: iso(now()) };
    if (stop && typeof incidents.oneShot === 'function') {
      try {
        const ev = incidents.oneShot({ serverId, uuid: 'host', vmName: 'HOST', faultClass: FAULT.HOST_CACHE_AUTO_STOPPED,
          eventId: stop.operationId, since: stop.evaluatedAt, reason: autoStopReasonCode(stop.reason) });
        if (ev.length) { totals.cacheStopEvents += ev.length; emit(ev); }
      } catch (e) { log('earnapp-monitor-host-cache-failed', { error: String(e && e.message || e).slice(0, 200) }); }
    }
  }

  async function startCycle(at) {
    finishCycle(at);
    let list = [], listFailed = false;
    try { list = canary ? lanes.getRows() : await listVms(); } catch (e) { listFailed = true; log('earnapp-monitor-list-failed', { error: String(e && e.message || e).slice(0, 200) }); }
    const nameOk = (n) => { try { return acceptName(n) === true; } catch { return false; } };
    const rows = (Array.isArray(list) ? list : []).filter((v) => v && v.uuid && nameOk(String(v.name || '')))
      .map((v) => ({ name: String(v.name || ''), uuid: String(v.uuid).toLowerCase(), running: v.running === true && (!canary || v.state === 'RUNNING') }));
    if (rows.length) {
      incidents.forgetMissing(serverId, rows.map((r) => r.uuid));
      for (const uuid of [...vms.keys()]) if (!rows.some((r) => r.uuid === uuid)) vms.delete(uuid);
    }
    const next = newCycle(now(), rows, { listFailed });
    for (const r of rows.filter((x) => !x.running)) {
      const v = vmState(r.uuid, r.name);
      const label = keepOff(r.uuid) ? MAINTENANCE.INTENTIONAL_OFF : MAINTENANCE.NOT_RUNNING;
      v.deferred = label;
      bump(next.skipped, label); bump(totals.skipped, label);
      incidents.markMaintenance({ serverId, uuid: r.uuid, label });
    }
    readCache();
    if (canary) {
      const ids = new Set(rows.map(r=>r.uuid));
      for (const id of due.keys()) if (!ids.has(id)) due.delete(id);
      for (const id of rechecks.keys()) if (!ids.has(id)) rechecks.delete(id);
    }
    queue = rows.filter((r) => r.running && (!canary || (due.get(r.uuid) ?? 0) <= now()));
    next.targets = queue.length;
    next.startedAt = now();
    cycle = next;
    if (totals.since === null) totals.since = iso(cycle.startedAt);
  }

  function defer(target, label) {
    const v = vmState(target.uuid, target.name);
    v.deferred = label;
    counters.deferred[label] = (counters.deferred[label] || 0) + 1;
    bump(totals.skipped, label);
    if (cycle) { cycle.deferred++; bump(cycle.skipped, label); }
    incidents.markMaintenance({ serverId, uuid: target.uuid, label });
  }

  /** One probe with a hard verdict deadline. The underlying call is always awaited (one probe at a time). */
  async function probe(target) {
    const started = now();
    abort = new AbortController();
    let timeoutHandle = null, timedOut = false;
    const call = Promise.resolve().then(() => readCore(target, { signal: abort.signal }))
      .catch((e) => ({ ok: false, reason: 'PROBE_EXCEPTION', error: String(e && e.message || e) }));
    const deadline = new Promise((resolve) => { timeoutHandle = setTimer(() => { timedOut = true; resolve(null); }, o.probeTimeoutMs); });
    inflight = call;
    let result = await Promise.race([call, deadline]);
    if (timeoutHandle) clearTimer(timeoutHandle);
    let durationMs = now() - started;
    if (timedOut || result === null) {
      counters.timeouts++;
      if (canary) { guestQuarantined = true; lanes.core(target,{ok:false,reason:'MONITOR_TIMEOUT'},started); lanes.setGuestSlot('QUARANTINED','GUEST_CLEANUP_UNVERIFIED'); }
      try { abort.abort(); } catch { /* already done */ }
      const late = await call;        // never start a second probe while this one is still running
      result = { ok: false, reason: 'MONITOR_TIMEOUT', vboxCalls: vboxCallsOf(late) };
    }
    if (canary) {
      const uncertain = ['PROBE_EXCEPTION','HELPER_UNAVAILABLE','SCAN_ABORTED'].includes(result?.reason) || result?.guestCleanupUnverified === true || timedOut || abort.signal.aborted || /TIMEOUT/.test(result?.reason || '')
        || result?.transport?.timedOut || result?.transport?.guestTimedOut || result?.transport?.outerTimedOut
        || result?.readAttempts?.some(r=>r.timed_out || r.outer_timed_out || r.guest_timed_out);
      if (uncertain) guestQuarantined = true;
      lanes.setGuestSlot(guestQuarantined?'QUARANTINED':'IDLE',guestQuarantined?'GUEST_CLEANUP_UNVERIFIED':null);
    }
    durationMs = now() - started;
    inflight = null; abort = null;
    return { result, durationMs, at: started };
  }

  function account(target, isRecheck, result, durationMs, obs, verdict) {
    totals.probes++;
    if (isRecheck) totals.rechecks++;
    const calls = vboxCallsOf(result);
    if (calls !== null) { totals.vboxCalls += calls; totals.vboxProbes++; }
    // Per-VM outcome of the cycle (a recheck replaces the earlier one): alerting = a CONFIRMED fault (a confirmed
    // MONITORING_GAP included); unreadable = an unreadable sample not yet confirmed as a gap; pending = candidate only.
    // Timeouts and errors are counted per probe, rechecks included.
    let out = 'ok';
    if (verdict.faults.length) out = 'alerting';
    else if (!obs.valid) out = 'unreadable';
    else if (verdict.pending.length) out = 'pending';
    if (!obs.valid) { if (TIMEOUTS.has(obs.gapReason)) totals.timeouts++; else totals.errors++; }
    if (!cycle) return;
    cycle.probes++;
    if (isRecheck) cycle.rechecks++;
    cycle.probeMsTotal += durationMs; cycle.probeMsMax = Math.max(cycle.probeMsMax, durationMs);
    cycle.lastProbeEndAt = now();
    if (calls !== null) { cycle.vboxCalls += calls; cycle.vboxProbes++; }
    if (!obs.valid) {
      bump(cycle.gapReasons, obs.gapReason || 'PARSER_ERROR');
      if (TIMEOUTS.has(obs.gapReason)) cycle.timeouts++; else cycle.errors++;
    }
    cycle.outcome.set(target.uuid, out);
  }

  function step() {
    if (canary && stepping) return Promise.resolve();
    if (canary) stepping = true;
    activeStep = runStep().finally(() => { stepping = false; activeStep = null; });
    return activeStep;
  }
  async function runStep() {
    if (!running) return;
    if (paused()) {
      if (pausedSince === null) pausedSince = now();
      schedule(o.pauseRetryMs);
      return;
    }
    if (pausedSince !== null) { if (cycle) cycle.pausedMs += now() - pausedSince; pausedSince = null; }
    if (canary && guestQuarantined) { schedule(60000); return; }
    let target = null, isRecheck = false;
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
    if (!canary) {
    if (recheck && recheck.dueAt <= now()) { target = recheck; recheck = null; isRecheck = true; }
    else {
      if (!queue.length) await startCycle(now());
      if (!running) return;
      if (!queue.length) {
        schedule(recheck ? Math.max(o.minGapMs, recheck.dueAt - now()) : targetMs());
        return;
      }
      target = queue.shift();
    }
    }
    const hold = (() => { try { return hostHold() || { active: false }; } catch { return { active: true }; } })();
    let busy = { busy: false };
    try { busy = peekBusy(target.uuid, target.name) || { busy: false }; } catch { busy = { busy: true, reason: 'GUARD_UNREADABLE' }; }
    if (hold.active) { defer(target, MAINTENANCE.HOST_HOLD); schedule(o.minGapMs); return; }
    if (keepOff(target.uuid)) { defer(target, MAINTENANCE.INTENTIONAL_OFF); schedule(o.minGapMs); return; }
    if (busy.busy) { defer(target, MAINTENANCE.GUARD_BUSY); schedule(o.minGapMs); return; }

    if (canary && !lanes.setGuestSlot('RUNNING')) {
      guestQuarantined = true; lanes.setGuestSlot('QUARANTINED','SOURCE_PERSIST_FAILED'); schedule(60000); return;
    }
    const { result, durationMs, at } = await probe(target);
    if (canary && running) lanes.core(target, result, at);
    if (!running) return;
    counters.probes++;
    durations.push(durationMs); if (durations.length > o.durationsKept) durations.shift();
    const v = vmState(target.uuid, target.name);
    const obs = observationFromProbe(result, { at: now(), durationMs });
    const grace = canary && obs.valid && lanes.isStartupGrace(target.uuid);
    const c = grace ? { track:emptyTrack(), verdict:{valid:true,faults:[],cleared:[],pending:[],recheck:false,cls:'STARTUP_GRACE',gapReason:null} }
      : classify(v.track, obs, canary ? {recheckWindowMs:1200000} : {});
    v.track = c.track; v.lastObservedAt = at; v.cls = c.verdict.cls; v.gapReason = c.verdict.gapReason;
    if (obs.valid) v.lastValidAt = at; else counters.gaps++;
    if (v.deferred) { incidents.clearMaintenance({ serverId, uuid: target.uuid }); v.deferred = null; }
    if (cycle && !isRecheck) cycle.probed++;
    account(target, isRecheck, result, durationMs, obs, c.verdict);
    emit(incidents.observe({ serverId, uuid: target.uuid, vmName: target.name, verdict: c.verdict }));
    if (canary) {
      if (!isRecheck && c.verdict.recheck && rechecks.size < CANARY_POLICY.queueMaxItems)
        rechecks.set(target.uuid,{uuid:target.uuid,name:target.name,dueAt:now()+o.recheckDelayMs});
    } else if (c.verdict.recheck) recheck = { uuid: target.uuid, name: target.name, dueAt: now() + o.recheckDelayMs };

    // Later rounds may contain only the first individually due VM. Budget
    // against the whole running host, otherwise that single-target subset
    // sleeps for 600 seconds and starves the other staggered due VMs.
    const pacingTargets=canary?lanes.getRows().filter(r=>r.state==='RUNNING').length:(cycle?cycle.targets:1);
    const slotMs = targetMs() / Math.max(1,pacingTargets);
    const over = durationMs > slotMs;
    let delay = over ? Math.max(o.minGapMs, durationMs * o.restRatio) : Math.max(o.minGapMs, slotMs - durationMs);
    if (canary) {
      // Fair first pass, no 50% rest when late; due-at survives cycle/recheck boundaries.
      delay = Math.max(o.minGapMs,slotMs-durationMs);
      if (!queue.length && rechecks.size) delay = Math.min(delay,Math.max(o.minGapMs,Math.min(...[...rechecks.values()].map(r=>r.dueAt))-now()));
    }
    if (recheck) delay = Math.min(delay, Math.max(o.minGapMs, recheck.dueAt - now()));
    schedule(delay);
  }

  function start() {
    if (running) return { ok: true, already: true };
    running = true;
    if (canary) lanes.start().then(() => { if (running) schedule(o.minGapMs); });
    else schedule(o.minGapMs);
    return { ok: true };
  }
  async function stop() {
    running = false;
    if (timer) { clearTimer(timer); timer = null; }
    if (abort) { try { abort.abort(); } catch { /* done */ } }
    const lanesStopping = canary ? lanes.stop() : null;
    if (inflight) await inflight;
    if (canary) { await activeStep; await lanesStopping; }
    finishCycle(now(), { partial: queue.length > 0 });
  }

  function status() {
    const at = now();
    const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    return {
      ...(canary ? { health: lanes.snapshot(), configVersion:1 } : {}),
      running, paused: pausedSince !== null, targetSec: targetMs() / 1000, probeInFlight: !!inflight,
      avgProbeMs: avg, maxProbeMs: durations.length ? Math.max(...durations) : null,
      cycle: cycle ? { startedAt: iso(cycle.startedAt), targets: cycle.targets, probed: cycle.probed, deferred: cycle.deferred, remaining: queue.length,
        inScope: cycle.inScope, probes: cycle.probes, timeouts: cycle.timeouts, errors: cycle.errors } : null,
      lastCycle, slowCycles, counters: JSON.parse(JSON.stringify(counters)),
      totals: { ...JSON.parse(JSON.stringify(totals)), vboxCallsPerProbe: totals.vboxProbes ? +(totals.vboxCalls / totals.vboxProbes).toFixed(2) : null },
      hostCache: lastHostCache ? { ...lastHostCache } : null,
      vms: [...vms.entries()].map(([uuid, v]) => ({ uuid, name: v.name, canary: v.canary === true, cls: v.cls, deferred: v.deferred, gapReason: v.gapReason,
        observationAgeMs: v.lastValidAt === null ? null : at - v.lastValidAt }))
    };
  }

  return { start, stop, status, step };
}
