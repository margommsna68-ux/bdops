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
| `GmailAccount.loginType` | `GMAIL` / `APPLE_ID`, chosen explicitly on import, never inferred from the email domain. Old rows stay empty and are listed under *Cần kiểm tra*. |
| `GmailAccount.batchId`, `PayPalAccount.batchId` | Receiving batch. |
| `AccountPurchaseBatch` | Lô nhập = one purchase: code, kind, source, purchase date, price mode (NONE / UNIT / TOTAL), `paidQuantity` (quantity actually bought), `lineCount` (lines pasted the first time, information only), `costRule` (1 = recorded before the 17/10 evening fix) and `costRecordId` (unique). |
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
  - *Lô nhập → Nhập bổ sung* continues that batch only (`append.batchId`), never with money, source or date. Sending money with
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
  records the payment later in *Lô nhập → Ghi chi phí*. This is refused once a cost is recorded; it is allowed again only after
  the cost is voided in Chi phí.
- The price shown per account (*Giá phân bổ*) is the unit price, otherwise the total divided by the quantity bought (or by the
  accounts received when no quantity was entered). It is for
  information only and is never added to profit. Only ADMIN or members with the COSTS module see amounts.
- Assigning, unassigning, moving, re-importing and appending never add a cost or change the recorded total.
- Batches recorded before this fix (`costRule = 1`) are listed under *Cần kiểm tra* when unit price × pasted lines differs from
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
  quantity × unit price with bad / repeated lines, append after errors, Lô nhập tab).
- Local browser acceptance: `scratchpad/pw/accounts-accept.js` on PROXY_TRIAL. It creates a new `ac-xxxx` server and synthetic
  `@example.invalid` accounts on each run.
