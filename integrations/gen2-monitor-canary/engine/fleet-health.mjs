import { sanitizeNativeSource } from './native-monitor-wire.mjs';
// 2.2.3 — fleet health flags carried on the (VirtualBox-free) heartbeat.
// Field incident (moon-04, 2026-10): autoScanAutoFix + controlledVmHangRecovery were OFF for
// weeks and VM_013 sat powered off for 2 days; Central showed only "Online". These flags let
// Central warn. Pure + defensive: an older Agent sends no `health` -> null -> NO warning
// (unknown is never reported as a fault).

// 3.1.18: optional `earnapp` (EarnApp monitor last cycle + rolling totals) and `hostCache` (AE 12-h cache check state)
// ride along, re-validated by engine/earnapp-status.mjs; an older Central drops them, an older Agent sends none.
import { sanitizeEarnAppStatus, sanitizeHostCacheStatus } from './earnapp-status.mjs';

const bool = (v) => (v === true ? true : v === false ? false : null);
const count = (v) => (Number.isInteger(v) && v >= 0 && v <= 100000 ? v : null);

export function sanitizeFleetHealth(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  const out = {
    autoScan: bool(h.autoScan),
    autoFix: bool(h.autoFix),
    hangRecovery: bool(h.hangRecovery),
    vmRunning: count(h.vmRunning),
    vmTotal: count(h.vmTotal),
    countsAt: Number.isFinite(h.countsAt) && h.countsAt > 0 ? h.countsAt : null
  };
  if (out.vmRunning !== null && out.vmTotal !== null && out.vmRunning > out.vmTotal) {
    out.vmRunning = null; out.vmTotal = null;           // inconsistent pair -> unknown, not a fault
  }
  const earnapp = h.earnapp === undefined ? null : sanitizeEarnAppStatus(h.earnapp);
  const hostCache = h.hostCache === undefined ? null : sanitizeHostCacheStatus(h.hostCache);
  const nativeMonitorV1 = h.nativeMonitorV1 === undefined ? null : sanitizeNativeSource(h.nativeMonitorV1);
  if (nativeMonitorV1) out.nativeMonitorV1 = nativeMonitorV1;
  if (earnapp) out.earnapp = earnapp;
  if (hostCache) out.hostCache = hostCache;
  return out;
}

/** Vietnamese operator warnings. Only PROVEN states produce a warning. */
export function fleetHealthWarnings(health) {
  const h = sanitizeFleetHealth(health);
  if (!h) return [];
  const w = [];
  if (h.autoScan === false) w.push('AUTO SCAN đang TẮT');
  if (h.autoFix === false) w.push('Auto-FIX đang TẮT');
  if (h.hangRecovery === false) w.push('Phục hồi VM treo đang TẮT');
  if (h.vmRunning !== null && h.vmTotal !== null && h.vmRunning < h.vmTotal) {
    w.push(`VM chạy ${h.vmRunning}/${h.vmTotal}`);
  }
  return w;
}

/** Built on the Agent/Central from its own settings + the last discover() counts (+ 3.1.18 cached monitor/cache state). */
export function makeFleetHealth(settings = {}, counts = null, { earnapp, hostCache, nativeMonitorV1 } = {}) {
  return sanitizeFleetHealth({
    autoScan: !!settings.autoScanEnabled,
    autoFix: !!settings.autoScanAutoFix,
    hangRecovery: !!settings.controlledVmHangRecovery,
    vmRunning: counts ? counts.running : null,
    vmTotal: counts ? counts.total : null,
    countsAt: counts ? counts.at : null,
    ...(earnapp ? { earnapp } : {}),
    ...(nativeMonitorV1 ? { nativeMonitorV1 } : {}),
    ...(hostCache ? { hostCache } : {})
  });
}
