# Check Apple ID — approved owner brief

Owner approved building the full prompt in this conversation on 25 October 2026. Web stays the system of record at https://wow.lalamail.sbs; worker runs on Central moon-01. During implementation owner explicitly authorized selecting a random unassigned unused ACTIVE Apple ID and eligible proxy from MoneyToHome for exactly one real canary. No VM operations, account replacement, CAPTCHA/OTP bypass or video.

## Behavior
Single-account Check Apple ID from stock, durable per-account active deduplication and request-key replay. Explicit Apple locked result sets APPLE_LOCKED, preventing new allocation through existing ACTIVE-only shared allocators; never alter VM/EarnApp links. Login success never means EarnApp success or clears account health. Challenge stops. Stale account revisions retain historical result only. Cooldown and submission checkpoint prevent repeated login after worker crash.

## Architecture and decisions
Reuse Prisma/Postgres, protected tRPC, account stock page, existing encryption, current member/server scope. Dedicated worker token stored hashed, tied to project and creating ADMIN; no existing AI tokens changed. ADMIN selects a dedicated existing ProxyGroup. Eligibility is same project, self-owned unused NEW, not replaced/archived/held/assigned; exclusive check lease separate from VM assignments. No eligible proxy means waiting. Only current leased job can get its account password/proxy once after route probe, with a durable SUBMITTING checkpoint before secret response. Restart of SUBMITTING becomes UNKNOWN, not resubmission. Secret delivery loss is conservative UNKNOWN. Worker cancellation/revocation always cleans owned browser; no new secrets or work.

Three independent outcomes: job phase, authentication result, cleanup result. Cleanup failure quarantines worker. Browser adapter must validate official Apple origins, never retrieve OTP links, use isolated per-job directory, proxy for every browser request, no direct fallback. Strict allowlisted evidence codes rendered server-side; no free text worker evidence. Worker local pending journal contains job identity/result only.

## API contract
Human router `appleCheck`:
- overview({projectId}) => {canManage, canCheck, groups:[{id,name}], worker:null|{id,name,enabled,online,state,proxyGroupId,lastSeenAt}, jobs:[public job]}; no secret.
- configure({projectId,name,proxyGroupId}) => {workerId,token} returned once to ADMIN; rotation revokes old token, active jobs must resolve safely.
- request({projectId,accountId,expectedRevision,key}) => public job.
- cancel({projectId,jobId}) => public job.
- disable({projectId}) => void.

Worker endpoint POST `/api/apple-check/v1/[action]` Bearer dedicated worker token, strict JSON envelope `{ok,data,error}`:
- heartbeat {state: IDLE|BUSY|WAITING_DESKTOP|WAITING_RESOURCES|CLEANUP_FAILED} => {workerId,enabled}
- claim {} => {job:null|{id,leaseToken,accountId,accountRevision,expiresAt}}. No secrets.
- route {jobId,leaseToken} => {proxy:{server,username,password}}; current job only, no account secret.
- submit {jobId,leaseToken} => {email,password}; atomically checkpoint SUBMITTING, no replay of secrets.
- heartbeat-job {jobId,leaseToken} => {cancelRequested:boolean}; lease extension only before hard deadline, never lets another worker resume submission.
- result {jobId,leaseToken,result,reasonCode,cleanup:OK|FAILED,observedAt} => public job; exact terminal replay accepted even if account revision changed; mismatched payload refused.
Results LOGIN_SUCCESS|APPLE_LOCKED|CHALLENGE_REQUIRED|INVALID_CREDENTIALS|PROXY_ERROR|NETWORK_ERROR|TIMEOUT|UNKNOWN|CANCELLED. Reason allowlist only. Public job {id,accountId,accountRevision,phase,result,reasonCode,cleanup,createdAt,observedAt,stale,cancelRequested}; no credentials.

## Verification
Test durable dedup, token/user disable/revoke, cross-project/server denial, account revision races, allocation after Locked, no VM changes, lease fencing, no repeat submission, late reporting and exact replay, cleanup quarantine. Worker tests fake transport/browser and real synthetic local browser where available. Real Apple canary deferred until owner selection. Deploy only after tests/build and backup; no real account auto-check during deployment.

## Implementation refinements
- Owner's random-pool authorization permits builtin TUT (SELF, NEW, unassigned, no holds/history conflicts) as an allowed check pool. Live has no custom groups; never create a false business group or move inventory merely for checking. The temporary exclusive reservation remains separate from all VM assignments. ADMIN may choose a custom group if it has eligible SELF endpoints.
- Claim requires a durable `{key}` persisted by worker before sending; deterministic token-bound HMAC lease supports exact claim replay after response loss. Replay after submission/expiry returns recoveryOnly, never credentials or permission to repeat login. Every accepted human key is persisted, including aliases resolving to an active job.
- `cleanup-recovered` reports verified cleanup after a recorded cleanup failure and releases account/worker/proxy reservations without repeating authentication.
- Real-canary authorization above supersedes the earlier defer-until-named wording; no batch expansion is authorized.
