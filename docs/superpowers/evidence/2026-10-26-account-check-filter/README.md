# Account check filter and proxy-error investigation — 26 October 2026

Owner asked why `/gmails?check=PROXY_ERROR` has failures and requested a shorter account-status dropdown showing only populated statuses with counts.

## Finding on the real worker

Read-only audit at 07:27–07:36 Bangkok found six current `PROXY_ERROR` jobs, all with `submittedAt=null`, cleanup OK, unchanged proxy revisions and no account-health mismatch. They previously reached `LIVE_2FA`; those older jobs remain history. All six new checks failed before account-password delivery. Worker 1.3.10 was IDLE, five slots, native task Running, zero owned browser/profile/pending/quarantine.

Performed one GET of the public Apple sign-in page through each exact job proxy from Central using curl. Proxy credentials were decoded in memory, passed through local child stdin and pinned SSH stdin, then curl config stdin. No credentials in command arguments, evidence files or logs; no Apple account credentials read or submitted.

- Five package `240292` endpoints timed out before TCP connection (curl 28, 10-second connection budget).
- One `GEN-22/10-100` endpoint established TCP, then failed the proxy tunnel/receive step (curl 56, no CONNECT/HTTP status).
- A recent successful-job proxy used as transport control returned CONNECT 200 and completed TLS. Apple returned HTTP 403 to curl; this proves transport only, **not** that a browser login would succeed.

This establishes connection failure at recheck time. It does not prove the provider's internal cause, expiry, permanent death, or that Apple locked any account. Database LIVE is inventory allocation, not a fresh reachability test. No proxy was marked BLOCKED, detached, replaced or quarantined globally. No real-account recheck was queued in this task. No changes to worker, VM, AE, GEN2, Sheet, permissions, tokens or financial records.

## UI change

`AccountStore.tsx` hides zero-count account-check options. Counts remain over the full matching dataset before pagination, including source/type/search/other constraints but excluding the check filter itself. Preserve a currently selected zero-count option until explicitly cleared. Loading/error disables the dropdown and uses ellipsis rather than false zero.

Production shared read-service snapshot: 149 accounts → Locked 105, Proxy error 6, Live/2FA 38. Only these three populated options will be offered absent other filters. Snapshot values are time-bound, not fixed UI options.

## Verification

- Three new rendered-component regressions: all fail against the previous production component and pass after the change (populated full-page/source counts; selected zero preservation; loading/error).
- Focused account/check group: 63/63 pass. Typecheck and Next production build pass; lint has existing warnings only.
- Real local Chrome with synthetic database: 22/22 assertions, including 105 rows across pages, source intersection, URL/reload/Back/Forward, zero-result selection and clearing, mobile overflow and no script errors. No video. Browser reproduction failed before the product fix. One intermediate harness failure dereferenced the filter before mount; fixed the wait predicate and reran clean.
- Full suite initially had six failures in `account-login-issues-ui.test.tsx`; all six also failed against HEAD before this change. Updated obsolete expectations from the earlier five-selection cap and duplicate status badges, removed a NoteCell mock that hid the moved note, and made a mocked revision refresh immutable to match real query updates. No product behavior changed for these tests.
- First standalone typecheck overlapped Next regeneration and saw missing `.next/types`; reran after build successfully.
- Independent read-only source review: no findings on the product diff. Reviewer did not run tests or inspect production.

Direct in-app browser inspection of production was unavailable (`cua` initialization failed). Production validation uses shared read services, built asset/health checks, and before/after business snapshots; no claim of a production browser screenshot.

Release details and final full-suite outcome are recorded in `release.json`.
