# Operation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Continue the user's chosen sequential inline execution.

**Goal:** Safe per-operation undo, encrypted full application database backup, fewer UI steps.

**Architecture:** Immutable encrypted before/after journal inside existing transactions. Compensating undo uses fresh project ADMIN scope and resource fingerprints. System backups stream pg_dump through authenticated encryption; restore only into a new empty local database.

**Tech Stack:** Existing Prisma 5/PostgreSQL 17, Node crypto/streams, tRPC, React.

**Spec:** `../specs/2026-10-14-operation-history-design.md`

## Global Constraints

- Genjy ownership/subgroup never reverted. Received IP history never erased. Revision only increases.
- No example/provider data import, no live database overwrite, no public deploy.
- Existing historical operations without before-images cannot be undone.
- Fresh ADMIN of exact project for undo; server-configured system owner for full backup.
- Normal fast save still executes the same preview/token/commit checks; invalid and unknown-package input stops for review.

## Review Focus

1. A new write/VM binding after an operation blocks all undo, with no partial restoration.
2. Double undo/replayed commit cannot reactivate withdrawn endpoints.
3. Undo blocked clears that health event's allocation risk but preserves IP received detection.
4. A project administrator must not obtain another project's backups or undo records.
5. Wrong key/corrupt backup/process failure cannot publish a valid backup or write restoration data.

### Task 1: Atomic journal and guarded undo

Files: Prisma schema/migration; `src/server/operation-history/{snapshot,journal,undo}.ts`; proxy batches/catalog/capabilities/repository/history; integration test `operations.integration.test.ts`.

Interfaces: `captureEndpoint(row)`, `recordOperation(tx, {scope,kind,summary,snapshot,batchId?})`, `listOperations(scope)`, `inspectOperation(scope,id)`, `undoOperation(scope,id,reason)`. Snapshot union covers endpoints, provider accounts and member access; encrypted only. Created endpoints become retired QUARANTINED, created catalog account disabled, BLOCKED events receive reversedAt, receipt VOID. Existing fields restored with incrementing version.

- [ ] Write RED tests for block -> undo -> eligible, replacement -> undo -> duplicate detection, NEW -> undo -> replay, fresh role/cross-project denial, changed revision/VM linkage rejects whole operation, catalog/member restoration and immutable Genjy.
- [ ] Add additive journal/events migration, generate Prisma and migrate guarded app/test databases.
- [ ] Capture before/after in existing transactions, implement strict comparison and append undo/audit; expose masked history API.
- [ ] Run integration cases and existing inventory suite; commit only after GREEN.

### Task 2: Encrypted full backup and isolated restore

Files: `src/server/system-backups/{archive,service}.ts`; `scripts/restore-backup-trial.ts`; tRPC routes; `.env.example`; backup tests/runbook.

Interfaces: `createSystemBackup(actorId)`, `listSystemBackups(actorId)`, stream archive sealing/opening; root owner ID, absolute server directory, separate key, PG binary paths. API returns metadata only.

- [ ] RED unit tests for owner denial, encryption authentication/corruption, target database guard and process failure.
- [ ] Write pg_dump stream -> encrypted UUID temporary archive -> checksum manifest; publish manifest last. Implement restore CLI that verifies first, requires empty isolated local database, uses pg_restore without clean/create.
- [ ] Configure synthetic trial owner and D backup path without printing keys; create a real trial backup and restore into a new proxy_restore_* database; compare counts and decrypt sample.
- [ ] Record backup date/checksum/result, document separate key/off-machine storage requirement and manual process; commit GREEN.

### Task 3: Simple UI and history

Files: `BatchDialog.tsx`, `RegistryTable.tsx`, `OperationHistoryDialog.tsx`, `SystemBackupDialog.tsx`, CSS and quick-save orchestration tests.

- [ ] RED tests: clean preview automatically commits; error/unknown package stops; failed commit preserves retry token; editing invalidates preview.
- [ ] One primary Kiểm tra và lưu button, optional fields in details, explicit save for reviewed partial rows. Neutral statuses and settings dropdown. History shows before/after with reason/confirm undo; backups accessible only system owner.
- [ ] Rebuild and restart own loopback preview; browser test save/undo/conflict and backup; run full tests/types/lint/build; commit verified result.

### Task 4: Whole-site inventory and next milestone

Files: `docs/runbooks/site-consolidation.md`; parent deployment master plan.

- [ ] Preserve read-only site inventory findings: legacy dashboard finance, server assignments intentionally blocked, EarnApp vms route not personal VM, fragmented history/notification links.
- [ ] List concrete next sequence: dedicated VM/reservation/desired vs installed confirmation; operational dashboard/nav; fresh Sheet import; public dependency/auth/storage gates; later business modules. No claim those are complete in this milestone.
- [ ] Report the functioning local result and material remaining scope in Vietnamese.
