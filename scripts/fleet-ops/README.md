# fleet-ops — Central worker for the web's fleet commands (28/10/2026)

Runs on Central (moon1, user meo3). Polls `POST /api/ops/v1/fleet-commands/claim` for each enrolled server, executes the
claimed command with the INSTALLED AE client (`Desktop\Claude Fleet\ae.ps1 -Host <alias>`, protocol 2) and reports verified
evidence with `complete`. It replaces nothing: GEN2 monitoring and the GEN2-dashboard publisher keep running unchanged.
The older `scripts/fleet-control` worker (AE 39.3.6 native-authorization contract) stays dormant.

| web action | AE path | verified when |
|---|---|---|
| START_VM | `vm-start-headless -Vm -Uuid` | vm-info RUNNING |
| SHUTDOWN_VM / POWER_OFF_VM | `vm-shutdown` / `vm-power-off -Uuid -Set reason` | vm-info POWERED_OFF |
| CHECK_HEALTH | `vm-info` | state known |
| CHECK_PROXY | `check-ip`, fallback `proxy-pool -Vms` when AE has no EarnApp account | IP_OK / IP_ISSUES / PROXY_POOL |
| REPLACE_PROXY | web job PROXY_APPLY → `proxy-credentials` → `inbox-put` → `proxy-draft-import` (one line, this VM) → `proxy-replace-preview -Vms` (must name only this VM) → `proxy-replace` → web `finish-proxy OK` | REPLACED + RUNNING |
| RECREATE_VM | `vm-recreate-preview` → `vm-recreate planToken+confirm` → `vm-info` (new UUID) → web `vms/{id}/recreated` → SDK read → `sdk-observations` | RECREATED + new UUID |
| READ_SDK | Central helper `mth-machine-read.ps1 -Mode Sdk` (full code, ACL capture) → web `sdk-observations` | DONE + tail |

Rules: never a force stop; AE request ids are `mth-<operationId>-<step>` so a lost answer is re-read (`result -Request`) and never
re-issued; any uncertainty → `UNKNOWN` (unverified) and reconciliation on a later claim; proxy credentials exist only in the AE
inbox file (wiped by AE) and the full SDK code only in the web request; evidence messages are scrubbed.

## Files
- `config.json` (`~/.mth/fleet-ops/config.json`): `{"version":1,"baseUrl":"https://wow.lalamail.sbs/api/ops/v1","pollMs":15000,"proxyKind":"SOCKS5","servers":[{"projectId":"…","serverId":"…","serverUuid":"<GEN2 server-id>","hostAlias":"moon-02"}]}`
- secret: the publisher's `~/.mth/wow-ops-secret.json` (`{"token":"…"}`, scopes READ + VM_OPS + PROXY_CREDENTIALS; user with ASSIGN and VM_PROXY_FOR_OPS).
- journal: `~/.mth/fleet-ops/journal` (same record format as fleet-control).
- run: `node scripts/fleet-ops/run.mjs --config <file> [--once]`.

Web side: `.env` `FLEET_CONTROL_M1_READY=1` and `FLEET_CONTROL_SERVERS=[{"projectId","serverId","serverUuid"}]` (server-level
enrollment; the VM identity comes from the web row: `UUID máy`, round, revision, configuration, no active VM job).

Tests: `node --test scripts/fleet-ops/test/worker.node.mjs` (fake AE + fake API; 10 cases).
