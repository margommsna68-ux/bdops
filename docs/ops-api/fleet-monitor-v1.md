# Fleet monitor v1 — M1 web contract

Web implementation only; no deployment, live data writes, agent installation, AE changes or canary acceptance. Existing Moon05 (91 VMs) and Central are the selected canary; do not create business servers. Missing explicit VM UUID mappings remain Unknown. Financial permissions and the existing generic `/batch` limits are unchanged.

## Policy

`GET /api/ops/v1/monitor-policy?projectId=…` requires Bearer `VM_OPS` and current infrastructure rights. Returns the standard `{ok:true,data:{policy:…},error:null}` envelope. The versioned shared module is `src/lib/monitor-policy.ts`. Version 1 has:

| Field | Value |
| --- | ---: |
| version | 1 |
| inventorySeconds | 60 |
| guestSeconds / proxySeconds | 600 / 600 |
| healthStaleSeconds | 1200 |
| heartbeatSeconds / heartbeatStaleSeconds | 60 / 180 |
| startupGraceSeconds / recheckSeconds | 120 / 30 |
| guestTimeoutSeconds / inventoryTimeoutSeconds / proxyTimeoutSeconds | 45 / 15 / 8 |
| guestConcurrency / proxyConcurrency | 1 / 2 |
| retryLimit / retryBackoffSeconds | 1 / 30 |
| telemetryFlushSeconds / queueMaxItems | 30 / 1000 |
| logMaxBytes / logRetentionDays | 10485760 / 7 |
| moneySeconds | 86400 |

These are the collector contract, not a claim that web code enforces native scheduling or that the installed collector already supports it. Unknown versions are stored but shown Unsupported, never healthy. Health expires at age **>=1200 seconds**, heartbeat at **>=180 seconds**, independently of the existing 24-hour money freshness. Grace does not make missing evidence healthy.

## Authoritative enrollment and heartbeat

Deployment must explicitly configure `FLEET_MONITOR_CANARY` as a JSON array (max 100 entries):

```json
[
 {"projectId":"<existing project id>","serverId":"<existing Moon05 id>","source":"AGENT","serverUuid":"<enrolled Moon05 machine UUID>"},
 {"projectId":"<existing project id>","serverId":"<existing Moon05 id>","source":"CENTRAL","serverUuid":"<enrolled Central machine UUID>"}
]
```

Placeholders are documentation, not configuration. No environment file was changed. Missing/malformed enrollment fails closed for extended monitor writes and heartbeats; legacy scans still work. Source UUID is enrolled independently for each role. `serverId` is the web's existing managed server row, resolved in the current project and server permissions inside the transaction; a caller label cannot create or select another server. The CENTRAL row describes Central's delivery path for that server, not the server agent itself. Both roles require current `VM_OPS` token and current user/server rights, including replay. This trusts the authorized telemetry publisher and enrollment; it is not machine attestation.

`POST /api/ops/v1/servers/{id}/monitor-heartbeat` with Bearer and `Idempotency-Key`:

```json
{
 "projectId":"<project id>",
 "source":"AGENT",
 "serverUuid":"<enrolled machine UUID>",
 "instanceUuid":"<UUID generated once per source process start>",
 "startedAt":"2026-10-26T05:00:00.000Z",
 "seq":1,
 "configVersion":1,
 "observedAt":"2026-10-26T05:01:00.000Z",
 "counts":{"managed":91,"inventory":91,"guest":0,"proxy":0,"app":0}
}
```

Use `source:"CENTRAL"` and Central's own enrolled UUID/instance/timestamps for Central. Do not synthesize AGENT messages from Central cache mtime, connection booleans or file synchronization. Counts are **reported fresh observation coverage**, not successful checks or proof about individual VMs; all integers 0–100000, each axis <=managed. `seq` is 0–2147483647, increasing per instance. Rotate the instance UUID only on a genuine restart. `startedAt <= observedAt <= web receipt time` (synchronize source clocks). Config version is an integer 1–100000.

Success `data` (standard envelope):

```json
{"replay":false,"serverId":"<id>","source":"AGENT","seq":1,"observedAt":"2026-10-26T05:01:00.000Z","receivedAt":"2026-10-26T05:01:01.000Z","configVersion":1}
```

Only two current snapshot rows per server, one per source. The current row holds the complete request hash/key/actor and original receipt time. Exact current-key/body retry returns `replay:true` without refreshing time. Conflicting current key (including reuse across source/server rows) returns 409 `IDEMPOTENCY_CONFLICT`; non-increasing sequence, older observation, same-instance changed start, or new instance with non-later start returns 409 `REVISION_CONFLICT`. After a newer row supersedes a key, retries of the old sequence are conservatively refused; this is not an unbounded replay ledger. A restarted instance must also have non-older observedAt. Delayed stale first snapshots can be retained but never displayed fresh. Existing scan/business/audit retention is unchanged; normal API write audit still applies.

## Optional independent scan axes

`GET /gen2-targets` adds optional nullable `endpointId` (the desired configuration's endpoint) and `proxyAddressFingerprint`. For compatibility with the existing endpoint model, this is **ADDRESS ONLY**: lowercase hex SHA-256 of UTF-8 `${host.trim().toLowerCase()}|${port}`. Protocol is not stored on the web and is excluded; neither authentication nor configuration proof is asserted. It uses desired endpoint `host` and `port`; if host is missing, a recognized legacy bare host / host:port / host:port:user:pass address supplies only the host (a conflicting port is refused). Missing/invalid/ambiguous address or port returns null. No credential/snapshot column is selected or decrypted and `configurationHash` is never exposed. Bridge readers should preserve these fields optionally. Compare the native observed address fingerprint exactly before mapping an endpoint. Native physical HOST evidence may then use that endpoint with `appliedConfigurationId:null`. Set applied configuration only with independent full configuration proof, never web pointers alone. Without a fingerprint match omit the proxy axis. Test vector: `203.0.113.42|8080` -> `147f2af7c3fb829a1f6614db3bedeacee4a7fbb07819d3634f797942b57650d7`.

Existing `POST /vms/{id}/scan-observations` and generic `/batch` with `GEN2_SCAN` are reused. No second batch endpoint. Existing required fields are unchanged: `projectId`, `expectedCycle`, `expectedVmRevision`, `machineUuid`, `configurationId` (nullable), `observedAt`, `earning` (nullable boolean), `problem` (nullable existing enum). Optional existing `money` retains its existing financial checks. Append optional `monitor`:

Optional top-level **`earningObservedAt`** is the original ISO source timestamp for cached earning proof. It must be within the current VM/cycle/configuration barrier, <= enclosing `observedAt`, and not future. It is stored separately. The legacy earning/problem health clock (`readScanHealth.at`) uses `earningObservedAt ?? observedAt`; the native inventory clock and individual monitor axes remain independent. Example: fresh `observedAt` with a 21-minute-old `earningObservedAt` and `earning:true` yields fresh inventory but **Unknown earning**. Without valid original proof send `earning:null` and omit the timestamp. Native reports must send `problem:null` unless that problem was actually observed at the same source time; do not redate cached legacy problems to the native inventory time. If the problem and earning clocks differ, omit the problem (this M1 contract does not add an independent problem timestamp).

```json
{
 "configVersion":1,
 "vmState":{"observedAt":"2026-10-26T05:01:00.000Z","state":"RUNNING"},
 "guest":{"observedAt":"2026-10-26T05:00:30.000Z","additions":"PRESENT","response":"RESPONSIVE"},
 "network":{"observedAt":"2026-10-26T05:00:30.000Z","provenance":"GUEST","ncsi":"NONE","https":"OK"},
 "proxy":{"observedAt":"2026-10-26T05:00:30.000Z","provenance":"HOST","endpointId":"<assigned endpoint id>","appliedConfigurationId":null,"tcp":"OK","auth":"OK","https":"OK"},
 "app":{"observedAt":"2026-10-26T05:00:30.000Z","earnApp":"RUNNING","sdk":"RUNNING","connection":"NOT_OBSERVED"}
}
```

Omit any axis without evidence; do not send arbitrary error strings, URLs, commands or credentials. All objects are closed. Each supplied axis requires all its fields. Allowed enums:

| Field | Values |
| --- | --- |
| vmState.state | RUNNING, PAUSED, ABORTED, POWERED_OFF, STARTING, STOPPING, UNKNOWN |
| guest.additions | PRESENT, ABSENT, UNKNOWN |
| guest.response | RESPONSIVE, AUTH_FAILED, TIMEOUT, UNAVAILABLE, UNKNOWN |
| network/proxy.provenance | HOST, GUEST |
| network.ncsi | INTERNET, LIMITED, NONE, UNKNOWN |
| network.https / proxy.tcp / proxy.https | OK, FAILED, TIMEOUT, HTTP_403, HTTP_429, UNKNOWN |
| proxy.auth | OK, FAILED, NOT_TESTED, UNKNOWN |
| app.earnApp / app.sdk | RUNNING, STOPPED, UNKNOWN |
| app.connection | VERIFIED, NOT_OBSERVED, UNKNOWN |

`monitor.configVersion` integer 1–100000. IDs are 1–64 characters `[A-Za-z0-9_-]`. `proxy.appliedConfigurationId` is nullable. `monitor` observation time cannot be future; each axis time must be within the current VM/cycle/configuration period and <= enclosing scan `observedAt`. Every proxy axis must match the desired endpoint. A nonnull configuration must match desired; GUEST additionally must match installed. Null applied configuration never proves GUEST proxy success. Authentication failures/timeouts do not imply missing Guest Additions. HOST success does not imply GUEST success. NCSI does not replace HTTPS. HTTP 403/429/timeouts do not set proxy BLOCKED. Running/process/connection evidence never sets earning.

Events remain `VmOpsEvent.kind=GEN2_SCAN`, detail extended with `projectId`, authoritative `serverId`, `vmId`, `cycle`, `expectedVmRevision`, resulting `vmRevision`, `machineUuid`, `configurationId`, `observedAt`, legacy `at`, `receivedAt`, optional `earningObservedAt`, and optional `monitor`. No lifecycle/proxy/account/finance state is overwritten by health telemetry. Existing money payloads still go through the existing authorized money service.

VM inventory becomes stale at120seconds (two inventory intervals); guest/network/proxy/app evidence at1200seconds. Dashboard selects each axis by **source timestamp**, with current UUID/cycle/configuration/revision binding. Inventory-only reports do not refresh old guest/proxy evidence. Money reads retain their independent times and permissions. Legacy scans remain visible as legacy earning/problem evidence and never manufacture new axes or heartbeats.

Review corrections: earning/problem selection uses the original proof clock (`earningObservedAt ?? observedAt`) independently of the newest inventory envelope; null earning/problem reports are not new proof. A cached positive at 10:00 inside inventory at 10:06 cannot outrank negative/error proof at 10:04 inside inventory at 10:05. On equal proof clocks a negative/error wins over a conflicting positive. Each monitor axis still selects its own latest source time, and the displayed inventory observation/receipt remains the latest envelope's.

For explicitly enrolled canary project/server pairs, **GOOD also requires a fresh version-supported AGENT heartbeat** (age <180 seconds); Central contact cannot satisfy this gate. Heartbeats are loaded before health calculation, not merely attached afterward. Missing, stale or unsupported agent contact suppresses positive earning confirmation to Unknown. Nonenrolled legacy servers retain the old independent earning-evidence behavior. A fresh native state ABORTED, POWERED_OFF, PAUSED, STARTING or STOPPING also contradicts positive earning and prevents GOOD without modifying recorded lifecycle status. Stale native state is not treated as a current contradiction; RUNNING alone still does not prove earning.

## Conservative choices and limits

- Enrollment is explicit backend configuration rather than inferring machine identity from names/paths. Incorrect enrollment can reject valid canary traffic; correcting enrollment is an operator deployment step.
- Future heartbeat/extended observation timestamps are refused rather than tolerated into freshness; source clocks must be synchronized.
- Latest-row heartbeat replay is intentionally bounded; retain exact pending payloads and reconcile a 409 rather than renumbering an old observation.
- Unsupported policy data stays visible as Unsupported. Old agents continue the old API but their absent independent axes/heartbeats stay Unknown.
- Address-only proxy matching is deliberately weaker than full configuration matching: protocol/authentication/configuration must never be inferred from it. Implementation choice: exclude protocol because the existing web proxy model does not store it; this is not a new owner decision.
- Web observes and renders; native scheduling, timeout cleanup, resource use, true instance delivery and real Moon05 coverage require integration/canary measurement outside this web-only change.

Rollback: disable the canary enrollment and stop new publishers; revert web changes if needed. Leave the additive snapshot table in place. Do not remove historical events or reset any business table. No live migration was applied by this implementation.
