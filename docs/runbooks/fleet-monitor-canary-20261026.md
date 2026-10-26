# Fleet monitoring canary handoff — 26 October 2026

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
