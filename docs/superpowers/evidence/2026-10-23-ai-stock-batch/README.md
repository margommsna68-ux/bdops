# AI stock + batch + CLI approval — 23 October 2026

## Scope
Take over the interrupted implementation of the approved ai-stock-batch design. Added ACCOUNT_OPS in API and user token UI, account/proxy/SDK stock routes, SDK stock discovery, batch max100 with10/min bucket, ADMIN 2FA confirmation from CLI and web. No real VM action, real stock assignment, new token or financial entry in this release.

## Checks
- Inherited services: account7 + inventory9 passed.
- Main HTTP test: original4 RED → GREEN for routes, mixed202, per-item refusal and locked-key handling. Expanded to9 tests including inventory/SDK routes, expired partial replay, SDK refusal masking and stale job-round credential denial.
- Approval race suite:4 RED +1 protective GREEN before fix →5 GREEN. Refuses after2FA reset, demotion, token revocation, expiry or fifth wrong attempt.
- Token UI test RED →GREEN exposes ACCOUNT_OPS. Client fake HTTP tests include partial batches, unknown responses, secret files, hidden TOTP and pasted input.
- One independent review found2 important issues: SDK error disclosure and expired partial-batch results. Both reproduced and fixed; no full SDK in refusal and committed critical commands replay after expiry independently of unexecuted items.
- Real HTTP + real CLI + actual backend, isolated test DB: exit4 pending →CLI code→exit0 →same-key replay exit0; exactly1 balance and1 payout row, no token/TOTP in journal or console. No production money/VM write.
- Final full suite:165 files /825 tests PASS, typecheck PASS, production Next build PASS, lint0 errors (existing warnings only). Earlier full run had2 outdated package-UI assertions from previous dollar-format change; corrected to the owner-requested $120.00, product unchanged.
- Test-only migration verified:20261023140000_approval_confirm_failed and20261023150000_ops_batch_key. Both additive. BatchKey stores hashes only, not request bodies or secret responses.

## Release gate
Production before snapshot:11 servers /678 VM /486 SDK /1463 proxy /148 login /0 PP /0 EarnApp /3 active costs. Data fingerprint572d8a6c957901b3eff7bfeac02a3361429e8fcc3419a3351b213381d462857b. Deployment and Central transfer proof to be appended only after verification. Evidence-private logs are under .runtime/ai-stock-*; no secrets included here.

## Rules retained
Owner creates new90-day token withREAD,VM_OPS,BALANCE_WRITE,PROXY_CREDENTIALS,ACCOUNT_OPS, noPAYOUT/RECEIPT. No automatic permission increase/token creation. No Sheet operation writes; disableAi remains owner action. UNKNOWN machine result keeps account held; prior credential reveal alone is not proof of registration. Imported SDKs remain UNCONFIRMED until actual check.
