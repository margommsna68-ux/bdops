# Fleet monitoring canary handoff — 26 October 2026

## Current moon1 canary — 26 October 2026, 3.1.18.3

GEN2 **3.1.18.3** is installed and activation-confirmed on moon1/Central after the owner normally exited GEN2. Fingerprint `c951ed5ce7f054afd9e2858195493b19c8ed362842e71ccb5f884c06f6446676`; transaction `63dc312b-8232-48c0-956f-e687ca36414e`; session 2; `pendingBoot:null`. Native monitoring resumed in a new source instance and fresh guest observations reached the web. See `moon1-live.md` in the fleet-M1 evidence directory for the final measured snapshot. **M1 is not fully accepted; M2/M3 and other-host rollout have not begun.**

Live 3.1.18.2 completed its first 61/61 running-VM round in 600.485 s, then read eight VMs in the next round before a source-write admission failure falsely latched guest quarantine. Version 3.1.18.3 defers such a failure before any guest call; real uncertain guest cleanup still latches. A one-time explicit offline reconciliation verified the exact prior build/module, source bytes, prior clean lane, normal exit and no guestcontrol children, and archived the old source. It did not invent guest-exit evidence or clear timeout/cancellation quarantine. Native core axis timestamps are probe-start times; a later complete responsive triplet before the failed admission is permitted only under this pinned control flow.

57/57 package tests and the legacy baseline/patched groups pass. The installer EXE self-test and installed fingerprint match. The previous 3.1.18/3.1.18.1/3.1.18.2 builds are retained. No VM power, RAM, proxy/NAT, account, SDK, money or Auto-FIX setting was changed by this canary. All 61 VM engine PIDs/start times/paths remain equal to baseline. Read the producer snapshot through Node/libuv or a file handle with **read/write/delete sharing**; SFTP or default PowerShell reads can block atomic rename on Windows. The lock reproduction proves susceptibility, not the exact historical lock holder.

The paragraphs below that describe an installation blocker or source-only state are historical. The current canary uses process-local environment gates and is not a fleet release or a restart-persistent production rollout.

Current launch evidence is `C:/GEN-MERGE/canary/monitor-moon1-20261026/start-canary-third.ps1` and `install-result-third.json`. The one-off start tasks were removed after completion; the running process was left intact. This launcher is evidence, not an unattended-start guarantee. Never run it alongside GEN2. The preflight-reconciliation switch was for the exact archived old snapshot, not a general quarantine-reset option.

## Historical second install — superseded by 3.1.18.3

**Historical second runtime: 3.1.18.2**, fingerprint `edd656962da9070ecb7d8e82cfeed34fe1905026655ccf547fcfbaed81cea43f`, source fix commit **617e51e**. At 09:40:39 UTC it completed the canonical FULL-install activation and real session-2 start after the owner normally exited GEN2 again. Live 3.1.18.1 testing found that second-cycle pacing incorrectly used the small due subset; the fix budgets against all running targets while retaining individual due times/rechecks. Two reproduction cases red→green, 41 package tests and 104 bridge tests pass. Regenerating replacements produces exactly the same engine hashes. First 3.1.18.1 success is not acceptance of that superseded build. Retain original 3.1.18 for reviewed recovery; do not select broken 3.1.18.1 merely because it is the most recent previous version.

After the owner normally exited GEN2 (VMs kept running), the canonical FULL installer installed **3.1.18.1** on moon1/Central. It preserved **3.1.18**, verified fingerprint `dfa637eb57b59fe01e2a55bfa9ffffe806a32c674e3ae79ee5b3facd5b766ab1`, and confirmed the real start in Windows session 2 (`pendingBoot:null`). The actual user is `WIN-6CA4QAGDD2F\meo3`, with the existing machine data under `C:/Users/Administrator/AppData/Roaming/gen-tool-pro/machine`. No new data/profile was used for the real application.

Native gates allow only server UUID `dda631e2-3ce9-492c-a733-f2b96873dd02`. The existing single collector uses the new schedule; no second collector/service was installed in any guest. The `current` path is changed only by the product installer. Shared update feed and `C:/GEN-MERGE/work/app` remain unchanged.

The web now additionally enrolls AGENT and CENTRAL for web server **MOON-01** (`cmvkqqg430c0vu6sastec8vkr`), both tied to that physical machine UUID. Prior Moon05 enrollment/history is retained; its older heartbeat becomes stale. The publisher points to immutable release `Desktop/MoneyToHome/Gen2Dashboard/releases/20261026-fleet-m1-moon1-flush30`; the supported CLI polling pause is 30 seconds, plus actual request work, not a hard 30-second delivery guarantee. All business/VM journals remain in place. The previous heartbeat file was archived only after confirming no pending requests; `monitor-heartbeats.moon05-acked-20261026.json` is retained. Never do this to an UNKNOWN request.

The real native inventory has 90 VM positions, 61 running. Only the existing 70 mapped web positions are published; 20 extra positions are not created on the web. Real native source clocks and AGENT heartbeat now reach the web; unknown earning/network fields remain unknown. See the bounded live evidence in `docs/superpowers/evidence/2026-10-26-fleet-m1/moon1-live.md` for final coverage and measured limits. **M1 acceptance and power/Telegram stages are separate gates, not implied by a successful installation.**

Environment gates are process-local. A normal restart through a different shortcut/watchdog may return to default collector behavior. Do not claim canary survives restart or unattended 24–48h acceptance. The version-2 canary launcher lives under `C:/GEN-MERGE/canary/monitor-moon1-20261026/start-canary-second.ps1`; it validates the canonical installation result before launch. Do not run it while GEN2 is running or bypass normal exit/draining. The matching `install-result-second.json` is technical transaction evidence, not a token or VM-operation script.

Native rollback uses the existing product update/recovery flow to preserved 3.1.18 after normal drain/exit. Do not manually rewrite `active.json` or `current`. Publisher configuration rollback requires matching heartbeat config/state; preserve/reconcile pending requests and restore the prior ACKed heartbeat archive only while that publisher is stopped. The environment backup `.env.before-moon1-native-20261026` is private and must never enter a handoff/Git. Restart only MoneyToHome-Web after a reviewed enrollment change.

## Historical first deployment (before native installation)

Web code15df173, build yFWk4680Rv6YEVgcyqHoB is installed on SERVER-01 (wow.lalamail.sbs). Migration20261026130000_monitor_heartbeat is additive;44 migrations now applied. Backend enrollment names only GROUP MOON / moon05, with distinct AGENT Moon05 UUID and CENTRAL machine UUID. No token or capability grants changed.

The existing Central cache publisher was updated in place to `Desktop/MoneyToHome/Gen2Dashboard/releases/20261026-fleet-m1`. Task `MoneyToHome-GEN2-Dashboard` keeps its existing user, token, state, reminder journal and project. This is not a second collector. The runner uses batch25 and monitor-config.json; legacy cache ingestion for the other servers continues. The source native GEN23.1.18 binaries and settings on Central and Moon05 were not replaced or restarted.

Verified on the live path: CENTRAL heartbeat accepted by web with source and receipt clocks; around0.8s on one measured request. AGENT source absent, no AGENT heartbeat manufactured. Native axes, actual guest coverage and earning remain Unknown. Central reported90 UUID-bound web targets for Moon05; the web has91 positions, so the remaining unbound position is not invented or counted as proof. Source-policy1 is installed only in the web/bridge contract, not the still-original native collector.

## Current gate

M1 is NOT accepted. Native installation has no verified safe initial updater ingress. Read `integrations/gen2-monitor-canary/DEPLOYMENT-BLOCKER.md` before any native deployment. No M2/M3, power canary, Telegram-control rollout, shared fleet publication or financial switch. Do not use the separate headless updater or GUI/forced GEN2 termination to bypass this.

Native source patch and tests are retained under `integrations/gen2-monitor-canary/`. The source ZIP is a patch package, not an installed GEN2 release and not sufficient release evidence. Original exact source baseline3.1.18 is SHA-pinned. Canonical remote source `C:/GEN-MERGE/work/app` remains unchanged. Web source remains this repository, not the Central client folder.

## Operation and rollback

- Do not reset/delete bridge state or monitor-heartbeats.json. UNKNOWN requests retry their exact original key/body. A backend409 on an old superseded heartbeat needs reconciliation, not silent renumbering.
- Fixed runner: `scripts/gen2-dashboard/background.ps1`, source-tree manifest verified before launch. Current log plus one rotated log,10MiB each; rotated retention7days. No per-VM commands in this runner.
- Existing Task Scheduler stop left the former cache publisher child alive. Only that exact node.exe command path and durable lock owner PID were verified and stopped for this upgrade; GEN2/AE/VM/Apple processes were excluded. The original publisher journal was preserved. This does NOT justify terminating native GEN2 for a future upgrade.
- Central runner rollback: stop only the publisher, preserve/reconcile pending journal, restore `run-background.before-fleet-m1-20261026.ps1` to `run-background.ps1`, start the same task. Never run old and new publishers concurrently. Keep technical heartbeat snapshots; after publisher rollback they naturally go stale.
- Web rollback: `D:/MoneyToHome/app-before-fleet-monitor-20261026`. Stop only MoneyToHome-Web, swap app directories, restart; Tunnel/Postgres stay up. Leave the additive MonitorHeartbeat table; do not restore the production database. The prior app directory retains its original environment without canary enrollment.
- Deployment command and guards: `D:/MoneyToHome/tools/deploy-fleet-monitor.ps1`. Backup125218 includes local dump and encrypted/decryption-verified copy on moon-01. Original and staged environment hashes were pinned; the only added environment key is FLEET_MONITOR_CANARY.

## Verified and unverified

- Full web suite219files/1314tests; bridge104tests; native package39tests plus15 legacy groups original/patched. Types/lint/build pass; existing hook warnings only.
- Local real Chrome120 API/layout assertions at1280/390, noJS/console/request errors. Dark and Bronze verified; Light and Golden theme application incomplete in the isolated source-copy harness. Do not claim four-theme acceptance.
- Live business snapshot immediately before/after deployment identical:678VM,149logins,1465proxies,4batches,4costs,3payoutrequests,0fundtransactions. Other operators created an additional payout request before the final backup; it was preserved. This deployment did not create that request.
- Moon05 read-only AE inventory:91/91 Running, identical UUID/state/RAM/Balloon/keep-off before/after. No power, proxy, NAT, account or Auto-FIX change issued. Engine PID/start baseline was not measured; do not claim that stronger proof.
- CPU/RAM delta, real probe p95/p99, sockets/handles growth,600second native coverage and native Agent→Central delivery: NOT measured. Telegram canary delivery/control and isolated VM power commands: NOT tested. Financial staysOFF. Apple worker untouched.
