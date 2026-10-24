# Login issues and automatic replacement — 24 October 2026

Owner requested Apple Locked, Google Verify and Google Disabled statuses plus filtering/sorting, then explicitly selected: AI records the error and automatically takes unused stock to continue.

## Behavior

Three additive GmailStatus values and nullable loginIssueNote/loginIssueAt fields. Existing rows keep their statuses and null issue metadata. Inventory shows colored badge/reason/time, login-only exact status filtering and sorting by errors first/latest issue/email; applied across all results before pagination, persisted in URL. Individual choices validate provider; mixed bulk refuses wrong-provider rows. Existing ADMIN-only soft-delete rules remain.

POST earnapp-accounts/{id}/login-issue (ACCOUNT_OPS, no approval) checks current token/user/project, owned ACTIVE job, VM/cycle/revisions/current account in one transaction. It quarantines the old login then takes fresh usable stock (same provider preferred, then other). Automatic replacement only takes ACTIVE, unarchived logins with a password and no previous EarnApp record. Old EarnApp is closed/detached only if replacement succeeds; its PayPal, payout requests, money and used SDKs never transfer. A new account is merely held, not proof of real login/registration. LINKED SDK remains used; response sdkReuseBlocked tells the operator it cannot be reused for the replacement. No real VM reset/install/login is performed by the web.

No stock: records issue, keeps old account bound and reports NO_STOCK. SELECTED operators cannot take common stock; they record own account issue and get NEEDS_ADMIN_STOCK. Idempotent replay returns the first result even after restocking; a fresh attempt requires current identities/revisions and a new command. Old bad accounts remain available for supplier handling or ADMIN deletion after releasing any binding. No new supplier-request workflow was introduced.

## Verification

- Initial API tests: 5 failed / 1 protection passed before endpoint; 6/6 passed after implementation. Added race, selected-scope and fresh-stock regressions; an account with prior PayPal state failed before the fresh-only fix; an email-only candidate failed before password eligibility was added.
- Final suite: 183 files / 945 tests passed. Typecheck and production build passed; lint has existing warnings only.
- Local HTTP + real headless Chrome, synthetic isolated data: 21/21. API reports and replaces; read-back VM has new account. Over 100 filtered rows verify whole-list sorting, each status, reason/time, reload/Back, PayPal filter separation, expanded detail, four themes, 390px and no JS errors. No video. Only local test data written.
- Independent source review: no remaining P1/P2 in automatic replacement after fresh-stock fix.
- Harness corrections: dev Node native TS loading failed on the old Tailwind require; local process flag restored the existing loader (no Tailwind source change). Browser sign-in changed to the normal local auth HTTP flow because first-render form clicks preceded hydration; UI PIN still entered normally. Sort test waits for URL navigation before reload; light theme correctly has no data-theme attribute. Generated bronze colors rebuilt for new badge utilities.

Release and host verification are appended after deployment.

## Release

Code 9c8762a, build -PMAO_jONEP3IpqVo7_X0, deployed SERVER-01 24/10/2026 15:51 Bangkok. Additive migration 20261024140000_login_issues applied; generated Prisma client copied with the tested schema. Public build and health 200; Web and Tunnel running. Before/after identity/status/revision/financial-link snapshot hash equal (678 VM, 148 login accounts, 1 EarnApp, 570 SDK, 0 payout requests); new metadata columns present, zero real issue reports. No host login was marked, replaced or deleted; no real machine login operation was performed. Rollback app D:\MoneyToHome\app-before-login-issues-20261024.

Backup moneytohome-20261024-154908.dump plus encrypted/decryption-verified moon-01 copy, SHA-256 88f0c63fe7fab0a49ba67f3e107f07f043b23d60ed574fb5b09a5b06b8e44a55.

Central current prompt, CAP_NHAT_LOI_DANG_NHAP_20261024.md and OPENAPI_WEB_HIEN_TAI.json (1.4.0) copied into Desktop/MoneyToHome and SHA-256 verified. AGENTS entry appended. Existing launcher me confirms connected; no token/PIN changed and no VM task started. Generic post in existing client supports the endpoint without a new installation. New top-level schema/instructions override old schema within earlier handoff bundles for this command.
