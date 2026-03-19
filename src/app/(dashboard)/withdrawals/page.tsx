"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import { exportToCSV } from "@/lib/excel-export";
import { ImportCSVDialog } from "@/components/forms/ImportCSVDialog";
import { useT } from "@/lib/i18n";
import toast from "react-hot-toast";

// Helper: get the holder of currently selected PPs
function getCurrentHolder(selected: Set<string>, pps: any[]): string | null {
  if (selected.size === 0) return null;
  const firstId = Array.from(selected)[0];
  const pp = pps.find((p: any) => p.id === firstId);
  return pp ? (pp.holder || "—") : null;
}

export default function WithdrawalsPage() {
  const t = useT();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const currentRole = useProjectStore((s) => s.currentRole);
  const isAdminOrMod = currentRole === "ADMIN" || currentRole === "MODERATOR";
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<"MIXING" | "EXCHANGE" | "">("");
  const [holderFilter, setHolderFilter] = useState("");
  const [showExchangeForm, setShowExchangeForm] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editingCodeValue, setEditingCodeValue] = useState("");
  const [showImport, setShowImport] = useState(false);

  // Panel selection
  const [pendingSelected, setPendingSelected] = useState<Set<string>>(new Set());
  const [accSelected, setAccSelected] = useState<Set<string>>(new Set());

  // Action form state
  const [actionMode, setActionMode] = useState<"merge" | "merge-acc" | "sell-pending" | "sell-acc" | null>(null);
  const [actionAmounts, setActionAmounts] = useState<Record<string, string>>({});
  const [frozenPPs, setFrozenPPs] = useState<any[]>([]); // Frozen snapshot when form opens
  const [actionTxId, setActionTxId] = useState("");
  const [actionDestId, setActionDestId] = useState("");
  const [actionAgentId, setActionAgentId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Queries
  const { data, isLoading, refetch } = trpc.withdrawal.list.useQuery(
    { projectId: projectId!, page, type: (typeFilter || undefined) as any },
    { enabled: !!projectId }
  );
  const { data: mixingStatus, refetch: refetchMixing } = trpc.withdrawal.mixingStatus.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const today = new Date().toISOString().slice(0, 10);
  const { data: todayFunds } = trpc.fund.confirmedByPaypal.useQuery(
    { projectId: projectId!, dateFrom: today, dateTo: today },
    { enabled: !!projectId }
  );
  const { data: masters } = trpc.paypal.masters.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const { data: agentEmails } = trpc.agentPP.agentList.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const { data: disputes, refetch: refetchDisputes } = trpc.withdrawal.disputes.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && isAdminOrMod }
  );
  const { data: mergeTargets, refetch: refetchMerge } = trpc.withdrawal.getMergeTargets.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const setMergeTarget = trpc.withdrawal.setMergeTarget.useMutation({ onSuccess: () => { refetchMerge(); } });

  const invalidateAll = () => { refetch(); refetchMixing(); refetchDisputes(); refetchMerge(); };

  const updateWithdrawal = trpc.withdrawal.update.useMutation({ onSuccess: invalidateAll });
  const deleteWithdrawal = trpc.withdrawal.delete.useMutation({ onSuccess: invalidateAll });
  const createWithdrawal = trpc.withdrawal.create.useMutation({ onSuccess: invalidateAll });
  const bulkMix = trpc.withdrawal.bulkMix.useMutation({ onSuccess: invalidateAll });
  const bulkImport = trpc.withdrawal.bulkImport.useMutation({ onSuccess: invalidateAll });
  const resolveDispute = trpc.withdrawal.resolveDispute.useMutation({ onSuccess: invalidateAll });

  const rawItems = data?.items ?? [];
  const items = holderFilter ? rawItems.filter((w: any) => (w.sourcePaypal?.holder || "—") === holderFilter) : rawItems;
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);
  const unmixed = [...(mixingStatus?.unmixed ?? [])].sort((a: any, b: any) => b.balance - a.balance);
  const accumulated = [...(mixingStatus?.accumulated ?? [])].sort((a: any, b: any) => b.balance - a.balance);

  // Build vmppCode lookup by holder from ALL PPs (unmixed + accumulated)
  const vmppByHolder: Record<string, string[]> = {};
  for (const pp of [...unmixed, ...accumulated]) {
    const holder = pp.holder || "—";
    const vmpp = pp.vmppCode;
    if (vmpp) {
      if (!vmppByHolder[holder]) vmppByHolder[holder] = [];
      if (!vmppByHolder[holder].includes(vmpp)) vmppByHolder[holder].push(vmpp);
    }
  }

  // Table selection
  const allSelected = items.length > 0 && items.every((i: any) => selected.has(i.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((i: any) => i.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  // Pending panel — restrict selection to same holder
  const togglePendingItem = (id: string) => {
    const clickedPP = unmixed.find((pp: any) => pp.id === id);
    const clickedHolder = clickedPP?.holder || "—";
    setPendingSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // If selecting a PP with different holder, clear previous selection
        const currentHolder = getCurrentHolder(prev, unmixed);
        if (currentHolder && currentHolder !== clickedHolder) {
          next.clear();
        }
        next.add(id);
      }
      return next;
    });
  };
  const togglePendingAllHolder = (holder: string) => {
    const holderPPs = unmixed.filter((pp: any) => (pp.holder || "—") === holder);
    const allHolderSelected = holderPPs.every((pp: any) => pendingSelected.has(pp.id));
    if (allHolderSelected) {
      setPendingSelected(new Set());
    } else {
      setPendingSelected(new Set(holderPPs.map((pp: any) => pp.id)));
    }
  };
  const selectedPPs = unmixed.filter((pp: any) => pendingSelected.has(pp.id));
  const pendingHolder = getCurrentHolder(pendingSelected, unmixed);

  // Accumulated panel — restrict selection to same holder
  const toggleAccItem = (id: string) => {
    const clickedPP = accumulated.find((pp: any) => pp.id === id);
    const clickedHolder = clickedPP?.holder || "—";
    setAccSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        const currentHolder = getCurrentHolder(prev, accumulated);
        if (currentHolder && currentHolder !== clickedHolder) {
          next.clear();
        }
        next.add(id);
      }
      return next;
    });
  };
  const toggleAccAllHolder = (holder: string) => {
    const holderPPs = accumulated.filter((pp: any) => (pp.holder || "—") === holder);
    const allHolderSelected = holderPPs.every((pp: any) => accSelected.has(pp.id));
    if (allHolderSelected) {
      setAccSelected(new Set());
    } else {
      setAccSelected(new Set(holderPPs.map((pp: any) => pp.id)));
    }
  };
  const selectedAccPPs = accumulated.filter((pp: any) => accSelected.has(pp.id));
  const accHolder = getCurrentHolder(accSelected, accumulated);

  // Options — Master PPs always available as destination; non-master PPs filtered by holder
  const activeHolder = pendingHolder || accHolder || null;
  const selectedIds = new Set([...Array.from(pendingSelected), ...Array.from(accSelected)]);
  const masterIds = new Set((masters ?? []).map((m: any) => m.id));
  const masterOptions = (masters ?? [])
    .map((pp: any) => ({ value: pp.id, label: `${pp.code} (Master)`, sub: pp.primaryEmail }));
  const allPPOptions = [
    ...masterOptions,
    ...[...unmixed, ...accumulated]
      .filter((pp: any) => !selectedIds.has(pp.id) && !masterIds.has(pp.id))
      .filter((pp: any) => !activeHolder || (pp.holder || "—") === activeHolder)
      .map((pp: any) => ({ value: pp.id, label: pp.code, sub: formatCurrency(pp.balance) })),
  ];
  const agentEmailOptions = (agentEmails ?? []).map((ae: any) => ({
    value: ae.id,
    label: `${ae.user?.name || ae.user?.username || "?"} — ${ae.email}`,
    sub: ae.label || undefined,
    userId: ae.userId,
  }));

  // Open action form — freeze PP snapshot so reactive changes don't affect it
  const openAction = (mode: "merge" | "merge-acc" | "sell-pending" | "sell-acc") => {
    const pps = (mode === "sell-acc" || mode === "merge-acc") ? selectedAccPPs : selectedPPs;
    const frozen = pps.map((pp: any) => ({ ...pp })); // Deep copy snapshot
    const amounts: Record<string, string> = {};
    frozen.forEach((pp: any) => { amounts[pp.id] = pp.balance.toFixed(2); });
    setFrozenPPs(frozen);
    setActionAmounts(amounts);
    setActionTxId("");
    setActionDestId("");
    setActionAgentId("");
    setActionMode(mode);
  };

  const closeAction = () => {
    setActionMode(null);
    setActionAmounts({});
    setFrozenPPs([]);
    setActionTxId("");
    setActionDestId("");
    setActionAgentId("");
  };

  // Submit merge — use FROZEN actionAmounts, NOT reactive selectedPPs
  const handleMerge = async () => {
    if (!projectId || !actionDestId || !actionTxId.trim()) return;
    setIsSubmitting(true);
    try {
      // Build sources strictly from actionAmounts keys (frozen at form open)
      const sources = Object.entries(actionAmounts)
        .map(([ppId, amountStr]) => ({ sourcePaypalId: ppId, amount: parseFloat(amountStr || "0") }))
        .filter((s) => s.amount > 0);
      if (sources.length === 0) {
        toast.error("Không có PP nào có số tiền > 0");
        setIsSubmitting(false);
        return;
      }
      const result = await bulkMix.mutateAsync({
        projectId, date: today, destPaypalId: actionDestId,
        withdrawCode: actionTxId.trim(),
        sources,
      });
      toast.success(`Gộp ${result.created} PP thành công`);
      if (actionMode === "merge-acc") setAccSelected(new Set());
      else setPendingSelected(new Set());
      closeAction();
    } catch (err: any) { toast.error(err.message); }
    setIsSubmitting(false);
  };

  // Submit sell — use FROZEN actionAmounts, NOT reactive selectedPPs
  const handleSell = async () => {
    if (!projectId || !actionAgentId || !actionTxId.trim()) return;
    setIsSubmitting(true);
    try {
      const agentEmail = (agentEmails ?? []).find((ae: any) => ae.id === actionAgentId);
      // Build from frozen actionAmounts keys only
      const entries = Object.entries(actionAmounts)
        .map(([ppId, amountStr]) => ({ ppId, amount: parseFloat(amountStr || "0") }))
        .filter((e) => e.amount > 0);
      if (entries.length === 0) {
        toast.error("Không có PP nào có số tiền > 0");
        setIsSubmitting(false);
        return;
      }
      for (const entry of entries) {
        await createWithdrawal.mutateAsync({
          projectId, date: today, amount: entry.amount,
          type: "EXCHANGE", sourcePaypalId: entry.ppId,
          agent: agentEmail?.user?.name || agentEmail?.user?.username || "Unknown",
          agentUserId: agentEmail?.userId,
          agentEmailId: agentEmail?.id,
          withdrawCode: actionTxId.trim(),
          mailConfirmed: false,
        });
      }
      toast.success(`Tạo ${entries.length} lệnh exchange`);
      if (actionMode === "sell-acc") setAccSelected(new Set());
      else setPendingSelected(new Set());
      closeAction();
    } catch (err: any) { toast.error(err.message); }
    setIsSubmitting(false);
  };

  const bulkDelete = async () => {
    if (!projectId || selected.size === 0) return;
    const deletable = Array.from(selected);
    if (deletable.length === 0) return;
    if (!window.confirm(`${t("delete")} ${deletable.length} ${t("wd_delete_confirm")}`)) return;
    let count = 0;
    for (const id of deletable) {
      try { await deleteWithdrawal.mutateAsync({ projectId, id }); count++; } catch {}
    }
    toast.success(`${count} ${t("deleted")}`);
    setSelected(new Set());
  };

  const toggleConfirm = (item: any) => {
    updateWithdrawal.mutate({ projectId: projectId!, id: item.id, mailConfirmed: !item.mailConfirmed });
  };
  const saveNote = (id: string) => {
    if (!projectId) return;
    updateWithdrawal.mutate({ projectId, id, notes: editingNoteValue || null });
    setEditingNote(null);
  };
  const saveCode = (id: string) => {
    if (!projectId) return;
    updateWithdrawal.mutate({ projectId, id, withdrawCode: editingCodeValue || null });
    setEditingCode(null);
  };

  const todayTotal = todayFunds?.reduce((s, g) => s + g.totalAmount, 0) ?? 0;
  // Use frozenPPs for form display — immune to reactive changes
  const isMergeAction = actionMode === "merge" || actionMode === "merge-acc";
  const actionTotal = frozenPPs.reduce((s, pp: any) => s + (parseFloat(actionAmounts[pp.id] || "0") || 0), 0);

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("wd_title")}</h1>
          <p className="text-sm text-gray-500">{t("wd_subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            if (!items.length) return;
            exportToCSV(items.map((w: any) => ({
              Date: formatDate(w.date), Type: w.type, "Source PP": w.sourcePaypal?.code ?? "",
              "Dest / Agent": w.type === "MIXING" ? w.destPaypal?.code ?? "" : w.agent ?? "",
              Amount: Number(w.amount), Code: w.withdrawCode ?? "",
              Confirmed: w.mailConfirmed ? "Yes" : "No",
            })), "withdrawals-export");
          }} disabled={!items.length}>{t("wd_export_csv")}</Button>
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>Import CSV</Button>
        </div>
      </div>

      {/* ═══ Disputes (Admin/Moderator) - top priority ═══ */}
      {isAdminOrMod && disputes && disputes.filter((d: any) => !d.disputeResolved).length > 0 && (
        <DisputePanel
          disputes={disputes.filter((d: any) => !d.disputeResolved)}
          onResolve={(id, action, note) => {
            resolveDispute.mutate({ projectId: projectId!, id, action, adminNote: note || undefined }, {
              onSuccess: () => toast.success(action === "OVERRIDE" ? "Đã xác nhận giao dịch" : "Đã hủy giao dịch"),
              onError: (err) => toast.error(err.message),
            });
          }}
          isLoading={resolveDispute.isLoading}
          t={t}
        />
      )}

      {/* Today's confirmed funds — always visible */}
      {(() => {
        const funds = todayFunds ?? [];
        // Group by server
        const serverGroups: Record<string, { serverCode: string; pps: typeof funds; total: number }> = {};
        for (const g of funds) {
          const srv = (g.transactions?.[0] as any)?.server?.code || "Khác";
          if (!serverGroups[srv]) serverGroups[srv] = { serverCode: srv, pps: [], total: 0 };
          serverGroups[srv].pps.push(g);
          serverGroups[srv].total += g.totalAmount;
        }
        const sortedServers = Object.values(serverGroups).sort((a, b) => b.total - a.total);
        return (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-green-900">{t("wd_today_revenue")}</h3>
              <span className="text-lg font-bold text-green-700">{formatCurrency(todayTotal)}</span>
            </div>
            {funds.length === 0 ? (
              <p className="text-xs text-green-600 mt-2">Chưa có giao dịch xác nhận hôm nay</p>
            ) : (
              <>
                {/* Server summary row */}
                <div className="flex flex-wrap gap-2 mt-3 mb-3">
                  {sortedServers.map((sg) => (
                    <div key={sg.serverCode} className="bg-white rounded-lg border border-green-200 px-3 py-1.5 flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-800">{sg.serverCode}</span>
                      <span className="text-sm font-bold text-green-700">{formatCurrency(sg.total)}</span>
                      <span className="text-[10px] text-gray-400">{sg.pps.length} PP</span>
                    </div>
                  ))}
                </div>
                {/* PP detail — collapsible */}
                <details className="group">
                  <summary className="text-[10px] text-green-700 font-medium cursor-pointer hover:text-green-900 select-none">
                    Chi tiết {funds.length} PP
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {sortedServers.map((sg) => (
                      <div key={sg.serverCode} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-bold text-green-800 uppercase w-16 shrink-0">{sg.serverCode}</span>
                        {sg.pps.map((g) => (
                          <span key={g.paypalId} className="bg-white rounded border px-1.5 py-0.5 text-[11px]">
                            <span className="font-medium">{g.paypalCode}</span>
                            <span className="text-green-700 ml-1">{formatCurrency(g.totalAmount)}</span>
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              </>
            )}
          </div>
        );
      })()}

      {/* ═══ PANEL 1: PP chờ gộp ═══ */}
      {/* Action buttons for pending PPs — above panel */}
      {pendingSelected.size > 0 && !actionMode && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-blue-800">
            {pendingSelected.size} PP &middot; {formatCurrency(selectedPPs.reduce((s: number, pp: any) => s + pp.balance, 0))}
          </span>
          <div className="flex-1" />
          <Button size="sm" onClick={() => openAction("merge")} className="bg-blue-600 hover:bg-blue-700">
            Gộp vào PP...
          </Button>
          <Button size="sm" variant="outline" onClick={() => openAction("sell-pending")}
            className="border-green-500 text-green-700 hover:bg-green-50">
            Bán trực tiếp...
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPendingSelected(new Set())}>{t("cancel")}</Button>
        </div>
      )}
      <PPPanel
        title={t("wd_pending_funds")}
        pps={unmixed}
        totalBalance={unmixed.reduce((s: number, pp: any) => s + pp.balance, 0)}
        selected={pendingSelected}
        onToggleAllHolder={togglePendingAllHolder}
        onToggleItem={togglePendingItem}
        dotColor="bg-amber-500"
        emptyText={t("wd_no_pending")}
        vmppByHolder={vmppByHolder}
        t={t}
        disabled={!!actionMode}
        mergeTargets={mergeTargets}
        onSetMergeTarget={(holder, paypalId) => {
          setMergeTarget.mutate({ projectId: projectId!, holder, paypalId });
        }}
      />

      {/* ═══ PANEL 2: PP đã gộp - chờ bán ═══ */}
      {accumulated.length > 0 && (
        <>
          {/* Action buttons for accumulated PPs — above panel */}
          {accSelected.size > 0 && !actionMode && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex flex-wrap items-center gap-3">
              <span className="text-sm font-bold text-green-800">
                {accSelected.size} PP &middot; {formatCurrency(selectedAccPPs.reduce((s: number, pp: any) => s + pp.balance, 0))}
              </span>
              <div className="flex-1" />
              <Button size="sm" onClick={() => openAction("merge-acc")} className="bg-blue-600 hover:bg-blue-700">
                Gộp vào PP...
              </Button>
              <Button size="sm" onClick={() => openAction("sell-acc")} className="bg-green-600 hover:bg-green-700">
                Bán trực tiếp...
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAccSelected(new Set())}>{t("cancel")}</Button>
            </div>
          )}
          <PPPanel
            title="PP đã gộp — Chờ bán trực tiếp"
            pps={accumulated}
            totalBalance={accumulated.reduce((s: number, pp: any) => s + pp.balance, 0)}
            selected={accSelected}
            onToggleAllHolder={toggleAccAllHolder}
            onToggleItem={toggleAccItem}
            dotColor="bg-blue-500"
            emptyText=""
            showIncoming
            vmppByHolder={vmppByHolder}
            t={t}
            disabled={!!actionMode}
            showCopyVmpp={false}
          />
        </>
      )}

      {/* ═══ ACTION DIALOG (popup) ═══ */}
      {actionMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeAction}>
          <div className={`relative w-full max-w-2xl mx-4 rounded-xl shadow-2xl overflow-hidden ${
            isMergeAction ? "bg-white border-2 border-blue-300" : "bg-white border-2 border-green-300"
          }`} onClick={(e) => e.stopPropagation()}>
            <div className={`px-5 py-3 flex items-center justify-between ${
              isMergeAction ? "bg-blue-50 border-b border-blue-200" : "bg-green-50 border-b border-green-200"
            }`}>
              <h3 className="text-sm font-bold">
                {isMergeAction ? "Gộp PP" : "Bán trực tiếp"} — {frozenPPs.length} PP
              </h3>
              <button onClick={closeAction} className="text-gray-400 hover:text-gray-600 text-lg font-bold">✕</button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* PP list with editable amounts */}
              <div className="bg-white rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">PP Code</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">User Win</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Số dư</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-36">Số tiền gửi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {frozenPPs.map((pp: any) => (
                      <tr key={pp.id}>
                        <td className="px-3 py-2 font-medium">{pp.code}
                          {pp.vmppCode && <span className="text-purple-600 text-[10px] ml-1">{pp.vmppCode}</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">{pp.holder || "—"}</td>
                        <td className="px-3 py-2 text-right text-xs text-gray-500">{formatCurrency(pp.balance)}</td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number" step="0.01" min="0" max={pp.balance}
                            value={actionAmounts[pp.id] || ""}
                            onChange={(e) => setActionAmounts(prev => ({ ...prev, [pp.id]: e.target.value }))}
                            className="h-7 text-sm text-right w-28 ml-auto"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right text-xs font-bold text-gray-700">Tổng:</td>
                      <td className="px-3 py-2 text-right font-bold text-sm">{formatCurrency(actionTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Dest / Agent + TX ID */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {isMergeAction ? (
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">PP đích</label>
                    <Combobox options={allPPOptions} value={actionDestId} onChange={setActionDestId} placeholder="Chọn PP đích..." />
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Đại lý</label>
                    <Combobox options={agentEmailOptions} value={actionAgentId} onChange={setActionAgentId} placeholder="Chọn đại lý..." />
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Transaction ID <span className="text-red-500">*</span></label>
                  <Input value={actionTxId} onChange={(e) => setActionTxId(e.target.value)}
                    placeholder="EX-083203U..." className="h-9" />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-gray-50 border-t flex items-center justify-between">
              <span className="text-sm text-gray-500">
                {frozenPPs.length} PP &middot; Tổng {formatCurrency(actionTotal)}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={closeAction}>{t("cancel")}</Button>
                {isMergeAction ? (
                  <Button size="sm" disabled={!actionDestId || !actionTxId.trim() || actionTotal <= 0 || isSubmitting}
                    onClick={handleMerge} className="bg-blue-600 hover:bg-blue-700">
                    {isSubmitting ? "Đang gộp..." : "Xác nhận gộp"}
                  </Button>
                ) : (
                  <Button size="sm" disabled={!actionAgentId || !actionTxId.trim() || actionTotal <= 0 || isSubmitting}
                    onClick={handleSell} className="bg-green-600 hover:bg-green-700">
                    {isSubmitting ? "Đang tạo..." : "Xác nhận bán"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-center gap-3">
          <span className="text-sm font-medium text-blue-800">{selected.size} {t("selected")}</span>
          <div className="flex gap-2 ml-auto">
            <Button size="sm" variant="outline" className="h-7 text-xs border-red-400 text-red-600 hover:bg-red-50" onClick={bulkDelete}>{t("wd_delete_selected")}</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>{t("clear")}</Button>
          </div>
        </div>
      )}

      {/* Type + User Win filter */}
      <div className="flex flex-wrap items-center gap-2">
        {(["", "MIXING", "EXCHANGE"] as const).map((ft) => (
          <Button key={ft} variant={typeFilter === ft ? "default" : "outline"} size="sm"
            onClick={() => { setTypeFilter(ft); setPage(1); }}>
            {ft === "" ? t("all") : ft === "MIXING" ? "PP Gộp" : "Bán trực tiếp"}
          </Button>
        ))}
        <span className="text-gray-300 mx-1">|</span>
        {/* User Win filter from unique holders in items */}
        {(() => {
          const holders = Array.from(new Set(rawItems.map((w: any) => w.sourcePaypal?.holder || "—").filter(Boolean)));
          holders.sort();
          return (
            <>
              <Button variant={holderFilter === "" ? "default" : "outline"} size="sm"
                onClick={() => { setHolderFilter(""); setPage(1); }}>
                All User Win
              </Button>
              {holders.map((h) => (
                <Button key={h} variant={holderFilter === h ? "default" : "outline"} size="sm"
                  onClick={() => { setHolderFilter(h); setPage(1); }}
                  className={holderFilter === h ? "" : "border-indigo-300 text-indigo-700 hover:bg-indigo-50"}>
                  {h}
                </Button>
              ))}
            </>
          );
        })()}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-2 py-2 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" /></th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_date")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Loại</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">User Win</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">PayPal Gửi</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">PayPal Nhận</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_amount")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Mã Giao Dịch</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_status")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_notes")}</th>
                <th className="px-3 py-2 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr><td colSpan={11} className="text-center py-8 text-gray-400">{t("loading")}</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-8 text-gray-400">{t("wd_no_withdrawals")}</td></tr>
              ) : (
                items.map((w: any) => {
                  const canDelete = true;
                  const userWin = w.sourcePaypal?.holder || "—";
                  return (
                    <tr key={w.id} className={`hover:bg-gray-50 group ${selected.has(w.id) ? "bg-blue-50" : w.agentDisputed ? "bg-red-50" : ""}`}>
                      <td className="px-2 py-2 text-center">
                        <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggleOne(w.id)} className="rounded" />
                      </td>
                      <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">{formatDate(w.date)}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={w.type === "MIXING" ? "border-blue-500 text-blue-700 text-xs" : "border-green-500 text-green-700 text-xs"}>
                          {w.type === "MIXING" ? "Gộp" : "Trực tiếp"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{userWin}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="group/src">
                          <span className="font-semibold text-xs text-purple-700">{w.sourcePaypal?.code ?? "—"}</span>
                          {(() => {
                            const emails = w.sourcePaypal?.emails ?? [];
                            const email = emails[0]?.email || w.sourcePaypal?.primaryEmail;
                            if (!email) return null;
                            return (
                              <div className="flex items-center gap-0.5 mt-0.5">
                                <span className="text-[10px] text-gray-500 truncate max-w-[130px]" title={emails.map((e: any) => e.email).join("\n") || email}>{email}</span>
                                <button onClick={() => { navigator.clipboard.writeText(email); toast.success("Copied!"); }}
                                  className="opacity-0 group-hover/src:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity shrink-0 p-0.5">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {w.type === "MIXING" ? (
                          <div className="group/dest">
                            <span className="text-blue-600 font-semibold">{w.destPaypal?.code ?? "—"}</span>
                            {(() => {
                              const emails = w.destPaypal?.emails ?? [];
                              const email = emails[0]?.email || w.destPaypal?.primaryEmail;
                              if (!email) return null;
                              return (
                                <div className="flex items-center gap-0.5 mt-0.5">
                                  <span className="text-[10px] text-gray-500 truncate max-w-[130px]" title={emails.map((e: any) => e.email).join("\n") || email}>{email}</span>
                                  <button onClick={() => { navigator.clipboard.writeText(email); toast.success("Copied!"); }}
                                    className="opacity-0 group-hover/dest:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity shrink-0 p-0.5">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <div>
                            <span className="text-green-600 font-medium">{w.agent ?? "—"}</span>
                            {w.agentEmail && (
                              <span className="text-gray-400 ml-1 text-[10px]">({w.agentEmail.email})</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2"><span className="font-semibold">{formatCurrency(w.amount)}</span></td>
                      {/* TX ID - editable */}
                      <td className="px-2 py-2">
                        {editingCode === w.id ? (
                          <input autoFocus className="w-full px-1 py-0.5 text-xs border rounded font-mono"
                            value={editingCodeValue} onChange={(e) => setEditingCodeValue(e.target.value)}
                            onBlur={() => saveCode(w.id)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveCode(w.id); if (e.key === "Escape") setEditingCode(null); }} />
                        ) : (
                          <span className="text-xs font-mono text-gray-500 cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded inline-block min-w-[50px]"
                            onClick={() => { setEditingCode(w.id); setEditingCodeValue(w.withdrawCode || ""); }}>
                            {w.withdrawCode || <span className="text-gray-300 italic">—</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {w.type === "MIXING" ? (
                          // MIXING: show "Đã gộp" always (internal operation, no mail confirm needed)
                          <Badge className="bg-blue-100 text-blue-800 text-xs">Đã gộp</Badge>
                        ) : w.agentDisputed ? (
                          <Badge className="bg-red-100 text-red-800 text-xs" title={w.disputeNote}>Khiếu nại</Badge>
                        ) : w.agentConfirmed ? (
                          <Badge className="bg-emerald-100 text-emerald-800 text-xs">Agent OK</Badge>
                        ) : (
                          <button onClick={() => toggleConfirm(w)} className="cursor-pointer">
                            {w.mailConfirmed ? (
                              <Badge className="bg-green-100 text-green-800 hover:bg-green-200 text-xs">{t("confirmed")}</Badge>
                            ) : (
                              <Badge variant="outline" className="border-yellow-500 text-yellow-700 hover:bg-yellow-50 text-xs">
                                {w.type === "EXCHANGE" ? "Chờ xác nhận" : t("wd_pending")}
                              </Badge>
                            )}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {editingNote === w.id ? (
                          <input autoFocus className="w-full px-1 py-0.5 text-xs border rounded"
                            value={editingNoteValue} onChange={(e) => setEditingNoteValue(e.target.value)}
                            onBlur={() => saveNote(w.id)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveNote(w.id); if (e.key === "Escape") setEditingNote(null); }} />
                        ) : (
                          <span className="text-xs text-gray-400 cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded inline-block min-w-[40px] max-w-[120px] truncate"
                            onClick={() => { setEditingNote(w.id); setEditingNoteValue(w.notes || ""); }}
                            title={w.notes || ""}>
                            {w.notes || <span className="text-gray-300 italic">—</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {canDelete ? (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { if (window.confirm(t("confirm_delete"))) deleteWithdrawal.mutate({ projectId: projectId!, id: w.id }); }}
                              className="p-1 rounded hover:bg-red-50 text-red-500" title={t("delete")}>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {total > 50 && (
          <div className="flex items-center justify-between px-4 py-2 border-t text-sm">
            <span className="text-gray-500">{(page - 1) * 50 + 1}-{Math.min(page * 50, total)} / {total}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-7 text-xs">{t("prev")}</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-7 text-xs">{t("next")}</Button>
            </div>
          </div>
        )}
      </div>

      {/* Exchange Form */}
      <ExchangeFormDialog open={showExchangeForm} onClose={() => setShowExchangeForm(false)}
        projectId={projectId!} masters={masters ?? []} agentEmails={agentEmails ?? []}
        onCreate={(data) => { createWithdrawal.mutate(data, { onSuccess: () => { setShowExchangeForm(false); toast.success(t("wd_exchange_created")); } }); }}
        isLoading={createWithdrawal.isLoading} />

      {/* Import CSV */}
      <ImportCSVDialog open={showImport} onClose={() => setShowImport(false)} title="Import Withdrawals"
        templateColumns={["Date", "Amount", "Type", "Agent", "Withdraw Code", "Mail Confirmed", "Source PayPal Code", "Dest PayPal Code", "Notes"]}
        onImport={async (rows) => {
          const items = rows.map((row) => ({
            date: row["Date"] || today, amount: parseFloat(row["Amount"]) || 0,
            type: (row["Type"]?.toUpperCase() === "EXCHANGE" ? "EXCHANGE" : "MIXING") as "MIXING" | "EXCHANGE",
            agent: row["Agent"] || undefined, withdrawCode: row["Withdraw Code"] || undefined,
            mailConfirmed: ["true", "yes", "1"].includes((row["Mail Confirmed"] || "").toLowerCase()),
            sourcePaypalCode: row["Source PayPal Code"] || "", destPaypalCode: row["Dest PayPal Code"] || undefined,
            notes: row["Notes"] || undefined,
          }));
          const result = await bulkImport.mutateAsync({ projectId: projectId!, items });
          toast.success(`Imported ${result.imported}, skipped ${result.skipped}`);
          setShowImport(false);
        }} />
    </div>
  );
}

// ═══ Reusable PP Card Panel — grouped by holder ═══
function PPPanel({ title, pps, totalBalance, selected, onToggleAllHolder, onToggleItem, dotColor, emptyText, showIncoming, vmppByHolder, t, disabled, showCopyVmpp = true, mergeTargets, onSetMergeTarget }: {
  title: string; pps: any[]; totalBalance: number; selected: Set<string>;
  onToggleAllHolder: (holder: string) => void; onToggleItem: (id: string) => void;
  dotColor: string; emptyText: string; showIncoming?: boolean;
  vmppByHolder: Record<string, string[]>;
  t: (k: string) => string;
  disabled?: boolean;
  showCopyVmpp?: boolean;
  mergeTargets?: Record<string, { paypalId: string; code: string; email: string; vmppCode: string | null }>;
  onSetMergeTarget?: (holder: string, paypalId: string | null) => void;
}) {
  // Group PPs by holder
  const grouped: Record<string, any[]> = {};
  for (const pp of pps) {
    const holder = pp.holder || "—";
    if (!grouped[holder]) grouped[holder] = [];
    grouped[holder].push(pp);
  }
  const holderKeys = Object.keys(grouped).sort((a, b) => {
    if (a === "—") return 1;
    if (b === "—") return -1;
    return a.localeCompare(b);
  });

  const copyVmppForHolder = (holder: string) => {
    const codes = vmppByHolder[holder];
    if (!codes || codes.length === 0) {
      toast.error(`Không có VMPP code cho ${holder}`);
      return;
    }
    navigator.clipboard.writeText(codes.join("\n"));
    toast.success(`Đã copy ${codes.length} VMPP code (${holder})`);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${pps.length > 0 ? `${dotColor} animate-pulse` : "bg-green-500"}`} />
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {pps.length > 0 && (
            <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
              {pps.length} PP &middot; {formatCurrency(totalBalance)}
            </span>
          )}
        </div>
      </div>
      {pps.length === 0 ? (
        emptyText ? (
          <div className="px-4 py-6 text-center">
            <span className="text-sm text-green-600 font-medium">{emptyText}</span>
          </div>
        ) : null
      ) : (
        <div className="p-3 space-y-3">
          {holderKeys.map((holder) => {
            const holderPPs = grouped[holder];
            const holderTotal = holderPPs.reduce((s: number, pp: any) => s + pp.balance, 0);
            const holderAllSelected = holderPPs.length > 0 && holderPPs.every((pp: any) => selected.has(pp.id));
            const hasVmpp = vmppByHolder[holder] && vmppByHolder[holder].length > 0;
            const currentMerge = mergeTargets?.[holder.toLowerCase().trim()];
            return (
              <div key={holder}>
                {/* User Win header */}
                <div className="flex items-center gap-2 mb-1.5 px-1">
                  <span className="text-xs font-extrabold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded uppercase">{holder}</span>
                  <span className="text-xs font-bold text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">
                    {holderPPs.length} PP &middot; {formatCurrency(holderTotal)}
                  </span>
                  <button
                    onClick={() => !disabled && onToggleAllHolder(holder)}
                    className={`text-[10px] font-medium ml-1 ${disabled ? "text-gray-400 cursor-not-allowed" : "text-blue-600 hover:text-blue-800"}`}
                    disabled={disabled}
                  >
                    {holderAllSelected ? t("deselect") : t("wd_select_all")}
                  </button>
                  {/* Mail gộp indicator */}
                  {currentMerge && (
                    <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                      <span>Mail gộp:</span>
                      <span className="font-bold">{currentMerge.code}</span>
                      <span className="text-emerald-500">{currentMerge.email}</span>
                    </span>
                  )}
                  <div className="flex-1" />
                  {showCopyVmpp && hasVmpp && (
                    <button
                      onClick={() => copyVmppForHolder(holder)}
                      className="text-[10px] font-medium text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200 transition-colors"
                      title={`Copy ${vmppByHolder[holder].length} VMPP code`}
                    >
                      Copy VMPP ({vmppByHolder[holder].length})
                    </button>
                  )}
                </div>
                {/* Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {holderPPs.map((pp: any) => {
                    const isSelected = selected.has(pp.id);
                    return (
                      <button key={pp.id} onClick={() => !disabled && onToggleItem(pp.id)}
                        disabled={disabled}
                        className={`relative flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all ${
                          disabled ? "opacity-60 cursor-not-allowed" :
                          currentMerge?.paypalId === pp.id ? "border-emerald-400 bg-emerald-50" :
                          isSelected ? "border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-200" : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                        }`}>
                        <div className={`absolute top-2 right-2 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                          isSelected ? "bg-blue-500 border-blue-500" : "border-gray-300"
                        }`}>
                          {isSelected && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="flex items-center gap-1 w-full">
                          <span className={`text-sm font-bold ${isSelected ? "text-blue-700" : "text-gray-800"}`}>{pp.code}</span>
                          {currentMerge?.paypalId === pp.id && (
                            <span className="text-[8px] font-bold text-emerald-700 bg-emerald-100 px-1 rounded">MAIL GOP</span>
                          )}
                        </div>
                        {pp.vmppCode && <span className="text-[10px] text-purple-600 font-medium">{pp.vmppCode}</span>}
                        {pp.primaryEmail && <span className="text-[9px] text-gray-400 break-all w-full">{pp.primaryEmail}</span>}
                        <span className={`text-lg font-bold mt-1 ${isSelected ? "text-blue-600" : "text-amber-600"}`}>
                          {formatCurrency(pp.balance)}
                        </span>
                        {showIncoming && pp.totalIncoming > 0 && (
                          <span className="text-[10px] text-blue-500">+{formatCurrency(pp.totalIncoming)} gộp</span>
                        )}
                        {onSetMergeTarget && currentMerge?.paypalId !== pp.id && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onSetMergeTarget(holder, pp.id); }}
                            className="text-[9px] text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 mt-1 transition-colors"
                          >
                            Chọn gộp
                          </button>
                        )}
                        {onSetMergeTarget && currentMerge?.paypalId === pp.id && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onSetMergeTarget(holder, null); }}
                            className="text-[9px] text-red-500 hover:text-red-700 hover:bg-red-50 px-1.5 py-0.5 rounded border border-red-200 mt-1 transition-colors"
                          >
                            Bỏ gộp
                          </button>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══ Exchange Form ═══
function ExchangeFormDialog({ open, onClose, projectId, masters, agentEmails, onCreate, isLoading }: {
  open: boolean; onClose: () => void; projectId: string; masters: any[]; agentEmails: any[];
  onCreate: (data: any) => void; isLoading: boolean;
}) {
  const t = useT();
  const [sourceId, setSourceId] = useState("");
  const [agentEmailId, setAgentEmailId] = useState("");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const masterOptions = masters.map((pp: any) => ({ value: pp.id, label: pp.code, sub: pp.primaryEmail }));
  const agentOptions = agentEmails.map((ae: any) => ({
    value: ae.id,
    label: `${ae.user?.name || ae.user?.username || "?"} — ${ae.email}`,
    sub: ae.label || undefined,
  }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceId || !agentEmailId || !amount || !code.trim()) return;
    const agentEmail = agentEmails.find((ae: any) => ae.id === agentEmailId);
    onCreate({
      projectId, date, amount: parseFloat(amount), type: "EXCHANGE" as const,
      sourcePaypalId: sourceId,
      agent: agentEmail?.user?.name || agentEmail?.user?.username || "Unknown",
      agentUserId: agentEmail?.userId,
      agentEmailId: agentEmail?.id,
      withdrawCode: code.trim(),
      mailConfirmed: false,
    });
    setSourceId(""); setAgentEmailId(""); setAmount(""); setCode("");
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">{t("wd_exchange_title")}</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">{t("wd_source_master")}</label>
            <Combobox options={masterOptions} value={sourceId} onChange={setSourceId} placeholder={t("wd_select_master")} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">{t("wd_agent")}</label>
            <Combobox options={agentOptions} value={agentEmailId} onChange={setAgentEmailId} placeholder="Chọn đại lý + PP email..." />
            {agentEmails.length === 0 && (
              <p className="text-[10px] text-amber-600 mt-1">Chưa có đại lý nào. Tạo user với module AGENT_PP và thêm PP email.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">{t("wd_amount")}</label>
              <Input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">{t("wd_date")}</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Transaction ID <span className="text-red-500">*</span></label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="EX-083203U" required />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" size="sm" disabled={isLoading || !sourceId || !agentEmailId || !amount || !code.trim()}>
              {isLoading ? t("wd_creating") : t("wd_create_exchange")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══ Dispute Panel (Admin/Moderator) ═══
function DisputePanel({ disputes, onResolve, isLoading, t }: {
  disputes: any[];
  onResolve: (id: string, action: "OVERRIDE" | "VOID", note?: string) => void;
  isLoading: boolean;
  t: (k: string) => string;
}) {
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveAction, setResolveAction] = useState<"OVERRIDE" | "VOID" | null>(null);
  const [adminNote, setAdminNote] = useState("");

  const handleResolve = () => {
    if (!resolveId || !resolveAction) return;
    onResolve(resolveId, resolveAction, adminNote);
    setResolveId(null);
    setResolveAction(null);
    setAdminNote("");
  };

  return (
    <div className="bg-red-50 rounded-xl border border-red-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-red-100 flex items-center gap-3">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
        <h3 className="text-sm font-semibold text-red-900">Khiếu nại từ Đại lý</h3>
        <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
          {disputes.length} chờ xử lý
        </span>
      </div>
      <div className="divide-y divide-red-100">
        {disputes.map((d: any) => (
          <div key={d.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-gray-800">
                  {d.agentUser?.name || d.agentUser?.username || d.agent || "?"}
                </span>
                <span className="text-xs text-gray-500">{d.agentEmail?.email || ""}</span>
                <Badge variant="outline" className="border-red-400 text-red-700 text-[10px]">
                  {d.sourcePaypal?.code} → {formatCurrency(d.amount)}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-red-700 bg-red-100 rounded px-2 py-1 inline-block">
                &ldquo;{d.disputeNote}&rdquo;
              </div>
              <div className="text-[10px] text-gray-400 mt-1">
                {formatDate(d.date)} &middot; TX: {d.withdrawCode || "—"}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {resolveId === d.id ? (
                <div className="flex flex-col gap-2">
                  <textarea autoFocus value={adminNote} onChange={(e) => setAdminNote(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2 text-xs" rows={2}
                    placeholder="Ghi chú xử lý (tùy chọn)..." />
                  <div className="flex gap-1.5">
                    <Button size="sm" disabled={isLoading} onClick={handleResolve}
                      className={resolveAction === "OVERRIDE" ? "bg-blue-600 hover:bg-blue-700 text-xs h-7" : "bg-red-600 hover:bg-red-700 text-xs h-7"}>
                      {isLoading ? "..." : resolveAction === "OVERRIDE" ? "Xác nhận đã gửi" : "Hủy giao dịch"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setResolveId(null); setResolveAction(null); setAdminNote(""); }}>
                      {t("cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="h-7 text-xs border-blue-500 text-blue-700"
                    onClick={() => { setResolveId(d.id); setResolveAction("OVERRIDE"); setAdminNote(""); }}>
                    Đã gửi đúng
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs border-red-400 text-red-600"
                    onClick={() => { setResolveId(d.id); setResolveAction("VOID"); setAdminNote(""); }}>
                    Hủy GD
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
