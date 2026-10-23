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

## Production and Central verification
- Source commit0abd6ac, production buildYYuyeK5O_AbCdn_o8iq1h. Deployed23/10/2026 18:21 Bangkok on SERVER-01; additive migrations20261023140000 and20261023150000 applied.
- Backup immediately before:moneytohome-20261023-181702.dump, encrypted offsite.mthbk SHA2568e57d3deca3f1d69a0555200be74f6842df2af879f9a192a9cb729ed054a47f6 verified/decrypted onmoon-01. Previousapp kept D:\MoneyToHome\app-before-ai-stock-20261023.
- First deployment attempt applied additive migrations but folder rename hit a Windows sharing lock; old app restarted. Added explicitWaitForStatusStopped + short wait/retry; second attempt succeeded, no restore/reset/data writes.
- Before/after business snapshot and fingerprint identical:11servers,678VM,486SDK,1463proxy,148login,0PP,0EarnApp,3activecosts. Fingerprint572d8a6c957901b3eff7bfeac02a3361429e8fcc3419a3351b213381d462857b.
- Public newbuild manifest200, health200, anonymous/me401. Live user-pageJS200 containsACCOUNT_OPS. Host authenticated stock/approval WRITE flows were not exercised: owner has not created a newtoken. Functional writes were checked only in isolatedTEST DB. No new browser UI flow/video in this takeover.
- Package handoff/moneytohome-ops-central-0abd6ac-20261023(.zip), OpenAPI1.3.0, code/docs only. Copied to pinnedmoon-01 WIN-6CA4QAGDD2F at C:\Users\Administrator\Desktop\MoneyToHome\moneytohome-ops-central-0abd6ac-20261023. All12 files (includingmanifest) transferhash verified; Node syntaxcheckPASS. Oldcode/config/journal retained; rootcommonoperatorprompt backedupand updated. Central actualNodefetch topublicAPI:health200JSON, anonymousme401JSON; no tokensent.
- Owner next step: create ai-ops token90days READ,VM_OPS,BALANCE_WRITE,PROXY_CREDENTIALS,ACCOUNT_OPS (noPAYOUT/RECEIPT), load via init in private terminal. No automatic token, scope or2FA changes. SheetdisableAi remains owneraction.
