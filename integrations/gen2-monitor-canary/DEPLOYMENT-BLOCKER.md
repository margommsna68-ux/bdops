# Deployment blocked — initial native-monitor canary ingress

## Current moon1 canary — 26 October 2026, 3.1.18.3

GEN2 **3.1.18.3** is installed and activation-confirmed on moon1/Central after the owner normally exited GEN2. Fingerprint `c951ed5ce7f054afd9e2858195493b19c8ed362842e71ccb5f884c06f6446676`; transaction `63dc312b-8232-48c0-956f-e687ca36414e`; session 2; `pendingBoot:null`. Native monitoring resumed in a new source instance and fresh guest observations reached the web. See `moon1-live.md` in the fleet-M1 evidence directory for the final measured snapshot. **M1 is not fully accepted; M2/M3 and other-host rollout have not begun.**

Live 3.1.18.2 completed its first 61/61 running-VM round in 600.485 s, then read eight VMs in the next round before a source-write admission failure falsely latched guest quarantine. Version 3.1.18.3 defers such a failure before any guest call; real uncertain guest cleanup still latches. A one-time explicit offline reconciliation verified the exact prior build/module, source bytes, prior clean lane, normal exit and no guestcontrol children, and archived the old source. It did not invent guest-exit evidence or clear timeout/cancellation quarantine. Native core axis timestamps are probe-start times; a later complete responsive triplet before the failed admission is permitted only under this pinned control flow.

57/57 package tests and the legacy baseline/patched groups pass. The installer EXE self-test and installed fingerprint match. The previous 3.1.18/3.1.18.1/3.1.18.2 builds are retained. No VM power, RAM, proxy/NAT, account, SDK, money or Auto-FIX setting was changed by this canary. All 61 VM engine PIDs/start times/paths remain equal to baseline. Read the producer snapshot through Node/libuv or a file handle with **read/write/delete sharing**; SFTP or default PowerShell reads can block atomic rename on Windows. The lock reproduction proves susceptibility, not the exact historical lock holder.

The paragraphs below that describe an installation blocker or source-only state are historical. The current canary uses process-local environment gates and is not a fleet release or a restart-persistent production rollout.

## Update — initial bootstrap resolved on moon1, 26 October 2026

**Historical second installed version was 3.1.18.2**, fingerprint `edd656962da9070ecb7d8e82cfeed34fe1905026655ccf547fcfbaed81cea43f`. Live observation of 3.1.18.1 revealed second-round scheduling starvation; the native pacing fix and matching generator were reviewed, 2 reproductions went red→green and 41 package tests passed. After a second owner-normal exit, the same canonical FULL installer confirmed transaction `ddba2d1d-43fd-4102-9def-50c448f150e0` and a real session-2 start, `pendingBoot:null`. Do not reactivate 3.1.18.1 as a healthy long-running build. Original 3.1.18 is still retained; use a reviewed product recovery path rather than editing current/active state.

The owner normally exited GEN2 and confirmed the VMs remained running. Direct checks found no remaining GEN2 or guestcontrol process. The existing FULL installer was then used, not the unsafe second-process live updater:

`GenToolPro.exe --install-managed --home=C:/GEN-TOOL-PRO --from-legacy=C:/GEN-TOOL-PRO/versions/3.1.18 --state-home=<isolated-installer-state> --gen-profile=fleet-monitor-install`

It verified candidate **3.1.18.1**, fingerprint **dfa637eb57b59fe01e2a55bfa9ffffe806a32c674e3ae79ee5b3facd5b766ab1**, preserved 3.1.18, and returned its canonical transaction/start arguments. A one-off Interactive/Limited task started the successor in the existing session 2 with the real machine state and only the three native canary environment keys. `active.json` confirms the exact build, transaction and `pendingBoot:null`. No manual junction rewrite, forced GEN2 exit, shared feed publication, AE upgrade or VM power command was used.

The **native canary is now installed on moon1/Central**. Real AGENT and CENTRAL heartbeats and 70 UUID-bound web VM observations have been received. Full measurements and remaining gates are recorded in `docs/superpowers/evidence/2026-10-26-fleet-m1/moon1-live.md`. This resolves initial installation only; it does not create an external live-process update API or accept M1/M2/M3. The installed canary gates are process-local and do not automatically persist across an ordinary later restart.

The sections below are retained as the **earlier, pre-owner-exit investigation**, not the current installation status.

Historical status: accepted source/test package only, before normal exit and FULL installation. Independent web deployment/source handoff proceeded without claiming native canary acceptance.

## Read-only evidence — 26 October 2026

At **2026-10-26T05:38:52.958077+00:00**, authenticated `GET /servers` through the existing pinned SSH connection's TCP forwarding returned HTTP 200:

| Role | GEN2 server UUID | Reported state/version | Reported VM running/total |
| --- | --- | --- | --- |
| Central / Moon-01 | `dda631e2-3ce9-492c-a733-f2b96873dd02` | ONLINE / 3.1.18 | 61 / 90 |
| Moon05 agent | `577be21b-18b5-4c7d-b897-3e5c0093c4aa` | ONLINE / 3.1.18 | 91 / 91 |

ONLINE is a registry observation, not a reservation of an idle deployment window. No STATUS command/job or VM scan was started. This request did not expose executable paths or Moon05's installed-file hashes.

Read-only SFTP inspection on Central established:

- `C:/GEN-TOOL-PRO/active.json`: current `3.1.18`, previous `3.1.17`, `pendingBoot:null`, `bootAttempts:0`, `confirmedAt:2026-10-25T12:07:05.803Z`.
- Installed `current/resources/app/package.json` reports `3.1.18`.
- Installed `current/resources/app/main.mjs` SHA-256 is `5800521fba2174c536a5b2362028a32b3d0200c83e018a1567166afac6edcd75`, matching the downloaded source and package base manifest. This verifies Central's installed file, not a new OS process-path attestation.
- Canonical settings read was `C:/Users/Administrator/AppData/Roaming/gen-tool-pro/machine/data/autoscan/settings.json`: update source `https://127.0.0.1:8767/update/manifest.json`, update host enabled on port 8767, local command port enabled, EarnApp monitor enabled with target 120 seconds. The similarly named settings under `C:/GEN-TOOL-PRO/data/` are not the canonical AppData settings.
- That AppData machine's `update-host/manifest.json` serves **3.1.14**, build ID `gen-tool-pro-merge-3.1.14-20261021150029`, code fingerprint `fb3ab982a40b060a285ac4e98dcb61d358f266891bb97181890cdbe2dc5518fb`, ZIP SHA-256 `ecc4221df928908c40e7465fc341a84219c58abd7e9474448168b5196d93cb7f`, size 1,153,010 bytes. The old shared feed is not a canary artifact.

Secrets were used only in memory for the existing authenticated connection/request and were not printed or stored in this report. Discovery used SFTP reads and one HTTP GET; no remote exec commands, mutations, GUI interaction, application/VM restart, or jobs were performed.

## Exact source findings

References below are relative to the repository's downloaded `.runtime/fleet-m1-source/gen2-app/`, unless marked remote-only. Line numbers refer to the inspected 3.1.18 source.

| Source | Finding |
| --- | --- |
| `main.mjs:6370`, `main.mjs:4137`, `engine/update-service.mjs:300` | Canonical live-process `UPDATE_NOW` invokes the existing updater, checks live work, verifies/stages a release, activates a transaction, starts the successor and requests graceful quit. Restart capability exists. |
| `engine/local-command-port.mjs:25`, `main.mjs:6919` | Port 8768 allows HEALTH_SCAN, MONEY_SCAN, FIX_ALL, NAT_REFRESH and STATUS. There is no public UPDATE_NOW binding. Existing updater entry points are internal Electron IPC and the authenticated cluster command handler, not a supported external canary deployment CLI. |
| `main.mjs:5213`, `main.mjs:9332` | `--update-live=now` starts an exempt headless process without the normal single-instance lock. Its updater sees that process's own OPS/scanner state. It can miss a job in the already-running application. It is **not a safe bootstrap workaround**. |
| `engine/update-service.mjs:303`, `engine/update-service.mjs:442` | Busy is checked at update entry; no final busy recheck immediately before activation was found. This does not establish exclusion against a job starting while download/verification is in progress. |
| `main.mjs:4120`, `engine/update-service.mjs:300`, `main.mjs:4161` | The configured update source is used. Supported update parameters pin expected version/fingerprint and transaction ID; they do not select a private manifest or inject successor environment gates. Spawn inherits the live process environment. Setting variables in another shell cannot change that process's environment. |
| `engine/build-identity.mjs:14`, `engine/build-identity.mjs:25` | Actual build identity requires a three- or four-part numeric version; version-directory validation rejects tag suffixes. A manifest parser accepting tags does not make tagged installed builds valid. |
| Remote-only `C:/GEN-MERGE/work/app/release-update.mjs`, `release-full.mjs`, `release-quality.mjs`, `BUILD-TOOLS.md` | Both release CLIs require real quality evidence. Local/live/EXE evidence must cover the new version/fingerprint; general release gates include three live HEALTH/MONEY rounds and EXE coverage. Existing authorized recovery evidence may be reused only when the pinned recovery modules are unchanged. Do not perform a power-cycle to manufacture proof, relabel old evidence, or bypass the gate. |

The top-level staged `update-installer.mjs`, `update-apply.mjs` and `update-swap.mjs` are zero-byte placeholders, not deployment implementations. Inspected old `C:/GEN-MERGE/install/run-install*.ps1` wrappers refuse a running GEN and require prior manual exit; they are not a safe no-GUI ingress for this task. The source full-install path likewise refuses another running installation.

## Blocking conclusion

**There is no verified supported initial ingress satisfying all current constraints:** live application job safety, no GUI/kill, selected Central + Moon05 only, private immutable artifact, per-process environment gates, unchanged settings, and no shared fleet publication.

Do not use the second-process `--update-live=now` CLI, direct file/junction replacement, GUI/CDP automation, process killing, global environment changes, or temporary shared-feed/settings changes as substitutes. Adding a deployment API only to the future canary does not solve bootstrapping the currently installed 3.1.18 process.

## Bounded source/harness follow-up prerequisites

No implementation is authorized by this report. A later reviewed ingress must:

1. Enter the **already-running process's** canonical updater through a fixed authenticated product binding, with explicit selected source identities and pinned artifact version/fingerprint/transaction. Resolve the initial 3.1.18 bootstrap explicitly.
2. Select a separate private immutable canary artifact without editing the shared feed or machine settings. Reserve an unused numeric version, for example `3.1.18.1` after checking availability; never replace 3.1.18 under the same identity.
3. Supply only the reviewed native canary environment keys to the selected successor process: `GEN2_NATIVE_MONITOR_CANARY`, `GEN2_NATIVE_MONITOR_RECEIVE_CANARY`, and `GEN2_NATIVE_MONITOR_CANARY_ALLOWLIST`. Preserve normal settings and existing launch profile/state home; do not set machine-wide variables.
4. Exclude new work during handover, recheck authoritative live busy state before activation/quit, and honor native guest/proxy draining or persisted quarantine. Exercise busy races, artifact changes, failed launch/verification and rollback in an isolated harness without production VM jobs or kills.
5. Provide a legitimate canary packaging/evidence path. The current general-release command below remains blocked by its evidence prerequisites; the accepted source-package tests are not full release or M1 evidence.

Canonical APP packaging syntax, **for a later isolated complete `app` source copy only; not executed**:

```text
node release-update.mjs --url=<private-package-HTTPS-URL> --out=<fresh-output-directory> --local-proof=<json> --live-proof=<json> --recovery-proof=<json> --exe-proof=<json>
```

Omit `--publish`. Build a full runtime APP package, not the small source patch ZIP: regenerate the code manifest after the numeric version bump, include the unchanged existing helper binaries/runtime assets, and verify ZIP size/SHA-256/code fingerprint. Preserve original installations and rollback identity. Do not upgrade AE or guest helpers.

After an authorized installation, actual Agent-to-Central/web delivery, source-time/identity binding, full read-only coverage, CPU/RAM/probe p95/p99 and bounded long-running behavior still require measurement. NCSI/service/GUEST HTTPS/earning remain UNKNOWN with the existing native core. Until those canary requirements are met, **no M1 acceptance, no M2, and no fleet rollout claim**.
