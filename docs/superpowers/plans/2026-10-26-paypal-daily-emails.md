# PayPal: tối đa 2 email rút EarnApp mỗi ngày

> Execution: backend inline, independent UI task via superpowers:subagent-driven-development; final independent review before release.

Goal: enforce the owner's two-distinct-email limit per PayPal across web, batch and AI using shared payout services. Existing authenticated scopes and financial flow remain intact.

Implementation decisions (stated to owner): calendar day Asia/Ho_Chi_Minh, server clock; preparations reserve capacity, unresolved UNKNOWN reserves until reconciled. SENT/UNKNOWN/retry-of-sent consume a durable daily email marker; cancel/failure never erases a used marker. Cancelling an unsent preparation releases its reservation. Same email/replay is not a second slot. Open preparations carry their reservation over midnight, so they cannot collide with new work; spent-only markers reset at midnight. Input date/observedAt cannot bypass the limit. The existing one-request-per-EarnApp rule is unchanged.

- [x] Backend: regression tests first; add PayPalPayoutDayEmail with unique project/PP/day/email and PayPal FK cascade, additive migration/backfill sent and uncertain history. New payout-daily.ts merges today's durable markers with unresolved preparations, exposes counts and per-email allowance. All writes use existing project lock/serializable transaction and shared service. Existing sent data supplies a conservative fallback for unbackfilled records. Preserve markers across ordinary undo.
- [x] Reads/UI: picker and API suggestion include daily {date,timeZone,limit,used,reserved,remaining}; each email dailyAllowed; never suggest another PP when an already-bound email is daily-blocked. UI shows daily occupancy, disables blocked options/save, retains errors/drafts, bulk checks local selections then server rechecks each write. API returns PAYPAL_DAILY_LIMIT with remaining/date details.
- [x] Tests: third-email rejection, simultaneous requests, cancellation vs sent/unknown, retries/idempotency, midnight, forged dates, own-email blocked, two PP independent, permissions unchanged. Run focused and full suite, types/lint/build; synthetic real-browser single/bulk and mobile. No real payout/receipt.
- [ ] OpenAPI/runbooks updated; review; local migration first, backup local+encrypted moon, deploy same self-hosted service with migration, read-only host checks. No VM/Sheet/GEN2 operations.

Review focus: midnight with pending holds; SENT and UNKNOWN late reconciliation; stale bulk picks; undo cannot release consumed quota; quota response must not expose other projects or money.
