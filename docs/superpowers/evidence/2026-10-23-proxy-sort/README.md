# Proxy registry blocked/package sorting — 23 October 2026

Owner requested clear blocked proxy sorting and selecting proxy packages, and asked whether imports record costs for profit.

Implemented fbc65b8:
- BLOCKED_FIRST sorting: blocked first, then natural package/server/VM/IP, applied before pagination and supported in URL/router/copy paths.
- One-click Only BLOCKED filter, combines with existing package/server/group/search filters.
- Package dropdown shows matching counts from all pages, ignoring only the package choice itself; includes package codes present in rows even when catalog lacks them. No credential fields added.
- New proxy import explains that importing stock does not record a cost. Use Packages > Record payment for the actual paid cost. No financial transaction is created automatically by this change.

Cost review: account import already supports original total/quantity/rate and one cost per purchase batch; appending missing accounts/email does not add a second cost. Proxy package price/note is reference only; record payment writes a proxy cost and advances due date. SDK money is an observation, not income. No financial data changed.

Checks: three regression assertions failed on the old implementation (blocked priority, URL, missing package counts) then passed. 31 related registry/package/link/copy/UI tests passed; the package integration test also checks blocked-filter counts and a first page limit of 1. Typecheck passed; lint no errors (existing RegistryTable reset dependency warning). Local Chrome: blocked-first, only-blocked, package counts/filter, reload, desktop/mobile; no page errors. Initial browser run clicked sign-in before hydration; rerun waits for page readiness. Screenshots are synthetic local data. Production build passed.

Backup 232556: local database archive and encrypted moon-01 copy verified. Deployed 23:26:40 Bangkok without UAC using previously granted scoped service control. Build v3cNHJaJOYY2MHO35IK0W, rollback app-before-proxy-sort-20261023. No migration or host business writes. Public and localhost build manifests return 200. Authenticated host UI not separately exercised; browser interaction checks used local test data.
