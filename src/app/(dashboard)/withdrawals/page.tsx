"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { exportToCSV } from "@/lib/excel-export";
import { ImportCSVDialog } from "@/components/forms/ImportCSVDialog";
import { useT } from "@/lib/i18n";
import toast from "react-hot-toast";

export default function WithdrawalsPage() {
  const t = useT();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<"MIXING" | "EXCHANGE" | "">("");
  const [showMixForm, setShowMixForm] = useState(false);
  const [showExchangeForm, setShowExchangeForm] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");
  const [showImport, setShowImport] = useState(false);

  // Withdrawal list
  const { data, isLoading, refetch } = trpc.withdrawal.list.useQuery(
    { projectId: projectId!, page, type: (typeFilter || undefined) as any },
    { enabled: !!projectId }
  );

  // Mixing status (unsold balance per PP)
  const { data: mixingStatus, refetch: refetchMixing } = trpc.withdrawal.mixingStatus.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  // Confirmed funds today (for quick view)
  const today = new Date().toISOString().slice(0, 10);
  const { data: todayFunds } = trpc.fund.confirmedByPaypal.useQuery(
    { projectId: projectId!, dateFrom: today, dateTo: today },
    { enabled: !!projectId }
  );

  const updateWithdrawal = trpc.withdrawal.update.useMutation({
    onSuccess: () => refetch(),
  });
  const deleteWithdrawal = trpc.withdrawal.delete.useMutation({
    onSuccess: () => refetch(),
  });
  const createWithdrawal = trpc.withdrawal.create.useMutation({
    onSuccess: () => { refetch(); refetchMixing(); },
  });
  const bulkImport = trpc.withdrawal.bulkImport.useMutation({
    onSuccess: () => { refetch(); refetchMixing(); },
  });

  const { data: masters } = trpc.paypal.masters.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  // Selection
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

  const bulkDelete = async () => {
    if (!projectId || selected.size === 0) return;
    if (!window.confirm(`${t("delete")} ${selected.size} ${t("wd_delete_confirm")}`)) return;
    let count = 0;
    const ids = Array.from(selected);
    for (const id of ids) {
      try { await deleteWithdrawal.mutateAsync({ projectId, id }); count++; } catch {}
    }
    toast.success(`${count} ${t("deleted")}`);
    setSelected(new Set());
    refetch();
  };

  const toggleConfirm = (item: any) => {
    updateWithdrawal.mutate({
      projectId: projectId!,
      id: item.id,
      mailConfirmed: !item.mailConfirmed,
    });
  };

  const saveNote = (itemId: string) => {
    if (!projectId) return;
    updateWithdrawal.mutate({ projectId, id: itemId, notes: editingNoteValue || null });
    setEditingNote(null);
  };

  const todayTotal = todayFunds?.reduce((s, g) => s + g.totalAmount, 0) ?? 0;

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
              Date: formatDateTime(w.date), Type: w.type, "Source PP": w.sourcePaypal?.code ?? "",
              "Dest / Agent": w.type === "MIXING" ? w.destPaypal?.code ?? "" : w.agent ?? "",
              Amount: Number(w.amount), Code: w.withdrawCode ?? "",
              Confirmed: w.mailConfirmed ? "Yes" : "No",
            })), "withdrawals-export");
          }} disabled={!items.length}>{t("wd_export_csv")}</Button>
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>Import CSV</Button>
          <Button size="sm" variant="default" onClick={() => setShowMixForm(true)}>{t("wd_mix")}</Button>
          <Button size="sm" variant="default" onClick={() => setShowExchangeForm(true)}>{t("wd_exchange")}</Button>
        </div>
      </div>

      {/* Today's confirmed funds summary */}
      {todayFunds && todayFunds.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-green-900">{t("wd_today_revenue")}</h3>
            <span className="text-lg font-bold text-green-700">{formatCurrency(todayTotal)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {todayFunds.map((g) => (
              <div key={g.paypalId} className="bg-white rounded border px-2 py-1 text-xs">
                <span className="font-medium">{g.paypalCode}</span>
                <span className="text-green-700 ml-1">{formatCurrency(g.totalAmount)}</span>
                <span className="text-gray-400 ml-1">({g.transactions.length}tx)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unsold PP balance (available for mixing) */}
      {mixingStatus && mixingStatus.unmixed.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-amber-900">{t("wd_unsold_balance")}</h3>
            <span className="text-lg font-bold text-amber-700">{formatCurrency(mixingStatus.totalUnmixed)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {mixingStatus.unmixed.map((pp) => (
              <div key={pp.id} className="bg-white rounded border px-2 py-1 text-xs flex items-center gap-1">
                <span className="font-medium">{pp.code}</span>
                <span className="text-amber-700">{formatCurrency(pp.unmixedBalance)}</span>
                <button
                  onClick={() => setShowMixForm(true)}
                  className="text-blue-600 hover:underline ml-1"
                >Mix</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-center gap-3">
          <span className="text-sm font-medium text-blue-800">{selected.size} {t("selected")}</span>
          <div className="flex gap-2 ml-auto">
            <Button size="sm" variant="outline" className="h-7 text-xs border-red-400 text-red-600 hover:bg-red-50" onClick={bulkDelete}>{t("wd_delete_selected")}</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>{t("clear")}</Button>
          </div>
        </div>
      )}

      {/* Type filter */}
      <div className="flex gap-2">
        {(["", "MIXING", "EXCHANGE"] as const).map((ft) => (
          <Button key={ft} variant={typeFilter === ft ? "default" : "outline"} size="sm"
            onClick={() => { setTypeFilter(ft); setPage(1); }}>
            {ft || t("all")}
          </Button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-2 py-2 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" /></th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_date")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_status")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("wd_source_pp")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("wd_dest_agent")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_amount")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("wd_code")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_status")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_notes")}</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr><td colSpan={10} className="text-center py-8 text-gray-400">{t("loading")}</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-8 text-gray-400">{t("wd_no_withdrawals")}</td></tr>
              ) : (
                items.map((w: any) => (
                  <tr key={w.id} className={`hover:bg-gray-50 group ${selected.has(w.id) ? "bg-blue-50" : ""}`}>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggleOne(w.id)} className="rounded" />
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">{formatDateTime(w.date)}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={w.type === "MIXING" ? "border-blue-500 text-blue-700 text-xs" : "border-green-500 text-green-700 text-xs"}>
                        {w.type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-medium text-xs">{w.sourcePaypal?.code ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{w.type === "MIXING" ? w.destPaypal?.code ?? "—" : w.agent ?? "—"}</td>
                    <td className="px-3 py-2"><span className="font-semibold">{formatCurrency(w.amount)}</span></td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-500">{w.withdrawCode || "—"}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => toggleConfirm(w)} className="cursor-pointer">
                        {w.mailConfirmed ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-200 text-xs">{t("confirmed")}</Badge>
                        ) : (
                          <Badge variant="outline" className="border-yellow-500 text-yellow-700 hover:bg-yellow-50 text-xs">{t("wd_pending")}</Badge>
                        )}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      {editingNote === w.id ? (
                        <input
                          autoFocus
                          className="w-full px-1 py-0.5 text-xs border rounded"
                          value={editingNoteValue}
                          onChange={(e) => setEditingNoteValue(e.target.value)}
                          onBlur={() => saveNote(w.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveNote(w.id); if (e.key === "Escape") setEditingNote(null); }}
                        />
                      ) : (
                        <span
                          className="text-xs text-gray-400 cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded inline-block min-w-[40px] max-w-[120px] truncate"
                          onClick={() => { setEditingNote(w.id); setEditingNoteValue(w.notes || ""); }}
                          title={w.notes || t("click_to_add")}
                        >
                          {w.notes || <span className="text-gray-300 italic">—</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { if (window.confirm(t("confirm_delete"))) deleteWithdrawal.mutate({ projectId: projectId!, id: w.id }); }}
                          className="p-1 rounded hover:bg-red-50 text-red-500" title={t("delete")}>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > 50 && (
          <div className="flex items-center justify-between px-4 py-2 border-t text-sm">
            <span className="text-gray-500">{(page - 1) * 50 + 1}-{Math.min(page * 50, total)} {t("of")} {total}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-7 text-xs">{t("prev")}</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-7 text-xs">{t("next")}</Button>
            </div>
          </div>
        )}
      </div>

      {/* Mix Form Dialog */}
      <MixFormDialog
        open={showMixForm}
        onClose={() => setShowMixForm(false)}
        projectId={projectId!}
        masters={masters ?? []}
        unmixed={mixingStatus?.unmixed ?? []}
        onCreate={(data) => {
          createWithdrawal.mutate(data, {
            onSuccess: () => {
              setShowMixForm(false);
              toast.success(t("wd_mix_created"));
            },
          });
        }}
        isLoading={createWithdrawal.isLoading}
      />

      {/* Exchange Form Dialog */}
      <ExchangeFormDialog
        open={showExchangeForm}
        onClose={() => setShowExchangeForm(false)}
        projectId={projectId!}
        masters={masters ?? []}
        onCreate={(data) => {
          createWithdrawal.mutate(data, {
            onSuccess: () => {
              setShowExchangeForm(false);
              toast.success(t("wd_exchange_created"));
            },
          });
        }}
        isLoading={createWithdrawal.isLoading}
      />

      {/* Import CSV Dialog */}
      <ImportCSVDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import Withdrawals"
        templateColumns={["Date", "Amount", "Type", "Agent", "Withdraw Code", "Mail Confirmed", "Source PayPal Code", "Dest PayPal Code", "Notes"]}
        onImport={async (rows) => {
          const items = rows.map((row) => ({
            date: row["Date"] || new Date().toISOString().split("T")[0],
            amount: parseFloat(row["Amount"]) || 0,
            type: (row["Type"]?.toUpperCase() === "EXCHANGE" ? "EXCHANGE" : "MIXING") as "MIXING" | "EXCHANGE",
            agent: row["Agent"] || undefined,
            withdrawCode: row["Withdraw Code"] || undefined,
            mailConfirmed: ["true", "yes", "1"].includes((row["Mail Confirmed"] || "").toLowerCase()),
            sourcePaypalCode: row["Source PayPal Code"] || "",
            destPaypalCode: row["Dest PayPal Code"] || undefined,
            notes: row["Notes"] || undefined,
          }));
          const result = await bulkImport.mutateAsync({ projectId: projectId!, items });
          toast.success(`Imported ${result.imported}, skipped ${result.skipped}`);
          setShowImport(false);
        }}
      />
    </div>
  );
}

// ═══ Mix Form ═══
function MixFormDialog({ open, onClose, projectId, masters, unmixed, onCreate, isLoading }: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  masters: any[];
  unmixed: any[];
  onCreate: (data: any) => void;
  isLoading: boolean;
}) {
  const t = useT();
  const [sourceId, setSourceId] = useState("");
  const [destId, setDestId] = useState("");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const sourceOptions = unmixed.map((pp: any) => ({
    value: pp.id,
    label: pp.code,
    sub: formatCurrency(pp.unmixedBalance),
  }));

  const destOptions = masters.map((pp: any) => ({
    value: pp.id,
    label: pp.code,
    sub: pp.primaryEmail,
  }));

  const selectedSource = unmixed.find((pp: any) => pp.id === sourceId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceId || !destId || !amount) return;
    onCreate({
      projectId,
      date,
      amount: parseFloat(amount),
      type: "MIXING" as const,
      sourcePaypalId: sourceId,
      destPaypalId: destId,
      withdrawCode: code || undefined,
      mailConfirmed: false,
    });
    setSourceId(""); setDestId(""); setAmount(""); setCode("");
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">{t("wd_mix_title")}</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">{t("wd_source_pp_label")}</label>
            <Combobox options={sourceOptions} value={sourceId} onChange={(v) => {
              setSourceId(v);
              const src = unmixed.find((pp: any) => pp.id === v);
              if (src) setAmount(String(src.unmixedBalance.toFixed(2)));
            }} placeholder={t("wd_select_source")} />
            {selectedSource && (
              <p className="text-xs text-amber-600 mt-1">{t("wd_available")}: {formatCurrency(selectedSource.unmixedBalance)}</p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">{t("wd_dest_master")}</label>
            <Combobox options={destOptions} value={destId} onChange={setDestId} placeholder={t("wd_select_master")} />
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
            <label className="text-xs font-medium text-gray-600">{t("wd_withdraw_code")}</label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="MIXING-083203U" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" size="sm" disabled={isLoading || !sourceId || !destId || !amount}>
              {isLoading ? t("wd_creating") : t("wd_create_mix")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══ Exchange Form ═══
function ExchangeFormDialog({ open, onClose, projectId, masters, onCreate, isLoading }: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  masters: any[];
  onCreate: (data: any) => void;
  isLoading: boolean;
}) {
  const t = useT();
  const [sourceId, setSourceId] = useState("");
  const [agent, setAgent] = useState("");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const masterOptions = masters.map((pp: any) => ({
    value: pp.id,
    label: pp.code,
    sub: pp.primaryEmail,
  }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceId || !agent || !amount) return;
    onCreate({
      projectId,
      date,
      amount: parseFloat(amount),
      type: "EXCHANGE" as const,
      sourcePaypalId: sourceId,
      agent,
      withdrawCode: code || undefined,
      mailConfirmed: false,
    });
    setSourceId(""); setAgent(""); setAmount(""); setCode("");
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
            <Input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="PP_VP, ACE, Marua, Direct..." required />
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
            <label className="text-xs font-medium text-gray-600">{t("wd_withdraw_code")}</label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="EX-083203U" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" size="sm" disabled={isLoading || !sourceId || !agent || !amount}>
              {isLoading ? t("wd_creating") : t("wd_create_exchange")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
