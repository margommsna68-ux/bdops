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
  feePP: number;
  note: string;
  paidToTeam: boolean;
  paidBatchId: string | null;
  paidAt: string | null;
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
    { id: "1", date: daysAgo(0), project: "AE", ppCode: "AE-018", ppAgent: "https://paypal.me/marua01", transactionId: "19X64127HH558342E", gross: 20.31, feePP: 1.39, note: "", paidToTeam: false, paidBatchId: null, paidAt: null },
    { id: "2", date: daysAgo(0), project: "AE", ppCode: "AE-019", ppAgent: "https://paypal.me/marua01", transactionId: "7BK92384PL201837W", gross: 45.00, feePP: 1.91, note: "", paidToTeam: false, paidBatchId: null, paidAt: null },
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

type Period = "today" | "week" | "month" | "all" | "custom";

export default function AgentPPDemoPage() {
  const [txs, setTxs] = useState<MockTx[]>(buildMock);
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingFeeId, setEditingFeeId] = useState<string | null>(null);
  const [editingFeeValue, setEditingFeeValue] = useState<string>("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unpaid" | "paid">("all");

  // ─── Filter by period ───────────────────────────────────────────
  const filtered = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return txs.filter((t) => {
      const d = new Date(t.date);
      // Date filter
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
      // Status filter
      if (statusFilter === "unpaid" && t.paidToTeam) return false;
      if (statusFilter === "paid" && !t.paidToTeam) return false;
      return true;
    });
  }, [txs, period, customFrom, customTo, statusFilter]);

  // ─── Computed per row ───────────────────────────────────────────
  const enriched = filtered.map((t) => {
    const net = t.gross - t.feePP;
    const commission = net * (COLLECTOR_PCT / 100);
    const totalAfterFee = net - commission;
    return { ...t, net, commission, totalAfterFee };
  });

  // ─── Hero totals (over filtered) ────────────────────────────────
  const totals = enriched.reduce(
    (acc, t) => {
      acc.received += t.gross;
      acc.fees += t.feePP;
      acc.net += t.net;
      acc.commissionEarned += t.commission;
      acc.totalAfterFee += t.totalAfterFee;
      acc.txCount += 1;
      if (t.paidToTeam) {
        acc.paidToTeam += t.totalAfterFee;
        acc.commissionRealized += t.commission;
        acc.paidCount += 1;
      } else {
        acc.owedToTeam += t.totalAfterFee;
        acc.commissionPending += t.commission;
        acc.unpaidCount += 1;
      }
      return acc;
    },
    { received: 0, fees: 0, net: 0, commissionEarned: 0, commissionRealized: 0, commissionPending: 0, totalAfterFee: 0, paidToTeam: 0, owedToTeam: 0, txCount: 0, paidCount: 0, unpaidCount: 0 }
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

  const markAsPaid = () => {
    const batchId = `batch-${Date.now()}`;
    const now = new Date().toISOString();
    setTxs((prev) =>
      prev.map((t) =>
        selectedIds.has(t.id) && !t.paidToTeam
          ? { ...t, paidToTeam: true, paidBatchId: batchId, paidAt: now }
          : t
      )
    );
    setSelectedIds(new Set());
  };

  const unmarkPaid = (id: string) => {
    setTxs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, paidToTeam: false, paidBatchId: null, paidAt: null } : t))
    );
  };

  const updateFee = (id: string, fee: number | null) => {
    setTxs((prev) => prev.map((t) => (t.id === id ? { ...t, feePP: fee ?? 0 } : t)));
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
            { key: "today", label: "Hôm nay" },
            { key: "week", label: "Tuần này" },
            { key: "month", label: "Tháng này" },
            { key: "all", label: "Tất cả" },
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

      {/* ─── Hero stats ─── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="text-center py-3 bg-green-50 rounded-lg">
            <div className="text-[10px] font-semibold text-green-600 uppercase mb-1">Nhận</div>
            <div className="text-xl font-bold text-green-700">{formatCurrency(totals.received)}</div>
            <div className="text-[10px] text-green-600 mt-0.5">{totals.txCount} giao dịch</div>
          </div>
          <div className="text-center py-3 bg-red-50 rounded-lg">
            <div className="text-[10px] font-semibold text-red-600 uppercase mb-1">Phí PP</div>
            <div className="text-xl font-bold text-red-700">-{formatCurrency(totals.fees)}</div>
            <div className="text-[10px] text-red-600 mt-0.5">PayPal fees</div>
          </div>
          <div className="text-center py-3 bg-purple-50 rounded-lg">
            <div className="text-[10px] font-semibold text-purple-600 uppercase mb-1">Commission {COLLECTOR_PCT}%</div>
            <div className="text-xl font-bold text-purple-700">{formatCurrency(totals.commissionEarned)}</div>
            <div className="text-[10px] text-purple-600 mt-0.5">của bạn</div>
          </div>
          <div className="text-center py-3 bg-emerald-50 rounded-lg">
            <div className="text-[10px] font-semibold text-emerald-600 uppercase mb-1">Đã trả team</div>
            <div className="text-xl font-bold text-emerald-700">{formatCurrency(totals.paidToTeam)}</div>
            <div className="text-[10px] text-emerald-600 mt-0.5">{totals.paidCount} giao dịch</div>
          </div>
          <div className="text-center py-3 bg-amber-50 rounded-lg">
            <div className="text-[10px] font-semibold text-amber-600 uppercase mb-1">Còn nợ team</div>
            <div className="text-xl font-bold text-amber-700">{formatCurrency(totals.owedToTeam)}</div>
            <div className="text-[10px] text-amber-600 mt-0.5">{totals.unpaidCount} giao dịch</div>
          </div>
          <div className="text-center py-3 bg-blue-50 rounded-lg">
            <div className="text-[10px] font-semibold text-blue-600 uppercase mb-1">Fund còn trong PP</div>
            <div className="text-xl font-bold text-blue-700">{formatCurrency(totals.owedToTeam + totals.commissionPending)}</div>
            <div className="text-[10px] text-blue-600 mt-0.5">chưa xử lý</div>
          </div>
        </div>

        {/* Commission detail */}
        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-3 text-xs">
          <div className="text-center">
            <div className="text-gray-500">Commission tổng earn</div>
            <div className="text-sm font-bold text-purple-700">{formatCurrency(totals.commissionEarned)}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-500">Đã có trong tay (paid)</div>
            <div className="text-sm font-bold text-green-700">{formatCurrency(totals.commissionRealized)}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-500">Pending (chưa xử lý)</div>
            <div className="text-sm font-bold text-amber-700">{formatCurrency(totals.commissionPending)}</div>
          </div>
        </div>
      </div>

      {/* ─── Status filter tabs ─── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex gap-1">
            {[
              { key: "all", label: `Tất cả (${enriched.length})` },
              { key: "unpaid", label: `Chưa trả team (${totals.unpaidCount})` },
              { key: "paid", label: `Đã trả team (${totals.paidCount})` },
            ].map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  statusFilter === s.key
                    ? "bg-blue-100 text-blue-700"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {totals.unpaidCount > 0 && statusFilter !== "paid" && (
            <button
              onClick={selectAllUnpaid}
              className="text-xs text-blue-600 hover:underline"
            >
              Chọn tất cả chưa trả
            </button>
          )}
        </div>

        {/* ─── Bulk action bar ─── */}
        {selectedIds.size > 0 && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span className="font-semibold text-emerald-800">
                Đã chọn {selectionTotals.count} giao dịch
              </span>
              <span className="text-gray-600">
                Tổng gross: <strong>{formatCurrency(selectionTotals.gross)}</strong>
              </span>
              <span className="text-emerald-700">
                Phải chuyển team: <strong>{formatCurrency(selectionTotals.totalAfterFee)}</strong>
              </span>
              <span className="text-purple-700">
                Commission: <strong>{formatCurrency(selectionTotals.commission)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs"
                onClick={markAsPaid}
              >
                ✓ Mark đã trả team ({formatCurrency(selectionTotals.totalAfterFee)})
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
                <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-600 whitespace-nowrap">Date</th>
                <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-600">Project</th>
                <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-600">PP Code</th>
                <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-600">PP Agent</th>
                <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-600">Transaction ID</th>
                <th className="px-2 py-2 text-right text-[11px] font-semibold text-green-700">Gross</th>
                <th className="px-2 py-2 text-right text-[11px] font-semibold text-red-600">Fee PP ({COLLECTOR_NAME} note)</th>
                <th className="px-2 py-2 text-right text-[11px] font-semibold text-gray-700">Net</th>
                <th className="px-2 py-2 text-right text-[11px] font-semibold text-purple-700 whitespace-nowrap">Fee {COLLECTOR_NAME} {COLLECTOR_PCT}%</th>
                <th className="px-2 py-2 text-right text-[11px] font-semibold text-emerald-700">Total After Fee</th>
                <th className="px-2 py-2 text-center text-[11px] font-semibold text-gray-600">Status</th>
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
                    className={`hover:bg-gray-50 ${t.paidToTeam ? "bg-emerald-50/30" : ""}`}
                  >
                    <td className="px-3 py-2 text-center">
                      {!t.paidToTeam ? (
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
                      ) : (
                        <button
                          onClick={() => {
                            setEditingFeeId(t.id);
                            setEditingFeeValue(String(t.feePP));
                          }}
                          className="text-red-600 hover:bg-blue-50 rounded px-1"
                          disabled={t.paidToTeam}
                        >
                          -{formatCurrency(t.feePP)}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-gray-700 whitespace-nowrap">{formatCurrency(t.net)}</td>
                    <td className="px-2 py-2 text-right font-mono font-semibold text-purple-700 whitespace-nowrap">{formatCurrency(t.commission)}</td>
                    <td className="px-2 py-2 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">{formatCurrency(t.totalAfterFee)}</td>
                    <td className="px-2 py-2 text-center">
                      {t.paidToTeam ? (
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
              <span>Total After Fee: <strong className="text-emerald-700">{formatCurrency(totals.totalAfterFee)}</strong></span>
            </span>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="bg-white rounded-lg border p-4 text-xs space-y-1">
        <div className="font-semibold text-gray-700 mb-2">Cách dùng demo:</div>
        <div>• Click tab <strong>Kỳ xem</strong> để filter theo thời gian (Hôm nay / Tuần / Tháng / Custom)</div>
        <div>• Click tab <strong>Chưa trả / Đã trả</strong> để lọc trạng thái</div>
        <div>• Tick checkbox nhiều row → bulk action bar hiện → click <strong>Mark đã trả team</strong></div>
        <div>• Click ô <strong>Fee PP</strong> để sửa phí (chỉ row chưa trả)</div>
        <div>• Click ô <strong>Note</strong> để thêm ghi chú</div>
        <div>• Click badge <strong>✓ Đã trả</strong> để unmark (quay lại trạng thái chờ)</div>
      </div>
    </div>
  );
}
