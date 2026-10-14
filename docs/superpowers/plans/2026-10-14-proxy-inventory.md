# Proxy Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa kho proxy cá nhân, báo BLOCKED, nhận replace và lịch sử lên web BDOps với các kiểm tra đã chốt từ Sheet; tạo nền dữ liệu cho VM/business.

**Architecture:** Giữ Next.js/tRPC/Prisma của BDOps. Domain module server-side quyết định parse/ownership/history/preview/commit; PostgreSQL giữ định danh IP, endpoints và nhật ký bất biến. Snapshot Sheet có provenance; client chỉ hiển thị kết quả và yêu cầu commit, không tự quyết định eligibility.

**Tech Stack:** Node >=20; Next.js 14.2.35; React 18; Prisma/client 5.22.0 theo lock hiện có; PostgreSQL; tRPC 10; Vitest. Kiểm tra phiên bản còn được hỗ trợ và các bản vá trước production; không tự nâng major stack trong các task domain này.

**Spec:** `../specs/2026-10-14-proxy-inventory-design.md`. Cũng đọc `../../../../docs/03-KE_HOACH_TRIEN_KHAI.md` từ file plan này.

## Global Constraints

- Bản làm việc: `C:\Users\TUNTUN\Desktop\project web new\bdops`; giữ source gốc và các thay đổi chưa commit.
- Kho/VM trong Sheet là cá nhân; không tự ghép sang VM Bright Data cũ.
- Owner GENJY bền vững; PC_CHUNG thuộc GENJY; đổi status/replace/void không biến thành SELF.
- Nhân viên thao tác toàn bộ VM trong dự án được cấp quyền; quyền VIEWER chỉ đọc và quyền credentials riêng.
- Chuỗi mặc định là IPv4:port:user:pass; port 1–65535; full hợp lệ giữ credentials nguyên trạng.
- Chống hàng gửi lại theo IP chuẩn hoá toàn hệ thống nội bộ, gồm current/history; ngoại lệ port stream phải được quản lý duyệt.
- SOURCE bare Genjy không phải full stock; UNKNOWN và QUARANTINED không phải nguồn cấp.
- Gán trên bảng khác cài thật; subsystem này không tự đổi VM khi nhận replace.
- Nhập thật lấy snapshot hiện hành; ngày cũ không rõ giữ null; mọi ngày giờ ghi UTC và hiển thị UTC+7, receivedDate là ngày địa phương.
- IP ví dụ của anh không được tự nhập production. Test dùng IPv4 documentation ranges 192.0.2.0/24, 198.51.100.0/24 và fake credentials.
- Credentials mã hoá bằng hàm AES-256-GCM hiện có; tránh raw password trong DTO mặc định, audit, thông báo lỗi hoặc log.
- Không chạy seed/reset hoặc db push --accept-data-loss trên dữ liệu thật. Không xoá dự án/data cũ trong plan này.
- Khi Genjy scan lỗi, xem/báo blocked vẫn dùng được; nhập NEW/REPLACE thành inventory khả dụng và cấp mới bị chặn, không dùng list rỗng.

## Review Focus

1. Password full proxy chứa dấu backslash hoặc ký tự markup ở cuối: full token hợp lệ giữ nguyên trước bước dọn provider text; test Task 2.
2. IP mới Genjy bare có note/status/date hoặc full credential nằm trong text nguồn: không được hoàn thiện làm mất metadata hay bỏ qua chặn; test Tasks 2/4/5.
3. Hai người commit cùng IP hoặc browser mất response rồi bấm lại: chỉ một receipt/batch được ghi, lỗi không để trạng thái dở dang; test Task 5.
4. Caller đưa ID dự án khác hoặc VIEWER gọi trực tiếp endpoint cũ: không gây thay đổi và không lộ credentials/location; test Tasks 3/6.
5. Received date cũ không rõ, source fetch lỗi hoặc snapshot đổi giữa preview/commit: không bịa ngày, không coi nguồn rỗng, yêu cầu preview lại; test Tasks 4/5.

## File map

| File | Trách nhiệm |
|---|---|
| `src/server/proxy-management/types.ts` | Input/domain/DTO/codes dùng chung; không có secret catalog ở client |
| `parse.ts`, `policy.ts`, `catalog.ts` | Parse list/endpoint, pure ownership/history decisions, package matching server-side |
| `repository.ts`, `transaction.ts` | Normalized registry, source/legacy reads, atomic writes/retry |
| `sources.ts`, `reconcile.ts` | Fetch Sheet/Genjy qua nguồn có quyền, giữ snapshot, tạo kế hoạch đối chiếu |
| `batches.ts`, `history.ts` | Preview/commit từng action, replay, history query và export |
| `src/server/routers/proxyManagement.ts` | tRPC wrapper, quyền và DTO |
| `src/components/proxy-management/` | RegistryTable, BatchDialog, HistoryPanel, BlockedExport; dùng Radix hiện có |
| `src/server/permissions/infrastructure.ts` | Operation rights + project-scoped resources |
| `prisma/schema.prisma`, `prisma/migrations/` | Additive schema, owner guard, uniqueness, index |
| `src/__tests__/proxy-management/` | Tests pure policy, adapter/API và integration PostgreSQL |

Không tách/refactor module tài chính ngoài các thay đổi role compile cần thiết. Chỉ sửa legacy proxy writers để hết đường bypass policy trong workspace PROXY_VM.

## Contracts dùng xuyên các task

```ts
export type Owner = 'SELF' | 'GENJY' | 'UNKNOWN';
export type Subgroup = 'PC_CHUNG' | null;
export type InventoryState = 'NEW' | 'LIVE' | 'BLOCKED' | 'REPLACED' | 'DIE' | 'QUARANTINED';
export type BatchKind = 'NEW' | 'BLOCKED' | 'REPLACE' | 'SHEET';
export type Outcome = 'READY' | 'SKIP' | 'ERROR';
export type IssueCode =
  | 'INVALID_INPUT' | 'COUNT_MISMATCH' | 'DUPLICATE_INPUT' | 'NOT_FOUND'
  | 'AMBIGUOUS_OLD' | 'NOT_BLOCKED' | 'CURRENT_IP' | 'HISTORICAL_IP'
  | 'OWNER_CONFLICT' | 'GENJY_RESERVED' | 'SOURCE_UNAVAILABLE'
  | 'STALE_PREVIEW' | 'KEY_PAYLOAD_MISMATCH' | 'UNKNOWN_PACKAGE' | 'FORBIDDEN';
export interface ParsedProxy {
  ip: string; port: number | null; username: string | null; password: string | null;
  format: 'BARE' | 'FULL';
}
export interface ActorScope {
  userId: string; projectId: string;
  role: 'ADMIN' | 'MODERATOR' | 'USER' | 'VIEWER';
  capabilities: string[];
}
export interface BatchInput {
  kind: BatchKind; text?: string; removedText?: string; addedText?: string;
  owner?: Owner; subgroup?: Subgroup; receivedDate?: string | null;
  snapshotIds?: string[]; idempotencyKey: string;
}
export interface PreviewRow {
  row: number; outcome: Outcome; code?: IssueCode; message: string;
  oldIp?: string; newIp?: string; identityId?: string; endpointId?: string;
  owner?: Owner; subgroup?: Subgroup; sourceRefs: string[];
}
export interface BatchPreview {
  token: string; kind: BatchKind; rows: PreviewRow[];
  ready: number; skipped: number; errors: number; expiresAt: string;
}
export interface CommitResult {
  batchId: string; replay: boolean; rows: PreviewRow[];
  applied: number; skipped: number; errors: number;
}
```


Các context/DTO được tạo trong `types.ts`, dùng cùng tên ở repository và service:

```ts
export interface Decision { outcome: Outcome; code?: IssueCode; message: string }
export interface CatalogAccount { id: string; code: string; username: string; password: string }
export interface IdentityFact {
  id: string; ip: string; owner: Owner; subgroup: Subgroup; revision: number;
  allocationMode: 'SINGLE_IP' | 'APPROVED_PORT_STREAM';
}
export interface EndpointFact {
  id: string; projectId: string; identityId: string; proxy: ParsedProxy;
  inventoryState: InventoryState; revision: number; vmKeys: string[];
}
export interface SourceEvidence {
  sourceRef: string; ip: string; owner: Owner; subgroup: Subgroup;
  format: 'BARE' | 'FULL'; hasFullCredentials: boolean; hasManualMetadata: boolean;
}
export interface HistoryFact {
  ip: string; kind: 'RECEIVED' | 'BLOCKED' | 'DIE' | 'REPLACED' | 'VOID';
  occurredAt: string | null; recordedAt: string;
}
export interface SourceSnapshotRef {
  id: string; sourceKey: string; hash: string; fetchedAt: string; scanSucceeded: boolean;
}
export interface SourceSnapshot extends SourceSnapshotRef { evidence: SourceEvidence[] }
export interface SheetSource {
  key: string; spreadsheetId: string; credentialRef: string;
  mode: 'GOOGLE_AUTH' | 'LOCAL_SNAPSHOT'; localSnapshotPath?: string;
}
export interface ProxyContext {
  identities: IdentityFact[]; endpoints: EndpointFact[]; evidence: SourceEvidence[];
  history: HistoryFact[]; receipts: {oldIp: string; newIp: string; status: 'APPLIED'|'VOID'}[];
  source: SourceSnapshotRef;
}
export interface ReplacementContext {
  old: EndpointFact | null; oldIdentity: IdentityFact | null; oldCandidates: number;
  next: ParsedProxy; nextEvidence: SourceEvidence[]; nextIdentities: IdentityFact[];
  nextInInventory: boolean; nextInVmOrReservation: boolean; nextHistory: HistoryFact[];
  exactReceiptReplay: boolean; sourceScanSucceeded: boolean;
}
export interface SheetSnapshot {
  snapshots: SourceSnapshot[];
  rows: {
    sourceRef: string; rawValue: string; proxy: ParsedProxy | null;
    kind: 'CURRENT_INVENTORY'|'LOOKUP_HISTORY'|'VM'|'GENJY_REFERENCE'|'OWNER_DECISION';
    owner: Owner; subgroup: Subgroup; vmKey: string | null;
    valueState: 'BLANK'|'FORMULA'|'PLACEHOLDER'|'UNRESOLVED'|'FULL';
  }[];
}
export interface ReconciliationPlan {
  rows: PreviewRow[]; snapshots: SourceSnapshotRef[];
  ownership: {ip: string; owner: Owner; subgroup: Subgroup; sourceRefs: string[]}[];
  vmRefs: {vmKey: string; sourceRef: string; valueState: 'BLANK'|'FORMULA'|'PLACEHOLDER'|'UNRESOLVED'|'FULL'; endpointId: string|null}[];
}
export interface EligibleProxy {
  identityId: string; endpointId: string; ip: string; port: number;
  revision: number; allocationKey: string;
}
export interface RegistryFilter {
  owner?: Owner; packageCode?: string; state?: InventoryState;
  view: 'CURRENT'|'HISTORY'|'ALL'; search?: string; cursor?: string; limit: number;
}
export interface RegistryRow {
  identityId: string; endpointId: string|null; ip: string; port: number|null;
  owner: Owner; subgroup: Subgroup; packageCode: string|null;
  state: InventoryState; revision: number; sourceRefs: string[]; vmRefs: string[];
}
export interface RegistryPage {
  rows: RegistryRow[]; nextCursor: string|null;
  counts: {current: number; historical: number; reserved: number; quarantined: number};
}
export interface ProxyTimeline {
  identity: IdentityFact;
  events: {kind: string; occurredAt: string|null; recordedAt: string; actor: string|null; sourceRef: string|null}[];
  replacements: {oldIp: string; newIp: string; receivedDate: string|null; recordedAt: string; status: 'APPLIED'|'VOID'}[];
  vmRefs: string[];
}
```

Các type mang ParsedProxy/password chỉ dùng trên server, không export sang client. Các function policy có signatures:
`decideNew(proxy: ParsedProxy, owner: Owner, ctx: ProxyContext): Decision`,
`decideBlock(candidates: EndpointFact[]): Decision`,
`decideReplacement(ctx: ReplacementContext): Decision`.
`queryRegistry(scope: ActorScope, filter: RegistryFilter): Promise<RegistryPage>` chỉ trả DTO đã mask.
Raw parsed password không nằm trong PreviewRow hoặc token gửi browser. Server giữ resolved plan mã hoá, token chỉ định danh plan. Preview có 10 phút để người dùng kiểm tra; expiry và revisions đều được kiểm tra khi commit.

---

### Task 1: Baseline có thể cài và migrate an toàn

**Files**
- Modify: `package.json`, `package-lock.json`, `.gitignore`, `Dockerfile`, `DEPLOY.md`.
- Create: `prisma/migrations/0_init/migration.sql`, `prisma/migrations/migration_lock.toml`, `docs/runbooks/proxy-staging.md`.

**Interfaces**
- Consumes: copied BDOps schema/source and lock; dedicated empty `DATABASE_URL_TEST`.
- Produces: reproducible install, baseline migration, staging runbook and test DB with existing schema.

- [ ] Step 1: Capture `git status --short`, diff and current HEAD. Keep the copied user edits as an initial baseline commit in this copy; check `.env` is ignored and inspect staged file names before commit. Create isolated implementation workspace using using-git-worktrees at execution time, carrying this saved baseline. No push/deploy in this step.
- [ ] Step 2: Install exact lock dependencies in the implementation workspace. Both Prisma packages are locked 5.22.0. Lock root version is 0.1.0 while package version is 8.9.0; fix metadata only, not dependency versions. Lock-only writes must include ignore-scripts because postinstall runs prisma generate.

```powershell
npm ci --ignore-scripts --legacy-peer-deps
npm install --package-lock-only --ignore-scripts --legacy-peer-deps
npx prisma generate
```

- [ ] Step 3: Obtain dedicated test DB, verify target hostname/database name in redacted form, then generate baseline using installed Prisma 5 flags:

```powershell
New-Item -ItemType Directory -Path prisma/migrations/0_init -Force
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script --output prisma/migrations/0_init/migration.sql
```

Only fresh test DB: set its datasource explicitly and run `npx prisma migrate deploy`. For an existing DB later, compare actual schema to baseline and use `migrate resolve --applied 0_init` only after matching and backup; never run the create-tables baseline blindly against it.

- [ ] Step 4: Change Docker start to `npm start`; deployment pre-step runs `npx prisma migrate deploy`. Add ignore entries for `.env.test`, `.env.production`, `.env.staging` and test DB dumps; keep `.env.example` tracked. Remove startup `db push --accept-data-loss`. Seed is not a deployment pre-step.
- [ ] Step 5: Run on the test DB only: migrate deploy twice, status, existing unit tests and TypeScript. Expected: second migration no-op, existing tables remain; no automatic seed. Record baseline failures if unrelated user edits fail and fix only what blocks this feature.

```powershell
npx prisma migrate status
npm test
npx tsc --noEmit --incremental false
```

- [ ] Step 6: Commit the migration/tooling/runbook files only after checks. Deliverable: app install and empty staging DB reproduces existing schema without destructive startup.

### Task 2: Parser, package matching and pure proxy policy

**Files**
- Create: `src/server/proxy-management/types.ts`, `parse.ts`, `policy.ts`, `catalog.ts`.
- Test: `src/__tests__/proxy-management/parse.test.ts`, `policy.test.ts`, `catalog.test.ts`.

**Interfaces**
- Produces `parseProxy(text: string): ParsedProxy`, `parseReplacementLists(removed: string, added: string): { old: ParsedProxy; next: ParsedProxy; row: number }[]`, `resolvePair(old: ParsedProxy, next: ParsedProxy): ParsedProxy`.
- Produces `decideNew`, `decideBlock`, `decideReplacement` from normalized contexts; returns `{outcome,code,message}`. Policies receive facts, never call fetch/Prisma.
- Produces `matchPackage(proxy: ParsedProxy, catalog: CatalogAccount[]): string | null`; CatalogAccount has id/code and decrypted credentials in server memory only. Credentials and catalog values never enter client modules.

- [ ] Step 1: Port meaningful cases from Sheet tests `test-replace-inputs.mjs`, `test-batch.mjs`, `test-new-import.mjs`, `test-fill-empty.mjs` into production-function tests with documentation-range IPs. No tests that copy the implementation's logic into the test.

```ts
import { describe, it, expect } from 'vitest';
import { parseProxy, parseReplacementLists, resolvePair } from '@/server/proxy-management/parse';

describe('paired replacement input', () => {
  it('inherits credentials by pair', () => {
    const old = parseProxy('192.0.2.10:5432:testuser:testpass');
    expect(resolvePair(old, parseProxy('198.51.100.10'))).toEqual({
      ip: '198.51.100.10', port: 5432, username: 'testuser', password: 'testpass', format: 'FULL',
    });
  });
  it('preserves a valid full password ending with a backslash', () => {
    const p = parseProxy('192.0.2.10:5432:testuser:' + 'secret' + '\\');
    expect(p.password).toBe('secret' + '\\');
  });
  it('rejects unequal pair counts', () => {
    expect(() => parseReplacementLists('192.0.2.10\n192.0.2.11', '198.51.100.10'))
      .toThrow('COUNT_MISMATCH');
  });
});
```

- [ ] Step 2: Run the tests; expect missing-module/function failures before implementation. Add parse that checks a valid FULL token first, then cleans presentation-only decorations on other lines; validates IPv4/port and rejects invalid middle lines, duplicate IP inputs and repeated/misplaced headings.
- [ ] Step 3: Use exact username+password match for package catalog. Catalog migration reads the five account mappings from server-side Sheet source; test uses synthetic catalog entries. Full Added overrides old credentials; bare Added inherits its own pair only.
- [ ] Step 4: Define `ReplacementContext` with explicit facts: resolved old endpoint + old health, owners/subgroups of new evidence, bare/full reference flags, manual metadata flag, current VM/reservation, current inventory, blocked/die history, replacement/history/receipt membership and source scan success. `decideReplacement` requires BLOCKED old; exact receipt replay is SKIP; only the narrow same-Genjy bare completion exception downgrades reservation warning.
- [ ] Step 5: Add table-driven tests: same IP different password blocked; Genjy bare allowed only within same subgroup; cross owner/subgroup denied; full in source text denied; bare with manual note/status/date denied; current VM, retired, previous receipt and failed scan denied; UNKNOWN denied. These pin actual risk cases, not label spelling alone.
- [ ] Step 6: Run `npm test -- src/__tests__/proxy-management/parse.test.ts src/__tests__/proxy-management/policy.test.ts src/__tests__/proxy-management/catalog.test.ts`, then TypeScript. Commit domain and tests. Deliverable: deterministic normalized input and decisions usable by every API path.

### Task 3: Durable registry, ownership and permissions

**Files**
- Modify: `prisma/schema.prisma`, `src/server/trpc.ts`, `src/server/routers/project.ts`, `src/server/routers/user.ts` and role lists in `src/app/(dashboard)/admin/users/page.tsx`.
- Create: migration named `proxy_registry`, `src/server/proxy-management/repository.ts`, `transaction.ts`, `src/server/permissions/infrastructure.ts`.
- Test: `src/__tests__/proxy-management/registry.integration.test.ts`, `permissions.test.ts`.

**Interfaces**
- `loadProxyContext(scope: ActorScope, input: BatchInput): Promise<ProxyContext>` includes all current/history facts and redacted cross-project conflicts.
- `assertInfrastructureAction(scope, action)` handles READ/BLOCK/IMPORT/REPLACE/ASSIGN/CONFIRM/COPY_CREDENTIALS/MANAGE, checks membership + module + operation.
- `withProxyTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>` uses Serializable and max 3 P2034 retries; no network inside.
- `getEligibleInventory(projectId): Promise<EligibleProxy[]>` returns only SELF/NEW, not used/reserved/risky, plus allocationKey for future VM subsystem. `EligibleProxy` includes identityId, endpointId, ip, port, revision, allocationKey; no password.

- [ ] Step 1: Add schema enums/models specified in the design. Keep old relation IDs and nullable linkage fields during backfill. Add revision integers and unique identity IP (`String @unique @db.Inet`); full raw legacy address is retained for provenance until migrated, not treated as authority. Add VIEWER to role validation and UI lists with no change to existing roles' values.
- [ ] Step 2: Create migration with `migrate dev --create-only` on dedicated test DB, inspect SQL and add a database trigger that refuses changing GENJY to another owner or dropping PC_CHUNG classification. Add field indexes for identity, project/state, source snapshot, history and batch key. Add `ProjectMember.capabilities String[] @default([])` and `ProxyProviderAccount` containing projectId, code/label and encrypted credentials for the catalog. The default subgroup is null and owner UNKNOWN; SQL checks forbid PC_CHUNG outside GENJY. Store all history via Restrict/soft retirement, avoiding cascading deletion of this feature's history.
- [ ] Step 3: Add integration tests using actual test DB. Fail by attempting a second identity with the same IPv4 and a GENJY→SELF update. Verify Prisma/SQL error and unchanged first row. Fixtures are fresh per test project and use explicit IDs to avoid touching old data. Cleanup uses IDs created by that suite in test DB only.

```ts
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { it, expect } from 'vitest';
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST! } } });

it('cannot reset Genjy owner', async () => {
  const id = 'fixture-owner-' + randomUUID();
  try {
    await db.proxyIdentity.create({ data: { id, ip: '192.0.2.42', owner: 'GENJY' } });
    await expect(db.proxyIdentity.update({ where: { id }, data: { owner: 'SELF' } })).rejects.toThrow();
    expect((await db.proxyIdentity.findUniqueOrThrow({ where: { id } })).owner).toBe('GENJY');
  } finally {
    await db.proxyIdentity.deleteMany({ where: { id } });
    await db.$disconnect();
  }
});
```

The suite validates `DATABASE_URL_TEST` exists and differs from app datasource before creating any fixtures; test IP uniqueness cleanup is scoped to its created IDs. Include timezone/null-date assertions.

- [ ] Step 4: Permission tests feed real middleware/domain rights: USER with module can BLOCK, VIEWER cannot any mutation, nonmember denied, MODERATOR without module denied, COPY requires explicit capability. Membership data comes from DB/session refreshed by auth; client flags do not grant rights. Resource lookups include project, cross-project conflict only says IP already reserved without disclosing its VM/credentials.
- [ ] Step 5: Backfill canonical identity and endpoint linkage from test legacy rows: conflicting ownership/current duplicate addresses go QUARANTINED with a conflict report; immutable history snapshots retain addresses before user edits. Preserve old confirmed exceptions as explicit policy/evidence, not global allow flags.
- [ ] Step 6: Run permission tests plus registry integration tests, migrate deploy twice and TypeScript. Commit. Deliverable: DB-backed identity, permanent Genjy and operation rights.

### Task 4: Source snapshots and Sheet reconciliation

**Files**
- Create: `src/server/proxy-management/sources.ts`, `reconcile.ts`, `src/__tests__/proxy-management/sources.test.ts`, `reconcile.test.ts`.
- Create: `scripts/proxy-import/inspect-snapshot.ts`, `docs/runbooks/proxy-sheet-import.md`.

**Interfaces**
- `fetchGenjySnapshot(source: SheetSource): Promise<SourceSnapshot>` reads every accessible tab/cell, hidden tabs included; records full/bare matches and scanned tab IDs.
- `buildReconciliation(input: SheetSnapshot, existing: ProxyContext): ReconciliationPlan` is pure and returns rows READY/SKIP/ERROR plus ownership evidence and source VM refs. Source unresolved values are not fake stock.
- `persistSourceSnapshot(snapshot): Promise<SourceSnapshotRef>` records source hash/success/revisions; successful scan adds permanent reservations, failed scan preserves prior evidence.

- [ ] Step 1: Fixtures model current Proxy Server/final/server/Genjy structure and canonical Sheet state decisions, using synthetic addresses. Include hidden Genjy tab, bare IP in notes, full credentials embedded in text, manual H/I/J metadata, old resolved PC note and recorded external port exception. Expected: current durable ownership decisions preserved; historical lookup rows not counted as active inventory.
- [ ] Step 2: Source adapter uses authorized Google Sheets access (service account shared by owner or OAuth) or user-supplied local snapshot. Do not require making Sheets public; do not reuse the existing public PP CSV scraper for Genjy. Store source IDs in server config; preserve independent tab/cell evidence. If no Google auth yet, local snapshot import supports building/testing; Genjy freshness remains explicit.
- [ ] Step 3: Adapter tests mock fetch, not SQL. Failed/unauthorized fetch yields SOURCE_UNAVAILABLE and no empty successful snapshot. Preserve unknown date null. A source credential detected anywhere prevents bare-only exception.
- [ ] Step 4: Reconciliation tests preserve literal blanks distinctly from formula/placeholder/unresolved VM cells. Output original row/cell + suggested target + issue code so user can check reality. Never infer VM position from adjacent note column alignment.
- [ ] Step 5: Persist the plan and immutable source hash to test DB; commit only reviewed READY records via batch service built in Task 5. `inspect-snapshot.ts` is read-only and writes a redacted preview report; it cannot mutate inventory.
- [ ] Step 6: Run source/reconciliation tests, TypeScript, review test import report. Commit. Deliverable: repeatable current-data comparison and complete Genjy reservation evidence.

### Task 5: Atomic preview/commit for new, blocked and replace

**Files**
- Create: `src/server/proxy-management/batches.ts`, `history.ts`, `src/server/routers/proxyManagement.ts`.
- Modify: `_app.ts`, legacy `proxy.ts`, writer paths in `vm.ts`, `src/lib/audit.ts`.
- Test: `batches.test.ts`, `batches.integration.test.ts`, `legacy-writers.test.ts` under proxy-management tests.

**Interfaces**
- `previewBatch(scope: ActorScope, input: BatchInput): Promise<BatchPreview>` stores encrypted resolved plan, payload hash, revisions and token expiring in 10 minutes.
- `commitBatch(scope: ActorScope, token: string, idempotencyKey: string): Promise<CommitResult>` checks scope/payload/revisions/source and writes READY rows + events + replacement/ownership + journal in one transaction.
- `getProxyTimeline(scope, identityId): Promise<ProxyTimeline>` returns status/replace/source and location metadata in project scope; credentials absent.
- `exportBlocked(scope): Promise<{packageCode: string; proxy: string; status: 'BLOCKED'}[]>` requires COPY_CREDENTIALS and audits a copy/export, not a provider message.

- [ ] Step 1: Unit tests call previewBatch with controlled repository/fetch adapters. READY/SKIP/ERROR counts match rows; source fetch failure blocks receiving NEW/REPLACE but permits existing BLOCKED reporting. Count mismatch prevents any preview commit. full credentials are absent from token/DTO/error logs; password available only via authorized copy.
- [ ] Step 2: Implement the planner using Task 2 policies and Task 3 repository. New valid receives become SELF NEW or remain Genjy. Blocked repeat keeps original timestamp. Replacement exact receipt replay does not increment receipt/status events. Date parser accepts YYYY-MM-DD, stores receivedDate separately from recordedAt, rejects invalid date rather than new Date fallback.
- [ ] Step 3: Implement commit using Task 3 transaction. Check current revisions and refreshed Genjy snapshot before opening SQL transaction; then compare persisted source revision within it. Write changes and history/journal atomically. Same key/hash returns prior result; same key/different payload is error. Recheck canonical IP membership for every READY row.

```ts
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

async function serializable<T>(db: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000, timeout: 10000,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 2) throw error;
    }
  }
}
```

No Google fetch/copy-provider call inside `fn`. Constraint conflicts return explicit CONFLICT, never silently become duplicates.

- [ ] Step 4: Integration test real competing commits and retry/rollback. Required assertions:
  - Promise.allSettled for two different batches receiving same new IP: one commit, the other conflict; one active endpoint/new receipt only.
  - Same idempotency key after simulated lost response: same result, unchanged events/receipt count.
  - Force an error after event creation inside transaction: no endpoint/status/history/journal partial result remains.
  - Change old endpoint or Genjy snapshot after preview: STALE_PREVIEW, nothing written.
  - Full new IP with changed credentials but historical identity exists: rejected.
  - Genjy bare with manual metadata: rejected; valid same-group bare completion preserves owner, even when receipt is later VOID.
- [ ] Step 5: Legacy writer tests call old proxy/VM mutation routes in PROXY_VM workspace. Every bypass route delegates to new services or rejects PRECONDITION_FAILED. BulkDelete cannot unassign arbitrary resource IDs before project check; update cannot edit canonical address/owner to bypass constraints. Disable hard delete of this feature's identity/events; keep retirement/history.
- [ ] Step 6: Run batch, history, legacy route and integration tests plus TypeScript. Commit. Deliverable: web backend performs safe imports/status/replace and supports browser retries.

### Task 6: Registry UI and operational acceptance

**Files**
- Modify: `src/app/(dashboard)/infrastructure/proxies/page.tsx`, `src/components/layout/Sidebar.tsx`, `ProjectSwitcher.tsx`, `src/lib/store.ts`, `src/lib/i18n.ts`.
- Create: `src/components/proxy-management/RegistryTable.tsx`, `BatchDialog.tsx`, `HistoryPanel.tsx`, `BlockedExport.tsx`.
- Create: `docs/runbooks/proxy-acceptance.md` and `src/__tests__/proxy-management/api-permissions.test.ts`.

**Interfaces**
- Consumes: proxyManagement list/preview/commit/timeline/export APIs; project.settings.businessMode and role/capabilities.
- Produces: editable proxy workflow through reviewed batches, history panel, red blocked rows, distinct owner/subgroup/state/location and explicit batch progress/results.

- [ ] Step 1: Implement table and filters for current inventory/history, owner, package, NEW/BLOCKED/REPLACED/QUARANTINED. Show Genjy as genjy; PC/chung as subgroup badge, retaining meaningful old labels. Sort package groups continuously; show active vs historical counts separately. Default DTO masks credentials.
- [ ] Step 2: Add buttons Nhập mới/Báo BLOCKED/Nhận replace/Copy BLOCKED; two empty replacement boxes. Preview shows resolved IP pair, package, owner, source row, READY/SKIP/ERROR reasons; full proxy reveal follows COPY rights. Save button uses exact ready count; after success refresh affected queries, not full-source rebuild. Disabled allocation button in inventory-only phase links to Server/VM stage rather than invoking old autoAssign.
- [ ] Step 3: Add history panel with chains and dated events, unknown dates visibly unknown. Copy output is package/full proxy/BLOCKED using browser clipboard only when requested by operator. No provider messages. In PROXY_VM navigation show operational modules; retain finance source for later, do not delete it.
- [ ] Step 4: API tests call real tRPC caller with VIEWER/nonmember/cross-project IDs and assert denied mutations/copy. Keep UI visibility tests small; backend tests prove access. Two browser sessions exercise stale preview and no duplicate save; keyboard paste/edit/repreview works.
- [ ] Step 5: Run existing tests + proxy tests, integration tests on dedicated DB, `npm run build`, lint and TypeScript. Independent review checks transaction boundaries, owner/history and bypass routes. Seed synthetic demo data only in test project; do not use provider examples from the chat.
- [ ] Step 6: Deploy preview only after Railway auth/target are known. Run `migrate deploy` against trial DB, verify healthcheck/login and perform acceptance with fake IPs: import→block→replace→history→duplicate reject→replay. Show result to user. Production import and old-project removal remain separate concrete data changes.
- [ ] Step 7: Commit UI/runbook and update master plan status. Deliverable: user can operate the proxy inventory on a preview web; ownership, history and duplicate detection visibly match Sheet rules.

## Final review checklist

- [ ] Every spec rule is covered by a task/test; Review Focus 1–5 linked to tasks above.
- [ ] No legacy write path bypasses owner/history/project/VIEWER rules in PROXY_VM mode.
- [ ] Journal/result counters exclude historical/bare-only lookup rows from stock available to allocate.
- [ ] Source provider failure and stale preview never free reserved Genjy or invent dates/credentials.
- [ ] No real example import, production schema/reset, old project deletion or provider communication occurred while implementing/testing this plan.
- [ ] Next VM plan uses getEligibleInventory/allocationKey and adds transaction-backed reservations, desired/confirmed config versions and literal blank checks before autofill.

## References and compatibility

Prisma CLI flags in Task 1 were checked against locally installed 5.22.0 --help. Use the pinned major, not new Prisma 8 command names. [Baselining workflow](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining), [versioned transaction retry guidance](https://docs.prisma.io/docs/orm/v6/prisma-client/queries/transactions#transaction-timing-issues). These references explain workflows; the project's installed CLI decides exact supported flags.

## API keys và giới hạn

`proxyManagement.list` nhận projectId + RegistryFilter, trả RegistryPage; limit 1–100, cursor opaque. `preview` nhận projectId + BatchInput; `commit` nhận projectId + token + idempotencyKey; `timeline` nhận projectId + identityId; `exportBlocked` nhận projectId. ActorScope được lấy từ session/membership, không nhận role hoặc userId từ client.

Với SHEET batch, thêm `snapshotIds?: string[]` vào BatchInput; server load các snapshot đã persist và buildReconciliation, không nhận quyết định owner/READY từ client. Quyền source snapshot cũng theo dự án. Partial import chỉ áp dụng những dòng READY được preview; count mismatch của replace lỗi toàn đợt.

Quét lại cùng nguồn nhưng nội dung không đổi chỉ cập nhật scan time. Token đối chiếu **hash nội dung chuẩn hoá và identity/endpoint revision**, không dùng fetchedAt hoặc snapshot ID mới để coi dữ liệu stale. Nếu nội dung thực tế đổi, preview lại trước commit.

Kiểm tra database test: đọc DATABASE_URL_TEST từ `.env.test`, so sánh hostname/port/database name với datasource ứng dụng, từ chối khi thiếu hoặc cùng database dù credentials/query string khác. Mọi fixture integration gọi guard này trước khi tạo PrismaClient. Khi chạy CLI Prisma cho test, truyền DATABASE_URL_TEST sang DATABASE_URL trong process con, không ghi đè `.env` ứng dụng.

Nạp cùng một fixture snapshot hai lần phải tạo cùng kết quả; những dòng/owner/exception đã giải quyết và provenance được giữ, không suy lại owner từ note Total cũ. Dòng không nhận diện gói được gắn UNKNOWN_PACKAGE/QUARANTINED, không âm thầm trở thành hàng NEW đủ điều kiện.
## Execution handoff

User reviews this technical plan together with the short master plan. Suggested execution: Native, implementing tasks in order in this session and an independent final review; these six tasks share domain and transaction interfaces. Alternative: fresh implementer/reviewer per task. No product code starts from this plan until the user reviews it and chooses the execution method.


