# Railway trial — 15/10/2026

User authorized completing preparation and deploying a separate hosted trial on 15 October. This supersedes the earlier milestone's local-only limit for this new trial, but never authorizes changing the old Railway database or source Sheets.

## Intent and approved scope

The owner tests real proxy/VM data from phone/Mac. Reuse the existing app and rules; do not introduce a new business workflow. Separate web service and PostgreSQL, strong private owner access, live read-only Genjy scan, encrypted backups, reversible operations and a clear handoff in this source folder. Sheet remains a reference; hosted edits do not write back to Sheet.

## Tasks (sequential)

1. Prepare release: audit and patch vulnerable runtime dependencies, exclude private files from upload/image, configure persistent backups and PostgreSQL client. Verify build/auth compatibility.
2. Replace the Windows-only Genjy snapshot configuration with a bounded public XLSX read adapter for the already-shared workbook, scanning every tab/notes/formulas and retaining permanent reservations. Failure must fail closed. RED→GREEN tests for hidden tabs, malformed/unavailable/oversized input. Preserve authenticated adapter.
3. Create isolated Railway app/database and backup volume. Clone local trial data with credentials encrypted, verify counts/relations, disable demo logins and remove demo memberships from the hosted copy; give the owner private credentials. Keep local and old Railway untouched. Fresh environment secrets; preserve the app encryption key needed by the copied data.
4. Verify the hosted login, project permissions, Genjy refresh, proxy replacement preview/commit/idempotency/undo and backup/restore using a separate QA project, then leave only the real project accessible. Download a verified encrypted backup to this machine. Record URL, deployment ID, versions, test evidence, limitations and recovery instructions; give the user a short guide.

## Checks and review focus

Full tests/types/lint/build; fresh runtime audit; no upload of .env/.runtime/keys/archives/history; unauthenticated APIs blocked; all demo passwords disabled; Genjy immutable and no cross-project VM access; real counts match local; no real replacement test writes. Restore only into a new empty target. Independent final release review before sharing the URL.

## Decisions

- Separate services in the existing Railway project avoid touching the old web/Postgres; explicit service IDs are required for all mutations.
- Public XLSX mode uses only the configured Google spreadsheet ID and bounded reads; no cookie extraction or Google write access. Authenticated Sheets mode remains available if link sharing changes.
- Staging is for practical acceptance, not a cutover or confirmation of physical VM installation. The 24 review rows remain visible.
- The owner's password/PIN and keys are saved only in ignored private handoff/config files; reports and Git contain no secret values.

## Progress

- [x] Release dependencies and packaging: Next 15.5.28, React 19.3.1, NextAuth 4.24.15, ImapFlow 2.4.2, SheetJS official 0.20.3; unused Auth Prisma adapter removed. Scoped compatible PostCSS/nanoid/source-map-js patches. Runtime audit zero. Private files excluded from both upload and Docker image.
- [x] Live Genjy adapter: shared Google XLSX, all tabs/hidden/notes/formulas; 20 MiB download/expanded budget, XML/reference validation, parser worker with 8-second/192 MiB heap bound. Permanent reservations retained. Live source 721 IPs matches original Genjy snapshot; inventory retains 724 reserved identities including other historical evidence.
- [x] Isolated cloud data/auth/backup configuration: new environment `proxy-trial-20261015`, app `bdops-proxy-trial`, dedicated Postgres and `/data` volume. Streamed clone verified all 39 tables and all 1362 encrypted credentials. One active password account and one real-project membership; synthetic accounts/data retained without login/membership for history integrity.
- [ ] Hosted verification and handoff

## Execution evidence / rulings

- Existing isolated `feat/proxy-inventory` worktree reused. This small release-preparation plan implements the already authorized four steps; no repeated design approval required.
- Initial Next/React upgrade: 214 tests/58 files, types and production build passed. Four existing agent-pp hook warnings remain; runtime audit zero.
- Independent release reviewer found two Important issues: partial malformed XML accepted by SheetJS and limits applied only after expansion. One RED→GREEN fix pass added strict XML/relationship validation, pre-expansion ZIP limits and a bounded worker. Corrupt worksheet/comment regression cases failed first, then passed. No Critical/Minor findings.
- Clone diagnostic: only `_prisma_migrations` fingerprint differed because local timezone was Asia/Bangkok and host UTC. Normalize the three migration timestamp instants as epoch; every row, checksum and relation then matched. The already copied target was verified before auth changes; no second import/overwrite occurred.
- The legacy `serviceInstanceUpdate` endpoint returned an error and CLI name-based edit silently reported no changes for the newly created service. Applied an explicit environment patch scoped to the new service ID and read it back; old services untouched.
- A temporary password-protected PostgreSQL TCP route is used for guarded data comparison/import. Remove it after hosted verification; application uses private Railway networking.
- Actual VM installation remains unconfirmed. The 24 review rows, Proxiware notes and Genjy conflict remain unchanged. No source Sheet writes.
