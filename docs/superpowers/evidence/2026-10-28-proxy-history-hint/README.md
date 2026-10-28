# Kho proxy: gợi ý lịch sử khi tìm IP đã replace — 28/10/2026

Owner could not find 95.135.204.110 (replaced 24/10) because the registry opens on "Đang quản lý", which hides replaced rows, and the
search there returned an empty table. Owner approved a hint. Commit 3e4a39a on feat/proxy-inventory (worktree), no migration.

## Change
- `queryRegistry` (src/server/proxy-management/history.ts): when `view=CURRENT`, a search text is given and no current row matches, the
  same search is run over historical rows (REPLACED / VOID / RETIRED) and `historyHint {total, rows[≤5]}` is returned with each
  row's ip, port, state, retiredAt and the APPLIED replacement (`replacedBy`, `receivedDate`). Null otherwise (rows found, other views,
  no search, unknown IP). Credentials are never included; the full `IP:port:user:pass` paste is normalised as before.
- `RegistryTable` empty state shows "IP này không còn ở tab Đang quản lý, chỉ còn trong lịch sử:" with `IP · Đã replace bằng X (nhận
  dd/mm/yyyy)`, a "Xem lịch sử" link (opens the IP timeline) and a button "Mở tab Lịch sử IP" that switches the view and keeps the
  query. Style `.pm-history-hint` (sticky inside the horizontally scrolling table so it stays visible at phone width); bronze theme CSS
  regenerated.

## Verification
- TDD: `registry-history-hint.integration.test.ts` red (historyHint undefined) → green; `history.integration.test.ts` green; the whole
  `src/__tests__/proxy-management` folder 1,021 tests green after regenerating the bronze CSS (the only failure was the sync test
  before regeneration). Typecheck clean; eslint only the pre-existing `exhaustive-deps` warning.
- Local Chrome against the synthetic trial project (55432 DB, dev server :3010): 10/10 checks (`ui-check-result.json`): hint on CURRENT
  search by IP and by full proxy (no credentials echoed), 0 rows, button → `?tab=history&q=` with the replaced row listed and no hint,
  unknown IP → plain empty state, phone width 390 px fits, no page errors. Screenshots `ui-hint-element.png`, `ui-history-row.png`,
  `ui-hint-phone.png`. No video.

## Release
- Stage built from a copy of the LIVE application source (D:\MoneyToHome\app, fleet WIP + merged payout) plus the six patched files,
  `next build` → BUILD_ID `VbZrBM9no6iLnhI2GhzDB`. Backup `moneytohome-20261028-113204.dump` + encrypted moon-01 copy verified.
- Deployed 28/10/2026 11:33 Bangkok by `tools\deploy-proxy-hint.ps1` (folder swap, migrate status "up to date", 46 migrations, no
  migration added). Public `_buildManifest` 200, login 200. Rollback `D:\MoneyToHome\app-before-proxy-hint-20261028`.
- Host read-only fingerprint identical before/after (678 VM / 1,486 proxies / 148 links / 150 logins / 16 payouts / 0 funds / 8 costs).
  On the host, `queryRegistry` CURRENT search for 95.135.204.110 now returns 0 rows + hint "REPLACED, thay bằng 178.94.226.124".
- No logged-in production UI screenshot (owner 2FA); UI verified on the local synthetic project only.
