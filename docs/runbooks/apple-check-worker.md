# Apple check worker (Central)

Standalone Node 22+ package: `scripts/apple-check-worker/`. It calls only dedicated Bearer POST `/api/apple-check/v1/{action}`. It does not operate VMs, EarnApp, account inventory allocation, OTP links, or shared browser services. The web remains authoritative.

## Handoff and configuration

The parent owns Central inspection, private token transfer, installation, scheduling, deployment and any real canary. The owner has subsequently authorized the parent to select **one random eligible unassigned, never-used ACTIVE Apple account and one eligible NEW SELF proxy** on MoneyToHome for a canary. This package's tests use fake transport/browser and temporary files; no real account check has been run by this implementer.

Verified inventory supplied by parent: Central `WIN-6CA4QAGDD2F`, interactive user `win-6ca4qagdd2f\meo3`, RDP session 2. AVC manifest Version 2.3.800 identifies Chromium 150.0.7871.114.6; `runtime.version` is stale. Executable:

```text
C:\Program Files\AVC\CloakBrowser\.cache\chromium-150.0.7871.114.6-pro\chrome.exe
```

Reuse that executable only. Do not use the existing Python Apple/EarnApp flows, mutate the shared runtime, install another browser, run a browser download command, or install global dependencies. Parent may ship its inspected `playwright-core` package (local candidate version 1.64.1) into the dedicated worker dependency directory. Compatibility with this Cloak executable still needs a synthetic local-browser check/canary; an existing executable is not proof of compatibility.

Resolve the Desktop through Windows, never infer it from the username. On the verified Central machine the `meo3` account resolves Desktop to the existing shared Administrator Desktop. The deployed dedicated root is:

```text
C:\Users\Administrator\Desktop\MoneyToHome\AppleCheckWorker
```

`config.example.json` contains the complete schema. `baseUrl` must be an HTTPS origin with no path, query, userinfo or fragment. `tokenFile`, `executablePath`, and `modulePath` must be absolute file paths. `modulePath` points to the dedicated `playwright-core/index.mjs`, not its directory. No token/password/email may be passed as CLI arguments or embedded into config. `tokenFile` initially belongs under `<root>\private\`.

```json
{
  "baseUrl": "https://wow.lalamail.sbs",
  "tokenFile": "C:/Users/Administrator/Desktop/MoneyToHome/AppleCheckWorker/private/worker-token.txt",
  "executablePath": "C:/Program Files/AVC/CloakBrowser/.cache/chromium-150.0.7871.114.6-pro/chrome.exe",
  "modulePath": "C:/Users/Administrator/Desktop/MoneyToHome/AppleCheckWorker/dependencies/playwright-core/index.mjs",
  "minFreeMemoryMb": 2048,
  "heartbeatMs": 10000,
  "pollMs": 15000,
  "jobTimeoutMs": 180000
}
```

The source config can be kept in meo3's dedicated AppData folder and supplied to `install --config`; install copies nonsecret config into `<root>\config.json`. Parent transfers the token directly into the private token file after install sets and verifies ACLs. No token in chat, logs, shell history or handoff archives. Run under the same user that owns the files.

Ranges: heartbeat 1–20 s (default 10 s), polls 1–60 s (default 15 s), job timeout 1–180 s (default 180 s), RAM threshold at least 512 MiB (default 2048 MiB). Backend lease 90 s; hard deadline 180 s. A durable claim attempt's start time conservatively bounds the local hard deadline even after claim replay.

## Install and operate

Run these in the **meo3 interactive session** using the parent-selected Node executable and source path. Examples use `node` only as an abbreviation for that verified executable. No command below contains a token.

```powershell
$workerRoot = 'C:\Users\meo3\Desktop\MoneyToHome\apple-check-worker'
$workerSource = 'C:\Users\meo3\Desktop\MoneyToHome\apple-check-worker-source'
$workerConfig = 'C:\Users\meo3\AppData\Local\MoneyToHome\apple-check-worker\config.json'
node "$workerSource\worker.mjs" version
node "$workerSource\worker.mjs" install --root $workerRoot --config $workerConfig
```

Install writes only its dedicated root, restricts its DACL to the current user and SYSTEM, verifies it, and stages an immutable hashed release under `releases\<version>`. It preserves existing config, private files and state. A nonempty unrelated destination is refused. It will not activate a release while a worker lock/launcher exists. Install does not receive a token or register a Windows task.

Parent now privately copies the inspected Playwright package to `<root>\dependencies\playwright-core\` and transfers the dedicated token file. Keep the dependency and token under inherited private ACLs; do not copy explicit public ACLs. For a first controlled single-account canary, use `once`; it can claim any queued check, so the parent must control the queue first.

```powershell
$workerEntry = "$workerRoot\releases\1.0.0\worker.mjs"
node $workerEntry status --root $workerRoot
node $workerEntry once --root $workerRoot
node $workerEntry loop --root $workerRoot
```

`loop` stays in the foreground and owns one exclusive lock across polls; `Ctrl+C` requests cancellation and owned cleanup. `once` processes at most one job or one pending replay. No automatic retry of account credential delivery or login. `start` launches a detached hidden `loop` in the caller's session; it does not log on a user or bridge an SSH/service session to an interactive desktop.

```powershell
node $workerEntry start --root $workerRoot
node $workerEntry status --root $workerRoot
node $workerEntry stop --root $workerRoot
```

`stop` is cooperative: writes `state\stop.json`, observed within roughly 500 ms; in-flight cleanup remains bounded by the browser close timeout. Wait for the lock to disappear and check status before update/rollback. Do not force-kill a shared browser or use taskkill by executable name. A task scheduled by the parent must run only in meo3's interactive session. Starting from SSH may report WAITING_DESKTOP indefinitely; scheduling is the parent's responsibility.

Desktop gating is read-only: Windows current process session must be active (WTS state Active) and the input desktop must be Default; locked, disconnected, session 0 and probe errors wait. Available physical memory must exceed the configured threshold. No VM actions are used to free memory. Gate applies before new claims; pending result/cleanup recovery remains possible without logging in again.

## Protocol, durability and recovery

Actions: `heartbeat`, `claim`, `route`, `submit`, `heartbeat-job`, `result`, `cleanup-recovered`. Strict HTTPS origin/action construction, POST JSON, fixed Bearer header, no redirects, bounded transport/body timeout, generic error messages. Browser interception fetches with `maxRedirects:0`, aborts every 3xx, and fulfills nonredirect responses; it never uses `route.continue()` to let credential redirects escape interception. No ops API and no PIN.

1. Before `claim {key}`, atomically write a fresh random key in `state\claim-inflight.json` and flush it. Lost claim responses retry **the same key** across restarts, before ordinary heartbeat/desktop/new-work gates. A disabled worker may replay only its existing bound key through cleanup-only backend authorization; it cannot create a new claim. Recovered jobs go directly to UNKNOWN and verified cleanup, never login. Confirmed `job:null` clears the key. Backend deterministic claim replay must retain the key binding; do not reissue a different key after an ambiguous claim.
2. Persist the returned raw claim identity/lease capability before profile creation, route or submit, then write `state\pending.json`. Raw lease tokens are non-account capabilities permitted by the parent for durable recovery; treat these private files as sensitive and never print/archive them. No account email/password, proxy credentials, cookies, OTP URL, HTML, screenshot or free text evidence is journaled.

If a crash leaves both journals, recovery first verifies matching job ID, lease capability and saved account identity/revision, then removes the redundant claim journal **before** reporting the pending result. A mismatch preserves both journals and any existing quarantine, raises `JOURNAL_IDENTITY_MISMATCH`, and performs no API/browser work. This prevents a stale claim from resurrecting an acknowledged terminal job with a different report timestamp.
3. Get proxy route credentials into memory only. Launch one isolated owned profile; every browser request uses that proxy. No direct fallback, extra anti-detect layer, service workers, WebSockets or downloads. Probe the official `https://account.apple.com/sign-in` in the same context, waiting for its official iframe controls. A visible preflight challenge reports CHALLENGE_REQUIRED without API submit or account-secret delivery (backend must permit this result before submittedAt).
4. Local durable SUBMITTING precedes the one API `submit` call. The backend atomically checkpoints before delivering email/password. Never retry that endpoint, including lost responses. Only one password-bearing browser submit is allowed. A crash/uncertain delivery yields UNKNOWN; restart does not resume authentication.
5. Heartbeat-job renews the 90-second lease within the 180-second hard deadline. Heartbeats recheck desktop/RAM and abort browser work on a failed gate. Cancel/revoke/lease failures abort browser work; owned close, verified process exit and cleanup still run. Results remain reportable even while disabled. Result `reasonCode` equals the result enum; `observedAt` is an ISO Zulu timestamp. Preserve exactly the same result payload/time on retries.
6. Authentication result and cleanup are independent. Failed close or owned-tree deletion produces cleanup FAILED, persists `state\quarantine.json`, and blocks claims. A successful authentication result is retained even when cleanup fails.

Interrupted nonterminal local journals produce UNKNOWN. Cleanup is OK only after verified absence of an owned browser and successful owned-marker tree cleanup; uncertain/running processes or deletion failures produce FAILED and quarantine. No foreign browser is closed. `recoveryOnly:true` claim replay likewise never calls route/submit or authenticates. The parent must review recovery metadata for a previously DONE/FAILED job: a new UNKNOWN payload must not overwrite a stored terminal result. If replay is rejected, keep the pending record; never discard it or invent a new login.

Cleanup first closes the owned browser and verifies process exit by the actual supported `chrome.exe` name and owned profile command line. Config refuses renamed executables; an uninspectable chrome command line means unresolved cleanup, including browsers in other sessions. No profile deletion happens without proof. File cleanup uses exact UUID child paths, a matching owner marker retained through partial failures, full-tree symlink/reparse-point preflight, ancestor checks, and individual unlink/rmdir calls. It never recursively deletes a computed tree, traverses a symlink, or takes ownership of foreign files. Root ACLs must propagate both object/container inheritance; effective token/config/state/private/profile ACLs are checked, including explicit public child ACEs. An adversarial same-user administrator can still race filesystem checks; the private ACL boundary and dedicated directory are required. Do not share this directory with another application.

For a dead worker lock, first inspect the exact process/profile. `recover-lock` refuses a live PID and any running Chromium command line belonging to this dedicated profiles root. It does not kill processes. If an orphan browser is present, the parent must verify and close that exact owned instance before recovering the lock; never terminate unrelated AVC browsers.

```powershell
node $workerEntry recover-lock --root $workerRoot
node $workerEntry once --root $workerRoot
node $workerEntry cleanup-recovered --root $workerRoot
```

`once` first replays any stored terminal result (or converts an interrupted submission to UNKNOWN/FAILED), even if worker token disablement forbids new work. `cleanup-recovered` requires the pending report acknowledged first, verifies no owned browser remains, performs verified owned cleanup, then posts only `{jobId,leaseToken}`. An acknowledgement loss retains quarantine so recovery can be retried idempotently. It never repeats authentication. Do not manually clear quarantine, pending records or claim keys as a way to unblock work.

## Update and rollback

Stop and verify unlock. Install a new package version into the **same root**; private config/state/dependencies remain. Source files are SHA-256 listed in the release manifest and checked before `start`; an installed version with different bytes is refused. Bump the package version to change an installed release.

```powershell
node $workerEntry stop --root $workerRoot
node $workerEntry status --root $workerRoot
# Install the inspected new package version with its worker.mjs install command.
node $workerEntry rollback --root $workerRoot
node $workerEntry status --root $workerRoot
```

Rollback swaps `active.json` to the previous verified release; it does not undo server account health, repeat a check, delete journals, reset leases, or change the shared runtime. Use `start` through an available entry to run the release selected by active.json. If directly running `once`/`loop`, choose the entry matching the reported active version. Failed cleanup or pending reports must be resolved under the same private state before attempting another login.

## Verification and present limits

```powershell
Set-Location '<source>\scripts\apple-check-worker'
npm test
node worker.mjs version
```

Tests use `*.node-test.mjs` to avoid Vitest's discovery. They cover strict HTTP actions/origin/redirect/timeout, private minimal journals and claim replay, no repeated submit, authenticated matching identity, cancellation/lease errors, cleanup quarantine/recovery, symlink/ownership boundaries, RAM/desktop policy, immutable version install/rollback and CLI redaction. API/browser are fake; native Windows desktop probing and actual process inspection still require verification in the Central session. No video.

Parent anonymously inspected official Apple sign-in: iframe `#aid-auth-widget-iFrame`, child `https://idmsa.apple.com/appleauth/auth/authorize/signin?...`, account/password fields `#account_name_text_field` / `#password_text_field`, button `#sign-in`. These login IDs are verified; runtime waits for the visible login field/challenge before secret delivery. Anonymous page also contains a commerce iframe titled Signout: **that iframe is never authentication proof**.

Success uses source-verified official markup, **not yet verified by a real authenticated canary**. The parent inspected Apple's primary public bundles [home-Bw-5G2lu.js](https://appleid.cdn-apple.com/static/module-assets/home-Bw-5G2lu.js) and [WebApp-DAWtHp_C.js](https://appleid.cdn-apple.com/static/module-assets/WebApp-DAWtHp_C.js), saved locally as `.runtime/apple-public-assets/4.js` and `5.js`. The adapter requires ALL of:

- Official `https://account.apple.com/account/manage...` page URL.
- An observed existing same-context GET to **exactly** `https://account.apple.com/account/manage` (no query), HTTP 200 JSON, whose `account.person.formattedAccountName` matches the expected email.
- A visible link/button with class `ac-localnav-action` and exact en-US title or text `Sign Out` in the official account page.
- A visible `[class*="formatted-account-name"]` element containing that exact email, compared case-insensitively after trimming.

No extra manage request is issued. Only the extracted identity string stays in memory; the full JSON/API keys are never stored or logged. Synthetic success test-ID assumptions are removed. Missing/wrong response identity, missing visible account name/signout, anonymous commerce Signout iframe, unexpected markup, and unsupported flows remain UNKNOWN. The worker separately requires authenticated=true and matching identity before accepting an adapter's LOGIN_SUCCESS result. A real successful canary is still required to validate this source-based conjunction end-to-end.

Browser requests en-US; explicit security-locked messages are allowlisted using [Apple's guidance](https://support.apple.com/en-us/102640). Other languages or unknown messages remain UNKNOWN. Media & Purchases disablement alone does not mark the Apple account locked. CAPTCHA/OTP stops; no OTP links are retrieved and no challenge bypass is attempted.

Implementation/review record: `scripts/apple-check-worker/WORK-LOG.md`. No subagent dispatch tool was available; the requested skill's inline fallback was used. Independent parent review, Central browser compatibility, authenticated selector validation and real canary results are separate from these local test results.


## 1.1.0 — 25 October follow-up

The stock table now has a dedicated check-result column and a selected-account check action (maximum five per atomic request). The single Central worker processes its queue sequentially. LIVE_2FA means only that an official visible OTP field appeared after the password-submit step, according to the owner's operational definition; it does not mean a fully authenticated Apple or EarnApp session. No OTP is retrieved or entered. CAPTCHA is never Live, and explicit locked/invalid-credential alerts take precedence over a remaining OTP field. LIVE_2FA never resets an existing locked account's health.

UNKNOWN now carries only bounded diagnostic codes for email/password form or submit controls missing, credential delivery failure, email entry failure, password submit failure, response read failure, unrecognized response or interruption. No raw DOM, exception text, email, password or link is persisted. Releases remain immutable; install 1.1.0 after a graceful stop and keep 1.0.0 for rollback. Token/configuration stay unchanged.


## 1.2.0 - concurrent slots and current Apple Continue flow

Owner chose up to five concurrent browser sessions. One global supervisor owns the Windows task; five bounded slot stores under state/slots/slot1..5 have independent journals, claim keys, profile UUIDs and browser cleanup. The API binds each claim to slot1..5 (old omitted slots mean1), and every simultaneous check has an exclusive randomly selected eligible proxy. New additive claimSlot column preserves replay slot identity after cleanup. Existing worker token/configuration stay unchanged; maxSlots defaults to5.

Before new admissions, recover root legacy and all five slot journals. Unacknowledged results keep admissions blocked, no repeated login. A quarantined slot blocks fresh work while peers still recover. Stop drains all sessions; restart recovers exact reports. Rollback to an older release refuses unresolved slot journals. Admission reserves memory conservatively; low free RAM prevents more launches, and desktop/session loss stops active sessions. Idle polling is bounded to15seconds.

Apple currently renders a visible password input while its button still says Continue. Submit must explicitly advance Continue and wait for Sign In before filling/submitting password once. The official widget's #errMsg and #alertInfo are read in addition to role=alert. Loading/unknown labels do not count as password phase.

Every completed check closes its browser, verifies no owned browser remains, and removes its UUID profile before reporting. This applies equally to Live, Locked, invalid credentials and UNKNOWN. A result pending acknowledgement retains only the minimal command journal, not the profile/cache. Cleanup failure retains ownership proof/quarantine until explicit safe cleanup recovery; never delete an unverified or unrelated browser profile.

Native Central proof used five isolated about:blank Cloak sessions with an unreachable proxy, no account credential reads and no external site. All five browser fingerprint samples differed (canvas/GPU/CPU sample hash); all five profiles were cleaned. They still run on one physical Central, not five physical hosts. The bundled Cloak engine generated those identities with existing defaults; no global browser or AE/GEN2 fingerprint configuration was changed.


## 1.2.2 - failure cleanup and bounded diagnostics

Failed browser launch/close now falls back to terminating only the verified UUID-profile Chrome process tree: owner marker, exact user-data-dir argument, Chrome-only descendants, opened process handle and creation/ancestry revalidation. It never kills unrelated or identity-ambiguous processes. Cleanup remains quarantined if proof/termination fails. The browser gets a60-second startup budget within the existing180-second job limit; page operations remain20seconds. Browser startup failure is UNKNOWN/BROWSER_INTERRUPTED rather than a false proxy diagnosis.

On UNKNOWN, one small last-diagnostic.json per slot stores only bounded enum/boolean/counter metadata (form phase, input kinds, auth HTTP status, blocked request counters). No raw URLs, DOM, response body, email or password. Diagnostic collection is bounded to2seconds and cannot hold cleanup indefinitely. This is independent of the user-visible result.

Actual follow-up: one original selected account remained UNKNOWN; another attempt failed before credential delivery and left an owned Chrome tree. Parent stopped only the verified owned tree, removed its profile, and acknowledged cleanup recovery; zero profiles/quarantines verified. A third original selected account is queued for final diagnostics, but the current interactive-desktop gate reports WAITING_DESKTOP; no secret delivered for that queued job. Do not claim real login/Locked/2FA recognition verified.
