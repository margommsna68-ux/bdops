"use client";

// ═══════════════════════════════════════════════════════════════════════
// CollectorWalletView — the new UX for collector-only users
// Wallet-centric: received → wallet balance → flexible expenses (team/bill/other)
// ═══════════════════════════════════════════════════════════════════════

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";

type ExpenseType = "TEAM_PAYMENT" | "BILL" | "OTHER";

const EXPENSE_LABELS: Record<ExpenseType, { label: string; color: string; icon: string }> = {
  TEAM_PAYMENT: { label: "Chuyển team", color: "bg-emerald-100 text-emerald-700 border-emerald-300", icon: "→" },
  BILL:         { label: "Thanh toán bill", color: "bg-blue-100 text-blue-700 border-blue-300", icon: "🧾" },
  OTHER:        { label: "Chi khác", color: "bg-gray-100 text-gray-700 border-gray-300", icon: "◇" },
};

type Period = "all" | "today" | "week" | "month" | "custom";
type SortKey = "date" | "project" | "ppCode" | "ppAgent" | "transactionId" | "gross" | "feePP" | "net" | "commission" | "totalAfterFee" | "status";
type SortDir = "asc" | "desc";

function SortTh({
  label, k, sortKey, sortDir, onSort, color, align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  color: string;
  align: "left" | "right" | "center";
}) {
  const active = sortKey === k;
  const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <th className={`px-2 py-2 ${alignCls} text-[11px] font-semibold ${color} whitespace-nowrap select-none`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-0.5 hover:opacity-70 ${justify} w-full`}
      >
        <span>{label}</span>
        <span className={`text-[10px] ${active ? "opacity-100" : "opacity-30"}`}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </button>
    </th>
  );
}

export function CollectorWalletView({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const [period, setPeriod] = useState<Period>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unconfirmed" | "unpaid" | "paid">("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingFeeId, setEditingFeeId] = useState<string | null>(null);
  const [editingFeeValue, setEditingFeeValue] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");

  // Expense dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expType, setExpType] = useState<ExpenseType>("TEAM_PAYMENT");
  const [expAmount, setExpAmount] = useState("");
  const [expRef, setExpRef] = useState("");
  const [expNote, setExpNote] = useState("");
  const [expLinkMode, setExpLinkMode] = useState<"linked" | "unlinked">("linked");

  const [showHistory, setShowHistory] = useState(true);
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);

  // ─── Queries ────────────────────────────────────────────────────
  const { data: txData, isLoading } = trpc.agentPP.myTransactions.useQuery(
    { projectId, page: 1, limit: 500 },
    { enabled: !!projectId }
  );
  const { data: wallet } = trpc.agentPP.walletBalance.useQuery(
    { projectId },
    { enabled: !!projectId }
  );
  const { data: expenses } = trpc.agentPP.listExpenses.useQuery(
    { projectId, limit: 100 },
    { enabled: !!projectId }
  );

  // ─── Mutations ──────────────────────────────────────────────────
  const updateMeta = trpc.agentPP.updatePaypalFee.useMutation({
    onMutate: async (vars) => {
      const queryInput = { projectId, page: 1, limit: 500 };
      await utils.agentPP.myTransactions.cancel(queryInput);
      const prev = utils.agentPP.myTransactions.getData(queryInput);
      if (prev) {
        utils.agentPP.myTransactions.setData(queryInput, {
          ...prev,
          items: prev.items.map((it: any) => {
            if (it.id !== vars.id) return it;
            const patched: any = { ...it };
            if (vars.paypalFee !== undefined) {
              patched.paypalFee = vars.paypalFee;
              patched.matchedPaypalFee = vars.paypalFee;
            }
            if (vars.collectorNote !== undefined) patched.collectorNote = vars.collectorNote;
            return patched;
          }),
        });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) utils.agentPP.myTransactions.setData({ projectId, page: 1, limit: 500 }, ctx.prev);
      toast.error(e.message);
    },
    onSuccess: () => {
      utils.agentPP.walletBalance.invalidate();
    },
  });

  const createExpense = trpc.agentPP.createExpense.useMutation({
    onSuccess: () => {
      utils.agentPP.myTransactions.invalidate();
      utils.agentPP.walletBalance.invalidate();
      utils.agentPP.listExpenses.invalidate();
      toast.success("Đã lưu khoản chi");
      setDialogOpen(false);
      setSelectedIds(new Set());
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteExpenseMut = trpc.agentPP.deleteExpense.useMutation({
    onSuccess: () => {
      utils.agentPP.myTransactions.invalidate();
      utils.agentPP.walletBalance.invalidate();
      utils.agentPP.listExpenses.invalidate();
      toast.success("Đã xóa");
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Filter + sort ──────────────────────────────────────────────
  const items = txData?.items ?? [];

  const filtered = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return items.filter((t: any) => {
      const d = new Date(t.date);
      if (period === "today" && d < startOfDay) return false;
      if (period === "week" && d < startOfWeek) return false;
      if (period === "month" && d < startOfMonth) return false;
      if (period === "custom") {
        if (customFrom && d < new Date(customFrom)) return false;
        if (customTo) {
          const to = new Date(customTo);
          to.setHours(23, 59, 59, 999);
          if (d > to) return false;
        }
      }
      const confirmed = t.matchedPaypalFee != null;
      if (statusFilter === "unconfirmed" && confirmed) return false;
      if (statusFilter === "unpaid" && (t.paidToTeam || !confirmed)) return false;
      if (statusFilter === "paid" && !t.paidToTeam) return false;
      return true;
    });
  }, [items, period, customFrom, customTo, statusFilter]);

  const enriched = useMemo(() => {
    const arr = filtered.map((t: any) => {
      const confirmed = t.matchedPaypalFee != null;
      const fee = confirmed ? Number(t.matchedPaypalFee) : 0;
      const gross = Number(t.amount ?? 0);
      const net = gross - fee;
      const pct = Number(t.collectorFeePercent ?? 0);
      const commission = net * (pct / 100);
      const totalAfterFee = net - commission;
      return { ...t, gross, fee, net, commission, totalAfterFee, pct, confirmed };
    });
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a: any, b: any) => {
      let av: any; let bv: any;
      switch (sortKey) {
        case "date": av = a.date; bv = b.date; break;
        case "project": av = a.project?.code ?? ""; bv = b.project?.code ?? ""; break;
        case "ppCode": av = a.sourcePaypal?.code ?? ""; bv = b.sourcePaypal?.code ?? ""; break;
        case "ppAgent": av = a.agentEmail?.email ?? ""; bv = b.agentEmail?.email ?? ""; break;
        case "transactionId": av = a.transactionId ?? ""; bv = b.transactionId ?? ""; break;
        case "gross": av = a.gross; bv = b.gross; break;
        case "feePP": av = a.fee; bv = b.fee; break;
        case "net": av = a.net; bv = b.net; break;
        case "commission": av = a.commission; bv = b.commission; break;
        case "totalAfterFee": av = a.totalAfterFee; bv = b.totalAfterFee; break;
        case "status":
          av = !a.confirmed ? 0 : a.paidToTeam ? 2 : 1;
          bv = !b.confirmed ? 0 : b.paidToTeam ? 2 : 1;
          break;
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  };

  // ─── Totals (filtered) ──────────────────────────────────────────
  const totals = enriched.reduce(
    (acc: any, t: any) => {
      acc.received += t.gross;
      acc.commissionEarned += t.confirmed ? t.commission : 0;
      acc.txCount += 1;
      if (!t.confirmed) { acc.unconfirmedCount++; acc.unconfirmedAmount += t.gross; }
      else if (t.paidToTeam) acc.paidCount++;
      else { acc.owedToTeam += t.totalAfterFee; acc.unpaidCount++; }
      return acc;
    },
    { received: 0, commissionEarned: 0, owedToTeam: 0, txCount: 0, paidCount: 0, unpaidCount: 0, unconfirmedCount: 0, unconfirmedAmount: 0 }
  );

  // Single-collector header hoist
  const uniqueCollectors = new Set(items.map((w: any) => w.collectorName).filter(Boolean));
  const singleCollector = uniqueCollectors.size === 1 ? items.find((w: any) => w.collectorName) : null;
  const singleCollectorName = (singleCollector as any)?.collectorName ?? null;
  const singleCollectorPct = singleCollector ? Number((singleCollector as any).collectorFeePercent ?? 0) : null;

  // ─── Selection + bulk ───────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const selectAllUnpaid = () => {
    const ids = enriched.filter((t: any) => !t.paidToTeam && t.confirmed).map((t: any) => t.id);
    setSelectedIds(new Set(ids));
  };
  const clearSelection = () => setSelectedIds(new Set());

  const selectionTotals = enriched
    .filter((t: any) => selectedIds.has(t.id))
    .reduce(
      (acc: any, t: any) => {
        acc.count++;
        acc.gross += t.gross;
        acc.totalAfterFee += t.totalAfterFee;
        acc.commission += t.commission;
        return acc;
      },
      { count: 0, gross: 0, totalAfterFee: 0, commission: 0 }
    );

  // ─── Expense flow ───────────────────────────────────────────────
  const openDialogFromSelection = () => {
    const selected = enriched.filter((t: any) => selectedIds.has(t.id) && !t.paidToTeam && t.confirmed);
    const suggestedAmount = selected.reduce((s: number, t: any) => s + t.totalAfterFee, 0);
    setExpType("TEAM_PAYMENT");
    setExpAmount(suggestedAmount.toFixed(2));
    setExpRef("");
    setExpNote("");
    setExpLinkMode("linked");
    setDialogOpen(true);
  };

  const openDialogEmpty = () => {
    setExpType("OTHER");
    setExpAmount("");
    setExpRef("");
    setExpNote("");
    setExpLinkMode("unlinked");
    setDialogOpen(true);
  };

  const confirmExpense = () => {
    const amt = parseFloat(expAmount);
    if (!amt || amt <= 0) { toast.error("Nhập số tiền"); return; }
    if (!expRef.trim()) { toast.error("Nhập mã tham chiếu"); return; }
    const linked = expLinkMode === "linked"
      ? enriched.filter((t: any) => selectedIds.has(t.id) && !t.paidToTeam && t.confirmed).map((t: any) => t.id)
      : [];
    createExpense.mutate({
      projectId,
      type: expType,
      amount: amt,
      referenceId: expRef.trim(),
      note: expNote.trim() || undefined,
      linkedWithdrawalIds: linked,
    });
  };

  // ─── Render ─────────────────────────────────────────────────────
  const walletBalance = wallet?.walletBalance ?? 0;
  const netReceived = wallet?.netReceived ?? 0;
  const totalExpenses = wallet?.totalExpenses ?? 0;
  const breakdown = wallet?.breakdown ?? { TEAM_PAYMENT: 0, BILL: 0, OTHER: 0 };

  return (
    <div className="space-y-4">
      {/* ─── WALLET (all-time) ─── */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 rounded-xl shadow-lg text-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold text-blue-200 uppercase tracking-wider">💰 Wallet (tiền đang nắm)</div>
            <div className="text-4xl font-bold mt-1">{formatCurrency(walletBalance)}</div>
            <div className="text-xs text-blue-200 mt-1">
              = Net nhận {formatCurrency(netReceived)} − Đã chi {formatCurrency(totalExpenses)}
            </div>
          </div>
          <Button
            size="sm"
            className="bg-white text-blue-700 hover:bg-blue-50 shadow-md font-semibold"
            onClick={openDialogEmpty}
          >
            + Ghi khoản chi
          </Button>
        </div>
        <div className="mt-4 pt-3 border-t border-blue-400/30 grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-blue-200">Chuyển team</div>
            <div className="text-base font-bold">{formatCurrency(Number(breakdown.TEAM_PAYMENT ?? 0))}</div>
          </div>
          <div>
            <div className="text-blue-200">Bill</div>
            <div className="text-base font-bold">{formatCurrency(Number(breakdown.BILL ?? 0))}</div>
          </div>
          <div>
            <div className="text-blue-200">Chi khác</div>
            <div className="text-base font-bold">{formatCurrency(Number(breakdown.OTHER ?? 0))}</div>
          </div>
        </div>
      </div>

      {/* ─── Period filter ─── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 mr-2">Kỳ xem:</span>
          {[
            { key: "all", label: "Tất cả" },
            { key: "today", label: "Hôm nay" },
            { key: "week", label: "Tuần này" },
            { key: "month", label: "Tháng này" },
            { key: "custom", label: "Custom" },
          ].map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key as Period)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                period === p.key
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-700"
              }`}
            >
              {p.label}
            </button>
          ))}
          {period === "custom" && (
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 px-2 text-xs border rounded" />
              <span className="text-xs text-gray-400">→</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 px-2 text-xs border rounded" />
            </div>
          )}
        </div>
      </div>

      {/* ─── Period stats ─── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="text-[10px] font-semibold text-gray-400 uppercase mb-2">
          Thống kê kỳ {period === "all" ? "tất cả" : period === "today" ? "hôm nay" : period === "week" ? "tuần này" : period === "month" ? "tháng này" : "custom"}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="text-center py-3 bg-green-50 rounded-lg">
            <div className="text-[10px] font-semibold text-green-600 uppercase mb-1">Tổng nhận</div>
            <div className="text-xl font-bold text-green-700">{formatCurrency(totals.received)}</div>
            <div className="text-[10px] text-green-600 mt-0.5">{totals.txCount} giao dịch</div>
          </div>
          <div className={`text-center py-3 rounded-lg ${totals.unconfirmedCount > 0 ? "bg-orange-50 ring-2 ring-orange-300" : "bg-gray-50"}`}>
            <div className={`text-[10px] font-semibold uppercase mb-1 ${totals.unconfirmedCount > 0 ? "text-orange-700" : "text-gray-500"}`}>
              Chưa confirm
            </div>
            <div className={`text-xl font-bold ${totals.unconfirmedCount > 0 ? "text-orange-700" : "text-gray-500"}`}>
              {formatCurrency(totals.unconfirmedAmount)}
            </div>
            <div className={`text-[10px] mt-0.5 ${totals.unconfirmedCount > 0 ? "text-orange-600" : "text-gray-400"}`}>
              {totals.unconfirmedCount} cần nhập fee
            </div>
          </div>
          <div className="text-center py-3 bg-purple-50 rounded-lg">
            <div className="text-[10px] font-semibold text-purple-600 uppercase mb-1">Commission</div>
            <div className="text-xl font-bold text-purple-700">{formatCurrency(totals.commissionEarned)}</div>
            <div className="text-[10px] text-purple-600 mt-0.5">đã earn</div>
          </div>
          <div className="text-center py-3 bg-amber-50 rounded-lg">
            <div className="text-[10px] font-semibold text-amber-600 uppercase mb-1">Chưa xử lý</div>
            <div className="text-xl font-bold text-amber-700">{formatCurrency(totals.owedToTeam)}</div>
            <div className="text-[10px] text-amber-600 mt-0.5">{totals.unpaidCount} giao dịch</div>
          </div>
          <div className="text-center py-3 bg-emerald-50 rounded-lg">
            <div className="text-[10px] font-semibold text-emerald-600 uppercase mb-1">Đã xử lý</div>
            <div className="text-xl font-bold text-emerald-700">{totals.paidCount}</div>
            <div className="text-[10px] text-emerald-600 mt-0.5">giao dịch</div>
          </div>
        </div>
      </div>

      {/* ─── Transactions table ─── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex gap-1 flex-wrap">
            {[
              { key: "all", label: `Tất cả (${enriched.length})` },
              { key: "unconfirmed", label: `⏳ Chưa confirm (${totals.unconfirmedCount})` },
              { key: "unpaid", label: `Chưa xử lý (${totals.unpaidCount})` },
              { key: "paid", label: `Đã xử lý (${totals.paidCount})` },
            ].map((s: any) => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  statusFilter === s.key ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {totals.unpaidCount > 0 && statusFilter !== "paid" && statusFilter !== "unconfirmed" && (
            <button onClick={selectAllUnpaid} className="text-xs text-blue-600 hover:underline">
              Chọn tất cả chưa xử lý
            </button>
          )}
        </div>

        {/* Bulk bar */}
        {selectedIds.size > 0 && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <span className="font-semibold text-emerald-800">Đã chọn {selectionTotals.count}</span>
              <span className="text-gray-600">Gross: <strong>{formatCurrency(selectionTotals.gross)}</strong></span>
              <span className="text-emerald-700">Để chi team: <strong>{formatCurrency(selectionTotals.totalAfterFee)}</strong></span>
              <span className="text-purple-700">Commission giữ: <strong>{formatCurrency(selectionTotals.commission)}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs" onClick={openDialogFromSelection}>
                + Ghi chi ({formatCurrency(selectionTotals.totalAfterFee)})
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={clearSelection}>Hủy</Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 w-8 text-center">
                  <input
                    type="checkbox"
                    checked={enriched.length > 0 && selectedIds.size === enriched.filter((t: any) => !t.paidToTeam && t.confirmed).length && enriched.some((t: any) => !t.paidToTeam && t.confirmed)}
                    onChange={(e) => { if (e.target.checked) selectAllUnpaid(); else clearSelection(); }}
                  />
                </th>
                <SortTh label="Date" k="date" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="left" />
                <SortTh label="Project" k="project" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="left" />
                <SortTh label="PP Code" k="ppCode" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="left" />
                <SortTh label="PP Agent" k="ppAgent" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="left" />
                <SortTh label="Transaction ID" k="transactionId" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="left" />
                <SortTh label="Gross" k="gross" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-green-700" align="right" />
                <SortTh
                  label={singleCollectorName ? `Fee PP (${singleCollectorName} note)` : "Fee PP (Agent note)"}
                  k="feePP" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-red-600" align="right"
                />
                <SortTh label="Net" k="net" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-700" align="right" />
                <SortTh
                  label={singleCollectorName ? `Fee ${singleCollectorName} ${singleCollectorPct}%` : "Collector fee"}
                  k="commission" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-purple-700" align="right"
                />
                <SortTh label="Total After Fee" k="totalAfterFee" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-emerald-700" align="right" />
                <SortTh label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="center" />
                <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-600 w-32">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr><td colSpan={13} className="text-center py-8 text-gray-400">Loading...</td></tr>
              ) : enriched.length === 0 ? (
                <tr><td colSpan={13} className="text-center py-8 text-gray-400">Không có giao dịch</td></tr>
              ) : (
                enriched.map((t: any) => (
                  <tr key={t.id} className={`hover:bg-gray-50 ${!t.confirmed ? "bg-orange-50/40" : t.paidToTeam ? "bg-emerald-50/30" : ""}`}>
                    <td className="px-3 py-2 text-center">
                      {!t.confirmed ? (
                        <span className="text-orange-400" title="Chưa nhập fee">⏳</span>
                      ) : !t.paidToTeam ? (
                        <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} />
                      ) : (
                        <span className="text-emerald-500">✓</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {new Date(t.date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {t.project?.code ? <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-[10px]">{t.project.code}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-2 py-2 text-xs font-medium">{t.sourcePaypal?.code ?? "—"}</td>
                    <td className="px-2 py-2 text-xs">
                      {(() => {
                        const val = t.agentEmail?.email ?? "—";
                        const isL = val.startsWith("http://") || val.startsWith("https://");
                        return isL
                          ? <a href={val} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block max-w-[150px]">{val.replace("https://", "")}</a>
                          : <span className="truncate block max-w-[150px]">{val}</span>;
                      })()}
                    </td>
                    <td className="px-2 py-2 text-xs font-mono text-gray-500 whitespace-nowrap">{t.transactionId || "—"}</td>
                    <td className="px-2 py-2 text-right font-semibold text-green-700 whitespace-nowrap">{formatCurrency(t.gross)}</td>
                    <td className="px-2 py-2 text-right text-xs w-24">
                      <div className="h-6 flex items-center justify-end">
                        {editingFeeId === t.id ? (
                          <input
                            type="number" step="0.01" autoFocus
                            value={editingFeeValue}
                            onChange={(e) => setEditingFeeValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                              if (e.key === "Escape") setEditingFeeId(null);
                            }}
                            onBlur={() => {
                              const v = editingFeeValue.trim() === "" ? null : parseFloat(editingFeeValue);
                              const current = t.matchedPaypalFee != null ? Number(t.matchedPaypalFee) : null;
                              if (v !== current) updateMeta.mutate({ projectId: t.projectId ?? projectId, id: t.id, paypalFee: v });
                              setEditingFeeId(null);
                            }}
                            className="w-full h-6 text-xs px-1 box-border border border-blue-400 rounded font-mono text-right"
                          />
                        ) : !t.confirmed ? (
                          <button
                            onClick={() => { setEditingFeeId(t.id); setEditingFeeValue(""); }}
                            className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-2 py-0.5 rounded text-[10px] shadow-sm"
                          >
                            + Nhập fee
                          </button>
                        ) : (
                          <button
                            disabled={t.paidToTeam}
                            onClick={() => { if (t.paidToTeam) return; setEditingFeeId(t.id); setEditingFeeValue(String(t.fee)); }}
                            className="text-red-600 hover:bg-blue-50 rounded px-1"
                          >
                            -{formatCurrency(t.fee)}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-gray-700 whitespace-nowrap">{t.confirmed ? formatCurrency(t.net) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-2 py-2 text-right text-xs whitespace-nowrap">
                      {!t.confirmed ? <span className="text-gray-300">—</span> : singleCollectorName ? (
                        <div className="text-purple-700 font-mono font-semibold">{formatCurrency(t.commission)}</div>
                      ) : (
                        <div className="leading-tight">
                          <div className="text-gray-700 font-medium truncate">{t.collectorName || "—"} <span className="text-purple-700 font-bold">{t.pct}%</span></div>
                          <div className="text-purple-700 font-mono font-semibold">{formatCurrency(t.commission)}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">{t.confirmed ? formatCurrency(t.totalAfterFee) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-2 py-2 text-center">
                      {!t.confirmed ? (
                        <Badge variant="outline" className="border-orange-500 text-orange-700 text-[10px]">Chờ confirm</Badge>
                      ) : t.paidToTeam ? (
                        <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">✓ Đã xử lý</Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500 text-amber-700 text-[10px]">Chờ xử lý</Badge>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {editingNoteId === t.id ? (
                        <input
                          type="text" autoFocus
                          value={editingNoteValue}
                          onChange={(e) => setEditingNoteValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditingNoteId(null);
                          }}
                          onBlur={() => {
                            const raw = editingNoteValue.trim();
                            const val = raw === "" ? null : raw;
                            const current = t.collectorNote ?? null;
                            if (val !== current) updateMeta.mutate({ projectId: t.projectId ?? projectId, id: t.id, collectorNote: val });
                            setEditingNoteId(null);
                          }}
                          className="w-full h-6 text-xs px-1 box-border border border-blue-400 rounded"
                        />
                      ) : (
                        <button
                          onClick={() => { setEditingNoteId(t.id); setEditingNoteValue(t.collectorNote ?? ""); }}
                          className="w-full h-6 text-left px-1 hover:bg-blue-50 rounded truncate text-gray-600"
                        >
                          {t.collectorNote || <span className="text-gray-300">+ note</span>}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Expense History ─── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <button onClick={() => setShowHistory(!showHistory)} className="w-full px-4 py-3 border-b flex items-center justify-between hover:bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-800">📜 Lịch sử chi ({expenses?.length ?? 0})</h3>
          <span className="text-xs text-gray-500">{showHistory ? "▲ Ẩn" : "▼ Xem"}</span>
        </button>
        {showHistory && (
          <div className="divide-y">
            {(expenses ?? []).length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-400">Chưa có khoản chi nào.</p>
            ) : (
              (expenses ?? []).map((e: any) => {
                const isExpanded = expandedExpenseId === e.id;
                const meta = EXPENSE_LABELS[e.type as ExpenseType] ?? EXPENSE_LABELS.OTHER;
                return (
                  <div key={e.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => setExpandedExpenseId(isExpanded ? null : e.id)}
                        className="flex-1 flex items-center justify-between hover:bg-gray-50 rounded px-2 py-1 -mx-2 text-left"
                      >
                        <div className="flex items-center gap-3 text-sm flex-wrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${meta.color}`}>
                            {meta.icon} {meta.label}
                          </span>
                          <span className="text-gray-600 text-xs">{new Date(e.date).toLocaleDateString("vi-VN")}</span>
                          <span className="font-mono text-blue-700 text-xs">{e.referenceId}</span>
                          {e.withdrawals?.length > 0 && <span className="text-gray-500 text-xs">({e.withdrawals.length} giao dịch)</span>}
                          {e.note && <span className="text-gray-400 italic text-xs">{e.note}</span>}
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="text-red-600 font-bold">-{formatCurrency(Number(e.amount))}</span>
                          <span className="text-gray-400 text-xs">{isExpanded ? "▲" : "▼"}</span>
                        </div>
                      </button>
                      <button
                        onClick={() => { if (confirm("Xóa khoản chi này?")) deleteExpenseMut.mutate({ projectId, id: e.id }); }}
                        className="text-gray-300 hover:text-red-500 px-1"
                        title="Xóa"
                      >×</button>
                    </div>
                    {isExpanded && e.withdrawals?.length > 0 && (
                      <div className="mt-2 ml-4 bg-gray-50 rounded p-2">
                        <div className="text-[11px] font-semibold text-gray-600 mb-1">Giao dịch liên kết:</div>
                        <div className="space-y-1">
                          {e.withdrawals.map((w: any) => (
                            <div key={w.id} className="flex items-center justify-between text-xs">
                              <span className="font-mono text-gray-500">{w.transactionId || "—"}</span>
                              <span className="text-gray-600">{w.sourcePaypal?.code}</span>
                              <span className="font-semibold text-green-700">{formatCurrency(Number(w.amount))}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ─── Expense Dialog ─── */}
      {dialogOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDialogOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full" onClick={(ev) => ev.stopPropagation()}>
            <div className="px-5 py-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Ghi khoản chi</h3>
              <p className="text-xs text-gray-500 mt-1">Ghi nhận tiền chi ra từ wallet</p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Loại chi</label>
                <div className="flex gap-2">
                  {(["TEAM_PAYMENT", "BILL", "OTHER"] as const).map((typ) => {
                    const meta = EXPENSE_LABELS[typ];
                    const active = expType === typ;
                    return (
                      <button
                        key={typ}
                        type="button"
                        onClick={() => setExpType(typ)}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${active ? meta.color + " ring-2 ring-offset-1" : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"}`}
                      >
                        {meta.icon} {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Số tiền chi <span className="text-red-500">*</span></label>
                <input
                  type="number" step="0.01" min="0" autoFocus
                  value={expAmount}
                  onChange={(ev) => setExpAmount(ev.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border rounded-md text-lg font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Wallet hiện có: <strong>{formatCurrency(walletBalance)}</strong>
                  {parseFloat(expAmount) > 0 && ` → sau chi: ${formatCurrency(walletBalance - parseFloat(expAmount))}`}
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Mã tham chiếu <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={expRef}
                  onChange={(ev) => setExpRef(ev.target.value)}
                  placeholder={expType === "BILL" ? "VD: INV-2026-042" : "VD: FT25041012345"}
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {selectedIds.size > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-blue-800">Link với {selectedIds.size} giao dịch đã chọn?</span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setExpLinkMode("linked")}
                      className={`flex-1 px-3 py-1.5 rounded border font-semibold ${expLinkMode === "linked" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-blue-700 border-blue-300"}`}
                    >✓ Có — mark đã xử lý</button>
                    <button
                      type="button"
                      onClick={() => setExpLinkMode("unlinked")}
                      className={`flex-1 px-3 py-1.5 rounded border font-semibold ${expLinkMode === "unlinked" ? "bg-gray-600 text-white border-gray-600" : "bg-white text-gray-600 border-gray-300"}`}
                    >Không — chỉ trừ wallet</button>
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Ghi chú (optional)</label>
                <input
                  type="text"
                  value={expNote}
                  onChange={(ev) => setExpNote(ev.target.value)}
                  placeholder="VD: Đợt 1 tháng 4 / Tiền điện / ..."
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Hủy</Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={confirmExpense}
                disabled={!parseFloat(expAmount) || !expRef.trim() || createExpense.isLoading}
              >
                {createExpense.isLoading ? "Đang lưu..." : "✓ Lưu khoản chi"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
