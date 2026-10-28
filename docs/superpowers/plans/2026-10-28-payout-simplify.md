# Rút EarnApp gọn lại — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rút tay 3 bước tại một khung (Rút giữ email → Đã rút → Tiền đã về), sửa / bỏ / xoá ghi nhầm trước khi tiền về, một nút "EarnApp bị SUS", danh sách Chờ tạo lại có tạo lại hàng loạt, AI chỉ xin duyệt lệnh Rút với phiên duyệt 15 phút.

**Architecture:** Mọi lệnh mới là `runBusinessCommand` trong `src/server/vm-ops/` (cùng khoá dự án, journal, idempotency như `updatePayoutRequest`). Gỡ binding email ghi nhầm gom vào một helper dùng chung cho Sửa / Bỏ đã rút / Xoá. Phiên duyệt cắm vào `gateApproval` nên đơn lệnh và lô (batch) đều được duyệt tự động. Giao diện: một component `PayoutFrame` thay `PayoutStatusActions` và các form rút rải rác.

**Tech Stack:** Next.js 14 App Router, tRPC, Prisma 5 + PostgreSQL 17, Vitest (integration test chạy trên DB test thật), ops API `/api/ops/v1`, `scripts/ops-client.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-28-payout-simplify-design.md` (đọc kèm; plan không nhắc lại lý do).

## Global Constraints

- Nguồn: worktree `D:/MoneyToHome/dev-payout-simple-20261028`, nhánh `codex/payout-simple`; commit đầu = phủ bản live `D:/MoneyToHome/app` (BUILD `DA1lGJ8RFpsq0u7O2EFoM`). Kiểm lại BUILD_ID live trước khi phủ và trước khi deploy; khác thì dừng, đối chiếu.
- Migration chỉ cộng thêm, một file `prisma/migrations/20261028120000_payout_simplify/migration.sql`.
- Không đổi: sổ PayPal, `PAYPAL_DAILY_EMAIL_LIMIT=2`, gợi ý PP, `requestMoney` cho state cũ, quyền (`payoutRights`), Rút gộp.
- Mọi chuỗi giao diện tiếng Việt như spec: "Rút", "Đã rút", "Bỏ", "Sửa", "Tiền đã về", "Chốt luôn, phần thiếu là phí", "EarnApp bị SUS", "Mất do SUS", "Đang rút, chưa xác nhận", "Chờ tạo lại", "Tạo lại N VM", "Ghi nhận đã tạo lại N VM", "Đã rút N dòng", "Đã về đủ N dòng", "Duyệt tất cả đang chờ", "Mở phiên 15 phút", "Khóa phiên ngay", "Đã xoá do ghi nhầm".
- Chạy vitest từ PowerShell (Git Bash làm hỏng 10 test CLI). DB test = PostgreSQL portable cổng **55432** (memory local-trial-postgres); KHÔNG BAO GIỜ trỏ test vào `MoneyToHome-Postgres` cổng 5432 (production).
- Không quay video. Kiểm trình duyệt chỉ trên dữ liệu giả, local.
- Mỗi commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Hai người cùng bấm "Rút" / "Sửa" sang cùng một email cuối cùng còn trống → đúng một người được, người kia nhận lỗi rõ ràng, không email nào bị giữ hai lần (test ở Task 3).
2. Sửa email trên lệnh đã rút khi email cũ đã có một khoản tiền về (kể cả khoản đã thu hồi rồi ghi lại) → từ chối, không gỡ gì (test ở Task 3).
3. SUS trên VM là VM chính của Rút gộp → khoản gộp ra "Mất do SUS", các VM thành viên vào Chờ tạo lại, không VM thành viên nào còn tính "chờ tiền" (test ở Task 5).
4. Phiên duyệt mở rồi ADMIN bị gỡ quyền / token bị thu hồi trong 15 phút → lệnh Rút tiếp theo bị giữ chờ duyệt, không chạy (test ở Task 8).
5. Bấm "Đã về đủ N dòng" khi một dòng vừa bị người khác ghi tiền về → dòng đó báo lỗi revision, các dòng khác vẫn ghi, không dòng nào ghi hai lần (test ở Task 10).

---

### Task 0: Worktree và mốc bản live

**Files:**
- Create: worktree `D:/MoneyToHome/dev-payout-simple-20261028`

- [ ] **Step 1:** `git -C "C:/Users/TUNTUN/Desktop/project web new/bdops-proxy-app" worktree add D:/MoneyToHome/dev-payout-simple-20261028 -b codex/payout-simple feat/proxy-inventory`
- [ ] **Step 2:** Kiểm `D:/MoneyToHome/app/.next/BUILD_ID` = `DA1lGJ8RFpsq0u7O2EFoM`. Copy từ `D:/MoneyToHome/app` sang worktree, ghi đè: `src/`, `prisma/`, `scripts/`, `package.json`, `package-lock.json`, `vitest.config.ts`, `tsconfig.json`, `next.config.mjs`, `fleet-source-manifest.json`. Không copy `.env`, `.next`, `node_modules`.
- [ ] **Step 3:** Copy `.env.test` từ `D:/MoneyToHome/dev-merged-payout-20261027/.env.test`; kiểm nó trỏ cổng 55432. Tạo `node_modules` bằng `npm ci` (hoặc junction tới `D:/MoneyToHome/app/node_modules` nếu offline).
- [ ] **Step 4:** Khởi động PG test (memory local-trial-postgres), `npx prisma migrate deploy` với `.env.test`.
- [ ] **Step 5:** Chạy mốc: `npx vitest run src/__tests__/proxy-management/payout-daily.integration.test.ts src/__tests__/proxy-management/payout-members.integration.test.ts src/__tests__/proxy-management/vm-ops.integration.test.ts src/__tests__/proxy-management/payout-report.integration.test.ts src/__tests__/ops-api/ops-merged-payout.integration.test.ts` → tất cả PASS. Ghi lại số test làm mốc.
- [ ] **Step 6:** Commit `chore: baseline = live source DA1lGJ8RFpsq0u7O2EFoM`.

### Task 1: Migration

**Files:**
- Modify: `prisma/schema.prisma` (model `EarnPayoutRequest`, `OpsApproval`; thêm 2 model)
- Create: `prisma/migrations/20261028120000_payout_simplify/migration.sql`

**Interfaces:**
- Produces:
  - `EarnPayoutRequest.lostAmount Decimal? @db.Decimal(12,2)`, `lostAt DateTime?`; `state` có thêm giá trị `'LOST_SUS'`.
  - `model EarnPayoutRequestVoid { id String @id @default(cuid()); projectId String; requestId String; vmId String; cycle Int; earnAppId String; paypalEmailId String; snapshot Json; reason String; voidedById String; voidedAt DateTime @default(now()); @@index([projectId, vmId]) @@index([projectId, voidedAt]) }`
  - `model OpsApprovalSession { id String @id @default(cuid()); projectId String; tokenId String; approvedById String; via String; openedAt DateTime @default(now()); expiresAt DateTime; closedAt DateTime?; closedById String?; @@index([projectId, tokenId, expiresAt]) }`
  - `OpsApproval.sessionId String?`

- [ ] **Step 1:** Sửa schema, `npx prisma migrate dev --create-only --name payout_simplify` trên DB test, đổi tên thư mục thành `20261028120000_payout_simplify`; kiểm SQL chỉ có `ALTER TABLE … ADD COLUMN` và `CREATE TABLE` / `CREATE INDEX`.
- [ ] **Step 2:** `npx prisma migrate deploy` + `npx prisma generate`; `npx tsc --noEmit` sạch.
- [ ] **Step 3:** Commit `feat(db): payout simplify columns and tables`.

### Task 2: Phase "Mất do SUS" trong mô hình tiền

**Files:**
- Modify: `src/lib/vm-ops.ts` (`requestMoney`, `RequestPhase`, `milestoneOf`, `MILESTONE_LABEL`)
- Modify: `src/server/vm-ops/payout-report.ts` (status `LOST`, tổng tiền mất)
- Test: `src/__tests__/proxy-management/vm-ops-rules.test.ts`

**Interfaces:**
- Produces: `RequestPhase` thêm `'LOST'`; `requestMoney({...state:'LOST_SUS'})` → `{phase:'LOST', remaining:'0.00', ...}`; `milestoneOf({phase:'LOST',...})` → `'LOST'`; `MILESTONE_LABEL.LOST='Mất do SUS'`, `MILESTONE_LABEL.RECREATE='Chờ tạo lại'`; `PayoutReportStatus` thêm `'LOST'`; tổng báo cáo thêm `lost: Record<currency,string>`.

- [ ] **Step 1: Test hỏng**

```ts
it('LOST_SUS is neither waiting nor received',()=>{
  const m=requestMoney({amount:'12.00',currency:'USD',state:'LOST_SUS',settledAt:null,shortfall:null,consumedAt:null,receipts:[]});
  expect(m).toMatchObject({phase:'LOST',remaining:'0.00',received:'0.00'});
  expect(milestoneOf({phase:'LOST',consumed:false,submission:'SENT'})).toBe('LOST');
});
```

- [ ] **Step 2:** Chạy `npx vitest run src/__tests__/proxy-management/vm-ops-rules.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt: trong `requestMoney`, `state==='LOST_SUS'` → phase `LOST` (đặt cạnh nhánh CANCELLED / FAILED). Trong payout-report: status `LOST`, không tính vào WAITING / ATTENTION, cộng `lostAmount` vào `totals.lost`. Thêm vào `vmOps.payoutReport` zod enum.
- [ ] **Step 4:** Test mới + `payout-report.integration.test.ts` PASS.
- [ ] **Step 5:** Commit `feat(payout): LOST phase for SUS`.

### Task 3: Sửa / Bỏ đã rút / Xoá ghi nhầm

**Files:**
- Create: `src/server/vm-ops/payout-fix.ts`
- Modify: `src/server/vm-ops/payout.ts` (export `requestInclude`, `release` logic dùng chung nếu cần; `readVmOpsHistory` đọc thêm `EarnPayoutRequestVoid`)
- Test: `src/__tests__/proxy-management/payout-fix.integration.test.ts`

**Interfaces:**
- Consumes: `assertPayoutDailySlot`, `consumePayoutDailySlot` (payout-daily.ts), `payoutRights`, `historyEntry`, `moneyOfRequest`.
- Produces:
  - `unbindMistakenEmail(tx:Tx, images:BusinessCollector, r:{id:string;projectId:string;earnAppId:string;paypalId:string;paypalEmailId:string}):Promise<void>` — ném `ProxyDomainError('INVALID_INPUT','Email đã nhận tiền, không đổi được','EMAIL_HAS_MONEY')` nếu có bất kỳ `FundTransaction` nào (kể cả đã thu hồi) có `paypalEmailId` này và `earnAppId` này; ngược lại (không phân biệt email do ai gán, spec bổ sung 3): bỏ `holdEarnAppId`/`holdAt` nếu = earnAppId; bỏ `usedEarnAppId`/`usedAt` nếu = earnAppId; `EarnAppAccount.paypalEmailId/paypalId = null` nếu đang trỏ email này; xoá `EarnAppPayout` có `earnAppId`+`paypalEmailId` này (ghi image); xoá `PayPalPayoutDayEmail` có `requestId = r.id` và `paypalEmailId` này.
  - `editPayoutRequest(scope, input:{key;requestId;expectedRevision;vmId;expectedCycle;earnAppId;paypalEmailId?:string;amount?:string;requestedAt?:string;reference?:string|null;note?:string|null}, db?)` → `{id, changed, revision}`.
  - `unsendPayoutRequest(scope, input:{key;requestId;expectedRevision;vmId;expectedCycle;earnAppId;note?:string|null}, db?)` → `{id, changed, revision, submission:'PREPARING'}`.
  - `voidPayoutRequest(scope, input:{key;requestId;expectedRevision;vmId;expectedCycle;earnAppId;reason:string}, db?)` → `{voidId, requestId, vmId}`.
  - Quyền: như `CORRECT` hiện có (người: `writeMoney`), AI: `payout` (`EARN_PAYOUT`). `kind`: `EARN_PAYOUT_EDIT` / `EARN_PAYOUT_UNSEND` / `EARN_PAYOUT_VOID`, module `FUNDS`, `reversible` mặc định (undo).

- [ ] **Step 1: Test hỏng** (dùng `businessFixture` + PP/email như `payout-daily.integration.test.ts`):
  - `edit swaps the email of a SENT request with no money`: tạo PREPARING email A → SENT → edit sang email B (note "ghi nhầm") → A: `holdEarnAppId`,`usedEarnAppId` null, không có `PayPalPayoutDayEmail` cho A; B: `usedEarnAppId = earnApp`, `earnApp.paypalEmailId = B`; history có dòng kind `EDIT`.
  - `edit refuses when the old email received money`: thêm receipt cho request rồi `recordPayoutReceipt`, thu hồi receipt (`voidedAt`), edit email → reject `{reason:'EMAIL_HAS_MONEY'}`.
  - `edit to an email held by someone else is refused`: email B đang `holdEarnAppId` của EarnApp khác → reject, A vẫn nguyên.
  - `two edits racing for the last free email: exactly one wins` (`Promise.allSettled`, 1 fulfilled 1 rejected).
  - `edit respects the daily limit of the new email's PayPal` → reject `{reason:'PAYPAL_DAILY_LIMIT'}`.
  - `edit SENT without note is refused`; `edit amount only on PREPARING needs no note`.
  - `edit frees an email pre-linked through PayPal nhận when it has no money` (gán email A cho EarnApp bằng `writeLink` trước, rút bằng A, sửa sang B → A về kho).
  - `after a partial receipt only the amount can be edited (with note); email edit is refused`.
  - `editing the email of a SENT request counts the new email on the submittedAt day, not today` (fake clock: SENT ngày 19, sửa ngày 20 → `PayPalPayoutDayEmail.day='2026-10-19'`; sửa `requestedAt` không đổi `submittedAt`).
  - `unsend returns SENT to PREPARING, email still held, day marker removed`.
  - `void deletes a request with no receipts and frees its email; VM can request again` (sau void gọi `createPayoutRequest` cùng VM OK; có 1 dòng `EarnPayoutRequestVoid` với `snapshot.history`).
  - `void refuses with any receipt, an active merged member, or consumedAt`.
- [ ] **Step 2:** Chạy file test → FAIL (module chưa có).
- [ ] **Step 3:** Cài đặt `payout-fix.ts`; thêm `consumePayoutDailySlotOn(tx,row,day:string)` vào payout-daily.ts (ngày = `payoutDay(submittedAt).date`) và `assertPayoutDailySlot` nhận `day?` tương ứng. Các kiểm như `updatePayoutRequest`: revision, `vmId`/`expectedCycle`/`earnAppId` khớp, `consumedAt` → từ chối, có receipt (kể cả đã thu hồi) → từ chối sửa email nhưng vẫn cho sửa số tiền kèm lý do (thay `CORRECT`). Sửa email = `unbindMistakenEmail(cũ)` rồi giữ email mới (`updateMany` có điều kiện `holdEarnAppId:null, usedEarnAppId:null, earnApp:null, archivedAt:null, reviewHold:false` → `count!==1` thì `STALE_PREVIEW`), `assertPayoutDailySlot`; nếu request đã SENT/UNKNOWN thì đặt `usedEarnAppId` + gắn `EarnAppAccount.paypalEmailId` như nhánh SENT hiện có và `consumePayoutDailySlot`. Void: ghi `EarnPayoutRequestVoid` (snapshot = toàn bộ cột + history dạng JSON), `unbindMistakenEmail`, `tx.earnPayoutRequest.delete`. `readVmOpsHistory` trả thêm `voided:[{at,by,reason,paypal,email,amount (chỉ khi money)}]`.
- [ ] **Step 4:** File test PASS; chạy lại các test mốc ở Task 0 Step 5 → PASS.
- [ ] **Step 5:** Commit `feat(payout): edit, unsend and void mistaken requests`.

### Task 4: Tiền đã về có chốt luôn phần thiếu; tiền về muộn sau SUS

**Files:**
- Modify: `src/server/vm-ops/payout.ts` (`PayoutReceiptInput`, `recordPayoutReceipt`)
- Test: `src/__tests__/proxy-management/payout-fix.integration.test.ts`

**Interfaces:**
- Produces: `PayoutReceiptInput.settleRemainder?: boolean` (mặc định false ở server; UI gửi true khi ô tick). Kết quả thêm `settled: boolean`, `shortfall: string|null`.

- [ ] **Step 1: Test hỏng:**
  - `receipt with settleRemainder settles the gap in the same command`: request 20.00 SENT, ghi 18.50 + `settleRemainder:true` → phase `RECEIVED`, `shortfall='1.50'`, `settleNote='Phí / thiếu 1,50 USD'`, history có RECEIPT và SETTLE.
  - `receipt without settleRemainder leaves 1.50 waiting`.
  - `settleRemainder without writeMoney is refused` (scope chỉ có PAYPAL_RECEIPT_RECORD → FORBIDDEN, không ghi gì).
  - `a late receipt on LOST_SUS reopens and records it`: state `LOST_SUS` → receipt đủ → `state='REQUESTED'`, phase `RECEIVED`, `lostAmount=null`, history "Tiền về muộn sau SUS".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt trong `recordPayoutReceipt`: cho phép `state==='LOST_SUS'` (đổi state về `REQUESTED`, xoá `lostAmount/lostAt` trước khi tính `open`); sau khi tạo FundTransaction, nếu `settleRemainder` và còn thiếu > 0 thì ghi settle như nhánh SETTLE của `updatePayoutRequest`.
- [ ] **Step 4:** PASS + `earn-money.integration.test.ts` PASS.
- [ ] **Step 5:** Commit `feat(payout): receipt can settle the remainder; late money after SUS`.

### Task 5: Lệnh "EarnApp bị SUS"

**Files:**
- Create: `src/server/vm-ops/suspend.ts`
- Modify: `src/server/vm-ops/ops.ts` (tách phần ghi trạng thái một VM của `setVmStatus` thành `applyVmStatus(tx, images, ctx, vm, status, note)` dùng chung; khi `status==='SUSPENDED'` và VM chưa SUS, `setVmStatus` chạy cùng phần đóng SUS `closeSuspendedInTx` — spec bổ sung 1 — nên ô Tình trạng, ghi hàng loạt và AI `vms/{id}/status` đều đóng như nút)
- Test: `src/__tests__/proxy-management/payout-suspend.integration.test.ts`

**Interfaces:**
- Consumes: `voidPayoutRequest` logic nội bộ (gọi hàm nội bộ `voidInTx` export từ payout-fix.ts), `memberOf`.
- Produces: `markEarnAppSuspended(scope, input:{key;vmId;expectedCycle;expectedVmRevision?:number;note?:string|null}, db?)` → `{vmId, cycle, request:{id,outcome:'LOST'|'VOIDED'|null,lostAmount:string|null}, archivedEmailIds:string[]}`. `kind:'EARN_SUSPEND'`, module `INFRASTRUCTURE`, quyền `authorizeVM(current,'ASSIGN')` (như ghi trạng thái).

- [ ] **Step 1: Test hỏng:**
  - `SUS on a SENT waiting request`: request 15.00 SENT, receipt 5.00 → SUS → `state='LOST_SUS'`, `lostAmount='10.00'`; `pendingByPaypal` không còn PP này; VM `status='SUSPENDED'`; email `archivedAt` khác null; `recreateRule` → `{reason:'SUSPENDED'}`.
  - `SUS on a PREPARING request voids it and returns the email` (email `archivedAt` null, `holdEarnAppId` null; có dòng Void).
  - `SUS with no request only marks SUS and archives the EarnApp's receiving email`.
  - `SUS on a merged primary`: VM chính + 1 thành viên → khoản gộp `LOST_SUS`; `recreateRule(member)` → `SUSPENDED`; báo cáo không còn WAITING cho thành viên.
  - `choosing SUS in setVmStatus closes the payout the same way` (cùng kết quả như test đầu, qua `setVmStatus`).
  - `SUS twice is a no-op` (lần 2 `changed:false`, không thêm journal).
  - `undo of SUS restores request state, email and status` (dùng hàm undo journal như `payout-daily-undo.integration.test.ts`).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt theo spec mục 3. Thứ tự trong transaction: kiểm VM / lượt / revision → request lượt này (`currentRoundPayout`) → LOST hoặc void → archive email (`EarnAppAccount.paypalEmailId` và email của request nếu SENT/UNKNOWN; `revision++`) → `applyVmStatus(...,'SUSPENDED')` → history request kind `SUS` "EarnApp bị SUS: mất X USD".
- [ ] **Step 4:** PASS; `vm-ops.integration.test.ts` (setVmStatus) PASS không đổi.
- [ ] **Step 5:** Commit `feat(vm-ops): EarnApp SUS closes the payout and retires its email`.

### Task 6: Chờ tạo lại trên bảng VM và Tổng quan

**Files:**
- Modify: `src/server/vm-ops/payout.ts` (`readVmOps` milestone), `src/server/dashboard/*` nơi đếm mốc RECREATE (tìm `RECREATE` trong `src/server/dashboard`)
- Test: `src/__tests__/proxy-management/payout-suspend.integration.test.ts`

**Interfaces:**
- Produces: `readVmOps(...).vms[].milestone==='RECREATE'` khi: (tiền lượt này RECEIVED và chưa consumed) hoặc `status==='SUSPENDED'` hoặc (thành viên gộp chưa consumed và (khoản gộp RECEIVED hoặc VM chính SUS)). Đúng bằng điều kiện `recreateRule` cho phép; hàm thuần mới `recreateReady(input):boolean` trong `src/lib/vm-ops.ts` dùng cho cả hai.

- Produces (UI model): `MILESTONE_LABEL.PREPARING='Đang rút, chưa xác nhận'`; `MoneyFilter` thêm `'PREPARING'` và `'LOST'` (`grid-model.ts`, `filter-model.ts`, chip ở `ServerWorkspace.tsx` cạnh chip WAITING / RECREATE); Tổng quan đếm "Chờ tạo lại" và "Đang rút, chưa xác nhận", bấm ra đúng bộ lọc.

- [ ] **Step 1: Test hỏng:** `board shows RECREATE for paid, SUS and merged-SUS members, nothing for waiting` (4 VM, so `milestone`); trong `vm-filter-model.test.ts`: `money=PREPARING` chỉ khớp VM có mốc PREPARING, `money=LOST` chỉ khớp LOST.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt; `recreateRule` dùng `recreateReady` (không đổi kết quả — test `vm-recreated.integration.test.ts` giữ xanh). **Step 4:** PASS. **Step 5:** Commit `feat(vm-ops): recreate queue includes SUS; unconfirmed and lost chips`.

### Task 7: tRPC và ops API cho lệnh mới; bỏ duyệt trừ Rút

**Files:**
- Modify: `src/server/routers/vmOps.ts`, `src/server/ops-api/api.ts`, `src/server/ops-api/approvals.ts` (`APPROVAL_ACTIONS`), `docs/ops-api/openapi.json` (copy từ live nếu thiếu; bump minor), `scripts/ops-client.mjs` (comment usage)
- Test: `src/__tests__/ops-api/ops-payout-simple.integration.test.ts`

**Interfaces:**
- Produces tRPC: `vmOps.editPayout`, `vmOps.unsendPayout`, `vmOps.voidPayout`, `vmOps.suspendEarnApp`; `vmOps.payoutReceipt` nhận `settleRemainder`.
- Produces ops API (scope / action, tất cả **không** `approval`):
  - `POST withdrawals/{id}/edit` PAYOUT `WITHDRAWAL_EDIT`
  - `POST withdrawals/{id}/unsend` PAYOUT `WITHDRAWAL_UNSEND`
  - `POST withdrawals/{id}/void` PAYOUT `WITHDRAWAL_VOID`
  - `POST vms/{id}/suspended` VM_OPS `VM_SUSPENDED`
  - `WITHDRAWAL_STATUS`, `WITHDRAWAL_RECEIPT` (body thêm `settleRemainder`), `WITHDRAWAL_MEMBERS` bỏ `approval:true`.
  - `APPROVAL_ACTIONS=['WITHDRAWAL_PREPARE']`; `me.approvalRequired` = `['WITHDRAWAL_PREPARE']`.

- [ ] **Step 1: Test hỏng:**
  - `status and receipt run without approval` (fixture `api({autoApprove:false})`: SENT → 200, receipt → 200).
  - `prepare still answers 202 APPROVAL_REQUIRED`.
  - `an old pending STATUS approval: retry with the same key runs directly` (tạo `OpsApproval` PENDING action WITHDRAWAL_STATUS rồi gửi lại cùng key → 200).
  - `edit / unsend / void / suspended answer 200 with {replay, recorded, current}` và replay cùng key trả nguyên `recorded`.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt; envelope / idempotency / `OpsAudit` như các route hiện có. **Step 4:** PASS + `ops-api.integration.test.ts`, `ops-merged-payout.integration.test.ts` PASS (sửa kỳ vọng 202 cũ của STATUS/RECEIPT/MEMBERS thành 200 — đúng quyết định chủ). **Step 5:** Commit `feat(ops-api): only withdrawal prepare needs approval; fix/SUS routes`.

### Task 8: Phiên duyệt 15 phút

**Files:**
- Create: `src/server/ops-api/approval-session.ts`
- Modify: `src/server/ops-api/approvals.ts` (`gateApproval`), `src/server/ops-api/api.ts` (routes, `me`), `src/server/routers/*` nơi có router approvals (tìm `decideApproval`), `scripts/ops-client.mjs`
- Test: `src/__tests__/ops-api/approval-session.integration.test.ts`

**Interfaces:**
- Produces:
  - `APPROVAL_SESSION_MS=15*60000`.
  - `openApprovalSession(db, input:{projectId;tokenId;admin:string;totp:string;via:'CLI'|'WEB';actorId?:string}) → {sessionId, expiresAt, approvedPending:number}` — kiểm ADMIN / 2FA / `checkTotp` / `totpVersion` y như `confirmApprovalByToken` (tách phần kiểm chung thành `assertApprover(tx, adminId, projectId, t)`); đóng phiên mở cũ của token; duyệt mọi `OpsApproval` PENDING còn hạn của token (status APPROVED, `sessionId`, `decidedById`, `decisionNote='Duyệt theo phiên HH:mm'`); audit `OPS_SESSION_OPEN`.
  - `closeApprovalSession(db,{projectId;tokenId?;sessionId?;actorId}) → {closed:number}`; audit `OPS_SESSION_CLOSE`.
  - `activeSession(tx,{projectId,tokenId}) → OpsApprovalSession|null` — chỉ trả khi chưa hết hạn, chưa đóng, người duyệt còn ADMIN + 2FA + không bị vô hiệu / khoá, token còn hiệu lực (đọc `FOR SHARE` trong transaction).
  - `gateApproval`: khi sắp trả `pending` (dòng mới hoặc PENDING cũ) mà `activeSession` có → cập nhật dòng thành APPROVED (`sessionId`, `decidedById`) và trả `{approval, replay:false}`.
  - `approveAllPending(db,{projectId;actorId;code}) → {approved:number}` (web, một mã TOTP).
  - ops API: `POST approval-sessions` body `{projectId, admin, totp}` (scope READ, action `APPROVAL_SESSION_OPEN`, không journal mã); `POST approval-sessions/close` (`APPROVAL_SESSION_CLOSE`); `GET me` thêm `approvalSession:{open:boolean;expiresAt:string|null;approvedBy:string|null}`.
  - ops-client: `session-open --admin <user> [--totp <code>|--totp-stdin]`, `session-close`, `session`; mã không ghi vào journal / stdout / file.

- [ ] **Step 1: Test hỏng:**
  - `opening a session approves pending prepares and later ones run at once` (prepare → 202; open → `approvedPending:1`; retry → 200; prepare mới → 200, `OpsApproval.sessionId` khác null, status CONSUMED).
  - `a batch with prepare items runs inside a session`.
  - `session ends after 15 minutes` (fake timer 15:01 → 202).
  - `revoking the token or demoting the admin ends the session now` (→ 202).
  - `closing the session restores 202`.
  - `same TOTP step cannot open twice` (lần 2 bị `checkTotp` từ chối).
  - `a wrong code counts toward the admin lock` (3 sai → khoá như hiện có).
  - `approveAllPending approves every pending row with one code`.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt. **Step 4:** PASS + `ops-api-review.integration.test.ts`, `ops-api.integration.test.ts` PASS; test CLI của ops-client (chạy PowerShell) PASS. **Step 5:** Commit `feat(ops-api): 15-minute approval session`.

### Task 9: Khung rút dùng chung (một VM)

**Files:**
- Create: `src/components/vm-management/vm-grid/PayoutFrame.tsx`, `src/components/vm-management/vm-grid/payout-frame-model.ts`
- Modify: `src/components/vm-management/vm-grid/OpsCells.tsx`, `VmSidePanel.tsx`, `src/components/business-management/PayoutReportWorkspace.tsx`; xoá `PayoutStatusActions.tsx` sau khi thay hết chỗ dùng
- Test: `src/__tests__/proxy-management/payout-frame-model.test.ts`

**Interfaces:**
- Consumes: tRPC Task 7; `vmOps.payoutPick`, `vmOps.requestPayout`, `vmOps.updatePayout` (SENT), `vmOps.payoutReceipt`.
- Produces: `payoutActions(view:{phase;submission;state;hasReceipts;consumed;rights}) → ('SEND'|'DROP'|'EDIT'|'UNSEND'|'RECEIPT'|'SUS'|'FAIL'|'RETRY'|'VOID')[]` (hàm thuần, quyết định nút nào hiện); `PayoutFrame` props `{projectId; vmId; cycle; earnAppId; request: VmOpsRequestView|null; rights; onDone():Promise<void>}`.

- [ ] **Step 1: Test hỏng** (`payout-frame-model.test.ts`): bảng trạng thái → nút:
  - không có request → `[]` (nút "Rút" nằm ngoài, ở ô Tiền VM);
  - PREPARING → `['SEND','DROP','EDIT','SUS']`;
  - SENT, WAITING, chưa receipt → `['RECEIPT','EDIT','UNSEND','SUS','FAIL']`;
  - FAILED / CANCELLED → `['RETRY']`;
  - SENT có receipt, còn thiếu → `['RECEIPT','SUS']`;
  - RECEIVED → `[]`; LOST → `['RECEIPT']`; thiếu quyền ghi tiền → không có `EDIT/UNSEND/VOID/FAIL/RETRY` và ô chốt thiếu không hiện.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt model + component. Luồng: "Rút" gọi `payoutPick` → `requestPayout({submission:'PREPARING', paypalEmailId: gợi ý, amount: Tiền VM})` ngay khi bấm; khung hiện email + Copy + "Đã rút" (SENT, **không** ô tick bằng chứng) + "Bỏ" (`voidPayout` lý do "Bỏ trước khi rút") + "Đổi email" (`editPayout`). "Tiền đã về": số tiền = `remaining`, ngày = hôm nay giờ Bangkok, ô "Chốt luôn, phần thiếu là phí" tick sẵn, chỉ hiện khi số nhập < remaining. Mỗi lệnh giữ key + body khi mất câu trả lời (theo mẫu sessionStorage của `PayoutBulkPanel`). Trang Rút EarnApp mở cùng `PayoutFrame` trong panel phải.
- [ ] **Step 4:** PASS; `npx tsc --noEmit`; `npx eslint` các file đã sửa sạch.
- [ ] **Step 5:** Commit `feat(ui): one payout frame for cell, VM panel and report`.

### Task 10: Thao tác hàng loạt

**Files:**
- Modify: `src/components/vm-management/vm-grid/PayoutBulkPanel.tsx`, `src/components/business-management/PayoutReportWorkspace.tsx` (chọn nhiều dòng), thanh chọn ở `ServerWorkspace.tsx`
- Create: `src/components/vm-management/vm-grid/RecreateBulkPanel.tsx`
- Test: `src/__tests__/proxy-management/payout-bulk-model.test.ts`

**Interfaces:**
- Consumes: Task 7 tRPC; `vmOps.recreate`; tRPC tạo lệnh fleet hiện có mà `FleetCommandPanel.tsx` dùng (action `RECREATE_VM`).
- Produces: `bulkPlan(rows, kind:'SEND'|'RECEIVE_FULL'|'RECREATE'|'RECORD_RECREATED') → {ready:Row[]; skipped:{row:Row;why:string}[]}` (hàm thuần).

- [ ] **Step 1: Test hỏng:** `bulkPlan` bỏ qua dòng không đúng trạng thái kèm lý do; `RECREATE` tách VM thuộc server có điều khiển (`fleetEnrolled:true`) và VM phải tạo tay; một dòng lỗi revision trong khi chạy không chặn dòng khác (mô phỏng bằng hàm chạy tuần tự nhận kết quả giả).
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt: "Đã rút N dòng", "Đã về đủ N dòng" (mỗi dòng một key, chạy tuần tự, kết quả từng dòng, retry giữ key); bộ lọc "Chờ tạo lại" (đổi nhãn) + "Tạo lại N VM" (gửi lệnh fleet cho VM có điều khiển; nhắc tạo tay cho phần còn lại) + "Ghi nhận đã tạo lại N VM". "Rút N VM" giữ nguyên hàng đợi hiện có nhưng tạo PREPARING ngay khi bấm.
- [ ] **Step 4:** PASS; tsc / eslint sạch. **Step 5:** Commit `feat(ui): bulk send, receive and recreate`.

### Task 11: Trang Phê duyệt và báo cáo

**Files:**
- Modify: `src/app/(dashboard)/approvals/page.tsx` (+ component của nó), `PayoutReportWorkspace.tsx` (status "Mất do SUS", "Đã xoá do ghi nhầm"), Tổng quan (số "Chờ tạo lại", "Mất do SUS")
- Test: integration của router approvals trong `approval-session.integration.test.ts` (đã có `approveAllPending`); UI kiểm ở Task 12.

- [ ] **Step 1:** Trang Phê duyệt: khối "Phiên duyệt" (đang mở / hết hạn lúc, người mở, "Khóa phiên ngay"), "Mở phiên 15 phút" (chọn token, nhập mã), "Duyệt tất cả đang chờ" (một mã). Router dùng `openApprovalSession({via:'WEB'})`, `closeApprovalSession`, `approveAllPending`.
- [ ] **Step 2:** Báo cáo Rút EarnApp: bộ lọc `LOST`, cột / tổng "Mất do SUS"; danh sách "Đã xoá do ghi nhầm" đọc `EarnPayoutRequestVoid` (chỉ người có quyền đọc tiền).
- [ ] **Step 3:** tsc / eslint / `npm run build` sạch. **Step 4:** Commit `feat(ui): approval session page, SUS and voided in report`.

### Task 12: Kiểm toàn bộ, tài liệu, phát hành

**Files:**
- Create: `docs/superpowers/evidence/2026-10-28-payout-simplify/` (README + ảnh chụp cần thiết)
- Modify: `docs/runbooks/vm-ops-cycle.md`, `docs/runbooks/ops-api.md`, `PROMPT_CLAUDE_VAN_HANH_WEB.md`, `AGENTS.md` gốc (mục mới, ngắn)
- Create: `D:/MoneyToHome/tools/deploy-payout-simple.ps1` (mẫu `deploy-money-report.ps1`, có `migrate deploy`)

- [ ] **Step 1:** Toàn bộ vitest từ PowerShell → PASS (ghi số file / test). `npx tsc --noEmit`, `npx eslint`, `npm run build` sạch.
- [ ] **Step 2:** Duyệt lại cả nhánh bằng một reviewer độc lập (superpowers:requesting-code-review); sửa RED→GREEN.
- [ ] **Step 3:** Kiểm trình duyệt trên dự án giả local (Chrome thật): Rút → Đã rút → Tiền đã về thiếu có chốt; Sửa email; Bỏ; Xoá; SUS; Chờ tạo lại + Ghi nhận hàng loạt; trang Phê duyệt mở / khoá phiên; 390px; 4 giao diện. Không video.
- [ ] **Step 4: Dừng, báo chủ kết quả, xin phép deploy.** Sau khi chủ đồng ý: backup `pg_dump` + bản mã hoá moon-01 đã kiểm giải mã; ghi dấu vân tay dữ liệu trước; stage = copy live + diff nhánh (kiểm BUILD_ID live vẫn `DA1lGJ8RFpsq0u7O2EFoM`), build; chạy script deploy; đọc lại: build manifest 200, migration đã áp, dấu vân tay dữ liệu nghiệp vụ không đổi.
- [ ] **Step 5:** Copy `PROMPT_CLAUDE_VAN_HANH_WEB.md` + `openapi` mới lên Central (kiểm SHA-256). Commit tài liệu + evidence.
