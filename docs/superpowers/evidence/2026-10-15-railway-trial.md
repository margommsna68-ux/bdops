# Railway trial release evidence — 15 October 2026

User authorized completing the preparation and deploying a separate trial for practical acceptance. Functional source commit `4fb3764`; deployment `adbcc72e-53c3-473f-9587-ff30c5f2aa76` SUCCESS. URL: https://bdops-proxy-trial-proxy-trial-20261015.up.railway.app.

## Isolation and access

New environment `89cf3b0a-e19e-42c0-a789-cb884e3ee624`, web `7de07016-cac4-4292-a5d0-5f2f3a2e919e`, Postgres `eb39bf26-de22-4a86-bc0c-ad2d824a8b61`; `/data` backup volume. Application uses private DB networking; temporary import TCP route removed. Explicit IDs guard every remote mutation.

Local source was streamed into an empty new database; all 39 tables matched before cloud-only auth changes. Migration timestamp hashes normalize instants to avoid local Bangkok/host UTC text differences. All 1362 real credential pairs decrypt with the preserved application key. Local data unchanged except the deliberate encrypted pre-hosting backup audit. Hosted auth/backup secrets are freshly generated; encryption key retained for copied ciphertext. Owner username `tuntun`; secret values never included here.

All old demo passwords/PINs disabled and demo project memberships removed from cloud copy. Historical actors/rows retained for relational integrity. Only PERSONAL_SHEET is accessible to the owner. Release QA created private synthetic projects/users; their memberships/passwords were disabled at completion. One active password user and one membership remain.

## Verification

- Full suite: **217/217 tests, 58 files**. TypeScript and production build passed. Four inherited agent-pp hook warnings remain. Runtime npm audit **0 vulnerabilities**.
- Next 15.5.28 / React 19.3.1 / NextAuth 4.24.15 / ImapFlow 2.4.2 / official SheetJS 0.20.3. Unused Auth adapter removed; compatible patched PostCSS/nanoid/source-map-js overrides. Strict XML parser saxes 6.0.0.
- Independent reviewer: two Important findings, no Critical/Minor. One RED→GREEN fix pass: corrupt worksheet/comment XML, missing references, pre-expansion ZIP limits; parse worker limited to 8 seconds and 192 MiB old heap. Subsequent suite/types/build passed. No second implementation/review loop.
- Public Genjy export adapter matches original 721 unique source IPs, all four tabs, notes/formulas; earlier imported 724 reservations include historical evidence and remain permanent. Host sync measured **4088 ms**. Failure blocks allocation rather than accepting an empty/partial source.
- Browser: HTTPS dashboard correctly redirects to login. Authenticated functional verification used application HTTP APIs, not a claim of every UI screen being tested.

Eleven hosted check groups passed:

| Check | Result |
|---|---|
| Anonymous protected APIs | denied |
| Production seed endpoint | 403 |
| Owner login and project list | correct session; only real project |
| Imported infrastructure | 10 servers / 574 rows; none falsely marked installed |
| Live Genjy | successful; historical reservations retained |
| Viewer/operator/project isolation | writes/import/cross-project reads denied as required; operator VM scope allowed |
| Proxy workflow | NEW → BLOCKED → bare-IP replace, exact inherited credentials, replay safe, duplicates rejected, replace undo succeeds before dependent operations |
| VM workflow | eligible NEW autofill creates planned configuration; allocation undo restores prior state |
| Real dataset protection | endpoint/VM/allocation/replacement hashes unchanged by QA |
| QA cleanup | logins and memberships disabled; real owner only |
| Encrypted backup | created on persistent volume |

## Backup and restore

Local pre-hosting backup `4c0614fc-7611-47e5-b68f-84a755b974c8` retained. Host backup `93fa4645-3ed0-4c94-bd07-7a490077a86a`, bytes **35130091**, SHA-256 **f866ef4ac976768c9483351369264c281ff32034993eb4cdf3dfad1488f48c29**.

Encrypted archive downloaded to owner-only private-config; checksum and GCM verified. Separate restore on host into newly created empty database `proxy_restore_host_1792044921142`: **39 tables / 13916 rows**, every original value/relation preserved (AuditLog allows the later backup-completed entry), **1362 real credential pairs verified**. Active app database unchanged. Restore database retained privately for verification, no user membership or public route.

Private logs/config reside under `.runtime` and `../private-config/railway-trial-2026-10-15`, excluded from upload/image/Git. A clean committed-source export was uploaded; no .env/runtime/archive/key files included. Source Sheets never written in this release.

Legacy Railway read-only integrity audit at 06:11:15 UTC: **26 tables /1120 rows, 0 changed tables** against the retained recovery baseline. Old production deployment/database not migrated or replaced.

## Practical limits

This is a hosted acceptance trial, not a source-of-truth cutover. VM installation requires operator confirmation. Snapshot still has 24 review rows and no eligible blank/NEW pool; five Proxiware notes remain metadata, not invented catalog ownership. Original Sheet Proxiware manual notes are still pending the earlier editor connection issue. Automatic backup schedule/retention, production monitoring and a final workflow cutover follow acceptance. No automated VM agent or collector receipt inference.
