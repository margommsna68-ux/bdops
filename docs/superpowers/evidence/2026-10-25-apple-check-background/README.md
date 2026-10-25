# Apple-check background worker and login reporting

Owner chose background operation without an open/unlocked Windows desktop and asked to continue fixing Login and reporting to the web.

## Changes

- Worker 1.3.9, Central moon-01: explicit boolean headless configuration. Existing configurations default to visible mode. Browser launch, admission and active gates use the same mode; Windows and admission RAM checks remain.
- Dedicated Windows task now uses the same meo3 identity with native Password batch logon/Limited, Normal priority4 and an AtStartup trigger. The native scheduler manages its Windows credential; none is placed in worker files, arguments or logs. No autologin, system-wide UAC setting or AE/GEN2 change. Pre-change task/config backed up privately. Upgrade waits for both worker unlock and the old scheduled task to finish.
- Up to five independent browsers remain concurrent. Short worker HTTP calls use one lane to avoid unnecessary contention on the server's worker row. Queued cancellation is prompt and is rechecked before any later delivery; request bodies are captured before enqueue.
- A transient idle-slot API failure no longer aborts a peer already logging in. A transient presence update does not interrupt a job immediately after successful lease renewal. Job-lease failures, revocation, cancellation, deadlines and cleanup quarantine retain their stop behavior.
- Known visible Apple error sentences accept dialog headings, recovery-link suffixes and punctuation variants. Read the visible official modal body as well as its generic heading. HTTP 403 alone never proves Locked or bad credentials.
- One narrow network exception permits the official basic-auth POST to exactly `https://idmsa.apple.com/appleauth/auth/verify/password`, once after the visible password click. Public Apple widget source contains this password validation flow; it is not an OTP submission. Pre-click, duplicate, GET, query, foreign-origin and OTP/security-code variants stay blocked; no redirects/retries, CAPTCHA bypass or code retrieval.
- Minimal diagnostic metadata separates operation/abort/API/cleanup stages. No raw exception, DOM, URL, response body, email, password, cookie or OTP is persisted. Route API errors are connection failures rather than proof of a bad proxy.
- Launch failures retain only fixed phase/kind and a numeric browser exit code. A settled failed launch can recover cleanup after fresh proof its owned browser is absent; a still-pending launch always remains quarantined even if termination found no current process. The latter path was independently reproduced red and fixed.

## Verification

- 108/108 Node worker tests pass. New tests observed red before implementation for background gating/config/launch, peer cancellation, presence heartbeat, visible error formatting, queued HTTP cancellation, route-error classification, basic password verification, modal body reading and launch-settlement cleanup guards. Existing 401/403/revocation and recovery checks remain.
- Initial native S4U proof: session 0, desktop unavailable, five headless Cloak contexts open concurrently, five unique owned profiles, all five cleaned, public health HTTP 200. Separate synthetic authenticated-proxy launch and cleanup passed. No real account credentials used in those checks.
- Four native Chrome synthetic flows: Continue once, Sign In once, correct LIVE_2FA / APPLE_LOCKED / INVALID_CREDENTIALS / UNKNOWN outcomes; every profile cleaned. All network responses were intercepted synthetic HTML.
- A separate native synthetic basic-auth flow can display OTP only after the exact permitted password-verification POST; LIVE_2FA confirmed. The modal-body native fixture first reproduced UNKNOWN instead of APPLE_LOCKED, then passed after reading the body. No real credentials/network in these fixtures.
- Web/backend source and database schema unchanged in this follow-up. No migration or application service deployment; the previous web suite/build results are separate from these worker tests.

## Real checks and limits

Only accounts from the owner's original three-account selection were used, with cooldown and revision guards. No bulk account sweep or repeated password submit within a job.

- The last previously queued job under 1.3.0 stopped before credential delivery: UNKNOWN/BROWSER_INTERRUPTED. Its residual owned profile was removed only after proving no browser remained, then cleanup recovery was acknowledged.
- Under 1.3.1 a real check pressed password submit and made Apple sign-in requests; HTTP 403 with an unrecognized visible error remained UNKNOWN. Cleanup OK, no profile left. This proves the click/report path, not successful login or Locked classification.
- The 1.3.2 check ended before account-secret delivery with a preflight error and cleanup OK. That old PROXY_ERROR label does not prove a failed proxy: 1.3.3 distinguishes route API failures.
- The 1.3.3 and 1.3.4 checks both pressed password submit and reported UNKNOWN/RESPONSE_UNRECOGNIZED, cleanup OK. Their diagnostic metadata showed a blocked verify write and only the generic dialog heading. The 1.3.4 check did not issue the basic-password request, so the basic-auth exception is not claimed as the proven cause of that account's failure.
- The 1.3.5 modal-body check stopped during browser launch before credential delivery; its verified residual profile was cleaned and acknowledged. The final 1.3.7 check/result and worker state are recorded separately after completion. Do not equate synthetic fixture success with a confirmed real Live/Locked/2FA result.

Cold boot was not rehearsed; only the noninteractive task and its startup registration were verified. No video, Sheet, Railway, VM power/configuration, account replacement or financial-book actions.

## Final accepted real result

Worker 1.3.9, native Password batch/session0, priority4, worker-only UV_THREADPOOL_SIZE=16. Manifest verified on Central; token and grants unchanged. No global environment/VM/browser/sandbox changes. HTTP read-only probes with the worker stopped and running returned successful replies; configuration adjustments are not treated as definitive attribution for every prior timeout.

At 2026-10-25T12:49:28.432Z (19:49:28 Bangkok), cmvntqk330002a74j9yuxzuwk completed APPLE_LOCKED with cleanup OK. Web common readChecks returns the same nonstale result and account APPLE_LOCKED/revision1. This is a real login/report/health result. No automatic VM account replacement. Final measured task Running, worker IDLE/online, zero owned Chrome/profiles/pending/quarantines.

live-checks.json records twelve jobs on the original three selected accounts, five credential-delivery checkpoints, all cleanup OK; one job existed before this continuation. Earlier UNKNOWN results remain historical and are not rewritten into successes. No real successful/2FA/incorrect-password outcome observed; five native synthetic browser scenarios and108 worker tests cover those rules. No recording or real credential screenshots.

Final post-password service-error fallback stores only numeric codes/finite recognized kinds, requires visible official error UI, prefers current visible evidence, rejects conflicting kinds and ignores late old responses. No health conclusion comes from HTTP status or an error code alone.
