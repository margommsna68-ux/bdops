# Team Cash / USDT — local verification, 15 October 2026

Design and implementation plan approved by the user. Implemented sequentially in the existing worktree; no source pushed, no production migration or cutover. One fresh independent review completed; three Important findings and one author-found database invariant were reproduced RED and fixed GREEN in one pass. Final gates are recorded below.

## Preserved legacy copy

- Authenticated recovery archive SHA256: `ed93f1c29e978e1436d49165735de138d61dfb10f3210d4c52d0659815477963`.
- Legacy schema fingerprint: `c83ad17b9c0aa331f9147b32f98e55525c16634907b4b418cd6775f972daec58`. Same named column definitions, constraints, indexes and enums as 0_init; physical column positions differ from historical db-push operations and are intentionally excluded.
- 26 original tables, 1120 original rows. Every original primary key, typed value and relationship was compared before/after migration and after a separate synthetic QA project. Numeric values canonicalized as exact server-side text, timestamps UTC and JSON canonicalized; no money converted through JavaScript float. Private row keys were not committed.
- 4 TEAM_PAYMENT candidates retain unknown actual USDT; 3 BILL/OTHER candidates require classification; 1 COMMISSION_WITHDRAW stays separate. No confirmed team receipts invented for original projects.
- Legacy credential decryption verified with the actual current Railway encryption key, loaded only into an isolated rehearsal child. The older saved desktop env had a different key; it was preserved, and the verified key is in the private recovery directory. No secrets or copied account rows appear in this report.
- Separate synthetic case: received `100.000000`, cost `105.000000`, net `-5.000000` USDT. Original projects still match their prior hashes.

## New backup roundtrip

- Backup `61ebf9b0-7006-4be9-9b26-b83b086b7299`, 248532 bytes, SHA256 `92515019cb5c306c4edd443f16d982df916f466e091b9aa4a87e0661e8597edf`.
- 39 tables verified in a separate empty `proxy_restore_*` database, including exact original amount/rate/USDT strings, source receipt links, journal v4 decryption and encrypted sample credentials.
- All original rows preserved. AuditLog includes the expected one backup-start event; no table omitted from count validation. Active application database not a restore target.

## Behavioral gates

- RED→GREEN converter boundaries, frozen quotes, exact signed micro-USDT allocation, scope/replay/rollback, global receipt reference/source uniqueness, v3 history projection, collector wallet and undo ownership.
- Ten deterministic write-versus-settlement cases (both acquisition orders) cover edit, insert, move into/out of period and undo. A committed closed report stays consistent.
- Old settled USD snapshots/paid facts unchanged. New USDT periods lock converted VND costs. Legacy monetary history revert cannot bypass the cash flow.
- Binance public P2P BUY/VND endpoint returned a real quote in the manager UI. Saved only in the synthetic trial with source and timestamp; six-decimal receipt save also verified. Viewer with infrastructure-only permission saw no financial totals and direct costs navigation was denied. API tests also cover cash-authorized viewer, operator denial, revoked access and foreign project access.
- Pre-review full run: 192 tests/54 files passed before migration-test additions. Final counts and independent review follow in the completion record.

## Decisions during execution

1. Noninteractive Prisma migrate-dev refused its warning prompt. SQL generated with migrate-diff against the validated local test datasource and deployed after review; unrelated proposed FK action changes were omitted.
2. Extended existing hand-written USD/VND SQL checks in a separate migration so new currency codes and TEAM_RECEIVED/USDT are valid while old WITHDRAWN stays USD/VND.
3. User added Binance P2P during execution, then confirmed BUY USDT with VND. Quotes are explicit timestamped references bound to project/user and saved per record; provider errors never become an assumed rate.
4. Canonical schema comparison ignores physical column positions while keeping definitions/defaults/constraints/indexes/enum order. A genuine schema mismatch stops migration.

## Remaining real-data decisions

Real USDT amounts, dates and transaction references for the four historical team-payment candidates still require evidence. The app keeps them unverified. Railway cutover, off-host backup retention/monitoring, real Sheet import and conversion of real historical costs remain separate work; no sample IP lists were imported.

## Final verification and fresh review

- Implementation fix commit: `b8169b3`; review range was `c7247a2..2add333`. Reviewer ran read-only and did not independently repeat database/browser operations. No second reviewer was dispatched.
- 208/208 tests across 57 files passed after fixes, then passed again through Task 8 completion (11:54 Bangkok). TypeScript `--noEmit --incremental false` passed. Lint passed with the four inherited agent-PP hook warnings. Production Next.js build passed.
- RED run: 10 failures, all expected financial/control/constraint reproductions. GREEN: 16/16 targeted tests; whole suite 208/208. Two receipt lifecycle cases cover adding USD to draft and already-confirmed unlinked receipts, then void/restore. Nine linked-period cases cover historical TEAM_PAYMENT/BILL/OTHER, October void/image-undo, and six concurrent settlement races with deterministic barriers in both lock orders. Rendered UI verifies managed historical controls after reopen and unmanaged read-only rows; the backend full historical reopen→recalculate→settle cycle also passes.
- The additional author-found SQL three-valued CHECK loophole allowed confirmed amount/key with null reference text. A failing database write test now rejects it after additive `20261015030000_confirmed_receipt_reference`; prior applied migrations were not rewritten.
- Repeated real-copy rehearsal after the last migration: `proxy_cash_verify_final_1792039974226`, 26 tables/1120 original rows, all original values/links preserved before/after synthetic QA. Source archive and schema fingerprints above are unchanged. Still 4 unknown TEAM_PAYMENT, 3 BILL/OTHER, 1 separate commission and 0 inferred confirmed receipts in original projects.
- Latest encrypted backup after the last migration: `779aacb0-a5f9-4d63-a5a3-f8bf6b628a3b`, 248793 bytes, SHA256 `2e461fe1192e5cca19468e22498f9cc7cc29247ae0a73dfc0989a30fef4bc3dc`. Empty destination `proxy_restore_1792039977200`; all 39 tables, original rows, exact cash values/rates, receipt source links, credential and journal decryption verified. Earlier backups retained.
- Local manager UI verified saving a Binance BUY/VND quote and a six-decimal receipt. After final build the saved original money/rate/source/time renders correctly; no console errors. Viewer and operator with infrastructure-only grants see no money totals and direct /costs is denied. No module grants changed to make tests pass. Preview retained at http://localhost:3010/costs, synthetic PROXY_TRIAL only.
- No Critical findings. All Important findings fixed. Deferred minors: none. Real-data/production limitations above remain explicit.

## Exhaustive execution rulings

- Task 2: Ruling: migrate dev refuses a noninteractive warning prompt — generate the identical additive SQL using migrate diff from the validated local test datasource to the datamodel, without a shadow database — risk is caught by SQL review and deploy/persistence tests.
- Task 2: Ruling: generated SQL also proposed unrelated FK update-action changes from older handcrafted migrations — omit those changes and keep only cash schema plus checks — no VM/proxy relation behavior changes.
- Task 6: Ruling: prior SQL has USD/VND currency checks not represented in the Prisma datamodel — extend them in a second additive migration, retaining historical WITHDRAWN restrictions — without it USDT/EUR writes fail; no original money changes.
- Task 7: Ruling: user changed the rate source to Binance P2P during execution — add an explicit buy/sell reference quote with timestamp and a scoped authenticated snapshot; never revalue saved costs, never silently substitute USD=USDT — live provider outages remain visible and manual verified input stays available.
- Task 8: Ruling: restored legacy schema and 0_init have identical 336 column definitions, 79 constraints and indexes but different physical column positions from prior db-push history — fingerprint named columns in canonical name order, while preserving types/defaults/constraints/indexes/enum order — physical column order has no effect on named ORM writes; behavioral mismatch still stops migration.
- Final: Ruling: Binance quote representativeness/availability — retain explicit reference label, manual verified input and stored timestamp; official API and real trial fetch/UI were exercised — a reference may differ from executable market price, never silently becomes a paid rate.
- Final: Ruling: receipt reference equivalence — retain exact trimmed case-sensitive opaque references because network/provider canonicalization is unspecified — case variants can represent a repeated transaction; reconciliation remains necessary.
- Final: Ruling: inherited cross-project collector wallet aggregation — retain existing all-project wallet semantics while scoping the changed expense list — changing wallet totals here would reinterpret legacy funds; a future project-wallet contract is needed.
- Final: Ruling: reclassification after void of a linked cost — retain unique historical source ownership and explicit admin undo recovery — operator must use history rather than create a second conflicting classification.
- Final: Ruling: editing unmanaged legacy periods — preserve as read-only; expose actions only for managed rows supported by existing backend — legacy edits require separate migration/design and cannot be silently invented.
- Final: Ruling: production readiness and historical receipt/rates — this milestone stays local and actual legacy USDT/rates remain unverified — no production cutover or historical profit can be asserted from missing evidence.
- Final: Ruling: reviewer did not repeat backup/browser/decryption — rely on executor's actual guarded runs and saved masked evidence, then final gates after fixes — this is execution evidence rather than an independently repeated restore.

Cost notes for initial implementation rulings: generated SQL would risk migration mismatch if incorrectly reviewed; omitted unrelated FK edits would need a separate relation change if required; broader currency checks could admit an invalid unsupported code without the application validator; P2P reference prices may differ from executable prices; canonical schema comparison would miss a consumer relying on physical column positions (the ORM and rehearsal use named fields).

## Completion record

- Task 1: complete (commits c7247a2..17fbb43, tests: npm test -- src/__tests__/proxy-management/usdt-money.test.ts src/__tests__/proxy-management/business-workflow.test.ts src/__tests__/proxy-management/business-profit.integration.test.ts →    Duration  802ms (transform 110ms, setup 33ms, import 154ms, tests 362ms, environment 0ms))
- Task 2: complete (commits 17fbb43..d3bbc8e, tests: npm test -- src/__tests__/proxy-management/team-cash-schema.integration.test.ts src/__tests__/proxy-management/team-cash-rehearsal-guard.test.ts src/__tests__/proxy-management/business-finance.integration.test.ts →    Duration  862ms (transform 109ms, setup 33ms, import 162ms, tests 413ms, environment 0ms))
- Task 3: complete (commits d3bbc8e..aae33a8, tests: npm test -- src/__tests__/proxy-management/team-cash-access.integration.test.ts src/__tests__/proxy-management/team-cash-history.integration.test.ts src/__tests__/proxy-management/business-access.integration.test.ts src/__tests__/proxy-management/business-journal.integration.test.ts src/__tests__/proxy-management/business-review-regressions.integration.test.ts src/__tests__/proxy-management/history.integration.test.ts →    Duration  3.35s (transform 381ms, setup 51ms, import 1.27s, tests 1.52s, environment 0ms))
- Task 4: complete (commits aae33a8..ba4a187, tests: npm test -- src/__tests__/proxy-management/usdt-costs.integration.test.ts src/__tests__/proxy-management/usdt-cost-workflow.test.ts src/__tests__/proxy-management/team-cash-history.integration.test.ts src/__tests__/proxy-management/business-journal.integration.test.ts →    Duration  962ms (transform 108ms, setup 38ms, import 220ms, tests 366ms, environment 0ms))
- Task 5: complete (commits ba4a187..d6c3d36, tests: npm test -- src/__tests__/proxy-management/team-receipts.integration.test.ts src/__tests__/proxy-management/collector-reconciliation.integration.test.ts src/__tests__/proxy-management/business-review-regressions.integration.test.ts →    Duration  2.39s (transform 390ms, setup 34ms, import 951ms, tests 1.15s, environment 0ms))
- Task 6: complete (commits d6c3d36..f52dba5, tests: npm test -- src/__tests__/proxy-management/team-cash-report.integration.test.ts src/__tests__/proxy-management/team-cash-profit.integration.test.ts src/__tests__/proxy-management/team-cash-races.integration.test.ts src/__tests__/proxy-management/business-profit.integration.test.ts →    Duration  1.69s (transform 138ms, setup 39ms, import 290ms, tests 1.02s, environment 0ms))
- Task 7: complete (commits f52dba5..64d4eaa, tests: npm test -- src/__tests__/proxy-management/team-cash-api.integration.test.ts src/__tests__/proxy-management/team-cash-workflow.test.ts src/__tests__/proxy-management/binance-p2p.test.ts src/__tests__/proxy-management/usdt-costs.integration.test.ts →    Duration  1.32s (transform 383ms, setup 39ms, import 734ms, tests 213ms, environment 0ms))
- Task 8: complete (commits 64d4eaa..b8169b3, tests: npm test →    Duration  20.38s (transform 673ms, setup 349ms, import 4.87s, tests 10.36s, environment 4ms))

Keep-as-is was already selected by the approved plan: local feature branch/worktree and preview retained. No merge, push, deployment or production migration. This plan’s ignored scratch directory is removed only after this durable evidence is committed; unrelated plan workspaces are retained.
