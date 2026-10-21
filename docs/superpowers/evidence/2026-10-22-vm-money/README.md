# "Tiền VM" at the row (owner brief 22/10/2026) + independent acceptance review of eced7af

What the owner sees in Server / VM: each VM's money as read on the machine for its current SDK code, right after Tình trạng, with the
observation time; no EarnApp account needed. Synthetic data only: test database and the local trial (`proxy_app_trial`). No host write,
no real VM, no Sheet, no video.

## Where the money comes from
- The same SDK records the AI writes through `POST /api/ops/v1/vms/{id}/sdk-observations` (sdk-observe.ts): `amount`,
  `amountObservedAt`, `amountSource`, `amountFailedAt` (latest reading that could not read the money; migration
  `20261022200000_sdk_failed_at`) and, after the review, WHERE each reading was checked: `amountVmId` / `amountCycle` and
  `amountFailedVmId` / `amountFailedCycle` (migration `20261022230000_sdk_money_binding`, additive; old figures bound to the current VM +
  round of their code, identity only). No second store.
- `src/lib/vm-money.ts` turns the VM's CURRENT code into one state from the readings bound to THIS VM in ITS CURRENT ROUND: UNCHECKED /
  OK / STALE (> 24 h) / FAILED (last good figure kept with its own time) / NO_TIME (old money, write time never shown) / HIDDEN (no read
  right; the server sends no figure). A code put back after a recreation or moved from another VM keeps its stored figure as history
  (`stored`, said in the frame) and reads "Chưa kiểm tra" until checked again on that VM + round. Never a sum, never the EarnApp balance.
- The ops API says the same: `GET vms/{id}` items carry `amount` / `observedAt` / `failedAt` of this VM + round, `moneyState` (the web's
  state) and `stored` apart; `GET sdks` adds `failedAt` / `observedCycle` / `observedVmId`.
- Column key stays `payout` (saved layouts keep working; the Cột menu says "Tiền VM"). The frame: Tiền VM + Lịch sử kiểm tra (SDK
  timeline) → Số dư EarnApp (when an account exists) → Rút về PayPal (unchanged flow and rights).
- Filters `money=UNCHECKED|STALE|VM_FAILED`, sorts `sort=BALANCE|CHECKED_OLD` over the whole result before paging, in the URL; summary
  "Tổng tiền VM đã kiểm tra" with Chưa kiểm tra / Số cũ / Kiểm tra lỗi / Chưa rõ giờ counted apart. The page refetches every 30 s while
  visible and on focus; filters, page, selection and drafts stay.

## Independent review of eced7af (`.runtime/review-vm-money-eced7af.test.ts`)
Run unchanged before the fixes: 3/3 red (preview `before.amount` leaked 731.25 to a user without the right; a code chosen again after a
recreation showed its round-1 $12.34 as checked; `GET vms/{id}` could not tell a failed latest reading). After: 3/3 green with the same
expectations, and the earlier four-case suite still 4/4 (`review-suites-after-fix.txt`).
- previewSdkStore: the stored amount is never sent without the money read right, on every outcome (SAME, UPDATE, ERROR, repeats);
  `moneyHidden` on each row. previewSdkPaste / previewVmBulk never carried the stored amount (they refuse money lines without the write right).
- Readings bound to VM + round (above); web edits bind to the holder VM's current round; undo restores the binding with the figure.
- API `moneyState` / `failedAt` / `stored` (above), shared state code with the web.
- Evidence corrections: the earlier `local-browser.txt` had FAIL T11 (a script regex expected date-before-time; the app shows
  "Kiểm tra lúc 21:15 21/10/2026" — product correct, script fixed) while the summary said 27/27 — wrong, corrected here; the three dark /
  golden / bronze screenshots were identical because the script wrote localStorage instead of picking the theme — now picked in
  Thiết lập → Giao diện and confirmed on `<html data-theme>` before each screenshot (four distinct files).

## Checks (last run)
| Check | Result |
|---|---|
| Unit `src/__tests__/vm-money.test.ts` | states incl. `stored` history, sorts, exact total, relative time |
| `money-column-ui.test.tsx` (React) | no account + no SDK = Chưa kiểm tra, money without account, current code only, failed keeps the figure, hidden = Ẩn, $0,00 |
| `sdk-money-rights.integration.test.ts` | reads / writes by right; preview masking (code only, malformed money cell); undo restores time + source; recreate → reselect reads UNCHECKED (web + API + `stored`), checked again → OK, moved code reads UNCHECKED on the target with the source reading as history |
| `ops-sdk-observe.integration.test.ts` | unreadable reading sets `amountFailedAt`, an older failure never moves it back, the grid carries it |
| Reviewer suites | `review-vm-money-eced7af` 3/3, `review-sdk-survey-20261021` 4/4 |
| Full suite / lint / tsc / build | 148 files / 735 tests, lint 0 errors, tsc clean, build OK |
| Data through the real API on the local trial (`.runtime/p44-local-vmmoney.ts`) | `local-http-ops-client.txt` 10/10: $0.21 without EarnApp, $0, no SDK, failed after a good figure, 25 h old, no time, three codes, replaced current code, recreated (round 2) + code chosen again keeps $12.34 of round 1; no finance / account rows |
| Browser (`p44-ui.js`, admin + a USER without the money right) | `local-browser.txt` 34/34: T1–T24 as before (column, states, full time in the title, summary, frame, EarnApp VM with the old payout flow, `money=UNCHECKED` and `sort=BALANCE` over the whole result through Back and reload, Cột menu, live update after an API write, four themes picked in Thiết lập and confirmed, 390 px, "Ẩn" without the right); T25 Kho SDK preview of an existing code as the user without the right shows no money; T26 after 36 s auto-refetch the typed SDK draft, the two ticked rows, the money filter and the URL are kept; T27–T30 recreated + reselected VM reads "Chưa kiểm tra", the frame names the $12,34 of round 1 as history, the API says UNCHECKED + stored, a new reading on round 2 shows $0,05; T31 API GET of the failed VM: `moneyState: FAILED`, `failedAt` newer than `observedAt`, $3 kept |
| Screenshots | `shots/vm-money-table-1280.png`, `vm-money-cell.png`, `vm-money-cell-live.png`, `vm-money-theme-{light,dark,golden,bronze}.png` (distinct), `vm-money-phone.png` |
