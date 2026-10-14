# Business Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Preserve the user's approved sequential inline execution; one fresh final reviewer.

**Goal:** Use the same BDOps projects/accounts/ledger to operate personal Proxy/VM, staff work and withdrawn-minus-cost profit.

**Architecture:** Additive canonical model extensions and a businessManagement router/domain; shared journal v3 with per-operation module permissions. Managed UI wrappers keep original legacy pages; no second warehouse, no automatic mapping/import.

**Tech Stack:** Existing Next14/React18/tRPC10/Prisma5/PostgreSQL17; no new product dependencies.

**Spec:** `../specs/2026-10-14-business-integration-design.md`

## Global Constraints

- Genjy/PC ownership permanent; existing desired/installed and blank-only NEW allocation invariant.
- Profit basis WITHDRAWN (EXCHANGE) minus actual costs; receipts/transfers never added twice.
- Currency USD/VND separated; exact decimals, Bangkok date range; no external money commands.
- Fresh project/role/module checks; finance writes manager-only, secrets explicit copy; no auto permission grants.
- Journal v1/v2 compatible; new records archive/void, never physical delete; snapshots masked/encrypted.
- Local trial/test only, preserve legacy source and real data; no Railway/push/cutover.

## Review Focus

1. Infra-only operators cannot inspect financial journal through known operation IDs.
2. Financial edits/new receipts must not change a settled period or double-count internal transfers.
3. Account/billing/task mutation must not release installed/pending proxy occupancy or break v2 undo.
4. Cross-project VM/Gmail/PayPal/package/assignee IDs must fail before any partial data write.
5. Replay, same-day money bounds, rounding and changing source between preview/settle cannot corrupt totals.

### Task 1: Shared business models, scope and journal

Files: schema/additive migration; `src/server/business-management/{types,scope,money,operation-images,idempotency}.ts`; journal/snapshot/undo and legacy guards; tests `business-contract.test.ts`, `business.integration.test.ts`.

Interfaces: `authorizeBusiness(scope,area,write,db)` returns fresh scope; areas INFRASTRUCTURE/FUNDS/COSTS/PROFIT. `money(text):Prisma.Decimal`; `period(start,end)` returns Bangkok half-open bounds. `readBusinessImage(db,projectId,resource,id)`/`restoreBusinessImage(tx,image)` preserve v1/v2 unchanged. `runBusinessCommand(scope,{key,payload,kind,module},fn,db)` uses Serializable, saved requestHash/resultCipher and replay.

- [ ] RED pure cases exact cents/date validity; RED integration financial journal read denial/foreign IDs/replay.
```ts
expect(money('0.10').plus(money('0.20')).toFixed(2)).toBe('0.30');
expect(()=>money('1e3')).toThrow();
expect(period('2026-10-01','2026-10-31').end.toISOString()).toBe('2026-10-31T17:00:00.000Z');
```
- [ ] Add revision/archive/currency/links on canonical rows, BusinessWorkItem, module/request fields on journal and guarded trial/test migration.
- [ ] Implement fresh scope, exact money, module-filtered journal v3 and compensation; old snapshot types untouched.
- [ ] GREEN target tests plus original inventory/VM/history tests; commit functional contracts.

### Task 2: Accounts, VM binding and staff work

Files: `business-management/{accounts,work}.ts`; router; account/work UI helpers and tests.

Interfaces: `saveOperatingAccount(scope,{kind,id?,expectedRevision?,email,code?,status,notes?,secret?,key},db)` saves canonical Gmail or PayPal+primary email; `bindVMAccount(scope,{vmId,gmailId|null,expectedRevision,key},db)`; `saveWork(scope,{id?,revision?,title,vmId?,serverId?,assigneeId?,status,key},db)`; `readOperatingWorkspace` explicit masked DTO; `copyOperatingCredentials` explicit capability/PIN/audit.

- [ ] RED integration create/bind/foreign email or PayPal/assignee IDs/viewer, stale edit, masked DTO, bind dependency blocks account undo, work versus config task separation.
```ts
await expect(bindVMAccount(own,{vmId:foreignVM.id,gmailId:ownMail.id,expectedRevision:0,key:randomUUID()},db)).rejects.toMatchObject({code:'NOT_FOUND'});
expect(JSON.stringify(await readOperatingWorkspace(own,db))).not.toContain('password');
```
- [ ] Implement archive/safe edit/metadata binding with journal images, task ownership/status and scoped copies; no physical VM login.
- [ ] GREEN same tests and lifecycle regressions; commit account/work domain.

### Task 3: Canonical financial ledger

Files: `business-management/{finance,report}.ts`; schema triggers/scoped links and financial images; tests.

Interfaces: `saveFinance(scope,{kind:'FUND'|'WITHDRAWAL'|'COST',id?,revision?,key,date,currency,amount,links,status,notes},db)`, `voidFinance(scope,{kind,id,revision,key,reason},db)`; `readFinanceWorkspace(scope,{start,end,currency},db)` and `businessReport(scope,period,currency,db)` return decimal strings, masked rows, received/withdrawn/transferred/cost/net separately.

- [ ] RED integration managers versus workers, replay, atomic failure, same canonical tx ID, cross-project links, void keeps tx identity, currency/time boundaries and MIXING exclusion.
```ts
expect(report).toMatchObject({received:'100.00',withdrawn:'80.00',transferred:'20.00',cost:'30.00',net:'50.00'});
```
- [ ] Add canonical create/update/void paths, scoped FK verification, immutable tx IDs and settled period guard; no external payments.
- [ ] GREEN exact report examples and UI contract tests; commit.

### Task 4: Profit periods and settlements

Files: `business-management/profit.ts`, ProfitSplit fields/snapshot, read-only payment history; tests.

Interfaces: `createProfitPeriod(scope,{start,end,currency,partners:{name,percentage}[],key},db)` snapshots source hash+revisions; `settleProfit(scope,{id,revision,key},db)` verifies unchanged source; `markProfitPaid(scope,{allocationId,revision,key,reason},db)` records a fact only, not a transfer. Closed overlapping periods/currency rejected.

- [ ] RED percentages, exact penny remainder, source stale at settle, blocked edits inside settled period, no negative-profit payment assumption and write-only manager scope.
```ts
expect(allocateCents('10.00',[{name:'A',percentage:'33.33'},{name:'B',percentage:'66.67'}]).map(x=>x.amount)).toEqual(['3.33','6.67']);
```
- [ ] Implement scoped canonical period snapshots, locked settlement and readonly paid records; list masked, no credentials.
- [ ] GREEN period/change/rounding tests; commit.

### Task 5: Unified business UI and administration

Files: `src/components/business-management/{AccountsWorkspace,WorkWorkspace,FinanceWorkspace,ProfitWorkspace,BusinessOverview}.tsx`; managed wrappers Gmail/PayPal/funds/costs/withdrawals/profit; ServerWorkspace VM account action; Sidebar/dashboard/history; project create settings and membership/store.

- [ ] RED orchestration/UI helpers for clean form submit/retry/stale edit and period/currency/report selection; manager finances separate from operator tasks.
- [ ] Reuse proxy style, neutral tables/forms, direct per-VM account/tasks/expense links. Tabs combine income/withdrawals/costs; navigation exposes finance by existing modules, not automatic grants.
- [ ] Add project type Business Proxy/VM and connect personal overview/work/finance together, preserving legacy routes and query mount isolation.
- [ ] Browser synthetic flow: account and VM binding/task, USD income=100/withdraw=80/cost=30 → net=50; MIXING not income twice; history and safe undo; viewer controls and secrets masked.
- [ ] GREEN types/lint/build and full suite, commit UI.

### Task 6: Verification and handoff

- [ ] Synthetic trial bootstrap only; real Sheet/provider lists untouched.
- [ ] Restore encrypted backup to separate empty trial and compare new table counts/decrypt sample.
- [ ] Full suite/types/lint/build; one fresh independent whole-milestone review, one RED→GREEN fix pass, no repeated review.
- [ ] Update runbooks/master progress, keep own local preview/worktree; Railway/source cutover remain explicit next milestones.
