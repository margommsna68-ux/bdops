# Team Cash and USDT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Preserve the user's selected sequential native execution and one fresh final review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Completed locally on 15 October 2026. 208 tests/57 files, types/lint/build and guarded copy/restore checks passed; four inherited lint warnings remain. See ../evidence/2026-10-15-team-cash-usdt.md.

**Goal:** Record operating costs in their original currencies, normalize them to USDT with transaction-specific rates, and calculate profit from confirmed USDT received by the team.

**Architecture:** Extend canonical CostRecord and add TeamReceipt with an optional one-to-one link to the existing collector ledger. An opt-in team-cash finance scope works in PAYPAL_ONLY projects as well as Proxy/VM projects, without changing infrastructure mode. Existing legacy periods and journal snapshots remain readable; new money writes, undo and settlement share transaction guards.

**Tech Stack:** Existing Next.js 14.2.35, React 18, tRPC 10, Prisma 5.22, PostgreSQL 17, Zod and Vitest. No new product dependencies. User-approved Binance P2P reference source, default BUY USDT with VND; each saved quote remains frozen.

**Spec:** `../specs/2026-10-15-team-cash-usdt-design.md`, approved by the user on 15 October 2026.

## Global Constraints

- Profit basis is TEAM_RECEIVED and reporting currency is USDT; only confirmed, non-void team receipts contribute.
- Preserve the original amount and currency. Rate direction is original currency units per 1 USDT; normalized USDT = original amount / rate. USDT itself requires rate 1.
- Currency codes are 3–8 uppercase letters. Original amounts allow 8 fractional digits; rates allow 12; normalized USDT and allocations use 6. Use exact decimal strings and HALF_UP, never JavaScript float for calculation.
- Missing non-USDT rates never become 1. Suggestions are visible copies of earlier explicit rates; later suggestions never revalue saved records.
- Dates use Asia/Bangkok and half-open month bounds. Costs use the recorded cash-out date; team receipts use actual receipt date. No automatic prepaid amortization.
- PayPal/collector fees already deducted before team receipt are reconciliation information, not an additional profit deduction. MIXING is not income.
- Keep old WITHDRAWN/USD/VND periods, paid facts, snapshots and IDs. Never recalculate them implicitly using TEAM_RECEIVED.
- Preserve Genjy/PC ownership, literal-blank NEW allocation, desired/installed VM separation and credential-copy permissions.
- Only local trial/test/copy databases may be written in this milestone. Do not change the Railway services, production data, real Sheet data or repository remotes. Do not print private keys, connection URLs, secrets or copied account data.
- Repository root for every relative path below is `C:\Users\TUNTUN\Desktop\project web new\bdops-proxy-app`. Keep the existing linked worktree and branch. Read the parent AGENTS.md before execution.

## Review Focus

1. A v3 journal image lacks newly added nullable FX fields; compare its historical field projection rather than marking every old action stale or clearing new money fields. Pinned in Task 3.
2. Two projects submit the same physical receipt reference, or one source expense is linked twice; exactly one may succeed, and errors must not disclose the other project's identity. Pinned in Task 5.
3. Cost edit and settlement run concurrently, including moving VND costs into/out of a USDT period; the committed result must preserve the closed report. Pinned in Task 6.
4. Old TEAM_PAYMENT amounts are USD ledger values, not evidence of actual USDT received; preserve four historical candidates without inventing receipt amounts. Pinned in Tasks 5 and 8.
5. Very small conversions, maximum numeric values, signed losses and division remainders must neither silently become zero nor disagree between storage, display and partner allocations. Pinned in Tasks 1 and 6.

## File and interface map

Create focused domain modules under `src/server/business-management/`: `usdt-types.ts`, `usdt-money.ts`, `team-cash-scope.ts`, `cash-command.ts`, `cash-lock.ts`, `usdt-costs.ts`, `team-receipts.ts`, `team-cash-report.ts`, `team-cash-profit.ts`, `collector-reconciliation.ts`. Keep existing legacy financial functions for historical period behavior; dispatch by explicit finance mode/basis rather than replacing the old formula in place.

New public domain contracts are defined once in `usdt-types.ts`:

```ts
export type CashRange = {start:string; end:string};
export type CashCommandResult = {id:string; replay:boolean; undone:boolean};
export type ProfitTreatment = 'CASH_COST' | 'ALREADY_NETTED';
export type SaveUsdtCostInput = {
  id?:string; expectedRevision?:number; key:string; reason?:string;
  date:string; amount:string; currency:string; rate?:string; notes?:string;
  category:string; serverId?:string|null; proxyAccountId?:string|null;
  treatment:ProfitTreatment; sourceReceiptId?:string|null;
  sourceCollectorExpenseId?:string|null;
};
export type SaveTeamReceiptInput = {
  id?:string; expectedRevision?:number; key:string; reason?:string;
  receivedDate:string; amountUsdt?:string; referenceId?:string;
  status:'DRAFT'|'CONFIRMED'; collectorId?:string|null;
  sourceCollectorExpenseId?:string|null; collectorUsdAmount?:string;
  notes?:string;
};
export type CashSourceFacts = {
  receipts: {id:string; revision:number}[];
  costs: {id:string; revision:number; currency:string;
    amount:string; rate:string|null; usdt:string|null; treatment:ProfitTreatment}[];
  collectorCandidates: {id:string; revision:number; fingerprint:string}[];
};
export type TeamCashReport = {
  basis:'TEAM_RECEIVED'; currency:'USDT'; teamReceived:string;
  cost:string; net:string; excludedNettedCostCount:number;
  blockingCount:number; unlinkedReceiptCount:number;
  blockers:{kind:'MISSING_RATE'|'UNVERIFIED_RECEIPT'|'UNCLASSIFIED_EXPENSE';id:string}[];
  sourceHash:string;
};
```

`db` in signatures below means `PrismaClient`, defaulting to the existing Prisma instance. Transaction functions accept `Prisma.TransactionClient`. ActorScope is the existing project/user identity; authorization always reloads membership. Every amount in a DTO is a string.

### Task 1: Exact USDT conversion and allocation

**Files:** Create `src/server/business-management/usdt-money.ts`, `usdt-types.ts`; test `src/__tests__/proxy-management/usdt-money.test.ts`. Existing `money.ts`/`allocateCents` remain available for legacy periods.

**Interfaces:** `normalizeCostMoney({amount,currency,rate?}): {amount:string;currency:string;rate:string;usdt:string}`; `parseOriginalMoney(text):string` returns a validated positive 8-decimal original; `parseUsdt(text):string`; `allocateUsdt(net:string, partners:{name:string;percentage:string}[]):{name:string;percentage:string;amount:string}[]`.

- [x] Write RED tests with real expected values, including these cases:

```ts
expect(normalizeCostMoney({amount:'2500000',currency:'VND',rate:'25000'}))
  .toEqual({amount:'2500000.00000000',currency:'VND',rate:'25000.000000000000',usdt:'100.000000'});
expect(normalizeCostMoney({amount:'1.000001',currency:'USDT'}).usdt).toBe('1.000001');
expect(normalizeCostMoney({amount:'1',currency:'EUR',rate:'3'}).usdt).toBe('0.333333');
expect(()=>normalizeCostMoney({amount:'1',currency:'USD'})).toThrow();
expect(()=>normalizeCostMoney({amount:'1',currency:'USDT',rate:'2'})).toThrow();
expect(()=>normalizeCostMoney({amount:'1e3',currency:'USDT'})).toThrow();
expect(allocateUsdt('0.000001',[{name:'A',percentage:'50'},{name:'B',percentage:'50'}])
  .map(x=>x.amount)).toEqual(['0.000001','0.000000']);
expect(allocateUsdt('-0.000001',[{name:'A',percentage:'50'},{name:'B',percentage:'50'}])
  .map(x=>x.amount)).toEqual(['-0.000001','0.000000']);
```

- [x] Run `npm test -- src/__tests__/proxy-management/usdt-money.test.ts`; confirm missing exports/module fail before implementation.
- [x] Implement with a local Decimal clone, avoiding global Decimal configuration changes:

```ts
const D = Prisma.Decimal.clone({precision:80,rounding:Prisma.Decimal.ROUND_HALF_UP});
// Validate lexical form and numeric bounds before construction.
const normalized = new D(amount).div(new D(rate));
const usdt = normalized.toFixed(6, D.ROUND_HALF_UP);
// Reject positive originals whose stored USDT rounds to zero or exceeds numeric(24,6).
```

  Accept only canonical plain positive decimals, up to 16 integer + 8 fractional amount digits and 12 integer + 12 fractional rate digits. Currency is trimmed/uppercased and checked against `^[A-Z]{3,8}$`. USDT defaults to exactly 1; an explicit different rate is an error. `parseUsdt` accepts up to 18 integer + 6 fractional digits. For allocations parse signed net up to 20 integer + 6 fractional digits, convert absolute value to integer micro-USDT, distribute largest remainders by original partner order, then reapply sign. Normalize negative zero to zero. Partner percentages use the existing 2-decimal percentage rule and sum exactly to 100.
- [x] Add boundaries: eighth original/12th rate/6th USDT fractional digits; seventh USDT digit rejected; zero/negative/whitespace-only/infinity/exponent/overflow rejected; rounding HALF_UP; legitimate zero net; duplicate partner names and percentages not totaling 100 rejected. Run the new file plus `business-workflow.test.ts` and `business-profit.integration.test.ts` with the guarded test datasource.
- [x] Commit the converter, contracts and tests as `feat: add exact USDT money conversion`.

### Task 2: Additive cash schema and migration safety

**Files:** Modify `prisma/schema.prisma`; create `prisma/migrations/20261015010000_team_cash_usdt/migration.sql`, `src/server/business-management/rehearsal-guard.ts`, `src/__tests__/proxy-management/team-cash-schema.integration.test.ts`, `team-cash-rehearsal-guard.test.ts`, `team-cash-fixture.ts`; update `business-fixture.ts` cleanup for the new relations.

**Interfaces:** Prisma TeamReceipt with nullable unverified amount; `assertCashRehearsalTarget(targetUrl,protectedUrls):{host:string;port:string;database:string}`. CostRecord gains stable explicit FX fields rather than overwriting original money.

  The new tests import `teamCashFixture` and `businessDB as db` from `team-cash-fixture.ts`. Its default creates a separate fixture with PROXY_VM and cash enabled; the PAYPAL_ONLY option leaves businessMode unset:

```ts
export {businessDB} from './business-fixture';
export async function teamCashFixture(mode:'PROXY_VM'|'PAYPAL_ONLY'='PROXY_VM') {
  const f=await businessFixture();
  await businessDB.project.update({where:{id:f.scope.projectId},data:{
    type:mode==='PAYPAL_ONLY'?'PAYPAL_ONLY':'FULL',
    settings:mode==='PAYPAL_ONLY'?{teamCashEnabled:true}:{businessMode:'PROXY_VM',teamCashEnabled:true},
  }});
  return f;
}
```

  Import `businessFixture/businessDB` from `business-fixture.ts` in that module. Historical v3 tests deliberately use the original fixture before activation.

- [x] Write RED persistence/guard tests:

```ts
const raw=await db.costRecord.create({data:{projectId:f.scope.projectId,date:new Date(),
  amount:'2500000.12345678',total:'2500000.12345678',currency:'VND',
  usdtRate:'25000.000000000000',usdtAmount:'100.000005',profitTreatment:'CASH_COST'}});
expect(raw.total.toFixed(8)).toBe('2500000.12345678');
expect(()=>assertCashRehearsalTarget('postgresql://x:x@remote.invalid/proxy_cash_verify_a',[])).toThrow();
expect(()=>assertCashRehearsalTarget(appUrl,[appUrl,testUrl])).toThrow();
```

  Define `appUrl/testUrl` from the existing fixture environment, not embedded credentials. Test prefixes `proxy_cash_verify_*` and `proxy_cash_restore_*`, explicit loopback host/port and a target distinct from app/test. Reject connection query parameters that can redirect host/port/database. Do not relax existing restore/test guards.
- [x] Run the targeted tests and confirm RED; do not run Prisma against `.env` implicitly.
- [x] Add these exact schema contracts:

```prisma
model TeamReceipt {
  id                       String @id @default(cuid())
  projectId                String
  project                  Project @relation(fields:[projectId],references:[id],onDelete:Restrict)
  receivedAt               DateTime
  amountUsdt               Decimal? @db.Decimal(24,6)
  referenceId              String?
  referenceKey             String? @unique
  status                   String @default("DRAFT")
  collectorId              String?
  collector                User? @relation("TeamReceiptCollector",fields:[collectorId],references:[id],onDelete:Restrict)
  sourceCollectorExpenseId String? @unique
  sourceCollectorExpense   CollectorExpense? @relation(fields:[sourceCollectorExpenseId],references:[id],onDelete:Restrict)
  collectorUsdAmount       Decimal? @db.Decimal(24,8)
  createdById              String
  createdBy                User @relation("TeamReceiptCreator",fields:[createdById],references:[id],onDelete:Restrict)
  notes                    String?
  revision                 Int @default(0)
  voidedAt                 DateTime?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
  nettedCosts              CostRecord[]
  @@index([projectId,receivedAt])
}
```

  Add Project.teamReceipts, User.teamCollectedReceipts/User.teamCreatedReceipts with the named relations above, CollectorExpense.teamReceipt (optional) and CollectorExpense.sourcedCost (optional). Add to CostRecord: `usdtRate Decimal?(24,12)`, `usdtAmount Decimal?(24,6)`, `fxAppliedAt DateTime?`, `fxSource String?`, `fxNote String?`, `profitTreatment String @default("CASH_COST")`, `sourceReceiptId String?` with Restrict relation to TeamReceipt, and `sourceCollectorExpenseId String? @unique` with Restrict relation to CollectorExpense. Widen only CostRecord.amount/total to numeric(24,8), ProfitSplit money totals/netProfitUsdt and SplitAllocation amount/amountUsdt to numeric(26,6). Preserve all old values, defaults for legacy basis/currency, IDs and other component cost columns. Add CollectorExpense `revision Int @default(0)`, `businessManaged Boolean @default(false)` and `voidedAt DateTime?`.

  Add SQL CHECK constraints for positive non-null receipt amount, valid receipt status, confirmed receipt requiring amount/reference, nonnegative revision, positive non-null FX rate and valid cost treatment. A cash cost with missing rate is allowed as a historical review candidate, never silently normalized. No bulk backfill of currency, USDT amounts, paidToTeam, flags or historical profit.
- [x] Verify sanitized host/database is the dedicated **local** test target, then create the SQL with `npm run db:test -- migrate dev --create-only --name team_cash_usdt`. Its shadow database must be disposable, local and distinct from app/test/copy targets; if the configured user cannot create a safe shadow database, configure one guarded local shadow target, never a remote fallback. Rename the single newly generated `*_team_cash_usdt` directory to `20261015010000_team_cash_usdt` before applying, verifying both resolved paths remain under this worktree's prisma/migrations. Review SQL for DROP/DELETE/TRUNCATE or narrowing types, add the named CHECK constraints, then run `npm run db:test -- migrate deploy` and `npm run db:test -- generate`. Run schema/guard tests GREEN and existing fixture tests; cleanup removes receipt-linked costs before receipts and collector rows.
- [x] Commit schema, migration, guard and persistence tests as `feat: add team receipt and cost FX storage`.

### Task 3: Finance-only scope, journal compatibility and common money lock

**Files:** Create `team-cash-scope.ts`, `cash-command.ts`, `cash-lock.ts`; modify `business-management/{operation-images,scope,finance,report}.ts`, `operation-history/{snapshot,journal,undo}.ts`, `permissions/{infrastructure,legacy-infrastructure}.ts`, `proxy-management/types.ts`, `routers/project.ts`, `server/trpc.ts`; create `team-cash-access.integration.test.ts`, `team-cash-history.integration.test.ts`.

**Interfaces:** `authorizeTeamCash(scope,area,write,db)` for FUNDS/WITHDRAWALS/COSTS/PROFIT; `activateTeamCash(scope,{key},db):Promise<CashCommandResult>`; `lockCashProject(tx,projectId):Promise<void>`; `runCashCommand(scope,{key,payload,kind,module},fn,db)` preserves existing replay/undone semantics and emits snapshot v4. Existing infrastructure/account modes retain their own checks.

- [x] RED test finance-only PAYPAL_ONLY access and historical projection compatibility:

```ts
await db.project.update({where:{id:f.scope.projectId},data:{type:'PAYPAL_ONLY',settings:{teamCashEnabled:true}}});
await expect(authorizeTeamCash(f.scope,'COSTS',true,db)).resolves.toBeDefined();
await expect(createManagedServer(f.scope,{code:'must-not-enable-vm',vmCodes:['VM_001']},db))
  .rejects.toMatchObject({code:'FORBIDDEN'});
// Build a real v3 cost operation before normalization, then add nullable schema fields.
expect(openSnapshot(encrypt(JSON.stringify(v3Snapshot))).version).toBe(3);
await expect(inspectOperation(f.scope,v3OperationId,db)).resolves.toMatchObject({blockedReason:null});
```

  Import `createManagedServer` from `src/server/vm-management/metadata.ts`. Before modifying the old image capture implementation, generate a synthetic v3 COST operation through the existing `saveFinance`, read its cipher from OperationJournal and decode it with `openSnapshot`. Store its original-format cost image as `src/__tests__/fixtures/business-v3-cost.json`, containing only synthetic values. Do not regenerate this golden fixture after adding FX fields. The regression recreates its row in a separate test project with the same historical fields, re-encrypts the golden snapshot under the test key, and verifies null columns added by migration do not make it stale. A second test explicitly normalizes the row and proves its increased revision does block the old undo.
- [x] Run new tests RED. Add cases for viewer/worker denial, unauthorized known journal ID, revoked membership, no auto module grant, finance flag removal after cash data, and legacy PayPal read continuing after the first cash operation.
- [x] Extend ActorScope with an effective `teamCashEnabled` flag loaded from settings plus persistent cash markers. Add admin-only activation in a Serializable transaction, journaled and idempotent; it changes no project type or infrastructure mode. Add only the safe finance flag to membership DTO/store. Finance activation must not expose managed account credential APIs to PAYPAL_ONLY projects.

  Effective cash markers are any TeamReceipt (including voided), a normalized/reconciliation managed cost, or a TEAM_CASH_* journal operation. A settings edit cannot turn off the protected flow after adoption. Existing financial branches of `assertBusinessArea`, finance reads/choices and `runBusinessCommand` may authorize the cash-enabled PAYPAL_ONLY project; INFRASTRUCTURE/PAYPALS managed account branches must still require PROXY_VM. Keep original-currency FUND/WITHDRAWAL recording available through its scoped domain, with a reconciliation label. Reject old `saveFinance(kind:'COST')` writes after cash activation so callers cannot bypass the new quote/classification rules; legacy reports/periods remain readable.

  Take a common transaction advisory lock for project money operations:

```ts
await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`team-cash:${projectId}`},0))::text`;
```

  `runCashCommand` acquires this lock, reloads authorization and request-key state, then writes domain rows and journal atomically through the existing Serializable/P2034 retry helper. No client snapshot is trusted. Activation is separately admin-checked because a not-yet-enabled project cannot pass `authorizeTeamCash`.
- [x] Add snapshot version 4 and resources TEAM_RECEIPT/COLLECTOR_EXPENSE; include all exact original/FX/USDT/treatment/link fields for v4 cost images. Decode v1/v2/v3 unchanged. For old images compare actual fields projected onto the keys present in the stored after-image, including revision. Never restore an unknown new FX field from an older snapshot. Any explicit normalization bumps revision, so an old undo cannot overwrite later conversion.

  Finance-only ADMIN undo is allowed only for authorized financial snapshot resources and source dependencies. Existing Proxy/VM undo rules remain unchanged. New receipt undo voids; it never physically deletes. A collector outflow created by that same command remains managed and is ignored in wallet sums when voided, with its withdrawal links handled atomically. Linking an already-existing historical outflow must not cause undo to void that original ledger fact. Its managed provenance remains permanent. Use the Task 2 voidedAt field and update every collector sum/query to ignore voided rows without hiding historical detail.
- [x] Replace project-wide BUSINESS-history blanket denial for finance-only projects with explicit routing/row guards: retain the blanket protection for PROXY_VM. Old financial writers must not edit new managed money rows. Legacy PayPal account reads remain usable; agent collector reads keep module scoping. Legacy expense deletion/edit/restore checks linked receipts/costs and permanent managed markers. Legacy TEAM_PAYMENT creation acquires the same project money lock and checks closed USDT periods; it creates a review source, not inferred USDT income. Do not silently grant collector users financial-manager permission.
- [x] GREEN new access/history tests plus existing history/VM/business access regression files. Test failures after injected second write roll back rows and journal; replay same key/same payload returns one result, changed payload errors. Commit as `feat: guard team cash scope and reversible money history`.

### Task 4: Original-currency costs with frozen USDT conversion

**Files:** Create `usdt-costs.ts`; modify `operation-images.ts`; test `usdt-costs.integration.test.ts`, `usdt-cost-workflow.test.ts`.

**Interfaces:** `saveUsdtCost(scope,input:SaveUsdtCostInput,db,deps?):Promise<CashCommandResult>`; `voidUsdtCost(scope,{id,expectedRevision,key,reason},db)`; `lastCostRate(scope,currency,db):Promise<{rate:string;date:string;sourceCostId:string}|null>`. `deps.afterWrite(tx)` supports a real rollback regression, as in existing finance tests.

- [x] RED integration example and historical quote stability:

```ts
const saved=await saveUsdtCost(f.scope,{key:randomUUID(),date:'2026-10-15',
  amount:'2500000',currency:'VND',rate:'25000',category:'SERVER',treatment:'CASH_COST'},db);
expect((await db.costRecord.findUniqueOrThrow({where:{id:saved.id}})).usdtAmount!.toFixed(6)).toBe('100.000000');
await saveUsdtCost(f.scope,{key:randomUUID(),date:'2026-10-16',amount:'2700000',
  currency:'VND',rate:'27000',category:'SERVER',treatment:'CASH_COST'},db);
expect((await db.costRecord.findUniqueOrThrow({where:{id:saved.id}})).usdtRate!.toString()).toBe('25000');
```

- [x] Run RED. Add explicit rejection of missing USD rate, foreign server/package/source receipt, stale revision, duplicate source collector expense, source-type TEAM_PAYMENT/COMMISSION_WITHDRAW imported as a cost, and ALREADY_NETTED lacking a same-project confirmed receipt/source reconciliation. Include browser-helper case: switching VND to USD clears the old VND rate.
- [x] Implement create/update/void through `runCashCommand`. Validate input, source, project links and both old/new period dates before changing anything. Persist original amount/total/currency, explicit rate, normalized USDT, FX timestamp/source, treatment and optional source links in one transaction. Do not allow changing a historical source by replacing source IDs without explicit revision checks. Classify linked BILL/OTHER explicitly; do not infer from note text.

```ts
const currency=input.currency.trim().toUpperCase();
const quote=input.treatment==='ALREADY_NETTED' && currency!=='USDT' && !input.rate
  ? null : normalizeCostMoney(input);
const original=parseOriginalMoney(input.amount);
const moneyData={amount:original,total:original,currency,
  usdtRate:quote?.rate??null,usdtAmount:quote?.usdt??null,
  fxAppliedAt:quote?new Date():null,fxSource:quote?'MANUAL':null,
  profitTreatment:input.treatment,businessManaged:true};
// ALREADY_NETTED is a linked reconciliation row; report excludes it from deductions.
```

  `lastCostRate` queries the most recent non-void same-project cost with a valid explicit rate and FX timestamp; read requires COSTS access. It is only a suggestion and never updates saved quotes. Legacy unconverted records remain visible with null USDT and a correction action.
- [x] Add exact roundtrip/undo for original amount, rate and quote; void preserves identifiers and provenance. Test no proxy/VM occupancy change, and no source partial write on failure. Run targeted tests GREEN and existing financial history regressions.
- [x] Commit as `feat: normalize operating costs to frozen USDT amounts`.

### Task 5: Actual team receipts and collector reconciliation

**Files:** Create `team-receipts.ts`, `collector-reconciliation.ts`; modify guarded collector mutations in `routers/agentPP.ts`; test `team-receipts.integration.test.ts`, `collector-reconciliation.integration.test.ts`.

**Interfaces:** `saveTeamReceipt(scope,input:SaveTeamReceiptInput,db,deps?):Promise<CashCommandResult>`; `voidTeamReceipt(scope,{id,expectedRevision,key,reason},db)`; `restoreTeamReceipt(scope,{id,expectedRevision,key,reason},db)` restores a voided receipt through an explicit ADMIN correction without freeing/reusing its reference; `reviewCollectorSources(scope,range,db)` returns masked same-project source candidates, their type/date/original USD, existing receipt/cost link and review reason; never raw credentials. `readReceiptChoices(scope,db)` returns eligible same-project members and source IDs only.

- [x] Write RED tests for partial/combined receipt independent of withdrawal amount:

```ts
const source=await db.collectorExpense.create({data:{projectId:f.scope.projectId,
  collectorId:f.scope.userId,type:'TEAM_PAYMENT',amount:'110',referenceId:'legacy-source'}});
const r=await saveTeamReceipt(f.scope,{key:randomUUID(),receivedDate:'2026-10-15',
  amountUsdt:'100.123456',referenceId:'cash-'+randomUUID(),status:'CONFIRMED',
  collectorId:f.scope.userId,sourceCollectorExpenseId:source.id,collectorUsdAmount:'110'},db);
expect((await db.teamReceipt.findUniqueOrThrow({where:{id:r.id}})).amountUsdt!.toFixed(6)).toBe('100.123456');
expect((await db.collectorExpense.findUniqueOrThrow({where:{id:source.id}})).amount.toFixed(2)).toBe('110.00');
expect(await db.collectorExpense.count({where:{projectId:f.scope.projectId}})).toBe(1);
```

- [x] Run RED. Race two actors/projects on the same external reference and two receipts on one source expense; one succeeds, one conflicts, no foreign project data leaks. Preserve case of references; trim but do not lowercase arbitrary transaction identifiers. The global referenceKey is SHA-256 of the trimmed verified receipt reference, not a project-specific key. Draft legacy candidates can have null referenceKey until a real receipt is confirmed.
- [x] Implement source validation: collector is a current project member; linked expense has same project/collector and type TEAM_PAYMENT; supplied USD equals the existing source amount. No guessed equality between USD and USDT. If no source but known original USD is supplied, create exactly one TEAM_PAYMENT with the receipt in one transaction; original USD must fit the legacy ledger's 2-decimal bound. If USD is unknown, record confirmed actual USDT with unlinked reconciliation warning and do not invent a collector debit.

  Confirmed receipts require a positive 6-decimal USDT amount and nonempty reference. A DRAFT can retain unknown amount for review. Received date is explicitly entered/confirmed, not inferred from source creation timestamp. A receipt can be smaller than or combine multiple withdrawals; no equation to gross EXCHANGE is imposed. Unknown multi-project allocation remains a source candidate without invented revenue.
- [x] Handle update/void/explicit restore atomically with source revision/provenance. Existing linked collector original amount is not silently rewritten; require explicit consistent input and block when another source-dependent record or settled period would be invalidated. Preserve source rows using managed/void markers. A voided receipt keeps its reference reserved; restore is ADMIN-only, requires a reason and rechecks source/periods. Only a collector outflow originally created together with the receipt may be voided/restored alongside it. Adapt collector wallet sums to exclude void rows and COMMISSION_WITHDRAW from team-wallet outflow as before; retain commission-wallet behavior and cross-project privacy. Tests compare wallet totals before/after link, replay, undo and restore, proving no doubled original-USD debit.
- [x] Ensure 4 old-style TEAM_PAYMENT rows without actual USDT remain candidates, never confirmed receipts. BILL/OTHER become cost-classification candidates; COMMISSION_WITHDRAW is not auto-imported as a new cost. Legacy deletion/edit history cannot remove linked records. Run all receipt/reconciliation tests GREEN plus existing agent-PP review regressions; commit as `feat: record verified USDT team receipts`.

### Task 6: USDT cash report, historical periods and concurrent settlement

**Files:** Create `team-cash-report.ts`, `team-cash-profit.ts`; modify `period-lock.ts`, `profit.ts`, `usdt-costs.ts`, `team-receipts.ts`, `operation-images.ts`; test `team-cash-report.integration.test.ts`, `team-cash-profit.integration.test.ts`, `team-cash-races.integration.test.ts`.

**Interfaces:** `teamCashSources(scope,range,db):Promise<{report:TeamCashReport;facts:CashSourceFacts}>`; `createTeamCashPeriod(scope,{start,end,partners,key},db)`; `recalculateTeamCashPeriod`, `settleTeamCashPeriod`, `reopenTeamCashPeriod` accept `{id,expectedRevision,key,reason?}`. Existing paid/correction logic dispatches by stored basis, not today's default.

- [x] RED authoritative cash-basis example, with a receipt of 100 USDT, a 2.5m VND/25k cash cost and a 5 USDT cash cost:

```ts
expect((await teamCashSources(f.scope,{start:'2026-10-01',end:'2026-10-31'},db)).report)
  .toMatchObject({basis:'TEAM_RECEIVED',currency:'USDT',teamReceived:'100.000000',
    cost:'105.000000',net:'-5.000000'});
```

  Build fixtures through the real new cost/receipt functions. Add a separate old EXCHANGE and MIXING plus an ALREADY_NETTED fee row: none increases cash income or adds a second fee deduction. Include an old `paidToTeam=true` withdrawal without a TeamReceipt and prove it contributes zero USDT income.
- [x] Run RED, then build the report from confirmed non-void receipts and CASH_COST normalized costs across **all original currencies** in the date range. Show unconverted cash costs and unverified TEAM_PAYMENT/BILL/OTHER candidates as explicit blockers. Already-netted rows are counted for reconciliation, excluded from cost and missing-rate blockers. Confirmed USDT with no USD-source link is a nonblocking reconciliation warning; the missing source does not negate actual cash received. Aggregate money uses stored 6-decimal amounts and 80-digit intermediate precision.

  `sourceHash` is a stable sorted hash over range, basis version, IDs/revisions, actual original/FX/USDT values, classification and legacy-candidate fingerprints. Legacy candidate fingerprints include relevant values/updatedAt rather than trusting newly added revision=0 when a legacy path did not previously track revision. Module-limited DTOs hide source detail when callers only have PROFIT.
- [x] Add TEAM_RECEIVED/USDT period creation, recalculation and settlement. Preserve existing WITHDRAWN functions/snapshots and select them by stored basis; never rewrite old allocations or paid facts. New allocations use micro-USDT and sum exactly, including losses. Keep existing refusal to mark nonpositive allocations paid. Require identical source hash and zero blockers before settlement; store facts in encrypted snapshot with basis/version. Overlapping new USDT periods are rejected.

  After cash activation reject new WITHDRAWN-period creation through the old endpoint; stale clients must use the new creation flow. Existing old periods retain their old calculation/locks when explicitly inspected or corrected. Mark-paid/correct-paid/reopen on TEAM_RECEIVED uses the common cash lock and full 6-decimal values; keep the same ADMIN-only correction and already-paid safeguards.
- [x] Extend period checking: for a cost entering/leaving or changing a USDT period, inspect both old/new dates regardless of original currency; apply the same guard to FX edits, classification, source links, receipt date/amount, void, undo and guarded legacy changes. Keep old currency-specific locks for old periods. All writes and settlement use `lockCashProject` within the same Serializable transaction boundary and existing conflict retry.

```ts
const results=await Promise.allSettled([
  settleTeamCashPeriod(f.scope,{id:period.id,expectedRevision:period.revision,key:randomUUID()},db),
  saveUsdtCost(f.scope,{...changedVndCost,id:cost.id,expectedRevision:cost.revision,key:randomUUID()},db),
]);
// Either the cost commits and settlement is stale, or settlement commits and the edit is blocked.
expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
const closed=await db.profitSplit.findUniqueOrThrow({where:{id:period.id}});
if(closed.settled)expect((await teamCashSources(f.scope,range,db)).report.sourceHash).toBe(closed.sourceHash);
```

  Use barriers to exercise both lock-acquisition orders deterministically. Add insert/move-in/move-out/undo races and 23:59:59 Bangkok month edges. Persist an old settled USD period and verify every amount, paid flag and snapshot cipher remains unchanged after new USDT operations.
- [x] Run all new report/period/race tests GREEN and the original financial-period tests. Commit as `feat: calculate and lock profit from team USDT receipts`.

### Task 7: One finance UI for costs, team receipts and profit

**Files:** Create `components/business-management/{FinancePage,UsdtCostsWorkspace,TeamReceiptWorkspace,TeamCashOverview,TeamCashProfitWorkspace}.tsx`, `team-cash-workflow.ts`; modify `routers/businessManagement.ts`, `routers/project.ts`, `components/layout/Sidebar.tsx`, `components/business-management/FinanceWorkspace.tsx`, finance/dashboard/history wrappers and existing collector-wallet source links. Keep legacy components unmounted unless their mode is selected. Test `team-cash-workflow.test.ts`, `team-cash-api.integration.test.ts`.

**Interfaces:** Add `cashAccess`, `activateCash`, `cashSummary`, `cashCosts`, `saveCashCost`, `voidCashCost`, `lastCashRate`, `cashReceipts`, `saveCashReceipt`, `voidCashReceipt`, `restoreCashReceipt`, `cashSources`, `cashChoices`, `cashPeriods`, `createCashPeriod`, `recalculateCashPeriod`, `settleCashPeriod`, `reopenCashPeriod`. Each input includes projectId, mutations include key/revision; ranges are start/end only, since report unit is always USDT. Reuse existing domain-error translation without exposing SQL/credentials.

- [x] RED pure UI and router authorization tests:

```ts
expect(costPreview({amount:'2500000',currency:'VND',rate:'25000'})).toBe('100.000000');
expect(changeCostCurrency({amount:'1',currency:'VND',rate:'25000'},'USD').rate).toBe('');
expect(selectFinanceView({businessMode:null,teamCashEnabled:true})).toBe('TEAM_CASH');
expect(selectFinanceView({businessMode:'PROXY_VM',teamCashEnabled:false})).toBe('MANAGED_LEGACY_BASIS');
expect(selectFinanceView({businessMode:null,teamCashEnabled:false})).toBe('LEGACY');
```

  Define these helpers in `team-cash-workflow.ts` with no browser-only globals at module load:

```ts
type CostForm={amount:string;currency:string;rate:string};
export function costPreview(input:CostForm):string|null {
  try{return normalizeCostMoney(input).usdt;}catch{return null;}
}
export function changeCostCurrency(form:CostForm,currency:string):CostForm {
  return {...form,currency,rate:currency==='USDT'?'1':''};
}
export function selectFinanceView(input:{businessMode:string|null;teamCashEnabled:boolean}) {
  return input.teamCashEnabled?'TEAM_CASH':input.businessMode==='PROXY_VM'?'MANAGED_LEGACY_BASIS':'LEGACY';
}
```

  Test that retry keys include the complete original amount, rate, source and treatment payload; changed input gets a new key.
- [x] Add validated router inputs using the Task 1 parsers/domain contracts. Manager-only finance writes; ADMIN activation/undo; scoped source lists and receipt choices. Test callers with viewer, infra-only operator, revoked module, foreign receipt/source/period ID and finance-only PAYPAL_ONLY membership. No PayPal account credential API is exposed by cash activation.
- [x] Implement `FinancePage` selector from fresh membership/effective cash access: TEAM_CASH component if enabled; existing managed finance for PROXY_VM not activated; otherwise legacy. Do not change the infrastructure ManagedPage selector. In PAYPAL_ONLY cash mode, PayPal pages and collector wallet remain usable, the dashboard must not mount VM/proxy queries, and the navigation must not grant new modules.

  Funds and original-currency withdrawals reuse FinanceWorkspace's recording/list components with the Task 3 financial authorization extension. Display original USD/VND separately as reconciliation, remove their old gross-profit card in cash mode, and add the actual-team-receipt tab beside the withdrawal list. Do not reinterpret or automatically convert those original fund/withdrawal values. Only costs, actual team receipts and profit use the new USDT components.
- [x] Build the short cost form: amount, currency, date, category; rate field only for non-USDT with visible `1 USDT = …` label and live decimal preview. USDT locks rate 1. Load the last same-currency suggestion with its date/source label. Preserve explicit edits on refetch; clear rate when currency changes; show original and USDT in tables/history. Reconciliation-only fee selection asks for its source and clearly says it is excluded from profit.
- [x] Add the Nhận về team tab with actual USDT/date/reference, optional collector/source and explicit draft/confirmed state. Source review opens from the original collector row; old amounts are displayed as original USD, not prefilled as USDT. Show partial/generic receipt support, duplicate/stale errors and source-link warnings. Keep old financial data visible by its basis without mixing totals.
- [x] Add USDT-only overview and period report. Show cash received, cost, profit, blockers with direct actions and reconciliation warning counts. Closed periods disable source edits; backend remains authoritative. History renders v4 money strings/rates without credentials. Run API/helper tests GREEN, types/lint/build. Before preview, back up the existing local trial, verify its URL is loopback:55432/proxy_app_trial with APP_ENV=trial, and apply migrations only to that validated trial profile. Do not let `npm run db:migrate` implicitly target an unchecked .env. Restart only the verified local preview process, preserve other Node/Postgres processes and enable cash on the synthetic trial via its real activation API. Browser-check manager and viewer flows; commit as `feat: expose simple USDT operating finance workflow`.

### Task 8: Rehearse the old dataset, verify backup restore and hand off

**Files:** Create `scripts/team-cash-rehearsal.ts`, `src/server/business-management/legacy-rehearsal.ts`, `src/__tests__/proxy-management/team-cash-migration.integration.test.ts`; update `scripts/check-backup-trial.ts`, `docs/runbooks/business-management.md`, `docs/runbooks/operation-history-backup.md`; create evidence `docs/superpowers/evidence/2026-10-15-team-cash-usdt.md`.

**Interfaces:** `inspectLegacyBaseline(db,projection?:LegacyEvidence['projection']):Promise<LegacyEvidence>` returns schema/data checksums over original columns only; `verifyLegacyPreserved(before:LegacyEvidence,after:LegacyEvidence):void` compares exact IDs, typed values and relations, ignoring newly added nullable columns and harmless numeric scale formatting; `rehearseTeamCash({metadataPath,legacyEnvPath,targetEnvPath})` restores only into a guarded separate local database. Errors and evidence contain counts/hashes only, not rows, plaintext credentials or URLs.

```ts
export type LegacyEvidence={
  projection:Record<string,{columns:{name:string;type:string}[];primaryKeys:string[];rowKeys:string[][]}>;
  tables:Record<string,{rows:string;primaryKeyHash:string;valueHash:string;relationHash:string}>;
};
```

  Canonicalize numeric values on the server as exact plain text with insignificant trailing zeros removed, dates in UTC, JSON object keys in stable order and rows ordered by original primary key. Hash strings without converting money to JavaScript numbers. The after-inspection consumes the before-projection and original row keys, so added QA rows/tables/columns do not look like altered legacy data; verify every original row/link remains. Keep row keys in private process/private evidence only, never in the committed public report. Compare full table counts exactly during migration before any QA additions. Check before-migration schema against an isolated database built from 0_init before accepting that baseline.

- [x] RED migration/rehearsal tests reject remote targets, app/test alias targets, nonempty restore destinations and absent/corrupted backup/key; prove 26 original table counts/values/relations survive migration. Seed a small synthetic old-schema dataset by executing `0_init/migration.sql` in a disposable guarded database, then use `prisma migrate resolve --applied 0_init` only after exact structural verification, and apply subsequent migrations. Wrong old-schema fingerprint must stop, not guess baseline status.

```ts
const before=await inspectLegacyBaseline(legacyFixtureDB);
// A deliberately deleted synthetic fixture row changes its key/value evidence.
await legacyFixtureDB.$executeRaw`DELETE FROM "Withdrawal" WHERE "id"=${syntheticWithdrawalId}`;
const after=await inspectLegacyBaseline(legacyFixtureDB,before.projection);
expect(()=>verifyLegacyPreserved(before,after)).toThrow();
// A second clean old-schema fixture is migrated without data edits.
expect(()=>verifyLegacyPreserved(cleanBefore,cleanAfterMigration)).not.toThrow();
expect(preview.sources.filter(x=>x.kind==='TEAM_PAYMENT').every(x=>x.amountUsdt===null)).toBe(true);
```

  `legacyFixtureDB` is a client for the guarded disposable old-schema test target. `syntheticWithdrawalId` belongs to that fixture only; never use real account/withdrawal IDs. Construct `cleanBefore/cleanAfterMigration` with the same inspector around migration of a second synthetic database. `preview` is the source-review output from Task 5 on a migrated fixture containing four unlinked legacy TEAM_PAYMENT rows. Preview source values are never copied into actual USDT amounts.
- [x] Implement read-only restore input from the existing private backup metadata at `..\reports\railway-recovery-2026-10-14\backup-metadata.json`. That recovery archive uses `BDB1 + nonce(12) + tag(16) + ciphertext`, unlike the application's BDOPSB01 archive; explicitly verify its SHA-256 and AES-GCM authentication before restore. Load its key from the metadata's private key path, never print it. Pipe the authenticated custom dump to pg_restore `--single-transaction --exit-on-error --no-owner --no-acl` against an empty loopback `proxy_cash_verify_*` target. Do not use the production URL in the old env file as a datasource.

  Load only the legacy encryption key needed for copied credential verification into the rehearsal child process before importing encryption modules; never replace the app's `.env` or trial key. Target connection is taken solely from the guarded target profile. Reject file paths resolving into the tracked repository for decrypted output and never persist a plaintext dump.
- [x] On the real copied backup, inspect original schema, baseline only the matching `0_init`, and migrate **the copy**. Compare all original row IDs, values and relation links. Expected pre-milestone source: 26 tables/1,120 rows; 220 PayPal, 30 receipts, 31 withdrawals (13 MIXING/18 EXCHANGE), 8 collector entries (4 TEAM_PAYMENT), no proxies/servers/VMs. Do not require these historical counts from a fresh live datasource. Keep the original archive and Railway untouched.
- [x] Produce a masked preview of the four team-payment candidates, BILL/OTHER classification candidates and missing-rate costs. Preserve null actual USDT/date verification until real evidence is supplied. Do not manufacture exchange rates or distribute collector payments across projects. Add a separate `.invalid` synthetic QA project in the copy to test 100 USDT receipt, 2.5m VND/25k cost=100 USDT, another 5 USDT cost, net=-5 USDT; demonstrate original project rows remain unchanged by those QA writes.
- [x] Create a normal encrypted system backup from a separate local trial containing the new tables/journal v4. Restore it with the existing BDOPSB01 flow to an empty guarded `proxy_restore_*` database and compare every table count, selected exact money/rates, receipt source links and decrypted journal/legacy credential samples using boolean assertions only. The active app and test database must not be restore targets.
- [x] Run `npm test`, `npx tsc --noEmit --incremental false`, `npm run lint`, `npm run build` on the validated local environment. Keep the existing four inherited agent-PP hook warnings separate from new failures. Complete manager/operator/viewer browser flows on local trial; if browser control is unavailable, report that exact gap and do not claim UI verification. Preview/rehearsal helpers start hidden and stay on loopback; a separate copy preview must use a different port/profile from the existing trial.
- [x] Run one fresh whole-milestone review using the previously chosen independent final-review workflow; implement meaningful RED→GREEN regressions for its important findings and rerun only affected checks before the final full verification. Record completed commands, counts, migration/source fingerprints, backup verification and unresolved real-data candidates. Update runbooks so TEAM_RECEIVED/USDT is current and legacy examples remain labeled historical. Commit verified code/docs, keep the worktree/preview and hand off for real-data decisions; no push, production migration or Railway cutover is included.

## Self-review and execution handoff

- [x] Confirm every spec section has an owning task: original money/rates (1/2/4), team receipts and collector linkage (2/5), finance-only mode and legacy protection (3/7), historical periods and locks (3/6), interface (7), old-data preservation/backup (8).
- [x] Check signatures, DTO field names and source links match this map; do not let the implementation silently reuse raw legacy EXCHANGE totals for the new report.
- [x] Search for undefined helper names, ambiguous source semantics and untested review-focus inputs; resolve before implementation. Record any genuine design conflict for the user rather than guessing real-money evidence.
- [x] User approved design and plan on 15 October 2026. Eight tasks implemented sequentially with one fresh independent final review and one verified fix pass. Keep the local worktree/preview; no push or production cutover.
