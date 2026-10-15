# Team Cash / USDT — local verification, 15 October 2026

Design and implementation plan approved by the user. Implemented sequentially in the existing worktree; no source pushed, no production migration or cutover. Independent review and final gates are recorded below when complete.

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
