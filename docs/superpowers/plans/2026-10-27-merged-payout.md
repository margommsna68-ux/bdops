# Merged EarnApp Payout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One EarnApp payout request (the primary VM's) can carry extra member VMs whose SDKs were merged into that account; every member shows the request's state, money is counted once, and each member may be recorded as recreated once the merged money arrived (or the primary account went SUS).

**Architecture:** A new `EarnPayoutMember` table hangs extra VMs (never the primary) off an existing `EarnPayoutRequest`; a request without member rows is exactly today's request. One service file `src/server/vm-ops/payout-members.ts` owns membership rules and is called from `createPayoutRequest`, `updatePayoutRequest`, `recordRecreated`, the reads, the tRPC router and the ops API, so web and AI share one rule set.

**Tech Stack:** Next.js 14 / tRPC / Prisma 5 / PostgreSQL 17 / Vitest (run from PowerShell, local trial PG 55432).

**Spec:** `docs/superpowers/specs/2026-10-27-merged-payout-design.md`

## Global Constraints

- Work in a clean worktree WITHOUT the uncommitted fleet WIP: `git worktree add D:/MoneyToHome/dev-merged-payout-20261027 -b codex/merged-payout e2aa8ad` (same pattern as dev-dashboard-payout). Never commit fleet files.
- Migration is additive only, name `20261027100000_payout_members`; old requests (no members) behave exactly as today.
- Every command goes through `runBusinessCommand` (idempotency key, journal, images, `authorize` re-checked in the transaction), carries `expectedCycle` + revision per VM, and refuses stale rounds with `CYCLE_CHANGED` / `REVISION_CONFLICT` as existing payout code does.
- Rights unchanged: `payoutRights` (writeMoney, or narrow EARN_PAYOUT for PREPARING / SENT / UNKNOWN only). Server-scoped members already get no payout rights (`hasServerScope` → all false); keep `assertScopedVmIds` on every member VM anyway.
- Money received stays the PayPal book on the request (`FundTransaction.payoutRequestId`); never a second ledger, never per-member receipts.
- Vietnamese UI copy as in this plan; money with units (`$20,54`).
- No production data writes for An-01/VM_001+VM_003 (owner does it after release).
- No video evidence; screenshots only where needed.

## Review Focus

- A VM in two open requests at once (member of A and own request B, or member of A and B) → second attach / create refused with the other request's VM named. Tests in Task 2.
- RETRY of a FAILED / CANCELLED merged request after a member joined another request → RETRY refused, nothing changes. Test in Task 2.
- A member VM recreated between attach and money arrival (cycle moved) → its membership no longer matches; the member is shown as history, not re-eligible in the new round. Test in Task 3.
- Report / dashboard totals with a merged request: amount once, VM count = primary + members, server filter matches a member's server. Test in Task 4.
- Ops API retry of the same Idempotency-Key for prepare-with-members replays the first answer and never attaches twice. Test in Task 5.

---

### Task 1: Schema, migration, journal images

**Files:**
- Modify: `prisma/schema.prisma` (model `EarnPayoutRequest` add `members EarnPayoutMember[]`; model `VmCycle` add `payoutMemberId String? @unique`)
- Create: `prisma/migrations/20261027100000_payout_members/migration.sql`
- Modify: `src/server/business-management/types.ts:6` (add `'PAYOUT_MEMBER'` to `BusinessResource`)
- Modify: `src/server/business-management/operation-images.ts` (fields list, load, undo-create = delete row, label "Thành viên rút gộp", consumedAt set ⇒ view-only like `PAYOUT_REQUEST`)
- Test: `src/__tests__/proxy-management/payout-members.integration.test.ts` (new; first test only)

**Interfaces:**
- Produces model:
  ```prisma
  model EarnPayoutMember {
    id            String            @id @default(cuid())
    projectId     String
    requestId     String
    request       EarnPayoutRequest @relation(fields: [requestId], references: [id], onDelete: Restrict)
    vmId          String            // historical scalar like EarnPayoutRequest.vmId
    cycle         Int
    sdkId         String?           // current SDK of the VM when attached
    shareAmount   Decimal?          @db.Decimal(12, 2) // reference only, never income
    shareObservedAt DateTime?
    removedAt     DateTime?         // only while the request is PREPARING
    removedById   String?
    consumedAt    DateTime?         // recorded as recreated
    consumedReason String?          // PAYOUT_RECEIVED | SUSPENDED
    createdById   String
    createdAt     DateTime          @default(now())
    revision      Int               @default(0)
    @@index([requestId])
    @@index([projectId, vmId, cycle])
  }
  ```
- Produces image resource `PAYOUT_MEMBER` with fields `['requestId','vmId','cycle','sdkId','shareAmount','shareObservedAt','removedAt','consumedAt','consumedReason','revision']`.

- [ ] **Step 1:** Create worktree (Global Constraints), `npm ci`, `npx prisma generate`; confirm `git status` shows no fleet files.
- [ ] **Step 2: Failing test** `it('stores a payout member row bound to a request')` — fixture request via `createPayoutRequest`, then `db.earnPayoutMember.create(...)`, expect `findMany({where:{requestId}})` length 1. Run `npx vitest run src/__tests__/proxy-management/payout-members.integration.test.ts` → FAIL (no model).
- [ ] **Step 3:** Schema + migration (CREATE TABLE, FK to EarnPayoutRequest RESTRICT, two indexes, `ALTER TABLE "VmCycle" ADD COLUMN "payoutMemberId" TEXT` + unique index). Apply with `npx prisma migrate deploy` on the local test DB (never reset).
- [ ] **Step 4:** Add `PAYOUT_MEMBER` image support; extend the "Ghi nhận tạo lại VM chỉ để xem" guard to `PAYOUT_MEMBER` with `consumedAt` newly set.
- [ ] **Step 5:** Test PASS; `npx tsc --noEmit` clean. Commit `feat: add payout member table for merged EarnApp payouts`.

### Task 2: Membership service (attach / remove / SENT / RETRY / create with members)

**Files:**
- Create: `src/server/vm-ops/payout-members.ts`
- Modify: `src/server/vm-ops/payout.ts` (`createPayoutRequest`, `updatePayoutRequest`)
- Test: `src/__tests__/proxy-management/payout-members.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MemberInput {vmId:string;expectedCycle:number;expectedVmRevision?:number;shareAmount?:string|null}
  /** Open request this VM+cycle already belongs to (own current-round request in state REQUESTED, or active member row of a REQUESTED request), else null. */
  export async function openPayoutOf(tx:Tx,projectId:string,vmId:string,cycle:number,exceptRequestId?:string):Promise<{requestId:string;where:string}|null>
  /** Validates and inserts members; returns created rows. Primary VM refused as member; duplicates in input refused. */
  export async function attachMembers(tx:Tx,images:BusinessCollector,ctx:{projectId:string;actorId:string},request:{id:string;vmId:string;cycle:number;earnAppId:string;state:string;submission:string;consumedAt:Date|null},members:MemberInput[]):Promise<{id:string;vmId:string;where:string}[]>
  /** Marks the current SDK of the primary VM and of every active member LINKED to request.earnAppId (linkedVmId = that VM, linkedCycle). Already LINKED → unchanged. */
  export async function linkMergedSdks(tx:Tx,images:BusinessCollector,ctx:{projectId:string;actorId:string},requestId:string):Promise<number>
  export async function addPayoutMembers(scope:ActorScope,input:{key:string;requestId:string;expectedRevision:number;members:MemberInput[]},db?:PrismaClient):Promise<{requestId:string;revision:number;added:{vmId:string;where:string}[]}>
  export async function removePayoutMember(scope:ActorScope,input:{key:string;requestId:string;expectedRevision:number;vmId:string},db?:PrismaClient):Promise<{requestId:string;revision:number;removed:boolean}>
  ```
- `PayoutRequestInput` gains `members?:MemberInput[]`.
- Business rules (copy exactly):
  - attach allowed while `state==='REQUESTED'`, `consumedAt===null` and money phase ≠ RECEIVED; otherwise `INVALID_INPUT` "Lệnh rút đã về đủ / đã dùng / đã huỷ; không gắn thêm VM".
  - member VM: `activeVM`, same project, `expectedCycle` = its cycle (`CYCLE_CHANGED`), revision if given; `openPayoutOf` non-null → `INVALID_INPUT` "VM <where> đang trong lệnh rút khác (<where of that request>)" code `DUPLICATE`.
  - `shareAmount` default = the VM's current SDK amount when `amountVmId===vm.id && amountCycle===cycle` (with `amountObservedAt` into `shareObservedAt`), else null.
  - remove only when `submission==='PREPARING'`; sets `removedAt/removedById`.
  - each add / remove bumps request revision and appends history kind `MEMBERS` ("Gộp thêm VM_003 (An-01)" / "Bỏ gộp VM_003"); add `MEMBERS:'Cập nhật VM gộp'` to `NEUTRAL`.
  - SENT (in `updatePayoutRequest`) and attach-to-an-already-SENT request call `linkMergedSdks` (only when the request has ≥1 active member).
  - RETRY of FAILED / CANCELLED: every active member re-checked with `openPayoutOf(...,exceptRequestId)`; conflict → refuse whole RETRY.
  - `createPayoutRequest` refuses when the primary VM itself has `openPayoutOf` (as a member elsewhere); with `members` it calls `attachMembers` in the same transaction; recorded answer includes `members`.
  - `addPayoutMembers` rights = same as `updatePayoutRequest` SENT (writeMoney or narrow payout).

- [ ] **Step 1: Failing tests** (one `it` each):
  - `create with members` — primary A + member B; expect 1 request, 1 member row (vmId B, cycle 1, shareAmount = B's SDK amount "11.83" seeded), history contains "Gộp thêm".
  - `refuses a member already in another open request` — B member of request A1; create A2 with member B → throws code `DUPLICATE`.
  - `refuses a member that has its own open request` and `refuses the primary as member`.
  - `attach to an existing SENT request links SDKs` — request SENT, add B → B's current SDK `linkState==='LINKED'`, `linkedEarnAppId===request.earnAppId`, `linkedVmId===B`.
  - `SENT links primary and member SDKs` — PREPARING with member, update SENT → both SDKs LINKED.
  - `remove only while PREPARING` — remove works on PREPARING; on SENT throws `INVALID_INPUT`.
  - `FAILED frees members; RETRY refused if a member joined another request`.
  - `replay of the same key attaches once`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the interfaces above (use `markVmSdkUsed`'s internal update pattern from `src/server/vm-management/sdk-list.ts:139` for LINKED writes and `event(tx,ctx,sdkId,'LINKED',…)` for SDK history).
- [ ] **Step 4:** Run file + `src/__tests__/proxy-management/vm-ops.integration.test.ts` + `payout-selection.integration.test.ts` + `payout-daily.integration.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat: attach member VMs to an EarnApp payout request`.

### Task 3: Recreate members (paid and SUS)

**Files:**
- Modify: `src/server/vm-ops/ops.ts` (`currentRoundPayout`, `recordRecreated`)
- Modify: `src/server/vm-ops/payout-members.ts` (add `memberOf`)
- Test: `src/__tests__/proxy-management/payout-members.integration.test.ts`

**Interfaces:**
- Produces: `export async function memberOf(tx:Tx|PrismaClient,projectId:string,vmId:string,cycle:number):Promise<{member:EarnPayoutMember;request:RequestWithReceipts;money:ReturnType<typeof moneyOfRequest>;primarySus:boolean}|null>` — active (removedAt null) member row of this VM+cycle whose request is not FAILED/CANCELLED; `primarySus` = request's EarnApp `closedReason==='SUSPENDED'` OR the request VM's operation status `SUSPENDED` with cycle === request.cycle.
- Rules in `recordRecreated` (only when the VM has no own current-round request):
  - eligible if `memberOf` non-null, `member.consumedAt===null`, and (`money.phase==='RECEIVED'` → reason `PAYOUT_RECEIVED`) or (`primarySus` → reason `SUSPENDED`); else refuse with existing message style: "VM đã gộp vào <where>: tiền chưa về đủ PP (còn chờ)" etc.
  - writes `member.consumedAt/consumedReason`, `VmCycle.payoutMemberId=member.id`, `payoutRequestId=null`, history line `CONSUMED` "VM_003 dùng khoản gộp để ghi tạo lại (đóng lượt N)" on the request.
  - member VM's own EarnApp account (if any): NOT closed, `vmId` kept, no `EarnAppPayout` period ended; `VmCycle.earnAppId/loginId` still recorded for history.
  - primary VM path unchanged (closes its account; `request.consumedAt`).
  - primary SUS: primary itself keeps today's SUS rule.

- [ ] **Step 1: Failing tests:**
  - `member recreated after money received` — request with member B, receipt full; recreate B → B cycle 2, `member.consumedAt` set, reason PAYOUT_RECEIVED; recreate B again with expectedCycle 1 → STALE; primary A still recreatable (its `request.consumedAt` null before).
  - `member refused while waiting` — SENT, no receipt → throws, message contains "Tiền chưa về đủ".
  - `member keeps its own EarnApp account across recreation` — B has own account X; after recreate X `closedAt===null`, `vmId===B`.
  - `primary SUS lets members recreate as SUSPENDED` — primary VM status SUSPENDED; recreate B → reason SUSPENDED, request money unchanged (no receipt).
  - `member recreated is history in new round` — after B recreated, `memberOf(B,2)` null and `openPayoutOf(B,2)` null.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run file + `vm-ops.integration.test.ts` + `earn-money.integration.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat: recreate VMs merged into a received payout`.

### Task 4: Reads — grid ops, VM history, payout report, dashboard

**Files:**
- Modify: `src/server/vm-ops/payout.ts` (`readVmOps`, `readVmOpsHistory`)
- Modify: `src/server/vm-ops/payout-report.ts`
- Test: `src/__tests__/proxy-management/payout-members.integration.test.ts`, `src/__tests__/proxy-management/payout-report.integration.test.ts`

**Interfaces:**
- `readVmOps` row gains `merge: null | {role:'PRIMARY';members:{vmId:string;where:string;share:string|null;consumed:boolean}[]} | {role:'MEMBER';primaryVmId:string;primaryWhere:string;consumed:boolean}`. For a MEMBER row, `request` is the merged request (same shape as today) and `milestone` uses `consumed = member.consumedAt!=null`; `earnAppId` stays the VM's own account. `share` only with `money` rights.
- `readVmOpsHistory` requests include those where the VM is a member (flag `memberOf: where of primary`).
- Payout report row gains `members:{vmId:string;where:string;serverId:string|null}[]`; server filter keeps a request if primary or any active member is on that server; distinct VM count = primary + active members; amounts unchanged (once).

- [ ] **Step 1: Failing tests:** `readVmOps shows member as merged with the request milestone` (B row: `merge.role==='MEMBER'`, `milestone==='WAITING'` after SENT, `request.id===A's`); `primary lists members`; report test `merged request counted once with members' VMs` (total amount = request amount; VM count 2; filter by B's server returns the row).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Run file + `payout-report.integration.test.ts` + dashboard tests (`npx vitest run src/__tests__ -t dashboard`) → PASS.
- [ ] **Step 5:** Commit `feat: show merged payouts on VM rows, history and report`.

### Task 5: tRPC router + ops API + OpenAPI

**Files:**
- Modify: `src/server/routers/vmOps.ts` (`requestPayout` input `members` optional array ≤ 100; new `addPayoutMembers`, `removePayoutMember` mutations)
- Modify: `src/server/ops-api/api.ts` (prepare body `members[]`; new route `POST withdrawals/{id}/members` scope `PAYOUT`, action `WITHDRAWAL_MEMBERS`, `approval:true`; DELETE not offered to AI — removal is web-only)
- Modify: `src/server/ops-api/views.ts` (`requestSelect` + `withdrawalView` add `members:[{vmId,where,cycle,consumed}]`; VM view adds `mergedInto` when member)
- Modify: `docs/ops-api/openapi.json` (version `1.6.0`, new path + schemas)
- Test: `src/__tests__/ops-api/ops-api.integration.test.ts` (add cases), router case in `payout-members.integration.test.ts`

- [ ] **Step 1: Failing tests:** API `prepare with members returns 202 then on approved retry creates members once` (use `ops-fixture.api()` auto-approve and a second identical call → `replay:true`, member count 1); `POST withdrawals/{id}/members adds a member and GET withdrawals/{id} lists it`; `GET vms/{memberId} shows mergedInto`; router `vmOps.addPayoutMembers` happy path.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; add `WITHDRAWAL_MEMBERS` wherever approval action names are enumerated (grep `WITHDRAWAL_PREPARE`). **Step 4:** PASS + `npx vitest run src/__tests__/ops-api`.
- [ ] **Step 5:** Commit `feat: merged payouts through router and ops API`.

### Task 6: UI — "Rút gộp về PayPal", member rows, primary panel

**Files:**
- Create: `src/components/vm-management/vm-grid/MergePayoutPanel.tsx`
- Modify: `src/components/vm-management/ServerWorkspace.tsx` (bulk toolbar button "Rút gộp về PayPal" when ≥ 2 rows selected and `rights.writeMoney||rights.payout`; `bulk==='merge'`)
- Modify: `src/components/vm-management/vm-grid/OpsCells.tsx`, `MoneyParts.tsx` (`requestLine`, `RequestSummary`)
- Modify: `src/app/(dashboard)/earnapp-withdrawals/**` row/panel to list member VMs (grep the page for `PayoutReport`)
- Test: `src/__tests__/ui/merge-payout-panel.test.tsx` (vitest + testing-library like existing UI tests; grep `PayoutBulkPanel` tests for the harness)

**Behaviour (copy exact strings):**
- Panel title "Rút gộp về PayPal"; step 1 radio list "VM chính (có tài khoản EarnApp)" — only selected VMs with `earnAppId`; others disabled with "Chưa có tài khoản".
- If chosen primary has an open request: panel shows "VM chính đã có lệnh rút <state>; gắn thêm các VM còn lại vào lệnh này" and saves through `addPayoutMembers`.
- Else: member table (VM, SDK hiện tại, "Đóng góp tham khảo" + "quét hh:mm", warning "VM có tài khoản riêng: giữ nguyên" when the member has its own account), "Tổng gợi ý $X", amount input "Số tiền thực rút trên EarnApp", PP / email picker reused from `RequestForm` (`trpc.vmOps.payoutPick` for the primary), default submission PREPARING; save via `requestPayout` with `members`.
- Same command-key / unknown-retry handling as `PayoutBulkPanel` (session journal per user+project+primary).
- Money cell for MEMBER: line "Đã gộp vào <primaryWhere>" + the request milestone label ("Chờ tiền về $20,54"); popover shows the request summary read-only plus "Ghi nhận đã tạo lại VM" when `milestone==='RECREATE'` or primary SUS (calls existing recreate form).
- PRIMARY: milestone line suffix "· gộp N VM"; summary lists members with "Bỏ gộp" button only when `submission==='PREPARING'`, and "Gộp thêm VM đã chọn" when other rows are selected.

- [ ] **Step 1: Failing UI tests:** primary choice disables VMs without account; total = sum of shares; save calls `requestPayout` with `members:[{vmId:B,expectedCycle:1}]`; existing-request case calls `addPayoutMembers`; member cell text "Đã gộp vào An-01 / VM_001".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `npx tsc --noEmit`; `npx eslint` on changed files.
- [ ] **Step 5:** Commit `feat: merged payout panel and member display on Server / VM`.

### Task 7: Docs, full verification, release

**Files:**
- Modify: `docs/runbooks/vm-ops-cycle.md` (section "Rút gộp nhiều VM (27/10/2026)")
- Create: `docs/superpowers/evidence/2026-10-27-merged-payout/README.md`
- Modify: root `AGENTS.md` (one dated entry)

- [ ] **Step 1:** Full suite from PowerShell `npx vitest run` → all pass (report count); `npx tsc --noEmit`; `npm run build` (if Prisma DLL EPERM, `npx next build` with unchanged generated client, as before).
- [ ] **Step 2:** Local production browser check on synthetic data (two servers, VMs A/B/C): create merged PREPARING, SENT, receipt, recreate B and A; four themes + 390 px for panel and member cell; screenshots only.
- [ ] **Step 3:** Independent review (fresh reviewer on the branch diff); fix findings red → green.
- [ ] **Step 4:** Release like 2026-10-26-dashboard-payout: fresh `pg_dump` + encrypted moon-01 copy verified; deploy script `tools/deploy-merged-payout.ps1` copied from `tools/deploy-dashboard-payout.ps1` plus `prisma migrate deploy`; rollback folder `D:/MoneyToHome/app-before-merged-payout-20261027`; read-only host business hash before/after; public manifest + health 200.
- [ ] **Step 5:** Copy updated OpenAPI 1.6.0 + short Vietnamese note `CAP_NHAT_RUT_GOP_20261027.md` to Central `C:/Users/Administrator/Desktop/MoneyToHome` with SHA-256 check (no token/config changes). Commit docs.
