# Kho tài khoản và tài khoản EarnApp của VM

## Hiện hành 24/10/2026 — lỗi đăng nhập và tự lấy tài khoản chưa dùng

Chủ chọn **tự ghi lỗi → lấy tài khoản chưa dùng → tiếp tục công việc đã giao**, không chờ duyệt từng lỗi. Đây là tình trạng đăng nhập của Gmail / Apple ID, tách biệt với đã gán, đã đăng ký EarnApp, tiền và SDK đã dùng. Các mốc cũ bên dưới giữ làm lịch sử; khi khác nhau, quy tắc hiện hành này áp dụng cho lỗi đăng nhập.

| Badge / trạng thái chính xác | Khi ghi |
|---|---|
| Apple Locked (`APPLE_LOCKED`) | Apple ID thực tế báo khoá; chỉ loại APPLE_ID. |
| Google Verify (`GOOGLE_VERIFY`) | Google thực tế yêu cầu xác minh; chỉ loại GMAIL. |
| Google Disabled (`GOOGLE_DISABLED`) | Google thực tế báo vô hiệu hoá; chỉ loại GMAIL. |

Kho Gmail / Apple ID có ba badge trên, lọc chính xác `status=APPLE_LOCKED|GOOGLE_VERIFY|GOOGLE_DISABLED` và sắp xếp `sort=ERRORS_FIRST` (lỗi trước), `LATEST_ISSUE` (lỗi mới nhất trước), `EMAIL` (email); không chọn sort giữ thứ tự tạo hiện có. Ví dụ `/gmails?status=GOOGLE_VERIFY&sort=LATEST_ISSUE`. Lọc/sort nằm trong URL, áp dụng trước phân trang; đổi lọc về trang 1, tải lại/Back/Forward giữ lựa chọn. `status` là tình trạng đăng nhập, khác `state` là tình trạng kho/gán. Không suy nhà cung cấp từ đuôi email.

Người vận hành lọc các tài khoản lỗi để đối chiếu/đề nghị nơi bán đổi, hoặc ADMIN dùng Xoá khỏi kho theo quy tắc hiện có; tài khoản còn gán vẫn bị chặn xoá. Không thêm trường hay quy trình theo dõi nhà cung cấp mới, không tự xoá lỗi hoặc đưa tài khoản lỗi trở lại hàng chưa dùng.

### AI ghi lỗi và thay tài khoản

1. Quan sát đúng lỗi trên máy thật trong công việc được giao. Đọc VM và `GET earnapp-accounts/{accountId}?projectId=…` để lấy `loginId`, `loginRevision`, `loginStatus`, `loginIssueNote`, `loginIssueAt`. Chụp đúng tài khoản hiện hành, `expectedCycle`, `expectedVmRevision`, job ACTIVE của chính user/token; revision login không phải revision EarnApp.
2. `POST earnapp-accounts/{accountId}/login-issue` cần ACCOUNT_OPS, không approval/PIN/TOTP, body `{projectId,vmId,jobId,expectedCycle,expectedVmRevision,expectedLoginRevision,issue,note}`. `issue` là một trong ba mã trên; `note` dài 1–500 ký tự, mô tả quan sát, không mật khẩu/2FA/token/link bí mật. Quyền dự án/server và các revision vẫn được kiểm.
3. Phản hồi `{replay,recorded,current}`: `recorded` giữ accountId/loginId cũ, status/loginRevision và thông tin lỗi; kèm `replacementStatus`, `replacement`, `sdkReuseBlocked`. `replacement` null hoặc `{accountId,loginId,loginType,email,revision,loginRevision}`; email đã che. `current` là VM đọc lại, không thay cho kết quả lệnh đã ghi.

| `replacementStatus` | Hành động tiếp |
|---|---|
| `ASSIGNED` | Tự chọn hàng chưa dùng hợp lệ cùng nhà cung cấp trước, rồi loại còn lại (Gmail / Apple ID). Tài khoản thay luôn khác tài khoản lỗi. Khi thay thành công, EarnApp cũ đóng/tách khỏi VM; tài khoản mới chỉ được giữ, chưa chứng minh đăng nhập/đăng ký. Đọc lại VM/tài khoản mới rồi lấy credentials theo job hiện hành, dùng đúng phương thức của `loginType` và tiếp tục công việc đã giao. |
| `NO_STOCK` | Đã ghi lỗi nhưng giữ tài khoản lỗi hiện hành; dừng bước tài khoản, báo thiếu hàng, không ghi OK. |
| `NEEDS_ADMIN_STOCK` | User SELECTED được ghi lỗi của VM thuộc server mình, nhưng không được lấy kho chung. Dừng và nhờ ADMIN cấp hàng theo phạm vi, không dùng token khác/approval để vượt quyền. |

PP, tiền, payout và SDK đã dùng vẫn thuộc tài khoản/lịch sử cũ; không chuyển sang tài khoản mới. Chỉ sau khi thực sự đăng nhập/đăng ký thành công mới ghi `/used` và `sdk-linked` với SDK chưa dùng hợp lệ. Kiểm `sdkReuseBlocked`; SDK hiện hành đã LINKED không được dùng lại, không tự cài lại/xoá SDK hoặc tạo lại máy nếu công việc chưa cho phép. Nếu thiếu SDK hợp lệ thì ghi bước bị chặn, không tuyên bố đã nối xong.

Mất phản hồi → retry **cùng key/path/body**. Key cũ replay kết quả cũ, kể cả `NO_STOCK`; bổ sung hàng không làm lần retry ấy tự cấp tài khoản. Sau khi có hàng/quyền phù hợp, đọc lại VM/login/job và revision mới, rồi gửi **lệnh mới/key mới** theo trạng thái hiện tại. Không sửa body của key cũ, không tạo key mới chỉ vì chưa rõ kết quả lần trước. Tệp credentials và cách xoá sau dùng giữ nguyên. Tài liệu không phải bằng chứng đã triển khai/chạy máy thật.

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

### Money input and VND → USDT (owner brief 19 October 2026, replaces the free-text money fields)

- Fields use the Vietnamese convention: "." groups thousands, "," starts the decimals. With VND "70000" and "70.000" are seventy
  thousand, "420.000" is four hundred twenty thousand, "16,27" is sixteen point twenty-seven. Malformed groups ("25.82") are errors
  at the field; nothing is multiplied or divided by 1.000 silently.
- Exact decimals are valid in every money field, up to 8 decimals for amounts and 12 for rates: "0,424", "16,125 USDT", a rate
  "1 USDT = 25.820,5 VND". Only a **VND** field (a VND amount or a "1 USDT = N VND" rate) warns about the English thousands comma:
  "25,820" or "70,000" there is refused with both readings ("nếu là 25.820 thì ghi 25.820; nếu thật sự có phần lẻ thì ghi 25,82");
  "0,xxx" is never taken for a thousands group. (Independent review 19/10/2026: the warning used to apply to every field, so the
  web refused its own "0,424" after switching 2,12 USDT / 5 PP to a unit price.)
- Text the web writes into a field (the unit price after switching, a fetched rate, an edited cost) always reads back as the same
  value (`viInput`); in the rare VND case where it would look like a thousands group it gets a trailing zero ("15,6250").
- Switching total ↔ unit keeps the total: total → unit fills the exact quotient (2,12 ÷ 5 = 0,424). The total actually paid is what
  gets recorded, so changing the view never turns an entered amount into "Chưa ghi chi phí": when the total cannot become an exact
  unit price (no quantity, a division not exact to 8 decimals such as 10 USDT / 3 or 100.000 VND / 3, an error in the field) the form
  stays on **Tổng tiền thực trả** with the same amount (and rate), says so at the field and shows only the reference allocation
  (≈ 3,33 USDT / PP); a rounded unit price is never multiplied back over the total. "Chưa ghi chi phí" only when no amount was typed
  or the person clears the visible amount (clearing also drops the other view's amount, so it never comes back on a switch). A unit
  view left empty over a kept total blocks Nhập instead of importing without a cost.
- The other direction follows the same rule (independent review 19/10/2026, 9 USDT per PP without a quantity used to switch to an
  empty total imported without a cost, and a changed unit price could bring back an older total): unit → total only with a valid
  unit price and a valid quantity, by the exact product (9 × 3 = 27). A unit price with a missing / 0 quantity, or a malformed unit
  price ("9,"), stays on **Tính theo giá mỗi …** with its content, the error at the field to fix and a note; the older total is
  never brought back and the amount never becomes "no cost". An empty view switches freely. Checked over every combination
  (amount valid / empty / malformed × quantity valid / missing / 0 × other view's old amount, both directions, repeated switches). Same fields in Nhập Gmail / Apple ID, Nhập PayPal
  and Ghi chi phí of a batch. (Independent review 19/10/2026: 10 USDT / 3 switched to "giá mỗi PP" left the unit empty and was
  imported with priceMode NONE.)
- The typed text and the number sent to the API are different things: `src/lib/money-input.ts` parses once and the form sends only
  canonical numbers ("420000", "25820", "16.27"). The batch endpoints (`accountStore.importPreview / importCommit / batchCost`)
  refuse anything else, so "25.820" can never be read as 25,82 again (the bug that turned 420.000 VND into 16.266 USDT). The Chi phí
  form parses the same way; its API keeps its older contract.
- USDT = original amount ÷ rate, with the existing Decimal arithmetic; the label reads "1 USDT = 25.820 VND". USDT shows with two
  decimals (≈ 16,27 USDT); the stored precision (16,26646) shows on hover and in the batch details.
- VND fetches the Binance P2P BUY USDT reference through the existing `businessManagement.p2pQuote` (sealed token, 10 minutes). The
  line shows source and time; editing the number makes it "Nhập tay". A failed fetch keeps the form and offers Thử lại or a manual
  rate; there is no fake price, no default 1 and no USD = USDT. An expired quote blocks Nhập with "Lấy giá mới" or "Giữ … ghi là
  nhập tay": the converted amount never changes at the click. The server refuses an expired quote too. Changing the currency drops
  the rate and the quote.
- The cost record keeps amount, currency, rate, USDT and the rate source (`fxSource` BINANCE_P2P_BUY with the quote time, or
  MANUAL). A new market price never changes a recorded cost.
- Total vs unit price: *Tổng tiền thực trả* is the default and the source of truth; *Tính theo giá mỗi PP / tài khoản* needs the
  quantity actually bought (a PayPal purchase counts PP codes: 6 PP with 30 emails is 6). The form shows "6 PP × 70.000 ₫ = 420.000 ₫".
  Switching unit → total carries the total (420.000); without a quantity the total stays empty, so 70.000 never becomes the whole
  purchase. Switching back keeps a unit price only while unit × quantity still equals the total. An optional quantity with a total
  shows the reference allocation (≈ 70.000 ₫ / PP), never a second cost.
- Retries: one command key per content (Nhập kho, Ghi chi phí); a retry after a lost answer re-sends the first attempt's content.
- Batch PP-2026-10-19-1 on the host (6 PP / 30 emails, 420.000 VND ≈ 16,26646 USDT) was recorded correctly and is left unchanged; no
  cost is recomputed with today's rate.

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

## Ghi chú Gmail / Apple ID tại ô (20 October 2026)

- Click the note cell (also an empty one) to edit. Up to three lines while not editing; the editor grows to the whole text. Column
  about 280px by default, resizable with the header handle (kept per browser, `mth-acc-note-width`); text size unchanged.
- Enter saves, Shift+Enter breaks the line, Esc cancels; Enter while a Vietnamese IME is composing never saves; leaving the cell keeps an
  unsaved text open. An error stays at the cell with the typed text; "Đã lưu" only after the server saved.
- `accountStore.setNote` (`setStockNote`): stock-write right, revision check, only `notes` changes (never password, status, batch or cost),
  journaled (`ACCOUNT_STOCK_NOTE`, undo), same text = nothing written, a retry reuses its key.

## Nhập Apple ID theo mẫu mua (20 October 2026)

- Chọn **Apple ID** → dán nguyên văn `Email | Mật khẩu | Link lấy 2FA | Link SMS | Số điện thoại` (tab hoặc `|`, đúng thứ tự, ô trống giữ
  vị trí; không tách theo `:` vì link có `https://`). Web tự kiểm tra từng dòng, một nút **Nhập**. Không suy loại từ đuôi email: một
  Apple ID đăng nhập bằng `@gmail.com` vẫn là Apple ID. Mẫu cũ (`Tài khoản | Mật khẩu | 2FA | Email khôi phục | Ghi chú`) còn ở ô
  **Mẫu cũ** (tuỳ chọn phụ, `loginFormat: STANDARD`); Gmail luôn dùng mẫu cũ (`APPLE5` cho Gmail bị từ chối).
- Kiểm tra: link chỉ nhận `http(s)://` và được giữ nguyên chữ hoa / thường, tham số, token, `%2F`; số điện thoại là chuỗi (giữ số 0 đầu,
  dấu `+`, mã quốc gia như người dùng gõ; không đoán quốc gia); dòng thừa cột, link sai, SĐT sai → lỗi tại dòng; không dồn cột thừa vào
  ghi chú. Bảng kiểm tra chỉ nói "có / không có" (mật khẩu, link 2FA, link SMS, SĐT), không hiện giá trị.
- Lưu: `GmailAccount.twoFaLink`, `smsLink` (mã hoá như mật khẩu), `phone` (chữ); migration `20261020150000_apple_id_fields` chỉ thêm cột.
  Không ghi vào Email khôi phục, Ghi chú hay 2FA. Tài khoản đã có không bị ghi đè mật khẩu / link / SĐT; khoá lệnh và chi phí một lần
  như cũ; nhật ký chỉ giữ digest của mật khẩu và link. Ảnh hoàn tác (`operation-images`) mang cả ba trường.
- Dùng: dòng hiện SĐT (có copy) và hai nút **Lấy 2FA** / **SMS** (chỉ với quyền copy). Bấm → nhập PIN → link hiện trong khung đó với
  **Mở trong tab mới** và **Copy link**; không tự mở, không trả link trong danh sách, lịch sử, lỗi hay log (`businessManagement.copyAccount`
  trả thêm `twoFaLink`, `smsLink`, `phone`; VIEWER / người không có `COPY_CREDENTIALS` / ngoài dự án bị từ chối).
- Test: `account-parse.test.ts` (mẫu APPLE5), `apple-id-import.integration.test.ts`.

## Xoá khỏi kho và Khôi phục (20 October 2026)

- **Ai:** chỉ ADMIN của đúng dự án (`accountStore.deleteStock` / `restoreStock`, kiểm lại trong giao dịch ghi; hạ quyền giữa chừng → từ
  chối). Đường "Ẩn tài khoản" cũ (`businessManagement.archiveAccount`) cũng chỉ ADMIN. Nhập, sửa, đổi tình trạng của MODERATOR giữ nguyên.
- **Ở đâu:** nút thùng rác **Xoá khỏi kho** cuối mỗi dòng Gmail / Apple ID và trong cột Thao tác của PayPal; tick nhiều dòng → **Xoá N dòng**.
  Bấm là ghi, không hỏi lý do / xác nhận; thông báo có **Hoàn tác** (nhật ký `ACCOUNT_STOCK_DELETE` / `…_RESTORE`, ảnh GMAIL / PAYPAL, hoàn
  tác chung bị từ chối khi dòng đã đổi tiếp). Dòng bị chặn giữ tick và hiện lý do ngay tại dòng kèm link **Mở**.
- **Dữ liệu:** chỉ `archivedAt` (không xoá cứng). Chi phí, lô nhập, số lượng mua / đã nhận, sổ PayPal, email và dấu đã dùng không đổi.
  Khôi phục trả về đúng tình trạng tính từ liên kết (tài khoản / email đã dùng không thành NEW). Chống trùng nhập vẫn thấy dòng đã xoá và
  chỉ tới Khôi phục; gán tự động / chọn tài khoản không đề xuất dòng đã xoá.
- **Chặn:** Gmail / Apple ID còn tài khoản EarnApp trên VM đang hoạt động hoặc liên kết VM cũ còn hiệu lực → "Đang gán cho Server / VM".
  PayPal có email đang nhận cho VM; còn yêu cầu rút `REQUESTED` chưa dùng; còn tiền theo sổ (bất kỳ đồng tiền, cùng quy tắc sổ PayPal);
  email tạm giữ đối chiếu hoặc liên kết cũ chưa rõ email → chặn kèm đường dẫn (VM, Tiền vào / ra, Cần đối chiếu). Giao dịch đã tất toán
  không chặn.
- **Xem:** chip **Đã xoá** (`?state=DELETED`, `accountStore.store {deleted:true}`), Khôi phục từng dòng / **Khôi phục N dòng**. Danh sách
  phân trang 100 dòng (`?page=`, lọc / tìm trên toàn bộ trước khi phân trang, tổng đúng, "Chọn tất cả trên trang (N)"); đổi bộ lọc về trang 1;
  trang không còn được kẹp về trang cuối; Back / tải lại giữ tab, bộ lọc và trang.
- Test: `account-delete.integration.test.ts`, `account-url.test.ts`. Phát hành (cùng Apple ID): commit ce29911, backup host 7587897d, deploy 65b78f18,
  migration 20261020150000_apple_id_fields; host chỉ đọc trước / sau giống hệt (chỉ xem kiểm tra dán, không nhập / xoá). Evidence
  docs/superpowers/evidence/2026-10-20-stock-delete-apple-id/.

## Khung chi tiết, một thanh thao tác, nhập xong về bảng (20 October 2026, tiếp)

- **Khung chi tiết:** bấm email ở bảng Gmail / Apple ID → khung ngay dưới dòng (không sang trang cũ). Apple ID 5 cột hiện Email đăng nhập,
  Mật khẩu, Link lấy mã 2FA, Link SMS, Số điện thoại, Ghi chú; tài khoản mẫu cũ hiện đúng trường đã lưu (2FA TOTP, Email khôi phục, Token);
  loại bí mật trống không được đề xuất (khung và hộp Copy). Email có Copy riêng; mật khẩu che, Xem / Ẩn / Copy sau PIN (quyền copy +
  `businessManagement.copyAccount`, giữ trong bộ nhớ của khung, mất khi đóng); "Lấy mã 2FA" / "SMS" mở đúng link đã nhập ở tab mới, chỉ
  khi bấm.
- **Sửa (ADMIN / MODERATOR):** nút Sửa → một nút Lưu, mờ khi chưa đổi, "Lưu N trường" khi có thay đổi hợp lệ. Chỉ gửi trường thực sự đổi
  (`accountStore.updateLogin`, `changes` từng trường: bỏ trống = giữ, `null` = xoá). Ô bí mật trống / đang che = giữ nguyên; xoá một trường là
  nút riêng "Xoá trường này"; để trống không bao giờ là xoá. Backend kiểm quyền, revision (hai người sửa cùng dòng: người sau bị từ chối,
  không ghi đè), email trùng (kể cả dòng đã xoá / dự án khác), link http(s), SĐT. Giữ ID, liên kết EarnApp / VM, dấu đã dùng, lô, chi phí.
  Nhật ký `ACCOUNT_STOCK_EDIT` (ảnh GMAIL, hoàn tác được), chỉ giữ digest của bí mật. Lỗi hiện tại ô, nháp giữ nguyên. Ghi chú vẫn sửa tại ô bảng.
- **Một thanh thao tác** (`BulkBar`, dùng chung cho Gmail / Apple ID, PayPal, Kho proxy): "Đã chọn N" → thao tác thường dùng (Đổi tình
  trạng + Áp dụng; proxy: Đổi nhóm, Chuyển server, Gán VM, Trạng thái + Áp dụng, Copy, Khôi phục) → cuối thanh Xoá (nhỏ, đỏ nhẹ) và Bỏ chọn.
  Thanh luôn ở cùng chỗ, cao cố định (khi chưa chọn: một dòng gợi ý), nên chọn dòng không đẩy bảng; màn hẹp thì xuống dòng để luôn thấy
  Xoá / Bỏ chọn. N là đúng số dòng bị tác động, kể cả dòng đã chọn ở trang khác ("gồm M ở trang khác"); Xoá ghi số dòng xoá được.
- **Nhập xong về bảng:** nhập hết (không còn dòng lỗi / email chờ bổ sung) → khung tự đóng, bảng làm mới, "Đã nhập N … vào lô X"; nháp bị bỏ
  hẳn (nội dung, bí mật, tiền, kết quả kiểm tra, lô nhập bổ sung), chỉ giữ lựa chọn Gmail / Apple ID. Bộ lọc giữ nguyên; nếu che dữ liệu mới,
  thông báo có "Xem vừa nhập" (mở đúng lô). Nhập một phần: chỉ giữ dòng cần sửa, sửa tiếp vào cùng lô, không thêm chi phí. Mất phản hồi:
  không đóng, giữ nội dung, Thử lại cùng khoá. Nhập proxy mới: như trên, "Xem vừa nhập" = `?batch=<id>` (danh sách đúng các proxy của đợt).
- **Sửa sau kiểm độc lập:** đường "Ẩn tài khoản" cũ dùng chung `deleteRefusal` với Xoá khỏi kho (chặn PP còn tiền ở bất kỳ đồng tiền, yêu
  cầu rút đang chờ, mục cần đối chiếu, đang gán); Lịch sử nhập kho đếm email của mọi PP trong lô (kể cả PP đã xoá), không đổi qua xoá /
  khôi phục / hoàn tác. Bộ tái hiện `.runtime/review-stock-delete-apple-20261020.test.ts` đỏ 2/2 → xanh 2/2.
- **Cho AI sau này:** dòng VM mang `data-project-id`, `data-server-id`, `data-vm-id`, `data-vm-code`, `data-cycle`, `data-account-id`; dòng tài
  khoản `data-account-id`; các nút có tên rõ (Xoá khỏi kho …, Xem / Copy Mật khẩu …). AI dùng cùng endpoint, quyền, PIN, revision và lượt VM
  như người dùng; không có đường đọc bí mật riêng.
- Test: `account-edit.integration.test.ts`, `account-detail-ui.test.tsx`, `stock-bulk-import.test.tsx`, `account-delete.integration.test.ts`,
  `proxy-retire.integration.test.ts`. Phát hành: commit fe2bf5f, backup host 0211ccb1, deploy d859efc0, không migration; host chỉ đọc trước /
  sau giống hệt (chỉ tick rồi bỏ tick một dòng, mở khung chi tiết ở trạng thái che). Evidence docs/superpowers/evidence/2026-10-20-stock-bulk-import/.

### Sửa sau kiểm độc lập bản fe2bf5f (20 October 2026)

- **Nháp sửa không mất khi dữ liệu nền tải lại:** nháp gắn với phiên bản lúc bấm Sửa. Bản mới đến thì khung báo "vừa được cập nhật ở nơi
  khác", hiện "Bản mới: …" dưới ô, Lưu khoá lại cho tới khi bấm **Đối chiếu bản mới** (giữ nguyên nháp, chuyển sang phiên bản mới có chủ
  đích). Nháp chỉ bỏ khi chính lần lưu đó thành công hoặc Huỷ sửa. Mất phản hồi: thử lại gửi đúng nội dung cũ (kể cả revision) với cùng khoá.
- **Bí mật không dùng lại của phiên bản cũ:** mật khẩu, 2FA, token, link 2FA, link SMS đọc sau PIN gắn với dự án + tài khoản + phiên bản +
  quyền copy; đổi bất kỳ thứ nào thì ẩn ngay, phải nhập PIN lại. Phản hồi đến chậm cho phiên bản / tài khoản khác bị bỏ, không hiện, không copy.
- **Nhập proxy một phần:** không còn coi là "đã xong": giữ ô nhập với đúng dòng chưa lưu, lý do từng dòng và nút Kiểm tra và lưu; gói / nhóm
  mới vừa tạo được chọn như đã có để lần sau không tạo trùng; sửa hết và lưu thành công thì tự đóng. Quy tắc ghép cặp replace không đổi.
- Test: `stock-detail-state.test.tsx` (jsdom; 4/5 ca đỏ trên fe2bf5f, ca mất phản hồi là ca bảo vệ). Bộ tái hiện
  `.runtime/review-stock-detail-state-20261020.test.tsx` đỏ 3/3 → xanh 3/3; `.runtime/review-stock-delete-apple-20261020.test.ts` vẫn xanh 2/2.
  Phát hành: commit 6bc27f9, backup host fa1d5724, deploy c896cc53, không migration; host chỉ đọc trước / sau giống hệt.
  Evidence docs/superpowers/evidence/2026-10-20-stock-detail-state/.

## 25/10/2026 — Xem/copy bằng bảo mật của từng người

- ADMIN trong dự án và MODERATOR có quyền Copy thông tin đăng nhập dùng PIN hoặc Google Authenticator của chính mình. Không dùng mã của chủ dự án.
- Khi phiên web đã mở khoá bằng mã bảo mật hiện hành, Xem/Copy dùng phiên đó, không yêu cầu nhập lại mã Google vừa dùng. Mỗi lần lấy dữ liệu vẫn kiểm quyền hiện tại, phiên, phiên bản PIN/2FA và phạm vi trong giao dịch. Đổi mã, thu hồi phiên hoặc vô hiệu hoá user thì không lấy được thông tin mới.
- MODERATOR giới hạn server chỉ mở được Gmail/Apple ID đang gắn với VM hoạt động thuộc server được giao; không thấy tài khoản chưa gán, server khác, PayPal dùng chung, lô mua hoặc chi phí toàn kho. Không mở quyền sửa/gán/xoá kho.
- Nếu trình duyệt chặn clipboard, khung Copy giữ kết quả để chọn và copy lại; không gửi lại mã Google đã dùng. Đóng khung sẽ bỏ kết quả trong bộ nhớ giao diện.
- Quy tắc này thay yêu cầu nhập lại PIN cho mỗi khung ở các hướng dẫn cũ. API AI giữ quy tắc token riêng, không đổi.

## 23/10/2026 — VND, USD PayPal, USDT khi nhập chi phí

- Lần mua mới / Ghi chi phí của lô / Chi phí / giá gói mới chỉ chọn VND, USD PayPal, USDT. Mã nội bộ USD PayPal là PPUSD; không thay đổi USD của sổ tiền PayPal hay các khoản lịch sử. Nguồn collector cũ có USD giữ nguyên USD, không tự chuyển đơn vị.
- USD PayPal hỏi hai tỷ giá riêng: 1 USD PayPal = ? VND (người dùng nhập khi trả, không mặc định 24.000); 1 USDT = ? VND (Binance P2P BUY VND có nguồn/giờ, hoặc người dùng nhập tay).
- USDT = tiền USD PayPal × VND/USD PayPal ÷ VND/USDT. Tính Decimal theo chuỗi gốc, làm tròn 6 số lẻ cuối; không làm tròn tỷ giá hiệu dụng rồi nhân ngược. Ví dụ 250 × 24.000 ÷ 25.940 = 231,303007 USDT.
- Hai tỷ giá được lưu trong CostRecord.fxNote dạng JSON {version:1,kind:PAYPAL_VND,paypalVndRate,vndUsdtRate,reason}, cùng ảnh COST/lịch sử/hoàn tác hiện có; usdtRate là tỷ giá hiệu dụng để tương thích báo cáo cũ. Không cần migration. Nhập lại/đổi chế độ đơn giá-tổng/nháp không mất tỷ giá.
- Quote của PPUSD là quote VND, token kiểm cùng user/project/rate và hạn10 phút. Sửa tỷ giá PayPal giữ quote VND; sửa tỷ giá VND/USDT bỏ quote; đổi đồng tiền bỏ cả hai. Không tự lấy tỷ giá mới lúc lưu, không đánh đồng USD PayPal=USDT.
- Chi phí đã trừ trước khi team nhận vẫn giữ cả hai tỷ giá nếu nhập; không trừ hai lần. Lỗi/thiếu tỷ giá chặn lưu rõ tại form/backend.
