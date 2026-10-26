# Dashboard trực quan — 26/10/2026

Owner asked for visuals that make the existing business dashboard faster to understand.

Only the client presentation changed: health distribution ring; labelled money-trend distribution; three threshold bars (<8, 8–<10, >=10 USD); per-server health and growth bars; compact attention tiles. Explanations are expandable. Filter buttons retain the exact shared predicates, server scope and VM links. Added the existing LOW category as a drilldown. Charts are proportional, use real projected data, never invent a time series. The health percentage cannot round an incomplete set up to 100%. A paused-only set has no percentage. All financial visuals are absent without money rights.

Verification:
- Two new chart/scope/permissions tests failed before implementation and passed after; one extra percentage-boundary guard added. Focused projection + UI: 32/32 pass.
- Actual local Chrome: 20 checks, admin and restricted user, drilldowns/server scoping, refreshed state, all four themes chosen via Settings, phone 390px without horizontal overflow, no page script errors. Screenshots use synthetic data only.
- Typecheck passed after build regenerated Next types. An earlier typecheck started concurrently with dev startup hit generated files being removed; it was rerun sequentially. Changed-component lint clean; production build succeeds with pre-existing warnings.
- No backend, database, API, permission, GEN2 bridge/scan configuration or real VM behavior changes. Full 1238-test backend suite was not rerun for this presentation-only change; relevant 32 tests run.

Deployment: pending final host verification (see release record).

## Phát hành
- Commit 64597fb; build Ljxej_M4sGYzNOxsfDnf0, live 26/10/2026 09:07 Bangkok.
- Backup 09:06:20 local + encrypted/decryption-verified copy on moon-01.
- No migration (41 applied unchanged). Web/Tunnel both Running, exact public build manifest HTTP200; deployed component/CSS match tested source.
- Read-only business snapshot before/after identical: 678VM /149accounts /1465proxies /4batches /4costs /0requests /0funds; hash 509b63d811b87135555dca5e684d631ebab99caffb7b6ac686b6342ee282039b. Existing GEN2 health ingestion may run independently; not frozen or changed.
- Rollback: D:/MoneyToHome/app-before-dashboard-visuals-20261026.
- Production authenticated UI not re-driven; visual verification was on the local app with synthetic users/data, all four themes and mobile. No production example records or operational commands sent.
