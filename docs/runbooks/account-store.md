# Kho tài khoản và tài khoản EarnApp của VM

Owner brief 17/10/2026. Replaces the old "Tài khoản VM" page and the rule that one Gmail could be used on several VMs.

## Rules

- One VM uses one EarnApp account; one EarnApp account runs on one VM and pays out to one PayPal of its own.
- One PayPal never receives for a second EarnApp account. The first EarnApp account a PayPal received for is stored on the
  PayPal (`firstEarnAppId`), so it stays blocked for other accounts even after unassignment.
- Gmail / Apple ID stock means NEW login accounts that have not been used to register EarnApp.
- Assigning a login, registering EarnApp, recording the SDK and the machine running are separate facts. "Đã đăng ký EarnApp" is
  recorded only by an explicit click (popover or side panel). Assigning an account or recording an SDK never sets it.
- PayPal stock needs only Mã PP + Email nhận tiền. No password, 2FA, bank or documents.

## Data

| Table / field | Meaning |
|---|---|
| `GmailAccount.loginType` | `GMAIL` / `APPLE_ID`, chosen explicitly on import, never inferred from the email domain. Old rows stay empty and are listed under *Cần đối chiếu*. |
| `GmailAccount.batchId`, `PayPalAccount.batchId` | Receiving batch. |
| `AccountPurchaseBatch` | Đợt nhập (a row of Lịch sử nhập kho) = one purchase: code, kind, source, purchase date, price mode (NONE / UNIT / TOTAL), `paidQuantity` (quantity actually bought), `lineCount` (lines pasted the first time, information only), `costRule` (1 = recorded before the 17/10 evening fix) and `costRecordId` (unique). |
| `EarnAppAccount` | EarnApp account: `loginId` (unique), `vmId` (unique, nullable), `paypalId` (unique, nullable), `registeredAt`. |
| `PayPalAccount.firstEarnAppId` | First EarnApp account this PayPal received for. |
| `BusinessWorkItem.kind` | `TASK` (work for staff) or `SHEET_REVIEW` (old Sheet reconciliation rows). |
| `VirtualMachine.gmailId` | Legacy link, no longer written. Shown as "Cũ: …" until someone assigns the account again. |

Stock state is computed from the current links and never stored:

- **NEW**: no EarnApp account yet (login), or never received for one (PayPal).
- **Đã gán**: the EarnApp account is on a VM now, with a link to that Server/VM.
- **Đã dùng · chưa gán**: was linked before. An unassigned account never returns to NEW.
- **Lỗi / ngừng dùng**: status is not ACTIVE. History is kept and the account is not offered for new assignment.

Migration `20261017120000_account_inventory` is additive. It only reclassifies the old Sheet-import work items, matched by their
exact title prefixes (`Proxiware`, `Chưa rõ nhóm sở hữu`, `Xác minh dòng không có VM`, `Proxy của Genjy đang ghi trên VM`). It
creates, merges and deletes nothing.

## Import (Kho tài khoản → Nhập Gmail / Apple ID, Nhập PayPal)

- Paste many lines or use *Một tài khoản*. Logins use `Tài khoản | Mật khẩu | 2FA | Email khôi phục | Ghi chú`, separated by tab,
  `|` or `:`. PayPal uses `Mã PP | Email`.
- *Xem trước* shows every line as Hợp lệ, Đã có or Lỗi: bad format, repeats inside the list (reported on every line involved),
  existing accounts, another project, a PP code with a different email, an email that belongs to another PP. Then one button
  *Nhập N dòng hợp lệ*.
- An existing account is never overwritten, credentials included. A new purchase with no new line is refused, so a repeat
  import cannot create a second batch or cost.
- **Lần mua mới vs Nhập bổ sung** (owner brief 17/10 evening):
  - *Nhập Gmail / Apple ID* / *Nhập PayPal* is always a new purchase with its own batch. The code is generated as
    `TK-<ngày mua>-<n>` / `PP-<ngày mua>-<n>` (next free number, withdrawn batches included) inside the command under the project
    lock, so two people importing at once get different codes. A typed code that already exists is refused, never merged.
  - *Lịch sử nhập kho → Nhập bổ sung* continues that batch only (`append.batchId`), never with money, source or date. Sending money with
    an append is refused, not ignored.
  - After an import that left error lines, the panel switches to *Nhập bổ sung vào lô …* of the batch just created.
- One command key per previewed request: the key is made at *Xem trước* and kept until the input changes or the import
  succeeds. A double click or a retry after a lost response replays the same command (no second batch or cost).
- Passwords and 2FA are encrypted at rest. They never appear in previews, results, the journal (the idempotency hash uses their
  sha256), the audit log or error messages.
- After import, the box keeps only the error lines; fixing them continues that batch without a new cost.

## Purchase cost

- Recorded in the existing cost ledger (USDT team cash, category GMAIL or PAYPAL), once per batch, in the same import command:
  - *Tổng tiền thực trả* (default field; empty = Chưa ghi chi phí) records the total as entered.
  - *Tính theo giá mỗi tài khoản* asks for *Số lượng thực mua* and *Giá / tài khoản* and shows `số lượng × đơn giá = tổng` live.
    The quantity is typed by the person; it is never the number of pasted or valid lines, because accounts that could not be
    imported may still have been paid for.
  - Original amount, currency and USDT rate are kept, and the period lock applies.
- Needs team cash and the right to write costs. Without them the batch is saved as *Chưa ghi chi phí*. A person with that right
  records the payment later in *Lịch sử nhập kho → Ghi chi phí*. This is refused once a cost is recorded; it is allowed again only after
  the cost is voided in Chi phí.
- The price shown per account (*Giá phân bổ*) is the unit price, otherwise the total divided by the quantity bought (or by the
  accounts received when no quantity was entered). It is for
  information only and is never added to profit. Only ADMIN or members with the COSTS module see amounts.
- Assigning, unassigning, moving, re-importing and appending never add a cost or change the recorded total.
- The current cost record in Chi phí is the paid amount. *Lịch sử nhập kho* and *Giá phân bổ* read total, currency, rate, USDT and state
  from it. After an edit there the batch shows the new total, with *Đã điều chỉnh ở Chi phí · ban đầu …* (the first price is kept
  as history and never rewritten). The `số lượng × đơn giá` formula is shown only while it still equals the ledger total.
  Allocation = ledger total / quantity bought. A voided cost shows *Khoản chi đã thu hồi*; *Ghi chi phí* records it again once.
  Undo of an edit is followed automatically.
- *Xem ở Chi phí* opens `/costs?cost=<id>&month=<YYYY-MM>`: the right month, with that row highlighted and scrolled into view.
- Batches recorded before this fix (`costRule = 1`) are listed under *Cần đối chiếu* when unit price × pasted lines differs from
  the accounts received, or when accounts were added later under the same code (possibly another purchase without its own
  cost). Their money is never recomputed or changed. Migration `20261017180000_account_batch_quantity` is additive.

## Assigning to VMs (Server / VM)

- Columns *Tài khoản EarnApp* (login and Gmail / Apple ID badge) and *PayPal nhận*. Click either cell to open a popover that
  picks the login and PayPal and saves both at once. The popover also has *Bỏ gán khỏi VM* and *Ghi đã đăng ký EarnApp*.
  *Lưu* is disabled when nothing changed.
- **Many VMs:** select the VMs, click *Gán tài khoản*, choose Gmail or Apple ID, tick *kèm PayPal*, click *Xem trước*, then
  *Gán N VM*. The oldest NEW accounts are used first, and VMs that already have an account are kept.
- **Dán bảng → Tài khoản + PP:** paste `Server | VM | Tài khoản | Mã PP`, matched by server + VM code, never by line order. When
  a server is selected, the Server cell may be left out. An empty cell keeps the current value; `-` in the Tài khoản cell
  unassigns.
- Server checks (`accountStore.linkPreview` / `linkApply`):
  - Rights, project, VM revision and current holders are checked again when saving. Two people saving at once: one wins, the
    other gets "VM vừa được người khác thay đổi".
  - A login or PayPal held elsewhere is refused with its position ("đang giữ cho moon05 / VM_001"); it is never moved silently.
  - A row is fully checked before anything is written, so login and PayPal are saved together or not at all.
  - Each row gets its own result. The same link again is *Không thay đổi*, with no journal entry.
- Undo restores the previous links exactly. EarnApp accounts created by the undone operation are removed; unique slots are freed
  before restoring.
- Old APIs: `businessManagement.bindAccount` now goes through the same checks (login only). `vmManagement.bulk*` with kind
  `GMAIL` is refused. A Gmail → PayPal link from the old account form is refused.
- A VM can be created and saved without proxy, account, PayPal or SDK.

## Giao việc (/work)

- The page assigns work to staff. It is not a required step for receiving or assigning accounts, and nothing creates tasks
  automatically.
- Tabs *Việc giao nhân viên* and *Đối chiếu Sheet cũ*; a row can be moved between them in the form.
- Old data is kept and is never marked done automatically.

## Checks

- `src/__tests__/proxy-management/account-store.integration.test.ts` and `account-parse.test.ts`.
- Purchase money: `scratchpad/pw/purchase-accept.js` on PROXY_TRIAL (two purchases the same day, lost response + retry,
  quantity × unit price with bad / repeated lines, append after errors, Lịch sử nhập kho).
- Local browser acceptance: `scratchpad/pw/accounts-accept.js` on PROXY_TRIAL. It creates a new `ac-xxxx` server and synthetic
  `@example.invalid` accounts on each run.

## Page layout and URL (18 October 2026)

- **Two tabs only:** Gmail / Apple ID and PayPal (`?tab=login | paypal`; `/gmails` defaults to login, `/paypals` to PayPal).
- **Inside the kind being looked at:**
  - *Lịch sử nhập kho* (`?view=history`): one row per purchase with source, date, quantity bought / received and money paid
    once. Buttons: *Xem tài khoản (N)* (the accounts of that purchase, `?batch=<code>`), *Nhập bổ sung* (continues that purchase,
    no money), *Ghi chi phí*, *Xem ở Chi phí*.
  - *Cần đối chiếu (N)* (`?view=review`): an amber warning shown only when the kind has items. Each item has a subject, a short
    reason and one button to the place to handle it: the VM, the account (searched in its table) or the purchase in the history.
    Account states (locked, PayPal limit, stopped) are not review items; they are the *Lỗi / ngừng dùng* filter.
- **Old URLs keep working:** `?tab=batch` → `?view=history`, `?tab=review` → `?view=review` (kind of the page),
  `?import=1` opens the import panel once. They are replaced by their canonical URL without a history entry.
- **Navigation:** kind, view, filter chips and the purchase filter are history entries; typing a search replaces the URL. Reload,
  Back/Forward and a direct URL show the same content. A PayPal-only member is shown the PayPal tab whatever the URL says.
- **Import panel per kind:** the tab, table, import button, panel and target purchase are always the same kind.
  - Each kind keeps its own draft (text, money, preview, target) in this tab's memory only (`importDraft` in
    `src/components/account-store/ImportPanel.tsx`), keyed by project and kind. Never in the URL, localStorage or
    sessionStorage (drafts can hold passwords and 2FA); a full reload drops them.
  - *Đóng* keeps the draft for the session; *Bỏ nháp* empties it.
  - Switching tabs never saves or imports. The row selection resets on any kind, view or filter change.
  - The page remounts per project, so drafts, panels and previews never cross projects.
- **Review data:** `readAccountStore().review[]` carries `group` (LOGIN / PAYPAL), `subject`, `reason` and `open`
  (`vm` / `account` / `batch`); `message` is kept for older readers. Items follow the member's rights (PayPal-only members never
  get login items).

## Lịch sử nhập kho layout (18 October 2026, later)

- **Columns:** Đợt nhập | Nơi mua | Số lượng mua | Đã nhập kho | Tổng tiền mua | Chi phí | Thao tác.
  - **Đợt nhập:** the full code on one line; below it the purchase date (dd/MM/yyyy, the day bought, not the import day) and,
    for logins, a small Gmail / Apple ID label.
  - **Nơi mua and Số lượng mua:** shown as recorded, or *Chưa ghi*. The quantity is never filled from the import count.
  - **Đã nhập kho:** the accounts of the purchase in the web stock (not delivered-confirmed, NEW or assigned). Clicking the
    number opens them (same kind, `?batch=`).
  - **Tổng tiền mua:** the current cost record in its own currency, right-aligned, Vietnamese format with every significant
    decimal (`batch-format.ts`). Non-USDT amounts add ≈ USDT. *Chi tiết* opens under the row: rate, first price after an
    adjustment or void, notes, lines pasted first. Hidden without the money right.
  - **Chi phí:** *Đã ghi* (links to the cost when the member may see money), *Chưa ghi* (not recorded; does not mean unpaid) or
    *Đã thu hồi*.
  - **Thao tác:** *Nhập bổ sung*, and *Ghi chi phí* when no cost is recorded and the member may write costs; no ⋯ menu.
- **Order:** purchase day (Asia/Bangkok) newest first; same day, the purchase created last first; then id (`readAccountStore`).
- **Size:** rows 56–80px and no horizontal scroll at 1280px. Under 640px each purchase is a labelled card.

## PayPal: many emails, one email per EarnApp (18 October 2026)

This section replaces the earlier "one PayPal code for one EarnApp account" rule.

### Rules

- **Data model:**
  - A PP code is one PayPal account with many `PayPalEmail` rows.
  - `EarnAppAccount.paypalEmailId` (unique) is the current receiving email; `paypalId` is that email's PayPal (not unique any more).
  - `PayPalEmail.usedEarnAppId` records the EarnApp account an email was given to. Unassigning never clears it.
  - An email may receive money many times; "not reused" means it is not given to another EarnApp account.
  - `reviewHold` keeps an email out of new assignments until reconciled.
- **Assigning:**
  - Done at Server/VM in two steps, Mã PP then Email. The chosen code and email are shown right away.
  - Paste format: `Server | VM | Tài khoản | Email PP` or `… | Mã PP | Email PP`; a bare code is refused.
  - Bulk pick takes unused emails of active PayPals (several VMs may share a PayPal).
  - The checks are in `account-store/links.ts` (`emailFor`). The unique index makes two simultaneous assignments of one email end with one success.
  - The old API field `paypal` (a PayPal id) is refused unless it is null (remove).
- **History and undo:**
  - Each change of receiving email closes and opens an `EarnAppPayout` period. Undo removes the period the operation opened.
  - Undo of a first assignment returns the email to unused only while no payment is recorded on it (`operation-images.ts`).

### Import

- **Format:** `Mã PP email1 email2 …`, separated by spaces, tabs or `|`.
  - Lines of one code (case-insensitive) are grouped into one PayPal.
  - A code with a broken line waits until the line is fixed.
  - An email on two codes is refused on both lines.
  - Emails of another PayPal, hidden ones or emails in another project are refused; another project is never named.
- **Existing code with new emails:** shown as ADD with "Bổ sung email" (`accountStore.addEmails`, no batch, no cost). The same emails again change nothing.
- **Checking while typing:** the panel checks automatically (`importPreview`, writes nothing).
  - A result is used only while it matches the text; the request key belongs to that exact content.
  - "Nhập" saves the valid lines and keeps only the lines still to fix (and ADD lines).
  - A save without an answer freezes the content and keeps the key: "Thử lại" replays it, "Kiểm tra lại" reloads first.
- **Counting:** a PayPal purchase counts PayPals (`received`) and emails separately (`emails`). The price per PayPal uses the quantity bought, never the number of emails.

### PayPal book (Kho PayPal)

- **One book:** the same rows as Tiền vào PayPal (`FundTransaction`) and Rút / chuyển (`Withdrawal`). The code is in `business-management/paypal-ledger.ts`.
- **Ghi tiền vào:**
  - Choose the PayPal, day, currency and status, then paste `Email | Số tiền | Mã giao dịch`. Each email must belong to that PayPal.
  - Lines are checked while typing (`receiptCheck`); only READY lines are written (`receiptRecord`).
  - With tab or `|`, every cell keeps its place (only separators at the end of a line are ignored): an empty amount, an empty email, extra columns or a wrong amount are errors at the line, and the payment id is never read as the amount.
  - Each payment keeps the EarnApp / VM using the email at that moment; nothing is assigned or marked registered because money arrived.
  - Duplicates:
    - A transaction id is checked per project, voided rows included.
    - Without an id, the same email / day / amount is SUSPECT at the line until "Khoản riêng".
- **Opening balance:** `openingRecord`, one per currency, counted in the balance, never as EarnApp income.
- **Ghi chuyển / rút:**
  - `transferRecord` writes Withdrawal `ledgerVersion` 2. `amount` is the total the source was debited, fee included (`feeAmount`, never subtracted again).
  - An internal transfer stores what the receiving PayPal actually got (`receivedAmount`, `receivedCurrency`). With different currencies, the rate actually used (`fxRate`) is required.
  - The amounts must add up (one rule, `src/lib/paypal-transfer.ts`, used by the form and by `recordTransfer`, review 18/10/2026):
    - received = round half up to 2 decimals of ((debited − source fee) × rate) − receiver fee;
    - same currency: rate 1, and no rate is typed;
    - the source fee is in the source currency and inside the total;
    - a fee taken on the receiving side is the explicit field "Phí bên nhận" (`receiverFeeAmount`, receiving currency).
    - A stated received amount that does not match is refused with the right number.
  - In the form, the received amount is computed live until the person types it. A typed value is kept and only checked, with "Dùng số tính được" next to the error.
  - A receiver fee needs a received amount: on a withdrawal outside, typing "Phí bên nhận" makes the form compute the received amount too (31 − 1 − 2 = 28), and the fee is always sent, never dropped. When it cannot be computed (no rate for another currency) the field shows the error and Lưu stays off. A withdrawal with neither a receiver fee nor a known received amount saves as before. Form state: `transferDraft` in the same file.
  - Both sides are one row, so they never look like two events.
  - `paidToTeam` is not used as proof that the PayPal paid.
  - The old one-amount form refuses to edit v2 rows; void and record again instead.
- **Totals:**
  - In = confirmed receipts + internal in; out = debits; balance = opening + in − out, per currency, up to the end of the month shown (everything before it included).
  - Range (`ledgerRange`), the same for a number and the list behind it: a month, or everything up to a cut-off day (today in Asia/Bangkok, or `?asof=`). Rows dated later are in neither.
  - Pending, failed and voided rows never count.
  - EarnApp income = receipts only.
  - v1 internal transfers without a received amount, and v1 rows with a collector fee, are counted as recorded and flagged for reconciliation.
- **Rights:**
  - Money in needs FUNDS; money out needs WITHDRAWALS; the balance needs both.
  - The PayPal stock right alone shows no money.
  - The purchase price follows Chi phí (COSTS).
- **UI:**
  - One row per code: Mã PP | email used / still usable | Tiền vào | Tiền ra | Còn lại theo sổ | Tình trạng | Thao tác.
  - The emails open under the row with copy, EarnApp / Server / VM, use and money received.
  - Clicking an amount lists the rows behind it (`?pp=&show=in|out&month=`, or `&asof=` without a month; Back and reload keep it).
  - The list states "Cộng các khoản được tính: X", which equals the number clicked. Pending, failed, voided and opening rows are shown as "(không cộng)" with their role. Rows after the cut-off day are only counted in a note.
- **Not counted here:** an EarnApp withdrawal request (EarnWithdrawal) is a different moment and is never added to money received.
- **Profit is unchanged:** USDT the team received minus costs. Money on PayPal or sent to a collector is not team income.
