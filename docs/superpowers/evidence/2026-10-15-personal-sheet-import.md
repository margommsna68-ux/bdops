# Personal proxy Sheet import — 15 October 2026

User authorized reading the latest Sheets, auditing duplicate/missing proxies and importing into the local trial, while preserving both source Sheets and old Railway data. This was a data operation using the existing models, not a production cutover.

## Sources and preservation

- personal: `1Cd3JlDuYlZRehi624vFwesk4I6KMZKyBk1svYLNyTXI`, HTTP 200 XLSX export, captured `2026-10-15T05:02:55.284Z`, 16915074 bytes, SHA256 `d6a53bbaa4dac575a998d665254ec5b6aacaf1f4fdf6c4f10a60fe27d6ebedbb`.
- genjy: `1_PQ7ZjCHl6wNzbRMdbFJsgF8hDjLRbMZPRyy3DyDve8`, HTTP 200 XLSX export, captured `2026-10-15T05:02:44.113Z`, 34117 bytes, SHA256 `859e82ac4a72619d3afb6ca862a92bf752eca576ce459989563192b95c12b037`.

- Main workbook: 30 tabs including 18 hidden historical/internal tabs; all original XLSX bytes preserved in an encrypted source snapshot. Only current classified rows feed current inventory/VM data. All Genjy tabs, bare IPs, notes and formulas were scanned; PCchung remains Genjy.
- Hidden SYSTEM_SNAPSHOT_THU expands to hundreds of MB of repeated JSON; avoided loading that text into Node. Stored the original compressed XLSX inside encryption plus current-tab JSON instead. Archive decode/checksum roundtrip matches the original download exactly. No hidden source history was silently dropped.
- Source access used only two Google GET exports. No write API or Apps Script action was called. No Railway command, migration, variable update or deployment was performed.
- Dedicated local target was validated as APP_ENV=trial, 127.0.0.1:55432/proxy_app_trial. A new PERSONAL_SHEET project was created atomically; no demo/legacy project rows were repurposed. Hash comparison confirms every pre-existing database row/value/relation remained unchanged.
- Raw workbooks, input plans and credential-bearing helper scripts are ignored/private under .runtime. Credentials and original notes/configurations are encrypted in the database; they are absent from this report and Git.

## Imported and verified

- Project `cmv92zr01000510hwh88f4yi9`: 10 servers, 574 source VM rows, 1362 proxy endpoints/port streams, 101 explicit replacement links; zero unresolved pair links. Source import hash `e0de0422da678acf868f404e67c51b7927005ece80cb69ddf4ebb2b843885886`.
- 1172 distinct final IPs. 1362 endpoints cover current inventory, historical replaced endpoints and external port streams; these figures are not interchangeable.
- 724 Genjy IP identities reserved permanently; 33 PC/chung identities included. No Genjy endpoint is a DESIRED/INSTALLED allocation for the user's pool; the one source conflict is held UNCERTAIN for review.
- No ordinary IP is duplicated between VM rows. Exception 23.142.16.73 has 41 distinct VM ports, matching the previously confirmed external stream policy. All active allocation keys are unique.
- Zero literally blank VM slots, zero eligible unassigned SELF NEW proxies. One “ko có VM” source row is preserved as PLACEHOLDER, never autofill-eligible.
- 550 recorded configurations await actual operator verification; none was marked installed by this import. The other 24 source rows require review. This does not claim that 550 real machines need reinstallation.
- Exact decryption comparison: all 1362 endpoint credential pairs match their source rows; all original source-row notes and all 574 VM source values remain exact. Desired configuration proxies match Sheet values. Re-running the same import returns replay=true without duplicate rows.
- Real project has only the existing owner/manager membership. Both demo operator and viewer were denied access. Browser verified the selected real project, 574 rows / 0 missing / 550 pending / 24 review and disabled autofill with no missing slot. Build, type/lint steps and git diff whitespace validation passed; four inherited agent-PP lint warnings unchanged.

## Rows to review

17 rows have a recognized package but the Sheet's owner group is still unknown; five are outside final and lack a confirmed package/owner; one is Genjy/PC; one is a placeholder. All 24 have linked work items and visible server/VM review notes. Unknown evidence was not overwritten with an inferred SELF owner.

| Server | VM row | IP | Review |
|---|---|---|---|
| anhlong | M-002 | 178.94.227.164 | Chưa rõ nhóm sở hữu |
| anhlong | M-009 | 178.94.227.168 | Chưa rõ nhóm sở hữu |
| anhlong | M-034 | 51.194.103.2 | Proxy ngoài final / chưa rõ gói |
| anhlong | M-035 | 82.22.114.102 | Proxy ngoài final / chưa rõ gói |
| moon1 | M-026 | 178.94.226.162 | Chưa rõ nhóm sở hữu |
| moon1 | M-029 | 84.32.137.52 | Proxy của Genjy đang ghi trên VM |
| An-01 | VM_063 | 178.94.227.163 | Chưa rõ nhóm sở hữu |
| vt-01 | VM_006 | — | Xác minh dòng không có VM |
| vt-02 | VM_013 | 122.8.74.58 | Proxy ngoài final / chưa rõ gói |
| vt-02 | VM_029 | 178.94.226.136 | Chưa rõ nhóm sở hữu |
| vt-02 | VM_030 | 178.94.226.147 | Chưa rõ nhóm sở hữu |
| vt-02 | VM_034 | 178.94.226.180 | Chưa rõ nhóm sở hữu |
| vt-03 | VM_011 | 178.94.226.181 | Chưa rõ nhóm sở hữu |
| vt-03 | VM_014 | 178.94.227.171 | Chưa rõ nhóm sở hữu |
| vt-03 | VM_027 | 178.94.226.183 | Chưa rõ nhóm sở hữu |
| vt-03 | VM_033 | 178.94.226.185 | Chưa rõ nhóm sở hữu |
| vt-04 | VM_009 | 178.94.227.152 | Chưa rõ nhóm sở hữu |
| vt-04 | VM_030 | 178.94.227.154 | Chưa rõ nhóm sở hữu |
| vt-04 | VM_043 | 178.94.227.157 | Chưa rõ nhóm sở hữu |
| vt-04 | VM_045 | 178.94.227.175 | Chưa rõ nhóm sở hữu |
| moon05 | VM_069 | 178.94.227.198 | Chưa rõ nhóm sở hữu |
| moon05 | VM_070 | 178.94.227.196 | Chưa rõ nhóm sở hữu |
| moon05 | VM_071 | 122.8.67.87 | Proxy ngoài final / chưa rõ gói |
| moon05 | VM_072 | 122.8.67.88 | Proxy ngoài final / chưa rõ gói |

The exact Genjy conflict is moon1/M-029, source `moon1 !B29`, IP 84.32.137.52 also in Genjy `PCchung!A16`. The earlier async wording VM_029 referred to that row; the stored VM code is M-029. User confirmation is pending; the import did not change ownership or real machine settings.

## Backup and recovery

Pre-import encrypted system backup `2bb38906-d1a6-4708-90e3-1bb21e375b1c` retained. Final post-import backup `6fdae8f2-6f86-450e-8bd6-d3940042bdd8` is 32881959 bytes, SHA256 `28001137c84ecd44fd36f4cebbc3ee752db7abb77cf899b14135b96d67b2b625`. Restored to the separate empty `proxy_restore_1792041513714` database; all 39 tables, original rows, encrypted credentials, exact cash quotes, receipt links and v4 history passed verification. The active application was not a restore target. Earlier pre/post-import backups are retained.

## Remaining boundary

This is a local snapshot-based trial, not live two-way Google sync. The source mode is visibly labeled. Historical raw workbook content remains available for lookup; no unclassified historical row was promoted to current stock. No machine configuration or installation was performed. The pending user questions affect resolution of review rows, not the completed preservation/import of their original values.

Final browser check selected PERSONAL_SHEET and filtered Server/VM to Cần kiểm tra. All 24 records show the source value and a specific review reason; the 17 known-package rows say ownership is unknown, not that the package is missing. No new product dependency, schema migration, allocation to a different VM or actual install was introduced. Trial banners were corrected to describe local recording rather than incorrectly claiming that every project still contains sample data.
