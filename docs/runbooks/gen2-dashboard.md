# GEN2 dashboard cache bridge

The bridge publishes existing GEN2 observations to MoneyToHome. It never starts a scan, health probe, fix or VM action, and never changes GEN2's schedule. The runner also polls existing proxy due dates and submits one reminder per due key through GEN2's existing notification sender. Deployment evidence records which version is installed.

## Entry points

- `scripts/gen2-dashboard/cache.mjs`: existing cache reader, evidence projection, exact identity matching.
- `scripts/gen2-dashboard/bridge.mjs`: durable capture, observation writes and replay.
- `scripts/gen2-dashboard/io.mjs`: fixed HTTPS client, atomic journal and process lock.
- `scripts/gen2-dashboard/run.mjs`: continuous runner; Node 22+; no dependencies.
- `scripts/gen2-dashboard/test/core.node.mjs`: isolated Node tests, no live HTTP or Telegram.

Run tests from the repository:

```powershell
node --test scripts/gen2-dashboard/test/*.node.mjs
```

Installed 26/10/2026 on Central as `MoneyToHome-GEN2-Dashboard`, password/batch logon for existing meo3 profile (Administrator folder), Limited, no interactive desktop. Web d57cde3; bridge 06808b4, release `Gen2Dashboard/releases/20261026-v1` under the shared MoneyToHome desktop folder. Existing token reused, no new grants. The startup/5-minute trigger restarts only when the long-running task is not already running; the inner loop reads cache every minute after each pass. It does NOT schedule a GEN2 scan.

For manual maintenance only, after stopping the installed task and checking its process/lock, run under that same profile. Replace the example project ID with its actual ID, not the project code:

```powershell
node scripts/gen2-dashboard/run.mjs --project ACTUAL_PROJECT_ID
```

Optional arguments: `--machine-root`, `--state-dir`, `--secret-file`, `--interval-ms` (minimum 30000, default 60000), `--once`. **`--once` performs real observation writes; it is not a dry run.** Canary recorded one genuine cached observation, read back through the dashboard, before enabling the background task. First pass is rate-limited and the verified count increases progressively.

Defaults on Central:

| Purpose | Location |
| --- | --- |
| Read-only GEN2 machine root | `C:/Users/Administrator/AppData/Roaming/gen-tool-pro/machine` |
| Existing web secret | `C:/Users/Administrator/.mth/wow-ops-secret.json` |
| Bridge journal and lock | `C:/Users/Administrator/.mth/gen2-dashboard/<projectId>/` |

The existing secret shape is `{token: string}`. Its value stays in memory. The bridge does not create connection configuration or copy credentials into its journal. Keep one canonical state directory per project; do not run parallel copies using different state directories. Windows file access inherits the chosen directory's ACL.

## Confirmed cache paths and evidence

Relative to the machine root, verified against running GEN2 3.1.18 on Central:

| Path | Useful fields / meaning |
| --- | --- |
| `data/fleet/fleet-latest.json` | `kind=GEN_FLEET_LATEST_V1`, `schemaVersion=1`; `servers[].serverId/serverName`, `vms[].vmName/vmId` (machine UUID), `health`, `income`, `money` |
| `data/health/last-scan.json` | Local `kind=GEN_HEALTH_LAST_SCAN`, `schemaVersion=1`; `serverId/hostId`, `rows[].vmName/vmUuid/result`; individual `result.guest.observed_at` or `result.probed_at`, process count/running, income |
| `data/money/latest.json` | Local `[hostId][vmUuid]` records with `vmName/vmUuid/timestamp`, `money.micros/currency/metricType` |
| **`data/diagnostics/inbox/<serverId>/latest.json`** | **Remote agent raw-report pointer:** `serverId`, `reportId`, `fileName`, `createdAt`, `receivedAt` |
| **`data/diagnostics/inbox/<serverId>/<fileName>`** | **Raw cached report:** `server.serverId`, `reportId`, `machines[]`; `vmName/vmId`, `processCount/processIds`, `verifiedGreen`, `incomeState/currentMicros/deltaMicros/baselineAt/incomeElapsedMs`, explicit proxy errors |
| `data/money/snapshots.jsonl` | Existing local money history; not read or rewritten by the bridge |

The remote report path is under **diagnostics/inbox**, not `data/cluster`. The reader follows only a bounded, basename-only pointer matching the server/report. It also requires the report to match the VM's fleet `health.reportId`, and a unique UUID + VM code within the report. Missing/mismatched proof produces unknown earning.

Individual balance time is precise. The live source `C:/GEN-TOOL-PRO/current/resources/app/engine/income.mjs` defines `elapsedMs = time(current) - time(anchor)` and `baselineAt = anchor.timestamp`; `engine/diagnostic-bundle.mjs` retains these as `incomeElapsedMs` and `baselineAt`. Thus:

```text
fleet income observedAt = baselineAt + elapsedMs
remote diagnostic observedAt = baselineAt + incomeElapsedMs
```

A reconstruction beyond its report timestamp is rejected. A first observation without baseline/elapsed cannot supply precise remote income money; a separately timestamped money record may still be used. Local `income.observedAt` and dedicated `money.at/timestamp` are individual reading times. Fleet `updatedAt`, receipt time, and report completion alone are never used as balance reading times.

Read-only projection check on 26 October 2026 read 18 existing remote reports and 1,427 fleet observations. It matched **481/486 explicit web UUIDs**: MOON-01 70, MOON-02 69, An-01 69, vt-01 26, vt-03 44, vt-04 44, moon04 69, moon05 90. Five vt-01 UUIDs had no source match; 192 web rows without explicit UUID were skipped. For matched VMs: 254 had earning proof, 227 were unknown. Money sources were local health 61, local money 9, reconstructed fleet income 369, dedicated fleet money 7, no valid source 35. This checked source availability only, not eligibility for a future capture or current SDK.

That snapshot's latest money reading was `2026-10-26T00:56:07.401Z`; latest health was `2026-10-26T00:58:59.000Z`; fleet refresh was `2026-10-26T01:17:26.198Z`. These are historical verification values, not freshness promises. Consumers must retain the individual observation time.

## Health and identity rules

- Require exact UUID equality, matching VM code, and matching normalized server name. `moon-1` and `MOON01` may match only with the UUID and VM code. Duplicate UUIDs or colliding server aliases are rejected. Missing UUIDs are never guessed or written.
- Local earning requires a running EarnApp process (exactly one) plus positive income growth, or explicit earning proof. `NO_PROOF` without growth is unknown. Remote earning additionally requires the matching report, exact reconstructed time, exactly one process ID, verified green and positive income growth. Fleet GREEN alone is unknown.
- Only explicit source errors map to `EARNAPP`, `PROXY_CONNECTION`, `PROXY_AUTH`, `PROXY_EXPIRED`, `PROXY_BLOCKED`, `VM_OFF`. Unrecognized error strings remain unknown. No operating-status command is issued.
- Choose the newest individually timestamped balance from income/money; keep null distinct from zero and refuse same-time disagreement. Ignore GEN2 `withdrawReady` and its $8 threshold. The web owns $8/$10 labels and money history/deltas.

## Web contract and revision ownership

Only these routes are allowed, on exactly `https://wow.lalamail.sbs`, with redirects refused:

1. `GET /api/ops/v1/gen2-targets?projectId=...` returns an ops envelope with `data: {capturedAt, items}`. Each target carries `id`, `serverId`, `serverCode`, `code`, `machineUuid`, `expectedCycle`, `expectedVmRevision`, `configurationId`, `sdkId`, `sdkRevision`.
2. `POST /api/ops/v1/vms/{id}/scan-observations` sends `projectId`, `expectedCycle`, `expectedVmRevision`, `machineUuid`, `configurationId`, individual health `observedAt`, nullable `earning`, nullable `problem`. Optional `money` carries `sdkId`, `expectedSdkRevision`, `capturedAt`, individual `observedAt`, nullable decimal-string `amount`.

Success acknowledgement uses `data.recorded.vmId/cycle/observedAt`, plus the main API's **`recorded.vmRevisionAfter` and `recorded.sdkRevisionAfter`**. These fields prove our own resulting revisions. The bridge never guesses a revision increment. Current SDK is required for money; otherwise send health only. API authorization must permit the new routes, and money requires its existing balance-write permission.

The first target snapshot is durably captured before cache ingestion. Old health may be sent (the API validates creation/cycle/configuration boundaries), but money must be **strictly later** than capture. Subsequent scans can write money using that capture. Retain capture across revision refresh only when SDK ID/cycle/configuration/UUID identity is unchanged and the exact revisions match our acknowledged write. An unexplained revision or identity change resets capture and waits for a newer scan. Source time never moves backward.

## Recovery, limits and reminders

The journal stores whitelisted identity facts and one original pending body/key, never raw reports, headers, credentials or error text. It records attempted=true atomically before every POST. If persistence fails, no new command is sent; if saving an acknowledgement fails, the original command remains pending. A crash/restart or unknown timeout retries the identical body/key before new target/cache reads. Only a contractual refusal on the first attempt can reset capture. A refused retry cannot settle an earlier uncertain write; it remains pending until success. Unknown/429/5xx/malformed answers retain pending state. 401/403 stops the runner with pending state preserved.

GET spacing is at least 550 ms; POST spacing at least 2300 ms (under 120 reads and 30 writes/minute for this process). Other users of the same token share its server-side allowance. A full 481-VM first pass needs roughly 18.5 minutes at this write limit; unchanged readings are skipped. Each next round refreshes targets and reads caches again. Ctrl+C requests a stop between writes and preserves pending work.

The exclusive `bridge.lock` prevents overlapping runs in the same state directory. After an unclean exit, verify the recorded process is no longer running before manually removing that one lock. Never delete/reset an unknown pending journal to bypass it; do not automatically take over an ambiguous lock. A damaged journal stops instead of inventing a new capture. Keep the state across upgrades and restarts.

`run.mjs` wires `afterSync` to `reminders.mjs`: at most hourly GET gen2-reminders, within three days of due date, state in reminders.json. Uses only loopback POST /notify and the existing GEN2 local-port token. UNKNOWN is persisted before send; only a valid success becomes DONE. UNKNOWN notifications are never automatically resent. The notification lock reuses dead-PID recovery without changing delivery state. Prices are shown only if the web token can read COSTS; otherwise the message links to the web. It does not elevate rights.

Review fixes: faults retain their own source timestamps (old raw evidence cannot timestamp a newer fleet fault or be contaminated by an older one). Fault/recovery Telegram stays with the existing GEN2 incident system; no duplicate incident sender is installed.

Existing GEN2 notifications remain owned by GEN2. Configuration/sender names only: machine-root `data/autoscan/settings.json`, `data/autoscan/telegram-token.bin`; application `engine/telegram.mjs`, `engine/earnapp-monitor.mjs`, `engine/earnapp-incidents.mjs`, `engine/earnapp-alerts.mjs`. Existing incident/outbox state is not read for sending or modified by this bridge. No Telegram secret or chat ID is needed for cache ingestion.
