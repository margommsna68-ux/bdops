# Selected VM payout — 25 October 2026

Owner request: ticking one/multiple VM rows exposes a withdrawal action, instead of requiring the hidden cell popover. Added Rút về PayPal to the selected toolbar; preserved the existing cell flow.

Panel has separate Request / Confirm SENT / Record actual receipt queues. Explicit email and amount per VM; default PREPARING. SENT needs an explicit evidence checkbox; no SDK amount or balance infers withdrawal eligibility. Receipts are actual confirmed amounts only and use the existing PayPal ledger/email aggregation. No new ledger, API financial command, grant, token, schema or migration. Existing requestPayout input now accepts optional expectedVmRevision, already enforced by the shared service.

Selection identities are captured at opening. Live changes block new drafts. Distinct email selections, partial row failure/success and current permissions remain checked by shared services. Per-command keys and original payload are persisted before sending in same-tab session storage, scoped to user/project/VM/action; uncertain outcomes freeze edits and retries use the original payload even after a denied retry or account/round change. Successful rows are not resent on table-refresh failure. Pending queues survive reopening, but not closing the tab; reconcile existing request/receipts before creating another command if tab storage is lost. No secret credentials stored in the journal.

11 component tests plus integration test for router revision passthrough, unique email reservation, replay and denied staff. Focused group 43/43. Real local production Chrome: 11 checks, including toolbar at 1/3 selected, missing account, two preparations, SENT confirmation, $6+$12 actual receipts, 390px and no JS errors. Eight DB readback assertions: two requests, two distinct emails, two receipts, total $18, $4 still open on first request, no missing-account request. Synthetic data only; no video.

Earlier browser script retries: native option.disabled was true, while the generic Playwright isDisabled helper did not report it; changed check to native property. One synthetic TOTP reused in same step was rejected; reset only fixture-user last step on guarded local trial DB. Neither was a product change. Build attempts while the full DB suite held Prisma DLL failed EPERM; final build is performed after the suite exits.

Production deploy and final checks recorded below after completion.

Final-build visual check: four themes selected via Settings and verified on the HTML element; selected toolbar and remaining-receipt form visible in all four. One unrelated old Apple import test falsely matched the three letters Tok inside encrypted random base64. Fixed its journal assertion to search the actual unique Tok+fixture-id secret (password assertion retained), rather than weakening credential checks or changing product code. Full regression rerun after that test-only correction.

Backup before release: moneytohome-20261025-135201.dump; moon-01 encrypted and decryption verified, SHA256 2a4ee39d39e9a385ff9b5c9147d424e03519530a0990becd845c7c5cbeeb283e. Final production build chzpasdz1rCbuVAtoLJDH.
Final regression: 197 files / 1058 tests pass. Typecheck clean; lint no new warning/error; build passes. Browser 11 functional + 4 final-build theme checks; 8 DB readback assertions.
