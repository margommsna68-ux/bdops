# Agent PP Admin Dashboard — Full Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the 4,377-line Agent PP admin experience from a patched-together MVP into a clean, CFO-grade financial operations dashboard with proper component architecture, consistent light theme, and scalable multi-agent management.

**Architecture:** Split the monolithic page.tsx (1,012 lines) into focused sub-components. Consolidate backend N+1 queries in agentPerformance into batched operations. Apply the project's existing design patterns (useTableSort, shadcn/ui, Tailwind light theme). All data must match walletBalance (source of truth) exactly.

**Tech Stack:** Next.js 14 App Router, TypeScript, tRPC, Prisma, Tailwind CSS, shadcn/ui, Recharts, Zustand, useT() i18n

---

## Current State Audit

### Problems Identified

| # | Category | Issue | Impact |
|---|----------|-------|--------|
| 1 | **Architecture** | page.tsx = 1,012 lines, 25+ useState, 12 queries, 8 mutations — god component | Unmaintainable |
| 2 | **Architecture** | Admin + Collector logic mixed in one component with `isAdminOrMod` branches | Confusing control flow |
| 3 | **Backend** | agentPerformance has N+1: loops `userIds` with individual queries per user | O(n) DB roundtrips |
| 4 | **Data** | Commission/fee calculations duplicated in 4 places (walletBalance, agentPerformance, adminDashboard, myTransactions) | Inconsistency bugs |
| 5 | **UI/Design** | Mixed glassmorphism dark → patched to light, inconsistent card styles | Unprofessional |
| 6 | **UI/Design** | Financial cards use `bg-gray-50` with muted text — CFO can't scan numbers fast | Poor data hierarchy |
| 7 | **UI/Design** | No visual distinction between per-project vs cross-project numbers | Confusing |
| 8 | **Patterns** | Custom sort logic in page.tsx instead of reusable `useTableSort` hook | Duplicated code |
| 9 | **i18n** | ~20 hardcoded strings remain in _AdminDashboard.tsx and page.tsx | Incomplete coverage |
| 10 | **UX** | Agent filter only works on transactions, no way to drill into single agent detail view | Limited management |

### File Map (Current)

```
src/app/(dashboard)/agent-pp/
├── page.tsx                    # 1,012 lines — GOD COMPONENT (admin + collector + forms + tables)
├── _AdminDashboard.tsx         # 813 lines — Financial overview + Agent Ledger + Activity Feed
├── _CollectorWalletView.tsx    # 960 lines — Collector's personal wallet (OK, keep as-is)
```

```
src/server/routers/
├── agentPP.ts                  # 1,592 lines — 20+ endpoints, N+1 in agentPerformance
```

---

## Design Direction

**Aesthetic:** "Swiss Financial Precision" — Clean, data-dense, zero decoration. Numbers are heroes. Inspired by Bloomberg Terminal's clarity meets Stripe Dashboard's polish.

**Design Principles:**
1. **Numbers First**: Large, high-contrast monospace amounts. Color = meaning (green=in, red=out, blue=team, amber=warning)
2. **Scannable Cards**: Each metric card has exactly 3 elements: label (muted), value (bold), indicator (color dot or arrow)
3. **Agent-Centric**: Agent Ledger is a mini-spreadsheet, not cards. Think Excel row with expandable detail.
4. **Consistent Light Theme**: Match existing BDOps pages (white bg, gray-200 borders, shadow-sm, no blur effects)
5. **Clear Scope Labels**: "Cross-project" badge on numbers that span projects, no badge = current project only

**Color System:**
- Received/Gross: `text-green-700 bg-green-50`
- Fees/Deductions: `text-red-600 bg-red-50`
- Commission: `text-purple-700 bg-purple-50`
- Team Revenue: `text-blue-700 bg-blue-50`
- Wallet/Balance: `text-teal-700 bg-teal-50`
- Warning/Pending: `text-amber-600 bg-amber-50`
- Expense: `text-orange-700 bg-orange-50`

---

## Target File Structure

```
src/app/(dashboard)/agent-pp/
├── page.tsx                        # ~150 lines — Router: admin vs collector, project gate
├── _AdminDashboard.tsx             # ~250 lines — Layout: overview + agent filter + tabs
├── _AdminOverviewCards.tsx          # ~120 lines — 6 financial metric cards
├── _AdminAgentLedger.tsx            # ~200 lines — Table of agents with financial breakdown
├── _AdminTransactionsTable.tsx      # ~250 lines — Received transactions with sort/filter
├── _AdminExpensesTable.tsx          # ~150 lines — Collector expenses table
├── _AdminActivityFeed.tsx           # ~100 lines — Today's live activity sidebar
├── _CollectorWalletView.tsx         # 960 lines — Keep as-is (working correctly)
```

```
src/server/routers/agentPP.ts       # Consolidate: remove N+1, extract shared calcFee()
```

---

## Tasks

### Task 1: Extract shared fee calculation utility

**Files:**
- Create: `src/lib/agent-fee.ts`
- Modify: `src/server/routers/agentPP.ts`

**Why:** Fee calculation logic is duplicated in walletBalance, agentPerformance, adminDashboard, myTransactions. One source of truth.

- [ ] **Step 1: Create `src/lib/agent-fee.ts`**

```typescript
import { type PrismaClient } from "@prisma/client";

export interface FeeByProject {
  byProject: Map<string, number>;
  fallback: number;
}

/**
 * Load agentFeePercent for a set of user IDs.
 * Returns Map<userId, FeeByProject> with per-project fee and fallback.
 * Matches walletBalance source-of-truth logic exactly.
 */
export async function loadAgentFees(
  prisma: PrismaClient,
  userIds: string[],
  preferProjectId?: string
): Promise<Map<string, FeeByProject>> {
  if (userIds.length === 0) return new Map();

  const rows = await prisma.projectMember.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, projectId: true, agentFeePercent: true },
  });

  const result = new Map<string, FeeByProject>();
  for (const uid of userIds) {
    result.set(uid, { byProject: new Map(), fallback: 0 });
  }

  for (const m of rows) {
    if (m.agentFeePercent == null) continue;
    const pct = Number(m.agentFeePercent.toString());
    const entry = result.get(m.userId);
    if (!entry) continue;
    entry.byProject.set(m.projectId, pct);
    if (entry.fallback === 0 && pct > 0) entry.fallback = pct;
  }

  return result;
}

/**
 * Get fee% for a user in a specific project.
 * Exact project match → fallback (any project) → 0
 */
export function getFeePercent(fees: FeeByProject, projectId: string): number {
  return fees.byProject.get(projectId) ?? fees.fallback;
}

/**
 * Calculate financial totals from withdrawals (confirmed only).
 * Returns { gross, fees, net, commission, totalAfterFee }
 */
export function calcFinancials(
  withdrawals: Array<{ amount: any; paypalFee: any; projectId: string; paidToTeam?: boolean }>,
  fees: FeeByProject
): {
  gross: number;
  fees: number;
  net: number;
  commission: number;
  totalAfterFee: number;
  unpaidTAF: number;
} {
  let gross = 0, totalFees = 0, commission = 0, totalAfterFee = 0, unpaidTAF = 0;
  for (const w of withdrawals) {
    if (w.paypalFee == null) continue; // skip unconfirmed
    const g = Number(w.amount);
    const f = Number(w.paypalFee);
    const net = g - f;
    const pct = getFeePercent(fees, w.projectId);
    const comm = net * pct / 100;
    const taf = net - comm;
    gross += g;
    totalFees += f;
    commission += comm;
    totalAfterFee += taf;
    if (!w.paidToTeam) unpaidTAF += taf;
  }
  return { gross, fees: totalFees, net: gross - totalFees, commission, totalAfterFee, unpaidTAF };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent-fee.ts
git commit -m "refactor: extract shared agent fee calculation utility"
```

---

### Task 2: Fix agentPerformance N+1 queries

**Files:**
- Modify: `src/server/routers/agentPP.ts:1342-1580`

**Why:** Current STEP 4 loops each userId and runs 2 queries per user (emails + withdrawals). With 10 agents = 20 extra queries. Batch into 2 total queries.

- [ ] **Step 1: Refactor agentPerformance to use loadAgentFees + calcFinancials**

Replace the per-user loop in STEP 4 with:
1. One batched query: all agent emails across all users
2. One batched query: all withdrawals for those emails (cross-project)
3. Group in memory by userId
4. Use `calcFinancials()` per user

- [ ] **Step 2: Verify build passes**

Run: `npx next build`

- [ ] **Step 3: Commit**

```bash
git add src/server/routers/agentPP.ts src/lib/agent-fee.ts
git commit -m "perf: batch agentPerformance queries, eliminate N+1"
```

---

### Task 3: Split page.tsx into focused components

**Files:**
- Rewrite: `src/app/(dashboard)/agent-pp/page.tsx` → ~150 lines
- Create: `src/app/(dashboard)/agent-pp/_AdminTransactionsTable.tsx`
- Create: `src/app/(dashboard)/agent-pp/_AdminExpensesTable.tsx`

**Why:** 1,012-line god component with 25 useState. Split by responsibility.

- [ ] **Step 1: Extract `_AdminTransactionsTable.tsx`**

Move the entire "Tab: Giao dịch nhận" section (table + inline editing + sort + pagination) into its own component.

Props:
```typescript
interface AdminTransactionsTableProps {
  projectId: string;
  agentFilter: string;
  isAdminOnly: boolean;
}
```

Uses `useTableSort` from `src/components/tables/useTableSort.tsx` instead of custom sort logic.

- [ ] **Step 2: Extract `_AdminExpensesTable.tsx`**

Move the expenses tab content into its own component.

Props:
```typescript
interface AdminExpensesTableProps {
  projectId: string;
  agentFilter: string;
}
```

- [ ] **Step 3: Slim down page.tsx**

page.tsx becomes a thin router:
```typescript
export default function AgentPPPage() {
  const { currentProjectId, currentRole, currentModules } = useProjectStore();
  const collectorOnly = isCollectorOnly(currentRole, currentModules);

  if (!currentProjectId) return <SelectProject />;
  if (collectorOnly) return <CollectorWalletView />;
  return <AdminDashboardLayout projectId={currentProjectId} role={currentRole} />;
}
```

- [ ] **Step 4: Verify build + deploy**

Run: `npx next build && railway deploy`

- [ ] **Step 5: Commit**

---

### Task 4: Redesign AdminOverviewCards with CFO-grade styling

**Files:**
- Rewrite: Financial cards section in `_AdminDashboard.tsx`
- Create: `src/app/(dashboard)/agent-pp/_AdminOverviewCards.tsx`

**Design spec:**

```
┌─────────────────────┬─────────────────────┬─────────────────────┐
│ GROSS RECEIVED      │ PP FEES             │ NET REVENUE         │
│ ● $12,450.00        │ ● -$340.20          │ ● $12,109.80        │
│   ▲ +12% vs prev    │   ▼ +5% vs prev     │   ▲ +11% vs prev    │
├─────────────────────┼─────────────────────┼─────────────────────┤
│ COMMISSION (3%)     │ TEAM REVENUE        │ ◆ WALLET BALANCE    │
│ ● $363.29           │ ★ $11,746.51        │ ◆ $111.71           │
│                     │                     │   cross-project     │
└─────────────────────┴─────────────────────┴─────────────────────┘
```

Styling rules:
- Cards: `bg-white rounded-xl border border-gray-200 shadow-sm p-5`
- Label: `text-[10px] font-semibold uppercase tracking-wider text-gray-500`
- Value: `text-2xl font-extrabold font-mono tabular-nums` + accent color
- Change badge: `text-[10px] px-1.5 py-0.5 rounded-full` green/red bg
- Wallet card: subtle `bg-gradient-to-br from-teal-50 to-white` + "cross-project" badge

- [ ] **Step 1: Create component with design spec**
- [ ] **Step 2: Verify visual matches spec**
- [ ] **Step 3: Commit**

---

### Task 5: Redesign Agent Ledger as spreadsheet-style table

**Files:**
- Rewrite: Agent section in `_AdminDashboard.tsx`
- Create: `src/app/(dashboard)/agent-pp/_AdminAgentLedger.tsx`

**Design spec:**

Replace card grid with a TABLE. Columns:
```
Agent | Fee% | Gross | PP Fees | Net | Commission | Team Share | Expenses | Owed Team ◆ | Sparkline
```

- Row click → expand inline detail panel (emails, recent transactions)
- "Owed Team" column: red bg if > $10, green if <= $0
- "◆" icon next to "Owed Team" header = cross-project indicator
- Uses `useTableSort` for column sorting
- Responsive: on mobile, show only Agent | Owed Team | Sparkline

- [ ] **Step 1: Create table component**
- [ ] **Step 2: Add expandable row detail**
- [ ] **Step 3: Verify responsive behavior**
- [ ] **Step 4: Commit**

---

### Task 6: Redesign Activity Feed as compact sidebar

**Files:**
- Rewrite: Activity section in `_AdminDashboard.tsx`
- Create: `src/app/(dashboard)/agent-pp/_AdminActivityFeed.tsx`

**Design spec:**
- Sticky sidebar on desktop (right 2/5 width)
- Compact timeline: time + icon + amount on one line
- Summary bar at top: Today Received $X | Sold $Y
- Max 15 items, scrollable
- Auto-refresh 30s pulse indicator
- On mobile: collapsible accordion

- [ ] **Step 1: Create component**
- [ ] **Step 2: Commit**

---

### Task 7: Consolidate _AdminDashboard.tsx as layout orchestrator

**Files:**
- Rewrite: `src/app/(dashboard)/agent-pp/_AdminDashboard.tsx` → ~250 lines

**Structure:**
```tsx
export function AgentAdminDashboard({ projectId }: Props) {
  return (
    <div className="space-y-6">
      <AdminOverviewCards projectId={projectId} />
      <AlertPanel />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <AgentLedger projectId={projectId} />
        </div>
        <div className="lg:col-span-2">
          <ActivityFeed projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
```

No business logic — pure layout composition.

- [ ] **Step 1: Compose from sub-components**
- [ ] **Step 2: Remove all dead code (chart helpers, skeletons, etc.)**
- [ ] **Step 3: Full i18n pass — zero hardcoded strings**
- [ ] **Step 4: Verify build + deploy**
- [ ] **Step 5: Commit**

---

### Task 8: Full i18n audit + cleanup

**Files:**
- Modify: `src/lib/i18n.ts`
- Modify: All agent-pp components

Scan every `.tsx` in `agent-pp/` for any string not using `t()`. Add keys.

- [ ] **Step 1: Grep for hardcoded strings**
- [ ] **Step 2: Add missing keys to i18n.ts**
- [ ] **Step 3: Verify both EN + VI render correctly**
- [ ] **Step 4: Commit**

---

### Task 9: End-to-end verification

- [ ] **Step 1: Deploy to Railway**
- [ ] **Step 2: Verify admin view with real marua data — numbers match collector view**
- [ ] **Step 3: Verify agent filter works on both tabs**
- [ ] **Step 4: Verify mobile responsive**
- [ ] **Step 5: Verify language switch EN ↔ VI — zero mixed text**
- [ ] **Step 6: Performance check — page load < 2s, no N+1 in server logs**

---

## Execution Order

```
Task 1 (fee utility)          → foundation, no UI change
Task 2 (fix N+1)              → backend perf, no UI change
Task 3 (split page.tsx)       → architecture, same UI
Task 4 (overview cards)       → visual redesign
Task 5 (agent ledger table)   → visual redesign
Task 6 (activity feed)        → visual redesign
Task 7 (compose dashboard)    → wire everything together
Task 8 (i18n)                 → polish
Task 9 (verify)               → final QA
```

Tasks 1-2 can run in parallel. Tasks 4-6 can run in parallel. Task 7 depends on 4-6. Task 8-9 are sequential at end.
