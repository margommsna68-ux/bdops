# Collector-Only Dashboard — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Area:** `src/app/(dashboard)/agent-pp/page.tsx`, `src/app/(dashboard)/layout.tsx`, `src/components/layout/Sidebar.tsx`, `src/server/routers/agentPP.ts`

## Problem

Users who are exclusively PayPal Collectors (have only the `AGENT_PP` module) currently see the same layout as admin/moderator users:
1. The project selector in the sidebar — unnecessary because they have nothing else to switch to.
2. The Hero card lacks critical collector-focused metrics: commission earned, amount paid to team, amount owed to team.
3. Some hardcoded Vietnamese strings leak into the UI even when language is set to English, violating the "100% English when selected" rule.

## Requirements (approved with user)

| # | Item | Decision |
|---|------|----------|
| R1 | "Collector-only" detection | `role !== ADMIN/MODERATOR` AND `allowedModules === ["AGENT_PP"]` |
| R2 | Hide project selector | For collector-only users, hide `ProjectSwitcher` in sidebar/header |
| R3 | Hero card metrics | 5 columns: Received, Commission, Paid to Team, Owed to Team, Fund Remaining |
| R4 | "Paid to team" tracking | Reuse existing `AgentSale.withdrawn` flag; relabel only — no schema change |
| R5 | i18n 100% | When language = EN, agent-pp page and related UI must have zero hardcoded Vietnamese strings |
| R6 | Admin/moderator view | Keep existing 3-col Hero card unchanged (avoid disruption) |
| R7 | Label change | "Đã rút" / "Withdrawn" → "Đã trả team" / "Paid to team" |

## Architecture

### New shared helper — `src/lib/collector-utils.ts`

```ts
import type { AppModule } from "@/server/trpc";

/**
 * True when user has ONLY the AGENT_PP module (no other modules).
 * Admin/Moderator never count as collector-only regardless of modules.
 */
export function isCollectorOnly(
  role: string | null | undefined,
  modules: string[] | null | undefined
): boolean {
  if (!role || !modules) return false;
  if (role === "ADMIN" || role === "MODERATOR") return false;
  return modules.length === 1 && modules[0] === "AGENT_PP";
}
```

Used on both client (via `useProjectStore`) and optionally server (via `ctx.membership.allowedModules`).

### Sidebar / Layout changes

**`src/components/layout/Sidebar.tsx`**:
- Read `currentRole` + `currentModules` from store.
- Compute `collectorOnly = isCollectorOnly(currentRole, currentModules)`.
- Wrap `<ProjectSwitcher />` render in `{!collectorOnly && ...}` so it's hidden for collector-only users.
- Navigation items stay filtered by `hasModuleAccess` (already exists). Collector-only users naturally only see "PayPal Collector" + "Settings" nav items.

**`src/app/(dashboard)/layout.tsx`**:
- No logic change needed here — sidebar handles the hide.
- Header (if any) that shows project name: also gate with `collectorOnly` to hide project badge.

### Backend — enrich `agentPP.myStats` (or equivalent)

Find the current endpoint that returns totals for the agent-pp page (looks like `agentPP.list` or `agentPP.summary`). Extend its return shape:

```ts
{
  // existing
  totalReceived,     // sum(Withdrawal.amount WHERE agentConfirmed=true)
  totalSold,         // sum(AgentSale.amount)

  // NEW
  totalCommission,   // sum(AgentSale.agentEarning)
  paidToTeam,        // sum(AgentSale.netAmount WHERE withdrawn=true)
  owedToTeam,        // sum(AgentSale.netAmount WHERE withdrawn=false)
  fundRemaining,     // totalReceived - totalSold
}
```

All aggregations scoped to the current user (`agentUserId = ctx.user.id`) and `projectId`.

### Frontend — Hero card refactor

In `src/app/(dashboard)/agent-pp/page.tsx`:

- Compute `collectorOnly = isCollectorOnly(currentRole, currentModules)`.
- If `collectorOnly` → render 5-column Hero card using new metrics:
  ```
  [Received] [Commission] [Paid to team] [Owed to team] [Fund remaining]
  ```
- Else → keep existing 3-column Hero card unchanged.

Visual: 5 equal-width cards, responsive stack on mobile.

### Label relabel

In Sales History tab:
- Column header "Đã rút" → `t("collector_paid_team")`
- Toggle button label: "Mark đã trả team"
- Keep the underlying DB field `withdrawn` — only the label changes.

### i18n audit

Scan `agent-pp/page.tsx` for any hardcoded string (Vietnamese or English) that isn't wrapped in `t(...)`. Candidates I expect to find:
- "Tổng nhận", "Đã bán", "Số dư còn lại"
- "Bán Fund", "Đóng", "Xác nhận", "Khiếu nại", "Đang khiếu nại", "Chờ"
- "Giao dịch nhận", "Lịch sử bán"
- "Đã rút"
- Form labels in the sell form (Email PP, Amount, Fee %, etc.)
- "All Agents" admin section labels
- "Today Activity"

Add translation keys for all of them. Also audit Sidebar, PinVerifyDialog, and any component the collector-only user interacts with. Any hardcoded string that falls back to Vietnamese when language=en is a bug.

### New i18n keys (en/vi)

```ts
// ─── Collector Dashboard ───
"collector_received": { en: "Received", vi: "Nhận" },
"collector_commission": { en: "Commission", vi: "Hoa hồng" },
"collector_paid_team": { en: "Paid to team", vi: "Đã trả team" },
"collector_owed_team": { en: "Owed to team", vi: "Nợ team" },
"collector_fund_remaining": { en: "Fund remaining", vi: "Fund còn" },
"collector_mark_paid": { en: "Mark as paid to team", vi: "Đánh dấu đã trả team" },
"collector_tx_received": { en: "Transactions received", vi: "Giao dịch nhận" },
"collector_sale_history": { en: "Sales history", vi: "Lịch sử bán" },
"collector_sell_fund": { en: "Sell fund", vi: "Bán fund" },
"collector_close": { en: "Close", vi: "Đóng" },
"collector_dispute": { en: "Dispute", vi: "Khiếu nại" },
"collector_disputing": { en: "Disputing", vi: "Đang khiếu nại" },
"collector_pending": { en: "Pending", vi: "Chờ" },
"collector_confirm": { en: "Confirm", vi: "Xác nhận" },
"collector_total_received": { en: "Total received", vi: "Tổng nhận" },
"collector_total_sold": { en: "Total sold", vi: "Đã bán" },
"collector_balance_remaining": { en: "Balance remaining", vi: "Số dư còn lại" },
// (... more as audit finds them)
```

## Data flow

### Collector opens the page

```
User logs in → layout.tsx syncs membership → store has currentRole, currentModules
  ↓
Sidebar renders → computes collectorOnly → hides ProjectSwitcher if true
  ↓
agent-pp/page.tsx loads → calls agentPP.summary (or equivalent)
  ↓
Server returns { totalReceived, totalCommission, paidToTeam, owedToTeam, fundRemaining, ... }
  ↓
Page computes collectorOnly → renders 5-col Hero (or 3-col for admin)
  ↓
All strings go through t() → respects language setting
```

### Collector marks a sale as paid to team

```
Collector clicks "Mark as paid to team" button on a row in Sales History
  ↓
Mutation: agentPP.markWithdrawn({ saleId, withdrawn: true })  [existing endpoint]
  ↓
AgentSale.withdrawn = true
  ↓
Hero card recomputes: paidToTeam += netAmount, owedToTeam -= netAmount
```

## Testing (manual)

1. **Collector-only detection**:
   - Create/pick a USER with only `allowedModules=["AGENT_PP"]`.
   - Log in → sidebar has NO `ProjectSwitcher`, only "PayPal Collector" + "Settings" nav.
   - Pick another USER with `["AGENT_PP", "AUTOTYPE"]` → ProjectSwitcher visible.

2. **Hero card**:
   - Collector-only: 5 columns show correct values.
   - Admin: 3 columns unchanged.

3. **Owed to team math**:
   - Mark 1 sale as withdrawn → `paidToTeam` increases, `owedToTeam` decreases.
   - Unmark → reversed.

4. **i18n 100% English**:
   - Settings → Language = English.
   - Visit agent-pp page as collector → no Vietnamese characters visible (except in user-generated data like notes).
   - Visit all admin sections → same.

5. **Label relabel**:
   - Sales history column header reads "Paid to team" (en) or "Đã trả team" (vi).
   - Toggle button labels accordingly.

## Out of scope

- Creating a new route `/collector`. Reuse existing `/agent-pp`.
- Schema changes. Reuse `AgentSale.withdrawn`.
- Refactoring admin Hero card.
- Multi-language support beyond en/vi.
- Changing the sell form workflow or commission calculation logic.

## Files affected

| File | Action |
|------|--------|
| `src/lib/collector-utils.ts` | **NEW** — `isCollectorOnly()` helper |
| `src/components/layout/Sidebar.tsx` | Hide `<ProjectSwitcher />` when collector-only |
| `src/app/(dashboard)/layout.tsx` | Optional header tweak if needed |
| `src/server/routers/agentPP.ts` | Extend summary endpoint with new metrics |
| `src/app/(dashboard)/agent-pp/page.tsx` | 5-col Hero for collector-only; audit hardcoded strings |
| `src/lib/i18n.ts` | Add ~20 new collector keys |

## Risks

- **Audit miss**: An audit may miss some hardcoded strings. Mitigation: systematic grep for Vietnamese characters (`[àáảãạâấầẩẫậăắằẳẵặđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]`) in the page file.
- **Admin view regression**: By gating on `collectorOnly`, admin view must NOT change. Regression test required.
- **Label change impact**: "Đã rút" is visible to admin too. Confirm whether admin should see old or new label — this spec keeps new label for everyone (label change is i18n only, not role-gated).
