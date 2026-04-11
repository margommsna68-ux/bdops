"use client";

// ═══════════════════════════════════════════════════════════════════════
// DEMO PAGE — collector-friendly dashboard
// All data is MOCK (hardcoded). No real API calls. No DB changes saved.
// Used for UX review before applying to the real /agent-pp page.
// ═══════════════════════════════════════════════════════════════════════

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

// ─── Types (module scope) ─────────────────────────────────────────────
type SortKey = "date" | "project" | "ppCode" | "ppAgent" | "transactionId" | "gross" | "feePP" | "net" | "commission" | "totalAfterFee" | "status";
type SortDir = "asc" | "desc";

// ─── Sortable header component ────────────────────────────────────────
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

// ─── Mock data ────────────────────────────────────────────────────────
const COLLECTOR_NAME = "Marua";
const COLLECTOR_PCT = 3;

type MockTx = {
  id: string;
  date: string;
  project: "AE" | "DN";
  ppCode: string;
  ppAgent: string;
  transactionId: string;
  gross: number;
  feePP: number | null;  // null = chưa confirm, không null = đã confirm
  note: string;
  paidToTeam: boolean;
  paidBatchId: string | null;
  paidAt: string | null;
};

type ExpenseType = "TEAM_PAYMENT" | "BILL" | "OTHER";

const EXPENSE_LABELS: Record<ExpenseType, { label: string; color: string; icon: string }> = {
  TEAM_PAYMENT: { label: "Chuyển team", color: "bg-emerald-100 text-emerald-700 border-emerald-300", icon: "→" },
  BILL:         { label: "Thanh toán bill", color: "bg-blue-100 text-blue-700 border-blue-300", icon: "🧾" },
  OTHER:        { label: "Chi khác", color: "bg-gray-100 text-gray-700 border-gray-300", icon: "◇" },
};

type Expense = {
  id: string;
  date: string;
  type: ExpenseType;
  amount: number;          // tiền chi ra từ wallet (flexible, không bắt buộc match linked tx)
  referenceId: string;     // Bank TX ID / Invoice / Receipt reference
  note: string;
  linkedTxIds: string[];   // optional — các giao dịch được cover bởi expense này (0..N)
};

function buildMock(): MockTx[] {
  const today = new Date();
  const iso = (d: Date) => d.toISOString();
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return iso(d);
  };
  return [
    { id: "1", date: daysAgo(0), project: "AE", ppCode: "AE-018", ppAgent: "https://paypal.me/marua01", transactionId: "19X64127HH558342E", gross: 20.31, feePP: null, note: "", paidToTeam: false, paidBatchId: null, paidAt: null },
    { id: "2", date: daysAgo(0), project: "AE", ppCode: "AE-019", ppAgent: "https://paypal.me/marua01", transactionId: "7BK92384PL201837W", gross: 45.00, feePP: null, note: "", paidToTeam: false, paidBatchId: null, paidAt: null },
    { id: "3", date: daysAgo(0), project: "DN", ppCode: "DN-042", ppAgent: "https://paypal.me/marua02", transactionId: "3HY71829UJ498201K", gross: 28.68, feePP: 1.53, note: "note test", paidToTeam: false, paidBatchId: null, paidAt: null },
    { id: "4", date: daysAgo(1), project: "AE", ppCode: "AE-015", ppAgent: "https://paypal.me/marua01", transactionId: "0AB92837OP449283X", gross: 60.00, feePP: 2.34, note: "", paidToTeam: true, paidBatchId: "batch-1", paidAt: daysAgo(1) },
    { id: "5", date: daysAgo(2), project: "AE", ppCode: "AE-012", ppAgent: "https://paypal.me/marua01", transactionId: "5PL84729QW163829J", gross: 35.20, feePP: 1.72, note: "", paidToTeam: true, paidBatchId: "batch-1", paidAt: daysAgo(1) },
    { id: "6", date: daysAgo(3), project: "DN", ppCode: "DN-038", ppAgent: "https://paypal.me/marua02", transactionId: "8NM17263BC748291L", gross: 50.00, feePP: 2.04, note: "", paidToTeam: true, paidBatchId: "batch-1", paidAt: daysAgo(1) },
    { id: "7", date: daysAgo(5), project: "AE", ppCode: "AE-008", ppAgent: "https://paypal.me/marua01", transactionId: "2QR83746DE912837M", gross: 25.50, feePP: 1.47, note: "", paidToTeam: true, paidBatchId: "batch-2", paidAt: daysAgo(4) },
    { id: "8", date: daysAgo(7), project: "AE", ppCode: "AE-007", ppAgent: "https://paypal.me/marua01", transactionId: "4TU28394FG827163N", gross: 40.00, feePP: 1.86, note: "", paidToTeam: true, paidBatchId: "batch-2", paidAt: daysAgo(4) },
    { id: "9", date: daysAgo(10), project: "DN", ppCode: "DN-020", ppAgent: "https://paypal.me/marua02", transactionId: "6VW91827HI384729O", gross: 33.40, feePP: 1.67, note: "", paidToTeam: true, paidBatchId: "batch-3", paidAt: daysAgo(9) },
    { id: "10", date: daysAgo(12), project: "AE", ppCode: "AE-003", ppAgent: "https://paypal.me/marua01", transactionId: "1XY82736JK501948P", gross: 22.15, feePP: 1.44, note: "", paidToTeam: true, paidBatchId: "batch-3", paidAt: daysAgo(9) },
    { id: "11", date: daysAgo(15), project: "AE", ppCode: "AE-001", ppAgent: "https://paypal.me/marua01", transactionId: "9ZA65432LM190273Q", gross: 55.00, feePP: 2.20, note: "", paidToTeam: true, paidBatchId: "batch-4", paidAt: daysAgo(14) },
    { id: "12", date: daysAgo(20), project: "DN", ppCode: "DN-011", ppAgent: "https://paypal.me/marua02", transactionId: "8CF12987NO827483R", gross: 18.00, feePP: 1.35, note: "", paidToTeam: true, paidBatchId: "batch-4", paidAt: daysAgo(14) },
    { id: "13", date: daysAgo(25), project: "AE", ppCode: "AE-014", ppAgent: "https://paypal.me/marua01", transactionId: "7GH39485PQ629384S", gross: 72.00, feePP: 2.39, note: "", paidToTeam: true, paidBatchId: "batch-5", paidAt: daysAgo(24) },
    { id: "14", date: daysAgo(30), project: "AE", ppCode: "AE-002", ppAgent: "https://paypal.me/marua01", transactionId: "5IJ72194RS573910T", gross: 30.00, feePP: 1.57, note: "", paidToTeam: true, paidBatchId: "batch-5", paidAt: daysAgo(24) },
    { id: "15", date: daysAgo(35), project: "DN", ppCode: "DN-005", ppAgent: "https://paypal.me/marua02", transactionId: "4KL38290TU846592U", gross: 45.00, feePP: 1.91, note: "", paidToTeam: true, paidBatchId: "batch-6", paidAt: daysAgo(34) },
  ];
}

type Period = "all" | "today" | "week" | "month" | "custom";

export default function AgentPPDemoPage() {
  const [txs, setTxs] = useState<MockTx[]>(buildMock);
  const [expenses, setExpenses] = useState<Expense[]>([
    {
      id: "exp-1",
      date: new Date(Date.now() - 86400000).toISOString(),
      type: "TEAM_PAYMENT",
      amount: 139.13,
      referenceId: "FT25041012345",
      note: "Chuyển team đợt 1",
      linkedTxIds: ["4", "5", "6"],
    },
    {
      id: "exp-2",
      date: new Date(Date.now() - 4 * 86400000).toISOString(),
      type: "TEAM_PAYMENT",
      amount: 61.76,
      referenceId: "FT25040612999",
      note: "",
      linkedTxIds: ["7", "8"],
    },
  ]);
  const [period, setPeriod] = useState<Period>("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingFeeId, setEditingFeeId] = useState<string | null>(null);
  const [editingFeeValue, setEditingFeeValue] = useState<string>("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unpaid" | "paid" | "unconfirmed">("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Expense dialog
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [expenseType, setExpenseType] = useState<ExpenseType>("TEAM_PAYMENT");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseRef, setExpenseRef] = useState("");
  const [expenseNote, setExpenseNote] = useState("");
  const [expenseLinkMode, setExpenseLinkMode] = useState<"linked" | "unlinked">("linked");
  const [showHistory, setShowHistory] = useState(true);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);

  // ─── Filter by period + status ──────────────────────────────────
  const filtered = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return txs.filter((t) => {
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
      if (statusFilter === "unconfirmed" && t.feePP !== null) return false;
      if (statusFilter === "unpaid" && (t.paidToTeam || t.feePP === null)) return false;
      if (statusFilter === "paid" && !t.paidToTeam) return false;
      return true;
    });
  }, [txs, period, customFrom, customTo, statusFilter]);

  // ─── Computed per row ───────────────────────────────────────────
  const computedFiltered = filtered.map((t) => {
    const confirmed = t.feePP !== null;
    const fee = t.feePP ?? 0;
    const net = t.gross - fee;
    const commission = net * (COLLECTOR_PCT / 100);
    const totalAfterFee = net - commission;
    return { ...t, fee, net, commission, totalAfterFee, confirmed };
  });

  // ─── Sort ───────────────────────────────────────────────────────
  const enriched = useMemo(() => {
    const arr = [...computedFiltered];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av: any;
      let bv: any;
      switch (sortKey) {
        case "date": av = a.date; bv = b.date; break;
        case "project": av = a.project; bv = b.project; break;
        case "ppCode": av = a.ppCode; bv = b.ppCode; break;
        case "ppAgent": av = a.ppAgent; bv = b.ppAgent; break;
        case "transactionId": av = a.transactionId; bv = b.transactionId; break;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedFiltered, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  };

  // ─── Filtered totals (over enriched) ────────────────────────────
  const totals = enriched.reduce(
    (acc, t) => {
      acc.received += t.gross;
      acc.fees += t.fee;
      acc.net += t.net;
      acc.commissionEarned += t.confirmed ? t.commission : 0;
      acc.txCount += 1;
      if (!t.confirmed) {
        acc.unconfirmedCount += 1;
        acc.unconfirmedAmount += t.gross;
      } else if (t.paidToTeam) {
        acc.paidCount += 1;
      } else {
        acc.owedToTeam += t.totalAfterFee;
        acc.unpaidCount += 1;
      }
      return acc;
    },
    { received: 0, fees: 0, net: 0, commissionEarned: 0, owedToTeam: 0, txCount: 0, paidCount: 0, unpaidCount: 0, unconfirmedCount: 0, unconfirmedAmount: 0 }
  );

  // ─── ALL-TIME totals for wallet balance (not filtered) ──────────
  // Wallet = money currently held in collector's PP
  //       = sum(net received for confirmed txs) - sum(expense amounts)
  const allTimeNetReceived = txs.reduce((s, t) => (t.feePP != null ? s + t.gross - t.feePP : s), 0);
  const allTimeExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const walletBalance = allTimeNetReceived - allTimeExpenses;
  // Expense breakdown by type
  const expenseBreakdown = expenses.reduce(
    (acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + e.amount;
      return acc;
    },
    { TEAM_PAYMENT: 0, BILL: 0, OTHER: 0 } as Record<ExpenseType, number>
  );

  // ─── Selection totals (appear when rows selected) ───────────────
  const selectionTotals = enriched
    .filter((t) => selectedIds.has(t.id))
    .reduce(
      (acc, t) => {
        acc.count += 1;
        acc.gross += t.gross;
        acc.totalAfterFee += t.totalAfterFee;
        acc.commission += t.commission;
        return acc;
      },
      { count: 0, gross: 0, totalAfterFee: 0, commission: 0 }
    );

  // ─── Actions ────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllUnpaid = () => {
    const ids = enriched.filter((t) => !t.paidToTeam).map((t) => t.id);
    setSelectedIds(new Set(ids));
  };
  const clearSelection = () => setSelectedIds(new Set());

  // ─── Expense flow ───────────────────────────────────────────────
  // Default prefill: if user has selection, suggest amount = sum totalAfterFee, type = TEAM_PAYMENT, linked
  const openExpenseDialogFromSelection = () => {
    const selected = enriched.filter((t) => selectedIds.has(t.id) && !t.paidToTeam && t.confirmed);
    const suggestedAmount = selected.reduce((s, t) => s + t.totalAfterFee, 0);
    setExpenseType("TEAM_PAYMENT");
    setExpenseAmount(suggestedAmount.toFixed(2));
    setExpenseRef("");
    setExpenseNote("");
    setExpenseLinkMode("linked");
    setExpenseDialogOpen(true);
  };

  // Open empty dialog (custom expense, no selection)
  const openExpenseDialogEmpty = () => {
    setExpenseType("OTHER");
    setExpenseAmount("");
    setExpenseRef("");
    setExpenseNote("");
    setExpenseLinkMode("unlinked");
    setExpenseDialogOpen(true);
  };

  const confirmExpense = () => {
    const amt = parseFloat(expenseAmount);
    if (!amt || amt <= 0) {
      alert("Nhập số tiền chi");
      return;
    }
    if (!expenseRef.trim()) {
      alert("Nhập mã tham chiếu (Bank TX / Invoice ID)");
      return;
    }
    const expId = `exp-${Date.now()}`;
    const now = new Date().toISOString();
    const linkedIds = expenseLinkMode === "linked"
      ? enriched.filter((t) => selectedIds.has(t.id) && !t.paidToTeam && t.confirmed).map((t) => t.id)
      : [];
    const newExpense: Expense = {
      id: expId,
      date: now,
      type: expenseType,
      amount: amt,
      referenceId: expenseRef.trim(),
      note: expenseNote.trim(),
      linkedTxIds: linkedIds,
    };
    setExpenses((prev) => [newExpense, ...prev]);
    // Mark linked txs as paid
    if (linkedIds.length > 0) {
      setTxs((prev) =>
        prev.map((t) =>
          linkedIds.includes(t.id) ? { ...t, paidToTeam: true, paidBatchId: expId, paidAt: now } : t
        )
      );
    }
    setSelectedIds(new Set());
    setExpenseDialogOpen(false);
  };

  const deleteExpense = (expId: string) => {
    if (!confirm("Xóa khoản chi này? Các giao dịch liên kết sẽ quay lại trạng thái chờ.")) return;
    const exp = expenses.find((e) => e.id === expId);
    setExpenses((prev) => prev.filter((e) => e.id !== expId));
    if (exp && exp.linkedTxIds.length > 0) {
      setTxs((prev) =>
        prev.map((t) =>
          exp.linkedTxIds.includes(t.id) ? { ...t, paidToTeam: false, paidBatchId: null, paidAt: null } : t
        )
      );
    }
  };

  const unmarkPaid = (id: string) => {
    setTxs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, paidToTeam: false, paidBatchId: null, paidAt: null } : t))
    );
  };

  const updateFee = (id: string, fee: number | null) => {
    setTxs((prev) => prev.map((t) => (t.id === id ? { ...t, feePP: fee } : t)));
  };
  const updateNote = (id: string, note: string) => {
    setTxs((prev) => prev.map((t) => (t.id === id ? { ...t, note } : t)));
  };

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Demo banner */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-sm text-yellow-800">
        <strong>DEMO PAGE</strong> — Data giả lập. Mọi thao tác chỉ chạy trong trình duyệt, không lưu vào DB.
        Mục đích: review UX trước khi apply vào page thật.
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PayPal Collector — Demo</h1>
          <p className="text-sm text-gray-500">Hello {COLLECTOR_NAME}, đây là dashboard mới đề xuất</p>
        </div>
      </div>

      {/* ─── Period filter pills ─── */}
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
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 px-2 text-xs border rounded"
              />
              <span className="text-xs text-gray-400">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 px-2 text-xs border rounded"
              />
            </div>
          )}
        </div>
      </div>

      {/* ─── WALLET: tiền đang nắm (all-time, không filter) ─── */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 rounded-xl shadow-lg text-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold text-blue-200 uppercase tracking-wider">💰 Wallet (tiền đang nắm)</div>
            <div className="text-4xl font-bold mt-1">{formatCurrency(walletBalance)}</div>
            <div className="text-xs text-blue-200 mt-1">
              = Net nhận {formatCurrency(allTimeNetReceived)} − Đã chi {formatCurrency(allTimeExpenses)}
            </div>
          </div>
          <Button
            size="sm"
            className="bg-white text-blue-700 hover:bg-blue-50 shadow-md font-semibold"
            onClick={openExpenseDialogEmpty}
          >
            + Ghi khoản chi
          </Button>
        </div>
        {/* Expense breakdown */}
        <div className="mt-4 pt-3 border-t border-blue-400/30 grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-blue-200">Chuyển team</div>
            <div className="text-base font-bold">{formatCurrency(expenseBreakdown.TEAM_PAYMENT)}</div>
          </div>
          <div>
            <div className="text-blue-200">Bill</div>
            <div className="text-base font-bold">{formatCurrency(expenseBreakdown.BILL)}</div>
          </div>
          <div>
            <div className="text-blue-200">Chi khác</div>
            <div className="text-base font-bold">{formatCurrency(expenseBreakdown.OTHER)}</div>
          </div>
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
            <div className="text-[10px] font-semibold text-purple-600 uppercase mb-1">Commission {COLLECTOR_PCT}%</div>
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

      {/* ─── Status filter tabs ─── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex gap-1 flex-wrap">
            {[
              { key: "all", label: `Tất cả (${enriched.length})` },
              { key: "unconfirmed", label: `⏳ Chưa confirm (${totals.unconfirmedCount})`, color: totals.unconfirmedCount > 0 ? "bg-orange-100 text-orange-700" : "" },
              { key: "unpaid", label: `Chưa trả team (${totals.unpaidCount})` },
              { key: "paid", label: `Đã trả team (${totals.paidCount})` },
            ].map((s: any) => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  statusFilter === s.key
                    ? s.color || "bg-blue-100 text-blue-700"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {totals.unpaidCount > 0 && statusFilter !== "paid" && statusFilter !== "unconfirmed" && (
            <button
              onClick={selectAllUnpaid}
              className="text-xs text-blue-600 hover:underline"
            >
              Chọn tất cả confirmed & chưa trả
            </button>
          )}
        </div>

        {/* ─── Bulk action bar ─── */}
        {selectedIds.size > 0 && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <span className="font-semibold text-emerald-800">
                Đã chọn {selectionTotals.count} giao dịch
              </span>
              <span className="text-gray-600">
                Gross: <strong>{formatCurrency(selectionTotals.gross)}</strong>
              </span>
              <span className="text-emerald-700">
                Để chi team: <strong>{formatCurrency(selectionTotals.totalAfterFee)}</strong>
              </span>
              <span className="text-purple-700">
                Commission giữ: <strong>{formatCurrency(selectionTotals.commission)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs"
                onClick={openExpenseDialogFromSelection}
              >
                + Ghi chi ({formatCurrency(selectionTotals.totalAfterFee)})
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={clearSelection}>
                Hủy chọn
              </Button>
            </div>
          </div>
        )}

        {/* ─── Table ─── */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 w-8 text-center">
                  <input
                    type="checkbox"
                    checked={enriched.length > 0 && selectedIds.size === enriched.filter((t) => !t.paidToTeam).length && enriched.some((t) => !t.paidToTeam)}
                    onChange={(e) => {
                      if (e.target.checked) selectAllUnpaid();
                      else clearSelection();
                    }}
                  />
                </th>
                <SortTh label="Date" k="date" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="left" />
                <SortTh label="Project" k="project" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="left" />
                <SortTh label="PP Code" k="ppCode" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="left" />
                <SortTh label="PP Agent" k="ppAgent" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="left" />
                <SortTh label="Transaction ID" k="transactionId" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="left" />
                <SortTh label="Gross" k="gross" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-green-700" align="right" />
                <SortTh label={`Fee PP (${COLLECTOR_NAME} note)`} k="feePP" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-red-600" align="right" />
                <SortTh label="Net" k="net" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-700" align="right" />
                <SortTh label={`Fee ${COLLECTOR_NAME} ${COLLECTOR_PCT}%`} k="commission" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-purple-700" align="right" />
                <SortTh label="Total After Fee" k="totalAfterFee" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-emerald-700" align="right" />
                <SortTh label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} color="text-gray-600" align="center" />
                <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-600 w-32">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {enriched.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-10 text-gray-400">
                    Không có giao dịch nào trong kỳ này
                  </td>
                </tr>
              ) : (
                enriched.map((t) => (
                  <tr
                    key={t.id}
                    className={`hover:bg-gray-50 ${
                      !t.confirmed ? "bg-orange-50/40" : t.paidToTeam ? "bg-emerald-50/30" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-center">
                      {!t.confirmed ? (
                        <span className="text-orange-400" title="Chưa confirm (chưa nhập fee)">⏳</span>
                      ) : !t.paidToTeam ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                        />
                      ) : (
                        <span className="text-emerald-500">✓</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {new Date(t.date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-[10px]">
                        {t.project}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs font-medium">{t.ppCode}</td>
                    <td className="px-2 py-2 text-xs">
                      <a href={t.ppAgent} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block max-w-[150px]">
                        {t.ppAgent.replace("https://", "")}
                      </a>
                    </td>
                    <td className="px-2 py-2 text-xs font-mono text-gray-500 whitespace-nowrap">{t.transactionId}</td>
                    <td className="px-2 py-2 text-right font-semibold text-green-700 whitespace-nowrap">{formatCurrency(t.gross)}</td>
                    <td className="px-2 py-2 text-right text-xs">
                      {editingFeeId === t.id ? (
                        <input
                          type="number"
                          step="0.01"
                          autoFocus
                          value={editingFeeValue}
                          onChange={(e) => setEditingFeeValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditingFeeId(null);
                          }}
                          onBlur={() => {
                            const v = editingFeeValue.trim() === "" ? null : parseFloat(editingFeeValue);
                            updateFee(t.id, v);
                            setEditingFeeId(null);
                          }}
                          className="w-full h-6 text-xs px-1 border border-blue-400 rounded text-right font-mono"
                        />
                      ) : !t.confirmed ? (
                        <button
                          onClick={() => {
                            setEditingFeeId(t.id);
                            setEditingFeeValue("");
                          }}
                          className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-2 py-0.5 rounded text-[10px] shadow-sm"
                          title="Nhập fee để confirm giao dịch"
                        >
                          + Nhập fee
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (t.paidToTeam) return;
                            setEditingFeeId(t.id);
                            setEditingFeeValue(String(t.feePP));
                          }}
                          className="text-red-600 hover:bg-blue-50 rounded px-1"
                          disabled={t.paidToTeam}
                        >
                          -{formatCurrency(t.fee)}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-gray-700 whitespace-nowrap">
                      {t.confirmed ? formatCurrency(t.net) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-semibold text-purple-700 whitespace-nowrap">
                      {t.confirmed ? formatCurrency(t.commission) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                      {t.confirmed ? formatCurrency(t.totalAfterFee) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {!t.confirmed ? (
                        <Badge variant="outline" className="border-orange-500 text-orange-700 text-[10px]">
                          Chờ confirm
                        </Badge>
                      ) : t.paidToTeam ? (
                        <button
                          onClick={() => unmarkPaid(t.id)}
                          className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-700"
                          title={`Paid ${new Date(t.paidAt!).toLocaleDateString("vi-VN")} — click to unmark`}
                        >
                          ✓ Đã trả
                        </button>
                      ) : (
                        <Badge variant="outline" className="border-amber-500 text-amber-700 text-[10px]">
                          Chờ trả
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {editingNoteId === t.id ? (
                        <input
                          type="text"
                          autoFocus
                          value={editingNoteValue}
                          onChange={(e) => setEditingNoteValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditingNoteId(null);
                          }}
                          onBlur={() => {
                            updateNote(t.id, editingNoteValue.trim());
                            setEditingNoteId(null);
                          }}
                          className="w-full h-6 text-xs px-1 border border-blue-400 rounded"
                        />
                      ) : (
                        <button
                          onClick={() => {
                            setEditingNoteId(t.id);
                            setEditingNoteValue(t.note);
                          }}
                          className="w-full h-6 text-left px-1 hover:bg-blue-50 rounded truncate text-gray-600"
                        >
                          {t.note || <span className="text-gray-300">+ note</span>}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer summary */}
        {enriched.length > 0 && (
          <div className="bg-gray-50 border-t px-4 py-2 text-xs text-gray-600 flex items-center justify-between">
            <span>
              Hiển thị {enriched.length} giao dịch
              {period === "today" && " (hôm nay)"}
              {period === "week" && " (tuần này)"}
              {period === "month" && " (tháng này)"}
            </span>
            <span className="flex gap-4">
              <span>Gross: <strong className="text-green-700">{formatCurrency(totals.received)}</strong></span>
              <span>Commission: <strong className="text-purple-700">{formatCurrency(totals.commissionEarned)}</strong></span>
              <span>Chưa xử lý: <strong className="text-amber-700">{formatCurrency(totals.owedToTeam)}</strong></span>
            </span>
          </div>
        )}
      </div>

      {/* ─── Expense History ─── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full px-4 py-3 border-b flex items-center justify-between hover:bg-gray-50"
        >
          <h3 className="text-sm font-semibold text-gray-800">
            📜 Lịch sử chi ({expenses.length})
          </h3>
          <span className="text-xs text-gray-500">{showHistory ? "▲ Ẩn" : "▼ Xem"}</span>
        </button>
        {showHistory && (
          <div className="divide-y">
            {expenses.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-400">Chưa có khoản chi nào.</p>
            ) : (
              expenses.map((e) => {
                const isExpanded = expandedBatchId === e.id;
                const linkedTxs = txs.filter((t) => e.linkedTxIds.includes(t.id));
                const meta = EXPENSE_LABELS[e.type];
                return (
                  <div key={e.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => setExpandedBatchId(isExpanded ? null : e.id)}
                        className="flex-1 flex items-center justify-between hover:bg-gray-50 rounded px-2 py-1 -mx-2 text-left"
                      >
                        <div className="flex items-center gap-3 text-sm">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${meta.color}`}>
                            {meta.icon} {meta.label}
                          </span>
                          <span className="text-gray-600 text-xs">{new Date(e.date).toLocaleDateString("vi-VN")}</span>
                          <span className="font-mono text-blue-700 text-xs">{e.referenceId}</span>
                          {e.linkedTxIds.length > 0 && (
                            <span className="text-gray-500 text-xs">({e.linkedTxIds.length} giao dịch)</span>
                          )}
                          {e.note && <span className="text-gray-400 italic text-xs">{e.note}</span>}
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="text-red-600 font-bold">-{formatCurrency(e.amount)}</span>
                          <span className="text-gray-400 text-xs">{isExpanded ? "▲" : "▼"}</span>
                        </div>
                      </button>
                      <button
                        onClick={() => deleteExpense(e.id)}
                        className="text-gray-300 hover:text-red-500 px-1"
                        title="Xóa"
                      >
                        ×
                      </button>
                    </div>
                    {isExpanded && linkedTxs.length > 0 && (
                      <div className="mt-2 ml-4 bg-gray-50 rounded p-2">
                        <div className="text-[11px] font-semibold text-gray-600 mb-1">Các giao dịch liên kết:</div>
                        <div className="space-y-1">
                          {linkedTxs.map((bt) => (
                            <div key={bt.id} className="flex items-center justify-between text-xs">
                              <span className="font-mono text-gray-500">{bt.transactionId}</span>
                              <span className="text-gray-600">{bt.ppCode}</span>
                              <span className="font-semibold text-green-700">{formatCurrency(bt.gross)}</span>
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

      {/* Legend */}
      <div className="bg-white rounded-lg border p-4 text-xs space-y-1">
        <div className="font-semibold text-gray-700 mb-2">Flow mới — Wallet + Expenses:</div>
        <div>💰 <strong>Wallet</strong> (thẻ xanh) = tiền đang nắm trong PP = Tổng net nhận − Tổng đã chi</div>
        <div>1. Giao dịch vào → <strong className="text-orange-700">⏳ Chờ confirm</strong> → click <strong>+ Nhập fee</strong> → Enter → tự động confirm</div>
        <div>2. Tick row(s) đã confirm → click <strong>+ Ghi chi</strong> → dialog mở sẵn loại <strong>Chuyển team</strong> + amount prefill</div>
        <div>3. Hoặc click thẳng <strong>+ Ghi khoản chi</strong> ở thẻ Wallet → dialog trống để chi bill / chi khác (không cần tick row)</div>
        <div>4. Dialog cho chọn: loại (Team/Bill/Khác), amount linh động, Ref ID, note, có/không link giao dịch</div>
        <div>5. Bấm cột header để sort theo cột đó (▲▼)</div>
      </div>

      {/* ─── Expense Dialog ─── */}
      {expenseDialogOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setExpenseDialogOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full" onClick={(ev) => ev.stopPropagation()}>
            <div className="px-5 py-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Ghi khoản chi</h3>
              <p className="text-xs text-gray-500 mt-1">Ghi nhận tiền chi ra từ wallet (PP)</p>
            </div>
            <div className="p-5 space-y-4">
              {/* Type */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Loại chi</label>
                <div className="flex gap-2">
                  {(["TEAM_PAYMENT", "BILL", "OTHER"] as const).map((typ) => {
                    const meta = EXPENSE_LABELS[typ];
                    const active = expenseType === typ;
                    return (
                      <button
                        key={typ}
                        type="button"
                        onClick={() => setExpenseType(typ)}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                          active ? meta.color + " ring-2 ring-offset-1" : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                        }`}
                      >
                        {meta.icon} {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  Số tiền chi <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={expenseAmount}
                  onChange={(ev) => setExpenseAmount(ev.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border rounded-md text-lg font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Wallet hiện có: <strong>{formatCurrency(walletBalance)}</strong>
                  {parseFloat(expenseAmount) > 0 && ` → sau chi: ${formatCurrency(walletBalance - parseFloat(expenseAmount))}`}
                </p>
              </div>

              {/* Ref ID */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  Mã tham chiếu <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={expenseRef}
                  onChange={(ev) => setExpenseRef(ev.target.value)}
                  placeholder={expenseType === "BILL" ? "VD: INV-2026-042" : "VD: FT25041012345"}
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  {expenseType === "TEAM_PAYMENT" ? "Bank transaction ID khi chuyển khoản cho team"
                    : expenseType === "BILL" ? "Số hóa đơn hoặc mã bill"
                    : "Mã chứng từ / ref để tra cứu sau"}
                </p>
              </div>

              {/* Link transactions toggle (only shown if has selection) */}
              {selectedIds.size > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-blue-800">
                      Link với {selectedIds.size} giao dịch đã chọn?
                    </span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setExpenseLinkMode("linked")}
                      className={`flex-1 px-3 py-1.5 rounded border font-semibold ${
                        expenseLinkMode === "linked" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-blue-700 border-blue-300"
                      }`}
                    >
                      ✓ Có — mark các giao dịch đã xử lý
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpenseLinkMode("unlinked")}
                      className={`flex-1 px-3 py-1.5 rounded border font-semibold ${
                        expenseLinkMode === "unlinked" ? "bg-gray-600 text-white border-gray-600" : "bg-white text-gray-600 border-gray-300"
                      }`}
                    >
                      Không — chỉ trừ wallet
                    </button>
                  </div>
                </div>
              )}

              {/* Note */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Ghi chú (optional)</label>
                <input
                  type="text"
                  value={expenseNote}
                  onChange={(ev) => setExpenseNote(ev.target.value)}
                  placeholder="VD: Đợt 1 tháng 4 / Tiền điện / ..."
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setExpenseDialogOpen(false)}>
                Hủy
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={confirmExpense}
                disabled={!parseFloat(expenseAmount) || !expenseRef.trim()}
              >
                ✓ Lưu khoản chi
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
