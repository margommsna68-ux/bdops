# Server-scoped user access — 24 October 2026

Owner: a user assigned An-01 sees/operates only that server and its bound VM, SDK and proxy data. No common unassigned stock. Multiple servers supported; SELECTED empty grants none. Existing memberships default ALL; no real user grants changed by release.

## Implementation

- Additive membership fields serverScope/allowedServerIds; ADMIN grant UI uses accessRevision and validates project, role and server IDs inside transaction, with audit.
- Shared scope resolution and membership locks in mutations; checks run before idempotent replay. Filter before counts/pagination/search/facets/copy; reject foreign targets and mixed writes.
- Web and ops API use the same boundaries. API /me documents nullable serverIds. Existing capability/token/security rules remain intersections. Removed grants invalidate further API writes and retained jobs.
- SDK provenance/history redacted across moves; shared endpoint writes denied if any affected current server is outside scope. Common stock and project-wide business/financial/history/legacy AutoType routes fail closed. Settings returns only safe project context.

## Verification

- Seven dedicated test files cover membership unit/UI/integration, workspace/route/replay, SDK, proxy and ops API boundaries (60 tests).
- Real local headless Chrome on production build: 18/18 checks, admin + scoped USER, 1280px and 390px; data read back through actual API. Includes settings, own status write, foreign write refusal, mixed stock isolation and grant removal while user page stays open. No video, no production test user or data writes.
- Two independent source reviews: no remaining P1 in reviewed paths after fixes to global-route classification, legacy AutoType, bulk transaction authorization and old SDK event notes.
- Typecheck passed; lint no errors (six existing warnings); production build passed.
- Regression harness maintenance: current label is Tiền trong VM; assigned DESIRED proxy is LIVE and UNCERTAIN is REVIEW (old NEW-filter expectation corrected). Vite failed to transform a Windows CRLF CLI hashbang; .gitattributes now keeps that unchanged CLI as LF. No API/client behavior changed for this workaround.

Full-suite result and deployment proof are recorded after their final completion below.
Final full suite: 175 files / 903 tests passed (127.34 s). Browser: 18/18, no JS errors. Build completed successfully. Backup before release: moneytohome-20261024-114054.dump; moon-01 encrypted copy verified including decryption.
