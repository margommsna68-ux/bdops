# Moon1 read-only native canary — 26 October 2026

## Current moon1 canary — 26 October 2026, 3.1.18.3

GEN2 **3.1.18.3** is installed and activation-confirmed on moon1/Central after the owner normally exited GEN2. Fingerprint `c951ed5ce7f054afd9e2858195493b19c8ed362842e71ccb5f884c06f6446676`; transaction `63dc312b-8232-48c0-956f-e687ca36414e`; session 2; `pendingBoot:null`. Native monitoring resumed in a new source instance and fresh guest observations reached the web. See `moon1-live.md` in the fleet-M1 evidence directory for the final measured snapshot. **M1 is not fully accepted; M2/M3 and other-host rollout have not begun.**

Live 3.1.18.2 completed its first 61/61 running-VM round in 600.485 s, then read eight VMs in the next round before a source-write admission failure falsely latched guest quarantine. Version 3.1.18.3 defers such a failure before any guest call; real uncertain guest cleanup still latches. A one-time explicit offline reconciliation verified the exact prior build/module, source bytes, prior clean lane, normal exit and no guestcontrol children, and archived the old source. It did not invent guest-exit evidence or clear timeout/cancellation quarantine. Native core axis timestamps are probe-start times; a later complete responsive triplet before the failed admission is permitted only under this pinned control flow.

57/57 package tests and the legacy baseline/patched groups pass. The installer EXE self-test and installed fingerprint match. The previous 3.1.18/3.1.18.1/3.1.18.2 builds are retained. No VM power, RAM, proxy/NAT, account, SDK, money or Auto-FIX setting was changed by this canary. All 61 VM engine PIDs/start times/paths remain equal to baseline. Read the producer snapshot through Node/libuv or a file handle with **read/write/delete sharing**; SFTP or default PowerShell reads can block atomic rename on Windows. The lock reproduction proves susceptibility, not the exact historical lock holder.

The paragraphs below that describe an installation blocker or source-only state are historical. The current canary uses process-local environment gates and is not a fleet release or a restart-persistent production rollout.

## Current build and defect found on the real canary

Current runtime is **3.1.18.2**, fingerprint `edd656962da9070ecb7d8e82cfeed34fe1905026655ccf547fcfbaed81cea43f`, source fix **617e51e**, activated by the product FULL installer in transaction `ddba2d1d-43fd-4102-9def-50c448f150e0`. Its real session-2 start at 09:40:38 UTC was confirmed at 09:40:39 UTC with `pendingBoot:null`. Its isolated EXE verifier also returned `ok:true`; the captured process exit code was null, not asserted as zero.

The first 3.1.18.1 round below was successful but **did not establish repeated-round safety**. At the next round only VM_001 was individually due, making `cycle.targets=1`; the scheduler then incorrectly slept 600 seconds and delayed the remaining VMs. The live cycle log retains this evidence. The fix sizes the pacing budget against all running inventory while preserving the due subset and first-pass/recheck semantics. A staggered three-round reproduction and a slow-read/app-failure/recheck reproduction both fail before, pass after. The initial alternative of keeping future targets in the queue broke the existing startup-grace/recheck test and was discarded; it was never installed.

An independent source review identified stale generator output; `build-replacement.py` now contains the same fix. Actual regeneration preserved SHA-256 of every engine file exactly. 41 native package tests plus 15 legacy groups on original/patched source pass; all 104 bridge tests pass and the publisher PowerShell parses cleanly. No full web rebuild/test rerun was performed because web product source did not change in this follow-up.

The owner normally exited GEN2 again before the second install. No forced GEN2 quit or production VM interruption was used. Version 3.1.18.1 is superseded and must not be described as a passed long-running canary. Subsequent real observations of 3.1.18.2 are recorded in the adjacent second-runtime evidence files.

## Installation and scope

Owner normally exited GEN2 and confirmed VMs remained running. Pre-install checks found zero GEN2 processes and zero outstanding guestcontrol child processes. The product FULL installer activated **3.1.18.1**, fingerprint `dfa637eb57b59fe01e2a55bfa9ffffe806a32c674e3ae79ee5b3facd5b766ab1`, transaction `f2dd6601-f808-4513-87db-cf06fc692d65`. The real process started in the existing interactive Windows session 2 at 09:24:12 UTC; activation was confirmed with `pendingBoot:null`. Previous 3.1.18 is preserved. The candidate EXE also passed isolated `--update-verify`; its captured process exit code was null, so no exit-code-zero claim is made.

The native environment allowlist contains only physical server `dda631e2-3ce9-492c-a733-f2b96873dd02`. Production GEN2 settings, Auto-FIX/holds, AE version, shared update feed, Apple worker and canonical source under `C:/GEN-MERGE/work/app` were not changed. No VM power/proxy/NAT/RAM/account operation was sent. A read-only local GEN2 STATUS request reads the compact last-cycle/totals snapshot; it does not dispatch a scan or Telegram report.

Backend enrollment now additionally permits AGENT/CENTRAL for web MOON-01, `cmvkqqg430c0vu6sastec8vkr`. Old Moon05 enrollment/heartbeat history remains, and ages naturally. Only MoneyToHome-Web was restarted for enrollment; Tunnel/Postgres stayed running. Private environment backup remains on the host. No migration or web build was needed for this enrollment change.

Publisher release `Gen2Dashboard/releases/20261026-fleet-m1-moon1-flush30` retains the existing task/user/token and journals. Previous heartbeat config was archived only after every request was acknowledged; new source heartbeat identities were started explicitly. The later transport-only change to a 30-second polling pause keeps that same new heartbeat state and all pending/business journals. Telemetry batches remain 25; no financial rate limit or permission was changed.

## Historical first full round — superseded 3.1.18.1

Product STATUS reports:

| Measurement | Observed |
|---|---:|
| Start / end UTC | 09:24:18.455 / 09:34:23.548 |
| Round duration | 605.093 seconds |
| Managed inventory | 90 VM positions |
| Guest targets / completed | 61 / 61 |
| Non-running exclusions | 10 NOT_RUNNING + 19 INTENTIONAL_OFF |
| Timeout / unreadable / error / deferred | 0 / 0 / 0 / 0 |
| Guest pipeline VBox calls | 366 (6 per probe) |
| Average / maximum probe duration | 1,204 / 13,486 ms |
| Full-round coverage | 100% of 61 running targets |

The product marks `overBudget:true`: the measured round exceeded the 600-second target by 5.093 seconds. It is not an under-600-second pass. `ok:61` is the existing core-probe result, not proof that 61 VMs are earning or that guest HTTPS/applied proxy is verified. Probe p95/p99 is not exposed by the existing compact status and is not inferred from average/max.

The one-shot pre-install HOST reader test separately verified 90 UUIDs and two exact applied-proxy route bindings with HOST HTTPS, 5 VBox reads, zero guest calls, 2.859-second runtime. That test process's RSS increase was 6.39 MiB; it is not incremental GEN2 runtime overhead.

## Web and mapping proof

All existing **70** UUID-bound web MOON-01 positions received real native monitor observations, including 61 guest/app axes after round completion. Real AGENT and CENTRAL heartbeat rows were read back from the production database. The other **20 physical VM_071–VM_090 positions are all POWERED_OFF**, do not have web MOON-01 positions, and were not silently imported or treated as missing running guest coverage. Their exact UUIDs and states are retained in `moon1-evidence-summary.json`.

No earning fact was invented: native observations retain `earning:null`. App process presence, HOST proxy HTTPS, guest-network proof and increasing money stay separate. NCSI, guest HTTPS, service state, applied guest-route proof and earnings remain UNKNOWN where the current native core lacks evidence.

Per-axis delivery is measured from the original axis clock to **its first web receipt**, grouped by VM + axis + observedAt. Recurring envelopes carrying old guest evidence are not called fresh guest observations. The pre-tuning sample at 09:34 UTC had guest median 47.936 seconds / p95 84.164 seconds / maximum 102.772 seconds and proxy median 72.627 seconds / p95 101.235 seconds / maximum 103.862 seconds. This exposed the old publisher's 60-second pause. At 09:35:14 UTC, the supported polling option was changed to 30 seconds without extra guest probes; see final JSON for post-change results. This is polling plus actual request work, not a guaranteed 30-second end-to-end bound.

## Resource window and invariants

A bounded host-only observer samples existing process resources and native latest-file metadata. It never calls guestcontrol or changes any VM. First and second runtime resource windows are kept separate. In particular, the first window includes the 3.1.18.1 scheduling stall and cannot represent correctly scheduled sustained load. Final resource measurements, process identity comparison, after-round AE inventory and delivery summaries are in the adjacent JSON evidence files. All figures are whole GEN2 process-tree usage during the canary. There is no comparable collector-off window, so **incremental CPU/RAM and the below-20-MiB target are unproven**. Discrete samples may miss short-lived child processes; they are not proof of an exact lifetime peak.

AE inventory comparison preserves VM UUID/state/RAM/Balloon/keepOff across installation and the first round. Production VM engine process identities/times are compared separately. No financial commands were sent or enabled by the canary. Read-only AE capabilities reported `financialEnabled:true` as an existing global setting; this work did not toggle it. Do not restate that as global AE financial=false. The canary has no financial command path enabled.

## Acceptance limits

Installed and live read-only on moon1: **yes**. Complete M1/fleet acceptance: **no**. Outstanding: another physical agent host, comparative resource baseline and probe percentiles, independent guest network/service/earning evidence where required, failure/restart/resource-growth observations and restart-persistent canary launch. Isolated transport/replay tests pass, but no production outage or AE/GEN2 kill was induced. The current process gates do not guarantee canary mode after a normal different-launcher/watchdog restart.

M2 isolated power operations and M3 Telegram command/delivery tests have not begun. No 24–48-hour or full-fleet acceptance claim. Native rollback must use the product updater/recovery path and preserved 3.1.18 after normal drain/exit; never manually edit current/active state or clear uncertain guest quarantine.

## Source-write incident and current recovery

At 09:52:02.708 UTC, 3.1.18.2 failed to persist `RUNNING` before the next guest probe. Its first full round and eight second-round reads remain valid historical measurements; the second round did not complete. The resource window includes this stall and cannot represent sustained healthy load. The last completed single-target cycle ended at 09:52:02.694, before the failed admission. The sampled clean lane at 09:51:50.551 precedes VM_008's probe-start timestamp 09:51:52.854; it is not fabricated into a later IDLE observation.

The fixed offline CLI verified exact 3.1.18.2 build/module hashes and source seq527, retained the unknown attempted VM as null, and saved an immutable source/audit before the canonical FULL installer activated 3.1.18.3. The new process began at 10:22:19.781 UTC and successfully read VM_001 at 10:22:23.410; the web received that observation at 10:22:33.085. Additional current observations are counted separately in `moon1-current-summary.json`; older web axes are not called new-build coverage.

Current AE vm-list is unavailable (`AE_NOT_RUNNING_OR_AMBIGUOUS`). The earlier full AE RAM comparison must not be restated as a fresh post-third-install RAM check. Current physical VM inventory and unchanged engine PID/start/path evidence are separate from this limitation.

## Final bounded smoke snapshot — 10:27 UTC

Installed 3.1.18.3 has 29 fresh guest/app observations of the 61 running VM targets; the first full round is still in progress. The latest supported STATUS at 10:26:46 reported 27 probes/162 VBox reads, zero timeout/errors and no open incident. Web readback at 10:27:04 has all 70 mapped inventory axes, 70 new HOST-proxy axes and 25 fresh guest/app axes from this build; no earning value was fabricated. These are bounded smoke observations, not a completed new-build round or multi-round endurance proof. All 90 native UUID/state pairs match the physical baseline; 61 VM engine PID/start/path identities are unchanged.

The 57-test native verification and independent source review passed. Code fix commit `d3344ce`. Source-only ZIP copied to the common Central MoneyToHome folder and SHA-256 verified: `moneytohome-gen2-monitor-source-d3344ce-20261026.zip`, `43941dc82e2944a838c858551ab3fb8d2d6b35a3251396f6d24ec2ce8fee0de1`. The completed one-off First/Second/ThirdStart tasks were removed after verifying Ready and their exact canary action paths; running GEN2 and the dashboard publisher were left intact. No full web rebuild was run for the native-only storage fix.
