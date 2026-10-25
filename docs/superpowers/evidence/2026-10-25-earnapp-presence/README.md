# EarnApp presence in Server/VM — 25 October 2026

Reuse the existing current VM–EarnApp relation and account column. Add Có EarnApp (ACCOUNT_PRESENT) and rename the missing chip Chưa EarnApp (old ACCOUNT_MISSING URL kept). Counts and server distribution use the shared pre-pagination filter model; the new view persists in URL, reload and Back. No SDK/proxy/money observation implies an account. Archived VMs remain excluded by normal active views.

Current email remains in the account cell, with Có tài khoản underneath. Tooltip distinguishes a recorded assignment from confirmed registration. A legacy Gmail without the current EarnApp relation explicitly says Chưa có tài khoản. Loading/error states never claim no account and do not open an assignment form before data is known. Saved column order, widths, hidden choices and permissions unchanged.

Five new tests red before implementation (three filter/URL, two cell rendering), green after. Focused regression 33/33 includes the selected payout panel. Typecheck/build pass, lint existing warnings only. Nine real local production Chrome checks: both chip counts, two linked VMs vs one missing, email/presence label, reload and Back, mobile visibility/no overflow and no JS errors. Synthetic trial data only; no production imports/assignments or video. No schema/migration/API data changes.
Backup moneytohome-20261025-135858.dump; moon-01 encrypted/decryption verified (SHA256 209825779f22545ac8847f7a4767d6965f735006c1c954a72f6f368408d6ba02). Build f1YDM86NYfEzFoyJ5Cc2H.
