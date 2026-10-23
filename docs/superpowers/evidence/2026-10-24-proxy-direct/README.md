# Direct proxy operation — 24 October 2026

Owner explicitly removed ADMIN approval for taking the configured proxy of an assigned VM, and confirmed that assigned tasks may select eligible stock and assign it to VMs on the web.

Code c2e98dd: proxy-credentials no longer carries the approval gate, for standalone and batch requests. Existing PROXY_CREDENTIALS scope, VM_PROXY_FOR_OPS capability, active job owned by caller token, project, VM and current cycle checks remain. proxy-assign already runs without approval; its FREE/ownership/concurrency/revision/job checks are unchanged. Other critical routes retain approval.

Regression: new test without fixture auto-approval failed 202 versus expected 200 before change; passed afterward, including repeated reads and batch. Related VM-work/approval/batch/inventory/CLI suites: 43 tests passed. Typecheck, lint and production build passed. No browser changes.

Backup moneytohome-20261024-001400.dump verified locally and encrypted/decryption-verified on moon-01. Deployed 00:15:12 Bangkok, build PB5nkXsKD4np1fTd8pguM, no migration. Public and localhost build manifests return 200. Rollback app-before-proxy-direct-20261024 retained.

Authenticated GET me executed from Central via its existing mth-wow.ps1 launcher: ok true, proxyApprovalRequired false; account credentials, payouts/receipts and SDK reveal remain in approvalRequired. No full proxy was retrieved, no VM action or operational data mutation used for verification.

Updated root PROMPT_CLAUDE_VAN_HANH_WEB.md on Central (SHA-256 verified, previous prompt preserved), current source prompt, client comment, OpenAPI and runbooks. Existing clients can retry the old waiting key/body against the now-direct endpoint; an expired job still requires normal job recovery. No token/config/journal changed.
