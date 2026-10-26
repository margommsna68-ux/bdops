// Pure SHA-gated source transform. No filesystem mutation or installation.
import fs from 'node:fs';
import crypto from 'node:crypto';
const manifest=JSON.parse(fs.readFileSync(new URL('./base-sha256.json',import.meta.url),'utf8'));
export function transformMain(bytes){
  if(!Buffer.isBuffer(bytes))throw Error('BASE_BYTES_REQUIRED');
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==manifest.base['main.mjs'])throw Error('BASE_SHA_MISMATCH');
  const newline=bytes.includes(Buffer.from('\r\n'))?'\r\n':'\n';
  let source=bytes.toString('utf8').replace(/\r\n/g,'\n');
  function replace(old,value){if(source.split(old).length!==2)throw Error('MAIN_ANCHOR_MISMATCH');source=source.replace(old,value);}
  replace("import { createEarnAppMonitor } from './engine/earnapp-monitor.mjs';",
    "import { createEarnAppMonitor } from './engine/earnapp-monitor.mjs';\nimport { readNativeInventory, readNativeAppliedProxy } from './engine/native-monitor-readers.mjs';\nimport { createMonitorSourceWriter, readGuestQuarantine } from './engine/native-monitor-source.mjs';\nimport { persistNativeSource, canarySourceAllowed } from './engine/native-monitor-wire.mjs';\nimport { createCanaryGuestTransport } from './engine/native-monitor-guest-transport.mjs';");
  replace('let earnappMonitor = null;', `let earnappMonitor = null;
let nativeMonitorSourceLatest = null;
let nativeMonitorSourceWriter = null;
let nativeMonitorStopping = null;
let nativeMonitorStopEpoch = 0;
function retireNativeMonitor(m, resync = false) {
  const isNative = m.status().configVersion === 1;
  const stop = m.stop();
  if (!isNative) { stop.catch(() => {}); return; }
  const epoch = ++nativeMonitorStopEpoch;
  nativeMonitorStopping = stop;
  stop.then(() => {
    if (nativeMonitorStopping !== stop) return;
    nativeMonitorStopping = null;
    if (resync && epoch === nativeMonitorStopEpoch) syncEarnAppMonitor();
  }, () => { LOG('native-monitor-stop-unverified', { code: 'CLEANUP_UNVERIFIED' }); });
}`);
  replace('if (want && !earnappMonitor) {', 'if (want && !earnappMonitor && !nativeMonitorStopping) {');
  replace('    m.stop().catch(() => {});', '    retireNativeMonitor(m, true);');
  replace('function stopEarnAppMonitor() {', 'function stopEarnAppMonitor() {\n  nativeMonitorStopEpoch++;');
  replace('if (earnappMonitor) { const m = earnappMonitor; earnappMonitor = null; m.stop().catch(() => {}); }',
    'if (earnappMonitor) { const m = earnappMonitor; earnappMonitor = null; retireNativeMonitor(m); }');
  replace('hostCache: hostCacheSnapshot() }),', 'hostCache: hostCacheSnapshot(), nativeMonitorV1: nativeMonitorSourceLatest }),');
  replace('function onCentralEvent(kind, data) {', `function onCentralEvent(kind, data) {
  // Existing authenticated HEARTBEAT; only the selected server may write this bounded inbox.
  if (process.env.GEN2_NATIVE_MONITOR_RECEIVE_CANARY === '1' && kind === 'change' && data?.reason === 'HEARTBEAT'
      && canarySourceAllowed(data.serverId, process.env.GEN2_NATIVE_MONITOR_CANARY_ALLOWLIST)) {
    const source = clusterRegistry?.get(data.serverId)?.health?.nativeMonitorV1;
    if (source) { try { persistNativeSource({ dir: path.join(MACHINE_DATA_DIR, 'native-monitor', 'inbox'),
      expectedServerUuid: data.serverId, snapshot: source }); }
      catch { LOG('native-monitor-inbox-unavailable', { code: 'SOURCE_REJECTED' }); } }
  }`);
  replace('  if (want && !earnappMonitor && !nativeMonitorStopping) {\n    earnappMonitor = createEarnAppMonitor({',
`  if (want && !earnappMonitor && !nativeMonitorStopping) {
    // Source-package canary: default remains the legacy 120 s monitor; no settings are written.
    const nativeCanary = process.env.GEN2_NATIVE_MONITOR_CANARY === '1'
      && canarySourceAllowed(SERVER_ID, process.env.GEN2_NATIVE_MONITOR_CANARY_ALLOWLIST);
    const nativeMonitorVbox = nativeCanary
      ? createCanaryGuestTransport(makeVbox(DETECT.path, CFG.VBoxUserHome || '', { lowPriority: true, onCall: countVbox, awaitCloseOnTimeout: true })) : vboxScan;
    if (nativeCanary && !nativeMonitorSourceWriter) nativeMonitorSourceWriter = createMonitorSourceWriter({
      file: path.join(MACHINE_DATA_DIR, 'native-monitor', 'latest.json'), serverUuid: SERVER_ID
    });
    earnappMonitor = createEarnAppMonitor({
      ...(nativeCanary ? {
        canaryPolicyVersion: 1,
        initialGuestQuarantine: readGuestQuarantine(path.join(MACHINE_DATA_DIR, 'native-monitor', 'latest.json'), SERVER_ID),
        readAppliedProxy: (vm, opts) => readNativeAppliedProxy(nativeMonitorVbox, vm, opts),
        onSnapshot: (snapshot) => { try { nativeMonitorSourceLatest = nativeMonitorSourceWriter(snapshot); return true; } catch { LOG('native-monitor-source-unavailable', { code: 'SOURCE_WRITE_FAILED' }); return false; } }
      } : {}),`);
  replace('listVms: async () => { await discover(); return LAST_VM_LISTING; },',
    'listVms: async () => { if (nativeCanary) return readNativeInventory(nativeMonitorVbox); await discover(); return LAST_VM_LISTING; },');
  replace('await awaitGuestReady(vboxScan, CFG, vm.uuid, { budgetMs: 15_000 });',
    'await awaitGuestReady(nativeMonitorVbox, CFG, vm.uuid, { budgetMs: 15_000 });');
  replace("if (!gr.ready) return { ok: false, reason: gr.code, vboxCalls: tap.calls };",
    "if (!gr.ready) return { ok: false, reason: gr.code, vboxCalls: tap.calls, guestCleanupUnverified: nativeMonitorVbox.guestCleanupUnverified === true };");
  replace('return { ...core, vboxCalls: tap.calls };', 'return { ...core, vboxCalls: tap.calls, guestCleanupUnverified: nativeMonitorVbox.guestCleanupUnverified === true };');
  replace('await readGuestHelperCore(vboxScan, CFG, vm.uuid, gr.username, { signal });',
    'await readGuestHelperCore(nativeMonitorVbox, CFG, vm.uuid, gr.username, { signal, ...(nativeCanary ? { canarySingleAttempt: true, canaryExistingHelperOnly: true } : {}) });');
  return source.replace(/\n/g,newline);
}
