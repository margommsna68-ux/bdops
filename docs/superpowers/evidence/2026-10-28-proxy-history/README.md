# Proxy cũ từ Sheet đưa lên web để tra cứu — 28/10/2026

Owner request (28/10/2026): Kho proxy on the web lacked some OLD proxies, so a re-delivered old IP from the provider could not be
detected. Current proxies on the web match reality (owner statement); only history was added. No deploy, no migration, no VM action.

## Source
- Proxy source Sheet `1Cd3JlDuYlZRehi624vFwesk4I6KMZKyBk1svYLNyTXI`, public XLSX export fetched 28/10/2026 ~10:30 Bangkok,
  sha256 `9aa078b0dcc35b88284ddffc023fa38bf18febe523f60c68ca7c731a205a7481` (private copy in `.runtime/sheet-history-20261028/`).
- The visible tab `Proxy Server` (gid 1025017506, 1,463 proxies) is already fully on the web: 0 missing IPs. The web has 2 more
  endpoints than that tab (178.94.226.124 on vt-01/VM_033 and 178.94.226.222 on An-01/VM_015, Account VietPhe, replaced on the web
  after the 24/10 reconciliation).
- The old proxies live only in hidden tabs: `Total` (columns "replace ngày 23/09": 231243 15 pairs, 232180 24 pairs, 236273 3 pairs)
  and `PROXY_SERVER_TRUOC_GOM_THU` column F notes. The 27,012-row `SYSTEM_SNAPSHOT_THU` JSON history (189 snapshots, 29/09→22/10)
  confirms the same set in its `baseline`; the raw-cell regex count of 254 "missing" IPs there was an artefact of JSON chunk boundaries.
- Exact gap: **21 IPs** absent from the web — 17 with full credentials (14 × 231243, 3 × 236273) replaced on 23/09/2026 and 4 BLOCKED
  IPs known only by address (84.32.136.28 → 84.32.136.163 → 84.32.136.174; 84.32.136.74 → 84.32.139.240; 84.32.136.93 → 95.135.204.88).

## What was written (one Serializable transaction, batch kind `SHEET_HISTORY`, key `SHEET-HISTORY-35420eed7269320afbc2f59f`)
- 21 new identities + endpoints, state **REPLACED** (status RESERVED, `retiredAt`/`statusAt` 23/09/2026 for the 17; null for the 4 bare
  IPs whose exact date is unknown, before 29/09/2026). Group inherited from the replacement proxy (SELF, or GENJY + PC_CHUNG), never an
  owner decision. Package from credentials (231243 / 236273); bare IPs have no package. Credentials encrypted as usual.
- 45 `ProxyReplacement` links dated 23/09/2026: 21 for the new rows and 24 for the 23/09 pairs whose old proxy was ALREADY on the web
  (all QUARANTINED "Cần kiểm tra", 232180) — their state was NOT changed; one pair (84.32.138.214 → 158.46.197.228) was already linked.
- 70 `ProxyStatusEvent` rows (SHEET_IMPORT / BLOCKED / REPLACED) whose `sourceRef` is the human-readable note shown in "Lịch sử IP":
  "Thay bằng <IP mới> — Sheet proxy › Total!B3:C3 (replace ngày 23/09/2026)" and a full explanation that the row exists only for
  look-up when the provider hands the IP back. `ProxySourceSnapshot` sourceKey `PERSONAL_SHEET_HISTORY` + references (not the key used by
  "Đối chiếu Sheet"). Journal `SHEET_HISTORY_IMPORT` (not reversible), audit `SHEET_HISTORY_IMPORT`.
- Backup before: `moneytohome-20261028-105902.dump` + encrypted copy verified on moon-01 (`backup.log` 10:59/11:00 Bangkok).

## Verification (read-only, product services)
- Pasting the 17 full old proxies into "Nhập proxy mới" now returns HISTORICAL_IP "Đã replace bằng <IP mới> 23/09/2026" (SELF) or
  GENJY_RESERVED "IP thuộc nhóm chung mooon–Genjy" (PC chung); the 4 bare IPs pasted with any credentials return GENJY_RESERVED.
- Timelines (`getProxyTimeline`) show the replacement chains and the notes; registry lists all 21 under "Đã replace" (124 rows).
- States after: LIVE 1,298 / NEW 5 / BLOCKED 6 / QUARANTINED 52 / RETIRED 1 unchanged; REPLACED 103 → 124. Endpoints 1,465 → 1,486,
  replacement links 103 → 148. Re-running the script replays (no second write). Dry run (rolled-back transaction) preceded the apply.
- Not done: no browser screenshot (owner 2FA login), no Sheet write (the Sheet already holds this history in its hidden tabs).
