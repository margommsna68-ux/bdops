# "Tiền VM" at the row (owner brief 22/10/2026)

What the owner sees in Server / VM: each VM's money as read on the machine for its current SDK code, right after Tình trạng, with the
observation time; no EarnApp account needed. Synthetic data only: test database and the local trial (`proxy_app_trial`). No host write,
no real VM, no Sheet, no video.

## Where the money comes from
- The same SDK records the AI writes through `POST /api/ops/v1/vms/{id}/sdk-observations` (sdk-observe.ts): `amount`,
  `amountObservedAt`, `amountSource`, and the new `amountFailedAt` (latest reading that could not read the money; additive migration
  `20261022200000_sdk_failed_at`). No second store.
- `src/lib/vm-money.ts` turns the VM's CURRENT code into one state: UNCHECKED / OK / STALE (> 24 h) / FAILED (last good figure kept with
  its own time) / NO_TIME (old money, write time never shown) / HIDDEN (no read right; the server sends no figure). Never a sum of the
  VM's codes, never the EarnApp balance; a replaced current code or a recreated VM shows "Chưa kiểm tra".
- Column key stays `payout` (saved layouts keep working; the Cột menu says "Tiền VM"). The frame: Tiền VM + Lịch sử kiểm tra (SDK
  timeline) → Số dư EarnApp (when an account exists) → Rút về PayPal (unchanged flow and rights).
- Filters `money=UNCHECKED|STALE|VM_FAILED`, sorts `sort=BALANCE|CHECKED_OLD` over the whole result before paging, in the URL; summary
  "Tổng tiền VM đã kiểm tra" with Chưa kiểm tra / Số cũ / Kiểm tra lỗi / Chưa rõ giờ counted apart. The page refetches every 30 s while
  visible and on focus; filters, page, selection and drafts stay.

## Checks
| Check | Result |
|---|---|
| Unit `src/__tests__/vm-money.test.ts` | states, sorts (unknown never 0, last), exact total, relative time |
| `money-column-ui.test.tsx` (React) | no account + no SDK = Chưa kiểm tra (button opens the frame), money without account, current code only, failed keeps the figure, hidden = Ẩn, $0,00 |
| `ops-sdk-observe.integration.test.ts` | an unreadable reading sets `amountFailedAt`, an older failure never moves it back, the grid carries it |
| Data through the real API on the local trial (`.runtime/p44-local-vmmoney.ts`) | `local-http-ops-client.txt` 9/9: $0.21 without EarnApp, $0, no SDK, failed after a good figure, 25 h old, no time, three codes, replaced current code; no finance / account rows |
| Browser (`p44-ui.js`, admin + a USER without the money right) | `local-browser.txt` 27/27: column after Tình trạng before Proxy, visible at 1280 with the sidebar; $0,21 / $0,00 / Chưa kiểm tra / $3,00 Kiểm tra lỗi / $7,50 Số cũ / $4,00 Chưa rõ giờ / three SDKs → current only / replaced code → Chưa kiểm tra; full time in the title; summary line; frame with history and the payout part (explanation without an account, the old flow with one); `money=UNCHECKED` and `sort=BALANCE` over the whole result, kept through Back and reload; Cột menu lists "Tiền VM"; the API writes $0.32 while the page is open and the row updates by itself; four themes; 390 px phone; "Ẩn" without the right |
| Screenshots | `shots/vm-money-table-1280.png`, `vm-money-cell.png`, `vm-money-cell-live.png`, `vm-money-theme-*.png`, `vm-money-phone.png` |
| Full suite / lint / tsc / build | see the commit message |
