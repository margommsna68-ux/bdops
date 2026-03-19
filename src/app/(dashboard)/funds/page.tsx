"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PickerDialog, type PickerItem } from "@/components/ui/picker-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { trpcVanilla } from "@/lib/trpc-vanilla";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { exportToCSV, parseCSV } from "@/lib/excel-export";
import { useT } from "@/lib/i18n";
import toast from "react-hot-toast";

// ═══ Types ═══
interface QuickRow {
  id: string;
  date: string;
  serverId: string;
  vmId: string;
  paypalId: string;
  amount: string;
  transactionId: string;
  confirmed: boolean;
  company: string;
}

function getLocalDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Convert a "YYYY-MM-DD" date string to a full ISO timestamp preserving local time */
function dateToISO(dateStr: string): string {
  const now = new Date();
  const timePart = now.toTimeString().slice(0, 8); // "HH:MM:SS"
  return new Date(`${dateStr}T${timePart}`).toISOString();
}

function makeQuickRow(serverId = "", vmId = ""): QuickRow {
  return {
    id: crypto.randomUUID(),
    date: getLocalDate(),
    serverId, vmId, paypalId: "", amount: "",
    transactionId: "", confirmed: false, company: "Bright Data Ltd.",
  };
}

const DEFAULT_WIDTHS: Record<string, number> = {
  checkbox: 40, date: 160, server: 130, vm: 110, paypal: 180,
  amount: 110, txid: 150, status: 100, company: 120, notes: 140, actions: 60,
};

export default function FundsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [confirmed, setConfirmed] = useState<boolean | undefined>(undefined);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterServerId, setFilterServerId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const t = useT();

  // Inline editing
  const [editingTx, setEditingTx] = useState<string | null>(null);
  const [editingTxValue, setEditingTxValue] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");
  const [editingServer, setEditingServer] = useState<string | null>(null);

  // Picker dialogs for VM/PP
  const [vmPickerFor, setVmPickerFor] = useState<{ rowId: string; serverId: string; type: "data" | "quick" } | null>(null);
  const [ppPickerFor, setPpPickerFor] = useState<{ rowId: string; type: "data" | "quick" } | null>(null);
  // VM name cache for quick-add display
  const [vmNameCache, setVmNameCache] = useState<Record<string, string>>({});
  // PP selected email per row (rowId → email user chose in picker)
  const [ppSelectedEmail, setPpSelectedEmail] = useState<Record<string, string>>({});
  const [editingAmount, setEditingAmount] = useState<string | null>(null);
  const [editingAmountValue, setEditingAmountValue] = useState("");

  // Quick-add
  const [quickRows, setQuickRows] = useState<QuickRow[]>([]);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [showQuickAddPopup, setShowQuickAddPopup] = useState(false);
  const [qaServerId, setQaServerId] = useState("");
  const [qaVmId, setQaVmId] = useState("");
  const [qaCount, setQaCount] = useState("1");

  // Column resize
  const [colWidths, setColWidths] = useState<Record<string, number>>({ ...DEFAULT_WIDTHS });
  const resizingCol = useRef<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  const onResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    resizingCol.current = col;
    resizeStartX.current = e.clientX;
    resizeStartW.current = colWidths[col] ?? 100;
    const onMove = (ev: MouseEvent) => {
      if (!resizingCol.current) return;
      const newW = Math.max(40, resizeStartW.current + (ev.clientX - resizeStartX.current));
      setColWidths((prev) => ({ ...prev, [resizingCol.current!]: newW }));
    };
    const onUp = () => {
      resizingCol.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [colWidths]);

  // ═══ Queries ═══
  const utils = trpc.useUtils();
  const invalidateAll = () => {
    utils.fund.list.invalidate();
    utils.fund.todaySummary.invalidate();
    utils.fund.unconfirmed.invalidate();
    utils.fund.confirmedTotal.invalidate();
  };

  const { data: servers } = trpc.server.list.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );
  const { data: paypals } = trpc.paypal.list.useQuery(
    { projectId: projectId!, limit: 500 }, { enabled: !!projectId }
  );
  const { data, isLoading } = trpc.fund.list.useQuery({
    projectId: projectId!, page, limit: 50,
    search: search || undefined, confirmed,
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    serverId: filterServerId || undefined,
  }, { enabled: !!projectId });

  // Summaries
  const { data: todaySummary } = trpc.fund.todaySummary.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );
  const { data: confirmedTotal } = trpc.fund.confirmedTotal.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );

  const updateFund = trpc.fund.update.useMutation({ onSuccess: () => invalidateAll() });
  const deleteFund = trpc.fund.delete.useMutation({ onSuccess: () => invalidateAll() });
  const bulkConfirm = trpc.fund.bulkConfirm.useMutation({
    onSuccess: (r) => { toast.success(`${r.confirmed} confirmed`); setSelected(new Set()); invalidateAll(); },
  });
  const bulkImport = trpc.fund.bulkImport.useMutation();
  const { data: unconfirmedData } = trpc.fund.unconfirmed.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );

  // Quick add popup VMs
  const { data: qaVmsData } = trpc.vm.list.useQuery(
    { projectId: projectId!, serverId: qaServerId, limit: 200 },
    { enabled: !!projectId && !!qaServerId && showQuickAddPopup }
  );

  const { data: serverTotals } = trpc.fund.serverTotals.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );
  const serverTotalMap = new Map((serverTotals ?? []).map((s) => [s.serverId, s]));

  const unconfirmedCount = unconfirmedData?.length ?? 0;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const serverOptions = (servers ?? []).map((s: any) => ({ value: s.id, label: s.code, sub: s.ipAddress }));
  const ppOptions = (paypals?.items ?? []).map((pp: any) => {
    const firstEmail = pp.emails?.[0]?.email || pp.primaryEmail;
    return { value: pp.id, label: pp.code, sub: firstEmail, emails: (pp.emails ?? []).map((e: any) => e.email) as string[] };
  });
  // Map paypalId → emails array for data table display
  const ppEmailMap = new Map<string, string[]>();
  for (const pp of (paypals?.items ?? []) as any[]) {
    const emails = (pp.emails ?? []).map((e: any) => e.email as string);
    if (emails.length === 0 && pp.primaryEmail) emails.push(pp.primaryEmail);
    ppEmailMap.set(pp.id, emails);
  }
  const qaVmOptions = (qaVmsData?.items ?? []).map((vm: any) => ({ value: vm.id, label: vm.code }));

  // PP picker data with emails + last used (exclude LIMITED/SUSPENDED/CLOSED)
  const ppPickerData = (paypals?.items ?? [])
    .filter((pp: any) => !["LIMITED", "SUSPENDED", "CLOSED"].includes(pp.status))
    .map((pp: any) => ({
      id: pp.id,
      code: pp.code,
      status: pp.status,
      primaryEmail: pp.primaryEmail,
      emails: pp.emails ?? [],
      lastFundDate: pp.lastFundDate ? new Date(pp.lastFundDate) : null,
      holder: pp.holder,
      fundCount: pp._count?.fundsReceived ?? 0,
    }));

  // VM picker query (when picker is open)
  const vmPickerServerId = vmPickerFor?.serverId ?? "";
  const { data: vmPickerData } = trpc.vm.list.useQuery(
    { projectId: projectId!, serverId: vmPickerServerId, limit: 200 },
    { enabled: !!projectId && !!vmPickerServerId }
  );
  const vmPickerItems: PickerItem[] = (vmPickerData?.items ?? []).map((vm: any) => ({
    id: vm.id, label: vm.code, sub: vm.server?.code,
    badge: vm.status, badgeColor: vm.status === "OK" ? "bg-green-100 text-green-700" : vm.status === "ERROR" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600",
  }));

  // Today summary computed
  const todayCount = todaySummary?.count ?? 0;
  const todayTotal = todaySummary?.totalAmount ?? 0;
  const todayUnconfirmed = todaySummary?.funds?.filter((f: any) => !f.confirmed) ?? [];
  const todayUnconfirmedTotal = todayUnconfirmed.reduce((s: number, f: any) => s + Number(f.amount), 0);

  // ═══ Selection ═══
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

  // ═══ Bulk actions ═══
  const bulkConfirmSelected = () => {
    if (!projectId || selected.size === 0) return;
    const ids = Array.from(selected);
    const validIds = ids.filter((id) => {
      const item = items.find((i: any) => i.id === id);
      return item?.transactionId?.trim();
    });
    if (validIds.length === 0) { toast.error("All selected rows are missing TX ID"); return; }
    const skipped = ids.length - validIds.length;
    if (skipped > 0) toast(`${skipped} skipped (no TX ID)`);
    bulkConfirm.mutate({ projectId, ids: validIds });
  };
  const bulkUnconfirmSelected = async () => {
    if (!projectId || selected.size === 0) return;
    const ids = Array.from(selected);
    for (const id of ids) await updateFund.mutateAsync({ projectId, id, confirmed: false });
    toast.success(`${ids.length} unconfirmed`);
    setSelected(new Set()); invalidateAll();
  };
  const bulkDeleteSelected = async () => {
    if (!projectId || selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} transaction(s)?`)) return;
    const ids = Array.from(selected);
    let count = 0;
    for (const id of ids) { try { await deleteFund.mutateAsync({ projectId, id }); count++; } catch {} }
    toast.success(`${count} deleted`);
    setSelected(new Set()); invalidateAll();
  };

  // ═══ Inline edit ═══
  const toggleConfirm = (item: any) => {
    if (!item.confirmed && !item.transactionId?.trim()) {
      toast.error("TX ID is required before confirming"); return;
    }
    updateFund.mutate({ projectId: projectId!, id: item.id, confirmed: !item.confirmed });
  };
  const saveTxId = (id: string) => { if (projectId) { updateFund.mutate({ projectId, id, transactionId: editingTxValue }); setEditingTx(null); } };
  const saveNote = (id: string) => { if (projectId) { updateFund.mutate({ projectId, id, notes: editingNoteValue || null }); setEditingNote(null); } };
  const saveServer = (id: string, serverId: string) => { if (projectId) { updateFund.mutate({ projectId, id, serverId: serverId || null, vmId: null }); setEditingServer(null); } };
  const saveVm = (id: string, vmId: string) => { if (projectId) { updateFund.mutate({ projectId, id, vmId: vmId || null }); } };
  const savePp = (id: string, paypalId: string) => { if (projectId && paypalId) { updateFund.mutate({ projectId, id, paypalId }); } };
  const saveAmount = (id: string) => { if (projectId && editingAmountValue) { updateFund.mutate({ projectId, id, amount: parseFloat(editingAmountValue) }); setEditingAmount(null); } };

  // ═══ Quick-add: save logic in PARENT ═══
  const removeQuickRow = (id: string) => setQuickRows((prev) => prev.filter((r) => r.id !== id));
  const updateQuickRow = (id: string, updated: QuickRow) => {
    setQuickRows((prev) => prev.map((r) => r.id === id ? updated : r));
  };

  const saveQuickRow = async (rowId: string) => {
    const row = quickRows.find((r) => r.id === rowId);
    if (!row || !projectId) return;
    if (!row.paypalId) { toast.error("Select PayPal"); return; }
    if (!row.amount || parseFloat(row.amount) <= 0) { toast.error("Enter amount"); return; }
    if (savingIds.has(rowId)) return;

    setSavingIds((prev) => new Set(prev).add(rowId));
    try {
      const result = await trpcVanilla.fund.bulkCreate.mutate({
        projectId,
        items: [{
          date: dateToISO(row.date),
          amount: parseFloat(row.amount),
          transactionId: row.transactionId || "",
          paypalId: row.paypalId,
          serverId: row.serverId || undefined,
          vmId: row.vmId || undefined,
          confirmed: row.confirmed,
          company: row.company || "Bright Data Ltd.",
        }],
      });
      if (result.created > 0) {
        toast.success(t("saved"));
        setQuickRows((prev) => prev.filter((r) => r.id !== rowId));
        invalidateAll();
      } else {
        toast.error(result.errors[0] || t("save_failed"));
      }
    } catch (err: any) {
      toast.error(err.message || t("save_failed"));
    }
    setSavingIds((prev) => { const next = new Set(prev); next.delete(rowId); return next; });
  };

  const saveAllQuickRows = async () => {
    const valid = quickRows.filter((r) => r.paypalId && r.amount && parseFloat(r.amount) > 0);
    if (!valid.length) { toast.error("No rows ready"); return; }

    setSavingIds(new Set(valid.map((r) => r.id)));
    try {
      const result = await trpcVanilla.fund.bulkCreate.mutate({
        projectId: projectId!,
        items: valid.map((row) => ({
          date: dateToISO(row.date),
          amount: parseFloat(row.amount),
          transactionId: row.transactionId || "",
          paypalId: row.paypalId,
          serverId: row.serverId || undefined,
          vmId: row.vmId || undefined,
          confirmed: row.confirmed,
          company: row.company || "Bright Data Ltd.",
        })),
      });
      if (result.created > 0) {
        toast.success(`${result.created} ${t("saved")}!`);
        const validIds = new Set(valid.map((r) => r.id));
        setQuickRows((prev) => prev.filter((r) => !validIds.has(r.id)));
        invalidateAll();
      }
      if (result.errors.length > 0) {
        toast.error(result.errors[0]);
      }
    } catch (err: any) {
      toast.error(err.message || t("save_failed"));
    }
    setSavingIds(new Set());
  };

  const doQuickAdd = () => {
    const n = Math.min(Math.max(parseInt(qaCount) || 1, 1), 50);
    const newRows = Array.from({ length: n }, () => makeQuickRow(qaServerId, qaVmId));
    setQuickRows((prev) => [...newRows, ...prev]);
    setShowQuickAddPopup(false);
    setQaServerId(""); setQaVmId(""); setQaCount("1");
    toast.success(`${n} row${n > 1 ? "s" : ""} created`);
  };

  // CSV import
  const csvInputRef = useRef<HTMLInputElement>(null);
  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !projectId) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (!rows.length) { toast.error("No data"); return; }
    try {
      const items = rows.map((r) => ({
        date: String(r["Date"] || r["date"] || ""),
        amount: Number(r["Amount"] || r["amount"] || 0),
        transactionId: String(r["TX ID"] || r["transactionId"] || r["Transaction ID"] || ""),
        confirmed: String(r["Confirmed"] || r["confirmed"] || "").toLowerCase() === "yes",
        company: String(r["Company"] || r["company"] || "Bright Data Ltd."),
        notes: r["Notes"] || r["notes"] ? String(r["Notes"] || r["notes"]) : undefined,
        paypalCode: String(r["PayPal"] || r["paypal"] || r["PP Code"] || r["PP"] || ""),
        serverCode: r["Server"] || r["server"] ? String(r["Server"] || r["server"]) : undefined,
        vmCode: r["VM"] || r["vm"] ? String(r["VM"] || r["vm"]) : undefined,
      }));
      const result = await bulkImport.mutateAsync({ projectId, items });
      toast.success(`Imported: ${result.imported}, Skipped: ${result.skipped}`);
      invalidateAll();
    } catch (err: any) { toast.error(err.message); }
    e.target.value = "";
  };

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  const ResizeTh = ({ col, children }: { col: string; children: React.ReactNode }) => (
    <th className="relative px-2 py-2 text-left text-xs font-medium text-gray-500 select-none"
      style={{ width: colWidths[col], minWidth: 40 }}>
      {children}
      <div className="absolute right-[-4px] top-0 bottom-0 w-[9px] cursor-col-resize z-10 group/handle flex items-center justify-center"
        onMouseDown={(e) => onResizeStart(col, e)}>
        <div className="w-[3px] h-5 rounded-full bg-gray-200 group-hover/handle:bg-blue-500 group-active/handle:bg-blue-600 transition-colors" />
      </div>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("funds_title")}</h1>
          <p className="text-sm text-gray-500">{t("funds_subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
          <Button variant="outline" size="sm" onClick={() => csvInputRef.current?.click()}>{t("funds_import_csv")}</Button>
          <Button variant="outline" size="sm" onClick={() => {
            if (!items.length) return;
            exportToCSV(items.map((f: any) => ({
              Date: formatDate(f.date), Server: f.server?.code ?? "", VM: f.vm?.code ?? "",
              PayPal: f.paypal?.code ?? "", Amount: Number(f.amount), "TX ID": f.transactionId,
              Confirmed: f.confirmed ? "Yes" : "No", Company: f.company, Notes: f.notes ?? "",
            })), "funds-export");
          }} disabled={!items.length}>{t("funds_export_csv")}</Button>
          <Button size="sm" onClick={() => setShowQuickAddPopup(true)}>{t("funds_quick_add")}</Button>
        </div>
      </div>

      {/* Summary Dashboard */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-gray-100">
          {/* Today */}
          <div className="px-5 py-4 relative">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("funds_today_tx")}</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(Number(todayTotal))}</div>
            <div className="text-xs text-gray-500 mt-1">{todayCount} {t("dash_transactions")}</div>
          </div>

          {/* Today Unconfirmed */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full ${todayUnconfirmed.length > 0 ? "bg-yellow-500 animate-pulse" : "bg-gray-300"}`} />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("funds_unconfirmed_today")}</span>
            </div>
            <div className={`text-2xl font-bold ${todayUnconfirmed.length > 0 ? "text-yellow-600" : "text-gray-400"}`}>
              {todayUnconfirmed.length > 0 ? formatCurrency(Number(todayUnconfirmedTotal)) : "$0"}
            </div>
            <div className="text-xs text-gray-500 mt-1">{todayUnconfirmed.length} {t("funds_pending")}</div>
          </div>

          {/* All-time Unconfirmed */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full ${unconfirmedCount > 0 ? "bg-orange-500" : "bg-gray-300"}`} />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("funds_total_unconfirmed")}</span>
            </div>
            <div className={`text-2xl font-bold ${unconfirmedCount > 0 ? "text-orange-600" : "text-gray-400"}`}>
              {unconfirmedCount}
            </div>
            <div className="text-xs text-gray-500 mt-1">{t("dash_needs_review")}</div>
          </div>

          {/* Confirmed Total */}
          <div className="px-5 py-4 bg-gradient-to-br from-emerald-50 to-white">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-3.5 h-3.5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("funds_confirmed_total")}</span>
            </div>
            <div className="text-2xl font-bold text-emerald-700">
              {formatCurrency(Number(confirmedTotal?.amount ?? 0))}
            </div>
            <div className="text-xs text-emerald-600 mt-1">{confirmedTotal?.count ?? 0} {t("dash_transactions")}</div>
          </div>
        </div>
      </div>

      {/* Quick Add popup */}
      {showQuickAddPopup && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm text-blue-900">{t("funds_qa_title")}</span>
            <button onClick={() => setShowQuickAddPopup(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="w-48">
              <label className="text-xs text-gray-600 mb-1 block">{t("funds_qa_server")}</label>
              <Combobox options={serverOptions} value={qaServerId}
                onChange={(v) => { setQaServerId(v); setQaVmId(""); }} placeholder="Skip or select..." />
            </div>
            {qaServerId && (
              <div className="w-40">
                <label className="text-xs text-gray-600 mb-1 block">{t("funds_qa_vm")}</label>
                <Combobox options={qaVmOptions} value={qaVmId} onChange={setQaVmId} placeholder="All VMs" />
              </div>
            )}
            <div className="w-24">
              <label className="text-xs text-gray-600 mb-1 block">{t("funds_qa_rows")}</label>
              <Input type="number" min="1" max="50" value={qaCount}
                onChange={(e) => setQaCount(e.target.value)} className="h-9"
                onKeyDown={(e) => { if (e.key === "Enter") doQuickAdd(); }} />
            </div>
            <Button size="sm" onClick={doQuickAdd}>
              Create {qaCount || 1} row{(parseInt(qaCount) || 1) > 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-center gap-3">
          <span className="text-sm font-medium text-blue-800">{selected.size} {t("selected")}</span>
          <div className="flex gap-2 ml-auto">
            <Button size="sm" variant="outline" className="h-7 text-xs border-green-500 text-green-700 hover:bg-green-50" onClick={bulkConfirmSelected}>{t("confirm")}</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs border-yellow-500 text-yellow-700 hover:bg-yellow-50" onClick={bulkUnconfirmSelected}>{t("unconfirm")}</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs border-red-400 text-red-600 hover:bg-red-50" onClick={bulkDeleteSelected}>{t("delete")}</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>{t("deselect")}</Button>
          </div>
        </div>
      )}

      {/* Server Filter Cards */}
      <div className="bg-white rounded-lg border p-3">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {/* All servers card */}
          <button
            onClick={() => { setFilterServerId(""); setPage(1); }}
            className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
              !filterServerId
                ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
            </svg>
            All
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold">{servers?.length ?? 0}</span>
          </button>
          {/* Each server card */}
          {(servers ?? []).map((srv: any) => {
            const st = serverTotalMap.get(srv.id);
            return (
              <button
                key={srv.id}
                onClick={() => { setFilterServerId(srv.id === filterServerId ? "" : srv.id); setPage(1); }}
                className={`shrink-0 flex flex-col items-start px-3 py-2 rounded-lg border-2 text-left transition-all min-w-[130px] ${
                  filterServerId === srv.id
                    ? "border-blue-500 bg-blue-50 shadow-sm"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-2 w-full">
                  <span className={`text-sm font-bold ${filterServerId === srv.id ? "text-blue-700" : "text-gray-800"}`}>
                    {srv.code}
                  </span>
                  {st && <span className="text-[10px] text-gray-400 ml-auto">{st.count} GD</span>}
                </div>
                <span className={`text-xs font-semibold mt-0.5 ${st && st.total > 0 ? "text-green-600" : "text-gray-400"}`}>
                  {st ? formatCurrency(st.total) : "$0.00"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border p-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <Input placeholder="Search TX ID, PP code..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-8 h-8 text-sm" />
          </div>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-36 h-8 text-sm" />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-36 h-8 text-sm" />
          <div className="flex gap-1">
            {[
              { label: "Today", fn: () => { const d = getLocalDate(); setDateFrom(d); setDateTo(d); setPage(1); } },
              { label: "7d", fn: () => { const d = new Date(); d.setDate(d.getDate() - 7); setDateFrom(getLocalDate()); setDateTo(getLocalDate()); setPage(1); } },
              { label: "Month", fn: () => { const d = new Date(); setDateFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`); setDateTo(getLocalDate()); setPage(1); } },
              { label: "Clear", fn: () => { setDateFrom(""); setDateTo(""); setPage(1); } },
            ].map((p) => (
              <button key={p.label} onClick={p.fn} className="px-2 py-1 text-xs rounded border bg-gray-50 hover:bg-gray-100 text-gray-600">{p.label}</button>
            ))}
          </div>
          <select value={confirmed === undefined ? "" : String(confirmed)} onChange={(e) => { setConfirmed(e.target.value === "" ? undefined : e.target.value === "true"); setPage(1); }} className="px-2 py-1 border rounded text-sm h-8">
            <option value="">All</option>
            <option value="true">Confirmed</option>
            <option value="false">Unconfirmed</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm" style={{ tableLayout: "fixed", width: "100%", minWidth: Object.values(colWidths).reduce((a, b) => a + b, 0) }}>
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-2 py-2" style={{ width: colWidths.checkbox }}><input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" /></th>
                <ResizeTh col="date">{t("col_date")}</ResizeTh>
                <ResizeTh col="server">{t("col_server")}</ResizeTh>
                <ResizeTh col="vm">{t("col_vm")}</ResizeTh>
                <ResizeTh col="paypal">{t("col_paypal")}</ResizeTh>
                <ResizeTh col="amount">{t("col_amount")}</ResizeTh>
                <ResizeTh col="txid">{t("col_tx_id")}</ResizeTh>
                <ResizeTh col="status">{t("col_status")}</ResizeTh>
                <ResizeTh col="company">{t("col_company")}</ResizeTh>
                <ResizeTh col="notes">{t("col_notes")}</ResizeTh>
                <th className="px-2 py-2" style={{ width: colWidths.actions }}></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {/* Save All bar */}
              {quickRows.length > 0 && (
                <tr className="bg-green-100 border-b border-green-200">
                  <td colSpan={11} className="px-3 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-green-800">{quickRows.length} {t("new_rows")}</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-6 text-xs px-3 border-red-300 text-red-600 hover:bg-red-50"
                          onClick={() => setQuickRows([])}>{t("clear_all")}</Button>
                        <Button size="sm" className="h-6 text-xs px-4 bg-green-600 hover:bg-green-700"
                          onClick={saveAllQuickRows}>{t("save_all")}</Button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}

              {/* Quick-add rows */}
              {quickRows.map((row) => (
                <QuickAddRow
                  key={row.id}
                  row={row}
                  serverOptions={serverOptions}
                  ppOptions={ppOptions}
                  saving={savingIds.has(row.id)}
                  onChange={(updated) => updateQuickRow(row.id, updated)}
                  onSave={() => saveQuickRow(row.id)}
                  onRemove={() => removeQuickRow(row.id)}
                  onPickVm={() => row.serverId && setVmPickerFor({ rowId: row.id, serverId: row.serverId, type: "quick" })}
                  onPickPp={() => setPpPickerFor({ rowId: row.id, type: "quick" })}
                  vmName={vmNameCache[row.vmId] || ""}
                  selectedEmail={ppSelectedEmail[row.id]}
                />
              ))}

              {/* Data rows */}
              {isLoading ? (
                <tr><td colSpan={11} className="text-center py-8 text-gray-400">{t("loading")}</td></tr>
              ) : items.length === 0 && quickRows.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-8 text-gray-400">{t("funds_no_tx")}</td></tr>
              ) : (
                items.map((item: any) => (
                  <tr key={item.id} className={`hover:bg-gray-50 group ${selected.has(item.id) ? "bg-blue-50" : ""}`}>
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} className="rounded" />
                    </td>
                    <td className="px-2 py-1.5 text-gray-600 text-xs whitespace-nowrap overflow-hidden">{formatDateTime(item.date)}</td>

                    {/* Server */}
                    <td className="px-2 py-1.5 overflow-visible">
                      {editingServer === item.id ? (
                        <Combobox options={[{ value: "", label: "— None —" }, ...serverOptions]}
                          value={item.serverId ?? ""} onChange={(v) => saveServer(item.id, v)}
                          placeholder="Server" className="text-xs" />
                      ) : (
                        <span className="text-blue-700 font-medium text-xs cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded inline-block"
                          onClick={() => setEditingServer(item.id)}>
                          {item.server?.code ?? <span className="text-gray-300">—</span>}
                        </span>
                      )}
                    </td>

                    {/* VM */}
                    <td className="px-2 py-1.5 overflow-visible">
                      <span className="text-gray-700 text-xs cursor-pointer hover:bg-blue-50 hover:text-blue-700 px-1.5 py-0.5 rounded inline-flex items-center gap-1 border border-transparent hover:border-blue-200 transition-all"
                        onClick={() => item.serverId ? setVmPickerFor({ rowId: item.id, serverId: item.serverId, type: "data" }) : toast.error("Select server first")}>
                        {item.vm?.code ?? <span className="text-gray-300">—</span>}
                        <svg className="w-2.5 h-2.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" /></svg>
                      </span>
                    </td>

                    {/* PayPal */}
                    <td className="px-2 py-1 overflow-visible">
                      <div className="group/pp">
                        <span className="font-semibold text-xs cursor-pointer hover:bg-purple-50 hover:text-purple-700 px-1.5 py-0.5 rounded inline-flex items-center gap-1 border border-transparent hover:border-purple-200 transition-all text-purple-700"
                          onClick={() => setPpPickerFor({ rowId: item.id, type: "data" })}>
                          {item.paypal?.code ?? <span className="text-gray-300">—</span>}
                          <svg className="w-2.5 h-2.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" /></svg>
                        </span>
                        {(() => {
                          const selectedEmail = ppSelectedEmail[item.id];
                          const emails = ppEmailMap.get(item.paypalId ?? "") ?? [];
                          const displayEmail = selectedEmail || emails[0];
                          if (!displayEmail) return null;
                          return (
                            <div className="flex items-center gap-0.5 mt-0.5 pl-1">
                              <span className="text-[10px] text-gray-500 truncate max-w-[140px]" title={emails.join("\n")}>
                                {displayEmail}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(displayEmail); toast.success("Copied!"); }}
                                className="opacity-0 group-hover/pp:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity shrink-0 p-0.5"
                                title="Copy email">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </td>

                    {/* Amount */}
                    <td className="px-2 py-1.5 overflow-hidden">
                      {editingAmount === item.id ? (
                        <input autoFocus type="number" step="0.01" min="0.01"
                          className="w-full px-1 py-0.5 text-xs border rounded font-semibold"
                          value={editingAmountValue}
                          onChange={(e) => setEditingAmountValue(e.target.value)}
                          onBlur={() => saveAmount(item.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveAmount(item.id); if (e.key === "Escape") setEditingAmount(null); }} />
                      ) : (
                        <span className="font-semibold text-green-700 cursor-pointer hover:bg-green-50 px-1 py-0.5 rounded inline-block"
                          onClick={() => { setEditingAmount(item.id); setEditingAmountValue(String(Number(item.amount))); }}>
                          {formatCurrency(item.amount)}
                        </span>
                      )}
                    </td>

                    {/* TX ID */}
                    <td className="px-2 py-1.5 overflow-hidden">
                      {editingTx === item.id ? (
                        <input autoFocus className="w-full px-1 py-0.5 text-xs border rounded font-mono"
                          value={editingTxValue} onChange={(e) => setEditingTxValue(e.target.value)}
                          onBlur={() => saveTxId(item.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveTxId(item.id); if (e.key === "Escape") setEditingTx(null); }} />
                      ) : (
                        <span className="text-xs font-mono text-gray-500 cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded inline-block min-w-[60px]"
                          onClick={() => { setEditingTx(item.id); setEditingTxValue(item.transactionId || ""); }}>
                          {item.transactionId || <span className="text-gray-300 italic">click to add</span>}
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-2 py-1.5">
                      <button onClick={() => toggleConfirm(item)} className="cursor-pointer">
                        {item.confirmed
                          ? <Badge className="bg-green-100 text-green-800 hover:bg-green-200 text-xs">{t("confirmed")}</Badge>
                          : <Badge variant="outline" className="border-yellow-500 text-yellow-700 hover:bg-yellow-50 text-xs">{t("unconfirmed")}</Badge>}
                      </button>
                    </td>

                    {/* Company */}
                    <td className="px-2 py-1.5 text-gray-500 text-xs overflow-hidden truncate">{item.company}</td>

                    {/* Notes */}
                    <td className="px-2 py-1.5 overflow-hidden">
                      {editingNote === item.id ? (
                        <input autoFocus className="w-full px-1 py-0.5 text-xs border rounded"
                          value={editingNoteValue} onChange={(e) => setEditingNoteValue(e.target.value)}
                          onBlur={() => saveNote(item.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveNote(item.id); if (e.key === "Escape") setEditingNote(null); }} />
                      ) : (
                        <span className="text-xs text-gray-400 cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded inline-block min-w-[40px] max-w-[120px] truncate"
                          onClick={() => { setEditingNote(item.id); setEditingNoteValue(item.notes || ""); }}
                          title={item.notes || "Click to add note"}>
                          {item.notes || <span className="text-gray-300 italic">—</span>}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-2 py-1.5 text-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { if (window.confirm("Delete?")) deleteFund.mutate({ projectId: projectId!, id: item.id }); }}
                          className="p-1 rounded hover:bg-red-50 text-red-500" title="Delete">
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
            <span className="text-gray-500">{(page - 1) * 50 + 1}-{Math.min(page * 50, total)} of {total}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-7 text-xs">{t("prev")}</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-7 text-xs">{t("next")}</Button>
            </div>
          </div>
        )}
      </div>

      {/* Page Summary */}
      {items.length > 0 && (
        <div className="bg-gray-50 rounded-lg border px-4 py-2 flex gap-6 text-sm">
          <span className="text-gray-500">{t("funds_page_total")}: <span className="font-semibold text-green-700">{formatCurrency(items.reduce((s: number, f: any) => s + Number(f.amount), 0))}</span></span>
          <span className="text-gray-500">{items.length} {t("rows")}</span>
          {data?.total !== undefined && data.total > items.length && <span className="text-gray-500">{t("total")}: {data.total}</span>}
        </div>
      )}

      {/* VM Picker Dialog - single for data rows */}
      {vmPickerFor?.type === "data" && (
        <PickerDialog
          open={true}
          onClose={() => setVmPickerFor(null)}
          title="Select VM"
          items={vmPickerItems}
          columns={5}
          allowClear
          selectedId={items.find((i: any) => i.id === vmPickerFor.rowId)?.vmId ?? ""}
          onSelect={(vmId) => {
            if (vmId) {
              const item = vmPickerItems.find((v) => v.id === vmId);
              if (item) setVmNameCache((prev) => ({ ...prev, [vmId]: item.label }));
            }
            saveVm(vmPickerFor.rowId, vmId);
            setVmPickerFor(null);
          }}
        />
      )}

      {/* VM Picker Dialog - MULTI for quick-add rows */}
      {vmPickerFor?.type === "quick" && (() => {
        // Count how many quick rows share same server and need VM
        const sameServerRows = quickRows.filter((r) => r.serverId === vmPickerFor.serverId && !r.vmId);
        const maxVms = sameServerRows.length || 1;
        return (
          <PickerDialog
            open={true}
            multi
            onClose={() => setVmPickerFor(null)}
            title={`Select VMs (${maxVms} rows need VM)`}
            items={vmPickerItems}
            columns={5}
            maxSelect={maxVms}
            selectedIds={[]}
            onSelectMulti={(vmIds) => {
              // Auto-distribute VMs to empty quick rows with same server
              const rowsToFill = quickRows.filter((r) => r.serverId === vmPickerFor.serverId && !r.vmId);
              const updates: Record<string, string> = {};
              for (let i = 0; i < Math.min(vmIds.length, rowsToFill.length); i++) {
                updates[rowsToFill[i].id] = vmIds[i];
              }
              // Cache VM names
              const newCache: Record<string, string> = {};
              for (const vmId of vmIds) {
                const item = vmPickerItems.find((v) => v.id === vmId);
                if (item) newCache[vmId] = item.label;
              }
              setVmNameCache((prev) => ({ ...prev, ...newCache }));
              // Update rows
              setQuickRows((prev) =>
                prev.map((r) => updates[r.id] ? { ...r, vmId: updates[r.id] } : r)
              );
              setVmPickerFor(null);
            }}
          />
        );
      })()}

      {/* PP Picker Dialog */}
      <PPPickerDialog
        open={!!ppPickerFor}
        onClose={() => setPpPickerFor(null)}
        items={ppPickerData}
        selectedId={ppPickerFor?.type === "data" ? (items.find((i: any) => i.id === ppPickerFor?.rowId)?.paypalId ?? "") : ""}
        onSelect={(ppId, email) => {
          if (!ppPickerFor || !ppId) return;
          if (ppPickerFor.type === "data") {
            savePp(ppPickerFor.rowId, ppId);
          } else {
            const row = quickRows.find((r) => r.id === ppPickerFor.rowId);
            if (row) updateQuickRow(row.id, { ...row, paypalId: ppId });
          }
          if (email) setPpSelectedEmail((prev) => ({ ...prev, [ppPickerFor.rowId]: email }));
          setPpPickerFor(null);
        }}
      />
    </div>
  );
}

// ═══ Quick-Add Row (display only, save in parent) ═══
function QuickAddRow({ row, serverOptions, ppOptions, saving, onChange, onSave, onRemove, onPickVm, onPickPp, vmName, selectedEmail }: {
  row: QuickRow;
  serverOptions: { value: string; label: string; sub?: string; emails?: string[] }[];
  ppOptions: { value: string; label: string; sub?: string; emails?: string[] }[];
  saving: boolean;
  selectedEmail?: string;
  onChange: (row: QuickRow) => void;
  onSave: () => void;
  onRemove: () => void;
  onPickVm?: () => void;
  onPickPp?: () => void;
  vmName?: string;
}) {
  return (
    <tr className="bg-green-50 border-b border-green-100">
      <td className="px-2 py-1.5 text-center">
        <button onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs font-bold">&times;</button>
      </td>
      <td className="px-1 py-1">
        <input type="date" value={row.date} onChange={(e) => onChange({ ...row, date: e.target.value })}
          className="w-full px-1 py-0.5 text-xs border rounded" />
      </td>
      <td className="px-1 py-1 overflow-visible">
        <Combobox options={serverOptions} value={row.serverId}
          onChange={(v) => onChange({ ...row, serverId: v, vmId: "" })}
          placeholder="Server" className="text-xs" />
      </td>
      <td className="px-1 py-1">
        <button
          onClick={() => row.serverId ? onPickVm?.() : toast.error("Select server first")}
          className={`w-full text-left px-1.5 py-1 text-xs border rounded transition-colors ${row.vmId ? "bg-blue-50 border-blue-200 text-blue-700 font-medium" : "bg-white border-gray-200 text-gray-400 hover:border-blue-300"}`}
        >
          {row.vmId ? (vmName || row.vmId.slice(0, 8)) : "Pick VM..."}
        </button>
      </td>
      <td className="px-1 py-1">
        <div className="group/pp">
          <button
            onClick={() => onPickPp?.()}
            className={`text-left px-1.5 py-0.5 text-xs border rounded transition-colors ${row.paypalId ? "bg-purple-50 border-purple-200 text-purple-700 font-semibold" : "bg-white border-gray-200 text-gray-400 hover:border-purple-300"}`}
          >
            {row.paypalId ? ppOptions.find(p => p.value === row.paypalId)?.label || "PP" : "Pick PP..."}
          </button>
          {row.paypalId && (() => {
            const pp = ppOptions.find(p => p.value === row.paypalId);
            const displayEmail = selectedEmail || pp?.sub;
            if (!displayEmail) return null;
            return (
              <div className="flex items-center gap-0.5 mt-0.5 pl-0.5">
                <span className="text-[10px] text-gray-500 truncate max-w-[120px]" title={pp?.emails?.join("\n") || displayEmail}>{displayEmail}</span>
                <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(displayEmail); toast.success("Copied!"); }}
                  className="opacity-0 group-hover/pp:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity shrink-0 p-0.5" title="Copy email">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                </button>
              </div>
            );
          })()}
        </div>
      </td>
      <td className="px-1 py-1">
        <input type="number" step="0.01" min="0" value={row.amount}
          onChange={(e) => onChange({ ...row, amount: e.target.value })}
          placeholder="$" className="w-full px-1 py-0.5 text-xs border rounded" />
      </td>
      <td className="px-1 py-1">
        <input value={row.transactionId}
          onChange={(e) => onChange({ ...row, transactionId: e.target.value })}
          placeholder="TX ID (optional)" className="w-full px-1 py-0.5 text-xs border rounded font-mono" />
      </td>
      <td className="px-1 py-1">
        <button onClick={() => {
          if (!row.confirmed && !row.transactionId?.trim()) {
            toast.error("TX ID required to confirm"); return;
          }
          onChange({ ...row, confirmed: !row.confirmed });
        }}>
          {row.confirmed
            ? <Badge className="bg-green-100 text-green-800 text-xs">Confirmed</Badge>
            : <Badge variant="outline" className="border-gray-300 text-gray-500 text-xs">—</Badge>}
        </button>
      </td>
      <td className="px-1 py-1">
        <input value={row.company} onChange={(e) => onChange({ ...row, company: e.target.value })}
          className="w-full px-1 py-0.5 text-xs border rounded" />
      </td>
      <td colSpan={2} className="px-1 py-1 text-center">
        <Button size="sm" className="h-6 text-xs px-3" onClick={onSave}
          disabled={saving || !row.paypalId || !row.amount}>
          {saving ? "..." : "Save"}
        </Button>
      </td>
    </tr>
  );
}

// ═══ PP Picker Dialog — list layout with emails, status, last used ═══
interface PPPickerItem {
  id: string;
  code: string;
  status: string;
  primaryEmail: string | null;
  emails: { id: string; email: string; isPrimary: boolean }[];
  lastFundDate: Date | null;
  holder: string | null;
  fundCount: number;
}

type PPSort = "balanced" | "last_used_asc" | "fund_count_asc";

function formatDaysAgo(date: Date | null): { text: string; color: string } {
  if (!date) return { text: "Chưa dùng", color: "text-gray-400" };
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return { text: "Hôm nay", color: "text-green-600" };
  if (diff === 1) return { text: "Hôm qua", color: "text-blue-600" };
  if (diff <= 7) return { text: `${diff} ngày trước`, color: "text-orange-600" };
  if (diff <= 30) return { text: `${diff} ngày trước`, color: "text-red-500" };
  return { text: `${diff} ngày trước`, color: "text-red-700 font-bold" };
}

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  LIMITED: "bg-red-100 text-red-700",
  SUSPENDED: "bg-orange-100 text-orange-700",
  CLOSED: "bg-gray-100 text-gray-500",
  PENDING_VERIFY: "bg-yellow-100 text-yellow-700",
};

function PPPickerDialog({ open, onClose, items, selectedId, onSelect }: {
  open: boolean;
  onClose: () => void;
  items: PPPickerItem[];
  selectedId: string;
  onSelect: (id: string, email: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<PPSort>("balanced");

  const filtered = items.filter((pp) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return pp.code.toLowerCase().includes(q)
      || pp.primaryEmail?.toLowerCase().includes(q)
      || pp.emails.some((e) => e.email.toLowerCase().includes(q))
      || pp.holder?.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "balanced") {
      // Score = days since last used + penalty for high fund count
      // Higher score = should be used first (top)
      const now = Date.now();
      const daysA = a.lastFundDate ? Math.floor((now - new Date(a.lastFundDate).getTime()) / 86400000) : 999;
      const daysB = b.lastFundDate ? Math.floor((now - new Date(b.lastFundDate).getTime()) / 86400000) : 999;
      const scoreA = daysA * 2 - a.fundCount;
      const scoreB = daysB * 2 - b.fundCount;
      return scoreB - scoreA || a.code.localeCompare(b.code);
    }
    if (sort === "last_used_asc") {
      if (!a.lastFundDate && !b.lastFundDate) return a.code.localeCompare(b.code);
      if (!a.lastFundDate) return -1;
      if (!b.lastFundDate) return 1;
      return new Date(a.lastFundDate).getTime() - new Date(b.lastFundDate).getTime();
    }
    if (sort === "fund_count_asc") {
      return (a.fundCount - b.fundCount) || a.code.localeCompare(b.code);
    }
    return a.code.localeCompare(b.code);
  });

  const handleSelect = (id: string, email: string) => {
    onSelect(id, email);
    setSearch("");
  };

  const handleClose = () => {
    setSearch("");
    onClose();
  };

  const copyEmail = (email: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(email);
    toast.success(`Copied: ${email}`);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Chọn PayPal — <span className="text-purple-600">chọn đúng email muốn nhận tiền</span></DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Input placeholder="Tìm PP code, email, holder..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" autoFocus />
          </div>
          <span className="text-xs text-gray-400 whitespace-nowrap">{sorted.length} PP</span>
        </div>

        {/* Sort buttons */}
        <div className="flex gap-1.5 items-center">
          <span className="text-xs text-gray-400">Sắp xếp:</span>
          {([
            ["balanced", "Cân bằng"],
            ["last_used_asc", "Lâu chưa dùng"],
            ["fund_count_asc", "Ít lần nhận"],
          ] as const).map(([key, label]) => (
            <button key={key}
              onClick={() => setSort(key)}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                sort === key ? "bg-blue-100 border-blue-300 text-blue-700 font-medium" : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto -mx-2 space-y-1">
          {sorted.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">Không tìm thấy</div>
          )}
          {sorted.map((pp) => {
            const isSelected = pp.id === selectedId;
            const daysAgo = formatDaysAgo(pp.lastFundDate);
            const allEmails = pp.emails.length > 0 ? pp.emails : (pp.primaryEmail ? [{ id: "primary", email: pp.primaryEmail, isPrimary: true }] : []);

            return (
              <div key={pp.id}
                className={`px-3 py-2.5 rounded-lg border-2 transition-all hover:shadow-sm ${
                  isSelected
                    ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200"
                    : "border-transparent hover:border-gray-200 hover:bg-gray-50"
                }`}>
                {/* Header row */}
                <div className="flex items-center gap-3">
                  {/* PP Code */}
                  <span className={`text-sm font-bold min-w-[60px] ${isSelected ? "text-blue-700" : "text-gray-900"}`}>
                    {pp.code}
                  </span>

                  {/* Status badge */}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${statusColors[pp.status] || "bg-gray-100 text-gray-600"}`}>
                    {pp.status}
                  </span>

                  {/* Holder */}
                  {pp.holder && (
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                      {pp.holder}
                    </span>
                  )}

                  {/* Fund count */}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                    pp.fundCount === 0 ? "bg-red-50 text-red-600" :
                    pp.fundCount <= 5 ? "bg-orange-50 text-orange-600" :
                    pp.fundCount <= 20 ? "bg-blue-50 text-blue-600" :
                    "bg-green-50 text-green-700"
                  }`}>
                    {pp.fundCount} lần dùng
                  </span>

                  <div className="flex-1" />

                  {/* Last used */}
                  <span className={`text-xs whitespace-nowrap ${daysAgo.color}`}>
                    {daysAgo.text}
                  </span>
                </div>

                {/* Emails - click email to select */}
                {allEmails.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {allEmails.map((em) => (
                      <span key={em.id}
                        onClick={() => handleSelect(pp.id, em.email)}
                        className="inline-flex items-center gap-1.5 text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded-md px-2.5 py-1 group cursor-pointer hover:bg-purple-600 hover:text-white hover:border-purple-600 transition-all"
                        title={`Chọn ${pp.code} với email này`}>
                        <svg className="w-3 h-3 shrink-0 opacity-50 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        <span className="font-medium">{em.email}</span>
                        <button
                          onClick={(e) => copyEmail(em.email, e)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 ml-0.5"
                          title="Copy email"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
