# GEN2 3.1.18 native-monitor canary source package

**Code/test milestone only — NOT installed, NOT M1 accepted.** No commit, production restart, VM action, remote command, token, settings or AE change was performed. All new deliverables are in this directory. Read-only source retrieval used pinned SSH/SFTP and the existing DPAPI helper; no secret was printed. Installed GEN2/AE identities supplied by the owner are context, not newly measured runtime results.

Initial deployment is blocked: see [DEPLOYMENT-BLOCKER.md](DEPLOYMENT-BLOCKER.md) for the subsequent live readback, exact updater/CLI limitations and bounded ingress prerequisites. **M1 cannot be accepted; M2 must not begin.** Independent web deployment/source handoff does not establish native canary acceptance.

## Build and verification

From this directory, using local Node 22.13+ and Python 3:

```
python fetch-source.py
node verify.mjs
```

`fetch-source.py` copies exact SHA-256-pinned fixtures from the existing repository staging area. If absent, `python fetch-source.py --sftp` retrieves only manifest-listed source through the existing pinned backup SSH connection, using SFTP only. A mismatch stops. It never invokes the backup helper's remote-command `connect()` routine. `base-sha256.json` pins original main, replacement-module bases, dependency/test fixtures and the original 3.1.18 package metadata. `build-replacement.py` deterministically derives the four existing-module replacements; it is optional when using the included replacement sources. `transform-main.mjs` checks the exact original main bytes and each unique anchor; rerunning on patched main fails closed. `build.mjs` writes only this package's ignored `output/` (main plus nine engine modules), never an app installation.

`base/`, `.work/` and `output/` are ignored and excluded from source handoff. Neither downloaded 544 KB main nor unchanged dependencies belong in the handoff. Source is uncommitted as requested.

## Opt-in and one collector

Keep existing settings unchanged. At a later installation, both the normal monitor-enabled setting and explicit environment gates must allow the native collector:

- `GEN2_NATIVE_MONITOR_CANARY=1` on the selected collecting process.
- `GEN2_NATIVE_MONITOR_CANARY_ALLOWLIST`: a JSON array of explicitly selected GEN2 server UUIDs, maximum 100; invalid/missing/duplicate entries fail closed. No host/project/web IDs are hardcoded in product modules or main transform.
- `GEN2_NATIVE_MONITOR_RECEIVE_CANARY=1` on Central, with the same source UUID allowlist, permits received source persistence. This gate does not enable Central's own guest collector.

The existing `syncEarnAppMonitor` constructs exactly one monitor. Default/off remains the existing 120-second behavior. Canary v1 uses 600-second per-VM due times, first pass before bounded rechecks, one guest slot, 30-second recheck, startup grace 120 seconds, and no 50% rest after a late probe. The monitor retains its existing guard/hold/keep-off/pause, incident and notifier dependencies. A retirement barrier prevents a replacement collector starting while the old guest/proxy lanes are still draining. Independent 60-second inventory uses one fixed native `VBoxManage list vms -l` call for all VM states; unreadable inventory never manufactures OFF.

The canary helper call reuses `awaitGuestReady` and `readGuestHelperCore --core-only`. It accepts only an existing content-addressed GenProbe whose SHA-256 matches the already-present HOST helper binary. Its fixed certutil hash read does not copy/upgrade a helper. Missing/mismatched helper stays unknown. No UIA, OCR, money scan, guest PowerShell, helper binary build, new port or per-VM process service is introduced. Normal helper users retain their original copy/verification and two-attempt behavior.

## Guest deadline safety

A 45-second verdict deadline does not release the underlying promise. The opt-in VBox wrapper also waits for HOST child close after timeout; default callers retain their old behavior. **HOST close is not proof of GUEST GenProbe exit.** Any guestcontrol timeout marks a canary-only transport latch, suppressing even readiness/internal retries; the canary helper itself uses one attempt. Timeout, cancellation or unverified exception quarantines the guest lane. Inventory and HOST proxy work continue.

Before a guest probe, the source file must durably record `guestSlot.state=RUNNING`; failure prevents the probe. Clean completion writes IDLE. Uncertain completion writes QUARANTINED; a prior RUNNING/QUARANTINED/unreadable source file quarantines a restarted collector too. There is intentionally no automatic clearing or claimed cleanup proof. A later product/operator reconciliation must prove the old guest child gone before releasing quarantine. No VM/guest kill or cleanup operation was added.

## Fixed source paths and transport

Resolve `MACHINE_DATA_DIR` from the installed GEN2 process, not from a guessed folder:

- Agent own: `MACHINE_DATA_DIR/native-monitor/latest.json`.
- Central received: `MACHINE_DATA_DIR/native-monitor/inbox/{GEN2serverUUID}.json`.

Each is a bounded atomic latest JSON file (<=1 MiB, <=1000 samples; temporary file removed/renamed). No accumulating journal. Agent envelope fields: `schema`, `source:AGENT`, `serverUuid`, `instanceUuid`, `startedAt`, `seq`, `configVersion`, `observedAt`, `sourceAt`, fresh reported-coverage `counts`, `policy`, `guestSlot`, `inventoryAt`, `inventoryReason`, `samples`. Instance/writer survives monitor enable/disable within the same process; sequence advances only after successful persistence. Real instance restart is distinct. `sourceAt` equals source `observedAt`, never filesystem mtime. Every sample has actual inventory `vmCode` matching `/^[A-Za-z0-9_.-]{1,40}$/`, `machineUuid`, enclosing `observedAt`, closed web-compatible `monitor` axes and explicit `unknowns`. Axis timestamps remain their original capture times when newer inventory arrives. No raw guest output, credentials, SDK code or money is serialized.

The source rides **existing Agent heartbeat `health.nativeMonitorV1`**, alongside the compact `health.earnapp`; it does not pass through the eight-canary-row EarnApp summary. The changed `fleet-health.mjs` validates this field on Agent and Central. Existing `cluster-protocol` HEARTBEAT already accepts health; existing framing is capped at 8 MiB, above the native 1 MiB cap. No protocol version, port or updater changed. The authenticated Central HEARTBEAT event reads the registry's revalidated snapshot and persists it under the authenticated server UUID, preserving source identity/time/sequence and adding only `receivedAt`. Same-sequence exact replay leaves the file and receipt time unchanged; conflicts/regressions/future source time are refused. A transport ACK is not web/Telegram storage proof. Central's own web delivery heartbeat remains separate; no AGENT heartbeat is synthesized from Central uptime or cache mtime.

Bridge must bind actual `vmCode` + source `serverUuid` + `machineUuid` to the existing web target/current cycle/revision capture. It must resolve web IDs, expected cycle/revision and current configuration itself. This package neither creates servers nor embeds those IDs.

## Proxy evidence

The fixed reader reuses only `parseProxyExtradata` plus native `getextradata <exact UUID> enumerate`. It never calls the whole blacklist/EarnApp check_ip flow or registry credential lookup. Invalid/ambiguous/multiple proxy-key sets stay unverified. Actual `ProxyForce` host/port/protocol and credentials remain in memory for the existing `httpsGetThroughProxy` transport; at most two independent checks, 8-second whole-lane deadline including route reads. Unsettled calls retain slots after deadline; stop aborts and waits. The route is read again after a check; changed binding invalidates the result. Socket results are bounded to 4096 bytes and discarded after normalization.

`proxyEvidence.proxyAddressFingerprint = SHA256(host.trim().toLowerCase() + "|" + decimalPort)` (UTF-8, lowercase hexadecimal). Protocol/credentials are deliberately absent from this address identity. A private in-memory route revision detects credential/configuration changes but is not serialized. No invented web endpoint/configuration ID is emitted. Bridge may map a matching trusted expected address to the web endpoint, sending `appliedConfigurationId:null`. It must omit proxy on mismatch/unproven mapping. HOST HTTPS success stays HOST evidence, with TCP/auth UNKNOWN when the existing aggregate transport supplies no stage-specific proof. AUTH_FAILED, timeout, 403/429 and endpoint errors never set BLOCKED.

## What this can and cannot prove

| Evidence | Package capability | Live canary proof here |
|---|---|---|
| All managed VM states | Native batch inventory; original UUID/name/time | None: no live reads/scans run |
| EarnApp / SDK processes and TCP | Existing verified core evidence; zero TCP never SDK-dead or earning | None |
| Actual applied proxy address | Exact UUID HOST extradata + canonical address fingerprint | None |
| HTTPS via that proxy | Existing transport, HOST provenance, bounded slots/deadline | Fixture + local HTTP407 transport test only |
| NCSI/time, service state, GUEST HTTPS/applied route | Native core lacks a verified field contract; explicit UNKNOWN | Cannot prove |
| Host-wide network outage | Suppression tested with injected independent HOST evidence; no live host-network reader is bound by main | Cannot diagnose a real host outage here; inconclusive proxy errors remain UNKNOWN |
| Money / earning | No core money; no earning inference | Cannot prove |
| Agent to Central delivery | Existing source channel wired and exercised through actual sanitizers/codec/authenticated controller/persistence in a 91-row harness | No real TLS/host delivery or web/Telegram acceptance |
| CPU/RAM, handles, sockets, p95/p99, 24–48h growth | Live measurement still required via canary controller/existing host telemetry | Not measured; no resource-pass claim |

Existing native core contains a generic network object, but its parser does not establish reliable NCSI/service/GUEST HTTPS/applied-route evidence. An extended native helper would be a later separately controlled binary/build rollout, not silently copied to production VMs by this package.

## Installation prerequisites / rollback (later, not performed)

1. Verify the exact pinned GEN2 source/runtime compatibility on the chosen collecting host and Central. Preserve their original complete installations and current source snapshots; overlay only the generated replacements after review. No AE downgrade/change (owner reports Moon05 AE 39.3.2.0, protocol 2, financial false).
2. Confirm the existing native helper binary/hash and already-installed content-addressed guest helper. Missing helpers must remain UNKNOWN; this package does not provision them.
3. Supply explicit native environment flags/allowlist and separately configure the existing backend enrollment/bridge mapping from the web contract. Check the actual runtime `MACHINE_DATA_DIR` paths and source clocks.
4. Have the canary controller capture process-local CPU/memory/uptime baseline before enabling native lanes, periodic bounded samples and guest/proxy in-flight counts, probe p95/p99 and coverage, existing engine count and delivery timestamps. Use existing host telemetry; no guest PowerShell/new process. Measure real before/after CPU/RAM rather than treating synthetic legacy test output as production evidence.
5. Validate a full read-only canary round, real source delivery and stale/gap/cleanup behavior. NCSI/service/GUEST HTTPS/earning remain UNKNOWN. This milestone does not accept M1 or authorize fleet rollout.

Rollback: stop the canary collector with cleanup/quarantine respected, remove explicit native gates and restore the exact backed-up files. Preserve source timestamps and uncertain guest-slot state for reconciliation. Do not clear quarantine, change VM/proxy/business records, restore database data or alter AE. Normal monitor settings are untouched by the package.
