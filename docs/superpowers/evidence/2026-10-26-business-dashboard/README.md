# Dashboard business verification

Local checks 26 October 2026, before deployment:
- Full web suite: 208 files / 1,238 tests passed. Typecheck and build passed; lint has existing warnings only.
- Synthetic Chrome browser: 20 checks, admin and no-money user, four themes selected through Settings, 1280px and 390px, exact card/drilldown/server counts, refresh selection, no-money hiding, no JS errors. No video. Phone screenshot taken after mobile sidebar transition.
- Independent backend review found missing manual-money event binding, cached health not rechecking current machine UUID, selected-server API allowlist omissions, and recorded faults hidden by old healthy evidence. Three new synthetic integration tests reproduced first three as red, then passed unchanged. Recorded faults are separately visible and block GOOD.
- First build attempt collided with the running test's loaded Prisma DLL (Windows EPERM); after tests finished, normal build passed. This was not an application error.
- Initial UI fixture needed explicit machine UUID in scan events after review fix; corrected synthetic seed. A screenshot taken before mobile sidebar transition was replaced after waiting for the real responsive layout. No production fixtures.

GEN2 source verification used read-only cached data and existing source on Central. Bridge ingestion, live release and notification outcomes are recorded separately after deployment; the local tests do not establish those outcomes.
