# Unattended AI inventory access — owner decision 24 October 2026

Owner explicitly requested automatic access to stock information without asking ADMIN to approve each read. ACCOUNT_CREDENTIALS and SDK_REVEAL now execute directly after the existing authorization checks, matching the proxy-credentials route which was already direct. No fake ADMIN decision or auto-approval rows are created. No token/user grants or operational records are changed by this release.

Remaining approvals are only WITHDRAWAL_PREPARE, WITHDRAWAL_STATUS and WITHDRAWAL_RECEIPT. Web users keep their existing login/PIN/2FA behavior. Inventory API uses Bearer token and existing project/user/server/capability constraints; account credentials still need the owned active current VM job. Disabled users, revoked tokens, stale jobs and foreign-server SDK reads remain denied. Restricted users still cannot read common stock.

Regression: four new tests fail before the route change and pass after, including direct account read, direct SDK with an old pending approval, inventory-only batch, retained financial hold and authorization refusals. Updated three old test expectations to the owner's new policy. OpenAPI 1.3.1 and current operating instructions updated; secret-file handling remains unchanged.

Independent source review found no unintended authorization weakening beyond the requested direct inventory reads. Full suite/build and release proof follow after completion. Local synthetic data only; no real VM, EarnApp, proxy credential or SDK was read for testing on the host.

Final verification: 176 files / 907 tests passed; typecheck passed; lint zero errors (existing warnings only); production build passed. Backup moneytohome-20261024-122103.dump and encrypted/decryption-verified moon-01 copy prepared before deployment.
