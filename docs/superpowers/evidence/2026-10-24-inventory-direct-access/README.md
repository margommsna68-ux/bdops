# Unattended AI inventory access — owner decision 24 October 2026

Owner explicitly requested automatic access to stock information without asking ADMIN to approve each read. ACCOUNT_CREDENTIALS and SDK_REVEAL now execute directly after the existing authorization checks, matching the proxy-credentials route which was already direct. No fake ADMIN decision or auto-approval rows are created. No token/user grants or operational records are changed by this release.

Remaining approvals are only WITHDRAWAL_PREPARE, WITHDRAWAL_STATUS and WITHDRAWAL_RECEIPT. Web users keep their existing login/PIN/2FA behavior. Inventory API uses Bearer token and existing project/user/server/capability constraints; account credentials still need the owned active current VM job. Disabled users, revoked tokens, stale jobs and foreign-server SDK reads remain denied. Restricted users still cannot read common stock.

Regression: four new tests fail before the route change and pass after, including direct account read, direct SDK with an old pending approval, inventory-only batch, retained financial hold and authorization refusals. Updated three old test expectations to the owner's new policy. OpenAPI 1.3.1 and current operating instructions updated; secret-file handling remains unchanged.

Independent source review found no unintended authorization weakening beyond the requested direct inventory reads. Full suite/build and release proof follow after completion. Local synthetic data only; no real VM, EarnApp, proxy credential or SDK was read for testing on the host.

Final verification: 176 files / 907 tests passed; typecheck passed; lint zero errors (existing warnings only); production build passed. Backup moneytohome-20261024-122103.dump and encrypted/decryption-verified moon-01 copy prepared before deployment.

## Release and live verification

Code b36eb6e, build MDoOw3Ft3rAr7-ptSWcGH, SERVER-01 deployment 24/10/2026 12:22 Bangkok. No migration. Public build manifest and /health 200; Web/Tunnel running. Business and membership snapshots identical before/after (11 servers, 678 VM, 511 operations, 1463 proxies, 570 SDK, 5 memberships). No token or user grants changed, no host inventory secrets fetched for testing.

Central moon-01: copied and SHA-256 verified updated PROMPT_CLAUDE_VAN_HANH_WEB.md and CAP_NHAT_AI_KHO_20261024.md into C:/Users/Administrator/Desktop/MoneyToHome; previous versions backed up, AGENTS entry appended. Ran existing mth-wow.ps1 me read-only: connected=true, inventoryNeedsApproval=false, approvalRequired exactly WITHDRAWAL_PREPARE / WITHDRAWAL_STATUS / WITHDRAWAL_RECEIPT. No init, token/PIN change, VM scan or machine operation. Existing client works unchanged; no package installation needed.

Backup moneytohome-20261024-122103.dump; moon-01 encrypted/decryption-verified moneytohome-20261024-122103.mthbk SHA-256 590cc2fec6d9a4fb183b4aad708cb2a7b33ce4747d1dfcf8294a991beafe4a6f. Rollback application at D:\MoneyToHome\app-before-inventory-direct-20261024.
