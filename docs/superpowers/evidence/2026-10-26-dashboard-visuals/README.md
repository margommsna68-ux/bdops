# Dashboard trực quan — 26/10/2026

Owner asked for visuals that make the existing business dashboard faster to understand.

Only the client presentation changed: health distribution ring; labelled money-trend distribution; three threshold bars (<8, 8–<10, >=10 USD); per-server health and growth bars; compact attention tiles. Explanations are expandable. Filter buttons retain the exact shared predicates, server scope and VM links. Added the existing LOW category as a drilldown. Charts are proportional, use real projected data, never invent a time series. The health percentage cannot round an incomplete set up to 100%. A paused-only set has no percentage. All financial visuals are absent without money rights.

Verification:
- Two new chart/scope/permissions tests failed before implementation and passed after; one extra percentage-boundary guard added. Focused projection + UI: 32/32 pass.
- Actual local Chrome: 20 checks, admin and restricted user, drilldowns/server scoping, refreshed state, all four themes chosen via Settings, phone 390px without horizontal overflow, no page script errors. Screenshots use synthetic data only.
- Typecheck passed after build regenerated Next types. An earlier typecheck started concurrently with dev startup hit generated files being removed; it was rerun sequentially. Changed-component lint clean; production build succeeds with pre-existing warnings.
- No backend, database, API, permission, GEN2 bridge/scan configuration or real VM behavior changes. Full 1238-test backend suite was not rerun for this presentation-only change; relevant 32 tests run.

Deployment: pending final host verification (see release record).
