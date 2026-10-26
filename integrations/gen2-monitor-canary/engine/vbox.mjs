// GEN TOOL PRO — VBoxManage async wrapper. READ-ONLY BY CONSTRUCTION:
// the only subcommands this engine ever issues are `list`, `showvminfo`,
// `guestproperty enumerate` and `guestcontrol run` (a read-only PowerShell
// probe). There is no startvm, no controlvm, no modifyvm, no kill anywhere.
// spawn (async) rather than spawnSync — a sync call inside the Electron main
// process would freeze the GUI for the length of every VBoxManage call.
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

export function detectVBoxManage(cfg) {
  const candidates = [
    cfg.VBoxManagePath,
    'C:\\Program Files\\AVC VirtualBox Pro\\VBoxManage.exe',
    process.env.VBOX_MSI_INSTALL_PATH && path.join(process.env.VBOX_MSI_INSTALL_PATH, 'VBoxManage.exe'),
    process.env.VBOX_INSTALL_PATH && path.join(process.env.VBOX_INSTALL_PATH, 'VBoxManage.exe'),
    'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe',
    'C:\\Program Files\\VirtualBox\\VBoxManage.exe'
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return { path: c, found: true }; } catch { /* keep looking */ }
  }
  return { path: cfg.VBoxManagePath || candidates[1], found: false };
}

/*
 * M13H LOW-IMPACT: `lowPriority` runs every child VBoxManage at BelowNormal so a
 * read-only fleet SCAN never competes for CPU with the guests themselves — the
 * host stays smooth even mid-scan. It only nudges the SCHEDULER; the read still
 * completes normally. FIX keeps normal priority (a separate, default vbox). This
 * uses os.setPriority on the spawned pid — supported on Windows, best-effort.
 */
export function makeVbox(vboxPath, userHome, { lowPriority = false, onCall = null, awaitCloseOnTimeout = false, spawnProcess = spawn } = {}) {
  return function vbox(args, timeoutMs = 60_000) {
    return new Promise((resolve) => {
      /* M1.2 IDLE PROOF: observation only — a counter hook so "0 VBoxManage
       * calls while idle" can be measured instead of asserted. It changes
       * nothing about the call itself. */
      if (onCall) { try { onCall(args); } catch { /* never break a call */ } }
      const env = { ...process.env };
      const transportKind={guestControlRun:args[0]==='guestcontrol'&&args[2]==='run'};
      if (userHome) env.VBOX_USER_HOME = userHome;
      let out = '', err = '', done = false, timeoutPending = false;
      const child = spawnProcess(vboxPath, args, { windowsHide: true, env });
      if (lowPriority && child.pid) {
        try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not supported here */ }
      }
      const timer = setTimeout(() => {
        if (!done) {
          timeoutPending = true; try { child.kill(); } catch { /* retain slot until close */ }
          if (!awaitCloseOnTimeout) { done = true; resolve({ ...transportKind, code: null, out, err, timedOut: true }); }
        }
      }, timeoutMs);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => {
        if (!done) { done = true; clearTimeout(timer); resolve({ ...transportKind, code: null, out, err: String(e), timedOut: false }); }
      });
      child.on('close', (code) => {
        if (!done) { done = true; clearTimeout(timer); resolve({ ...transportKind, code, out: String(out), err: String(err), timedOut: timeoutPending }); }
      });
    });
  };
}

/*
 * MERGE (port từ 1.9.61) — ĐỌC TRẠNG THÁI MỘT MÁY MÀ KHÔNG CẦN KHOÁ SESSION.
 *
 * `showvminfo` xin shared lock; một máy kẹt `stopping` (tiến trình máy ảo đã
 * chết mà VBoxSVC vẫn giữ trạng thái) trả E_FAIL tại LockMachine. `list vms -l`
 * đọc cùng registry VBoxSVC nhưng không xin lock. Cùng một nguồn, khác lối vào.
 *
 * Khác bản 1.9.61: khớp theo TÊN hoặc UUID (1.7.18 gọi nhiều lệnh theo UUID),
 * và KHÔNG được gắn vào machineInfo() chung — chỉ luồng QUÉT (chỉ đọc) dùng nó
 * để gọi đúng tên trạng thái thay vì "không tìm thấy máy ảo". Mọi luồng FIX /
 * hard-off giữ nguyên hành vi showvminfo của 1.7.18.
 */
export async function machineStateLockFree(vbox, nameOrUuid, timeoutMs = 45_000) {
  const r = await vbox(['list', 'vms', '-l'], Math.max(1_000, timeoutMs));
  const want = String(nameOrUuid || '').toLowerCase();
  const blocks = [];
  let cur = null;
  for (const l of String(r.out || '').split(/\r?\n/)) {
    /* Dòng thư mục chia sẻ cũng bắt đầu bằng "Name:" nhưng giá trị nằm trong
     * nháy đơn — loại ra để không cắt khối máy làm đôi. */
    const head = l.match(/^Name:\s{2,}(.+?)\s*$/);
    if (head && !head[1].startsWith("'")) { cur = { name: head[1] }; blocks.push(cur); continue; }
    if (!cur) continue;
    const st = l.match(/^State:\s{2,}(\S+)/);
    if (st && !cur.VMState) cur.VMState = st[1];
    const id = l.match(/^UUID:\s{2,}([0-9a-fA-F-]+)/);
    if (id && !cur.UUID) cur.UUID = id[1];
    const os = l.match(/^Guest OS:\s{2,}(.+?)\s*$/);
    if (os && !cur.ostype) cur.ostype = os[1];
  }
  const hit = blocks.filter((b) => b.VMState
    && (String(b.name).toLowerCase() === want || String(b.UUID || '').toLowerCase() === want));
  /* Không đúng MỘT khối khớp thì không đoán. */
  return hit.length === 1 ? hit[0] : null;
}

/* B8: `timeoutMs` cho phép bên gọi ép lệnh này nằm trong ngân sách còn lại của
 * nó. Không truyền thì giữ nguyên 45 s như trước. */
export async function machineInfo(vbox, name, timeoutMs = 45_000) {
  const r = await vbox(['showvminfo', name, '--machinereadable'], Math.max(1_000, timeoutMs));
  const out = {};
  for (const l of r.out.split(/\r?\n/)) {
    const at = l.indexOf('=');
    if (at > 0) out[l.slice(0, at)] = l.slice(at + 1).replace(/^"|"$/g, '');
  }
  out.__error = r.code === 0 ? null : (r.err || (r.timedOut ? 'showvminfo timeout' : 'showvminfo failed'));
  return out;
}

export async function listVms(vbox) {
  const r = await vbox(['list', 'vms'], 45_000);
  return r.out.split(/\r?\n/)
    .map((l) => l.match(/^"(.*)"\s+\{([0-9a-fA-F-]+)\}$/)).filter(Boolean)
    .map((m) => ({ name: m[1], uuid: m[2].toLowerCase() }));
}

export async function listRunning(vbox) {
  const r = await vbox(['list', 'runningvms'], 45_000);
  return new Set(r.out.split(/\r?\n/)
    .map((l) => l.match(/^"(.*)"\s+\{/)).filter(Boolean).map((m) => m[1]));
}
