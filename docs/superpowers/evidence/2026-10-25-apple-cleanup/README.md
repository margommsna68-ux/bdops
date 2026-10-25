# Apple worker cleanup recovery — 25 October 2026

Worker-only release ac8b0e0, version 1.3.10. Public web remains 8c1b28f. No migration or token/configuration replacement.

## Incident

The owner queued 100 accounts at 15:57:11Z. At 15:59:09Z, slot5 job cmvo0gqrn002umbfknthddtyr returned APPLE_LOCKED with cleanup FAILED. That stopped admissions globally and drained peers. The displayed peer cmvo0gqrw003cmbfkfo44chqa returned CANCELLED with its own cleanup OK. Those are separate jobs, so the global warning and per-job text were consistent but confusing. Initial counts: 92 queued, 8 finished (one failed cleanup).

The old worker saved technical diagnostics only for UNKNOWN/PROXY_ERROR/NETWORK_ERROR/TIMEOUT, excluding this Locked result. The original cleanup stage/Windows error is therefore unknown. Do not claim the wait patch proves the original root cause.

## Recovery

On pinned Central moon-01, the worker task was stopped/Ready. Exact slot5 profile UUID 6183d9bd-4fb9-451d-9124-eede27fccc2c had a matching owner marker, no reparse points and no associated process; native inspection showed zero Chrome processes. Official cleanup initially could not load the private state because this leftover Chrome profile carried browser-created capability and deny ACLs. No permission check was relaxed. Verified noOwnedBrowser plus the existing ownership-bounded Store.cleanup removed only this profile. Then the official cleanup-recovered command returned RECOVERED and the database retained APPLE_LOCKED with cleanup OK and no active lease.

## Patch and verification

- Two regressions failed before the patch: briefly departing browser incorrectly quarantined; Locked/Cancelled cleanup failures had no diagnostic.
- After a settled close, allow up to five seconds for positive process-exit proof. Each native probe receives the remaining budget. Unknown process identity/errors still prevent profile deletion.
- Every cleanup failure now retains only allowlisted stage/code metadata, independent of authentication result; no raw exceptions, paths, credentials or lease tokens.
- 110/110 Node worker tests passed. Source review found no introduced P1/P2 issue; reviewer did not rerun tests or inspect the host.
- Runtime 1.3.10 was installed immutably on Central; archive hash and runtime manifest verified. Previous 1.3.9 retained. Existing Password/Limited/session0 task, Normal priority4, headless mode and effective default maxSlots5 remain.
- Existing owner queue resumed; no new check request or repeat login of completed jobs was submitted by this work. Live observations are recorded separately; queue completion is not claimed.

## Live follow-up at 16:10:10Z / 23:10 Bangkok

The first five resumed jobs all reported cleanup OK: two APPLE_LOCKED, one NETWORK_ERROR, one PROXY_ERROR and one UNKNOWN/BROWSER_INTERRUPTED. The three technical outcomes are not successful account-health checks and were not automatically retried. At the database snapshot, 13 original jobs were DONE/cleanup OK and 87 remained QUEUED. The native task remained Running with zero quarantine files, and was already preparing another claim. Profile/pending counts during a running queue are not expected to stay zero. This is evidence that cleanup resumed successfully, not proof that all100 checks or the separate network issues are resolved.

No VM/AE/GEN2, Sheet, proxy configuration, account-link or financial operations were performed. Owner-queued checks may record account health as designed.
