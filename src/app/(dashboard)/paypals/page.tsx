"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { trpcVanilla } from "@/lib/trpc-vanilla";
import { useProjectStore } from "@/lib/store";
import { useTableSort, SortIcon } from "@/components/tables/useTableSort";
import { exportToCSV } from "@/lib/excel-export";
import { ImportCSVDialog } from "@/components/forms/ImportCSVDialog";
import { PinVerifyDialog } from "@/components/PinVerify";
import { useT } from "@/lib/i18n";
import toast from "react-hot-toast";

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  LIMITED: "bg-yellow-100 text-yellow-800",
  SUSPENDED: "bg-red-100 text-red-800",
};
const PP_STATUSES = ["ACTIVE", "LIMITED", "SUSPENDED"] as const;
const PP_HOLDERS = Array.from({ length: 19 }, (_, i) => `PP${String(i + 1).padStart(2, "0")}`);

// ─── Inline Editable Cell ─────────
function EditableCell({ value, onSave, mono, placeholder, className: cls }: {
  value: string; onSave: (v: string) => void; mono?: boolean; placeholder?: string; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const open = (e: React.MouseEvent) => { e.stopPropagation(); setDraft(value); setEditing(true); };
  const save = useCallback(() => { setEditing(false); if (draft !== value) onSave(draft); }, [draft, value, onSave]);
  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); if (e.key === "Tab") save(); };

  if (editing) {
    return (
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={`w-full px-1.5 py-0.5 border border-blue-400 rounded text-xs bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none ${mono ? "font-mono" : ""} ${cls || ""}`}
        placeholder={placeholder} />
    );
  }
  return (
    <div className={`w-full min-h-[24px] flex items-center px-1.5 py-0.5 rounded cursor-pointer hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-colors ${mono ? "font-mono" : ""} ${cls || ""}`}
      onClick={open}>
      <span className={`truncate ${value ? "" : "text-gray-300"}`}>{value || placeholder || "—"}</span>
    </div>
  );
}

// ─── Secret Cell (password/2FA/token) ─────────
function SecretCell({ ppId, field, projectId, pinVerified, onNeedPin, t }: {
  ppId: string; field: "password" | "twoFa" | "hotmailToken"; projectId: string;
  pinVerified: boolean; onNeedPin: () => void; t: (k: string) => string;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copying, setCopying] = useState(false);
  const utils = trpc.useUtils();
  const updatePaypal = trpc.paypal.update.useMutation({
    onSuccess: () => { utils.paypal.list.invalidate(); toast.success(t("saved")); setEditing(false); },
    onError: (e) => toast.error(e.message),
  });

  const fetchCredential = (): Promise<string> => {
    return trpcVanilla.paypal.getCredentials.query({ projectId, id: ppId })
      .then((creds) => (creds as any)?.[field] ?? "");
  };

  const handleReveal = () => {
    if (!pinVerified) { onNeedPin(); return; }
    setLoading(true);
    fetchCredential()
      .then((val) => setRevealed(val || "—"))
      .catch(() => toast.error("Failed"))
      .finally(() => setLoading(false));
  };

  const handleCopy = () => {
    if (!pinVerified) { onNeedPin(); return; }
    setCopying(true);
    fetchCredential()
      .then((val) => {
        if (val) { navigator.clipboard.writeText(val); toast.success("Copied!"); }
        else toast.error("Empty");
      })
      .catch(() => toast.error("Failed"))
      .finally(() => setCopying(false));
  };

  const handleSave = () => {
    const payload: any = { projectId, id: ppId };
    payload[field] = draft || null;
    updatePaypal.mutate(payload);
    setRevealed(null);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
          className="w-full px-1.5 py-0.5 border border-blue-400 rounded text-xs bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none" />
        <button onClick={handleSave} className="text-green-600 hover:text-green-800 shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </button>
      </div>
    );
  }

  if (revealed !== null) {
    return (
      <div className="flex items-center gap-1">
        <span className="font-mono text-xs truncate">{revealed}</span>
        <CopyBtn value={revealed} />
        <button onClick={() => { setDraft(revealed === "—" ? "" : revealed); setEditing(true); }} className="text-gray-400 hover:text-blue-600 shrink-0" title="Edit">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
        </button>
        <button onClick={() => setRevealed(null)} className="text-gray-400 hover:text-gray-600 shrink-0" title="Hide">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button onClick={handleReveal} disabled={loading} className="text-gray-400 hover:text-blue-600 text-xs flex items-center gap-0.5" title="Show">
        {loading ? (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        )}
        <span>••••</span>
      </button>
      <button onClick={handleCopy} disabled={copying} className="text-gray-400 hover:text-blue-600 shrink-0" title="Copy">
        {copying ? (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        ) : (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        )}
      </button>
    </div>
  );
}

// ─── Copy Button ─────────
function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value || value === "—") return null;
  return (
    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="shrink-0 text-gray-400 hover:text-gray-600" title="Copy">
      {copied ? (
        <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      )}
    </button>
  );
}

// ─── Default column widths ─────────
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  checkbox: 36, idx: 36, status: 110, code: 90, holder: 85, vmppCode: 95,
  email: 220, pass: 90, twoFa: 90, token: 90, received: 95, withdrawn: 95, balance: 95, notes: 140,
};

// ─── Quick Add types ─────────

export default function PayPalsPage() {
  const router = useRouter();
  const t = useT();
  const { currentProjectId: projectId, currentRole } = useProjectStore();
  const utils = trpc.useUtils();

  // Page-level PIN verification (once per page visit)
  const [pinVerified, setPinVerified] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pendingPinAction, setPendingPinAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (projectId && !pinVerified) setShowPinDialog(true);
  }, [projectId]);

  const handlePinSuccess = () => {
    setPinVerified(true);
    setShowPinDialog(false);
    if (pendingPinAction) { pendingPinAction(); setPendingPinAction(null); }
  };

  const requirePinOnce = (action: () => void) => {
    if (pinVerified) { action(); return; }
    setPendingPinAction(() => action);
    setShowPinDialog(true);
  };

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [holderFilter, setHolderFilter] = useState<string>("ALL");
  const [roleFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Quick add panel
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickHolder, setQuickHolder] = useState("");
  const [quickEmails, setQuickEmails] = useState(""); // one email per line
  const [savingQuick, setSavingQuick] = useState(false);

  const { data, isLoading, refetch } = trpc.paypal.list.useQuery(
    { projectId: projectId!, page: 1, limit: 500, search: search || undefined, status: (statusFilter !== "ALL" ? statusFilter : undefined) as any, role: (roleFilter !== "ALL" ? roleFilter : undefined) as any },
    { enabled: !!projectId }
  );

  const invalidate = () => { utils.paypal.list.invalidate(); refetch(); };
  const updatePaypal = trpc.paypal.update.useMutation({ onSuccess: () => { invalidate(); toast.success(t("saved")); }, onError: (e) => toast.error(e.message) });
  const bulkImport = trpc.paypal.bulkImport.useMutation({
    onSuccess: (res) => { invalidate(); toast.success(`Imported ${res.imported}, skipped ${res.skipped}`); },
    onError: (e) => toast.error(e.message),
  });
  const bulkUpdateStatus = trpc.paypal.bulkUpdateStatus.useMutation({ onSuccess: (res) => { invalidate(); setSelectedIds(new Set()); toast.success(`Updated ${res.updated}`); }, onError: (e) => toast.error(e.message) });
  const bulkUpdateHolder = trpc.paypal.bulkUpdateHolder.useMutation({ onSuccess: (res) => { invalidate(); setSelectedIds(new Set()); toast.success(`Updated ${res.updated}`); }, onError: (e) => toast.error(e.message) });
  const bulkDelete = trpc.paypal.bulkDelete.useMutation({ onSuccess: (res) => { invalidate(); setSelectedIds(new Set()); toast.success(`Deleted ${res.deleted}`); }, onError: (e) => toast.error(e.message) });

  const canEdit = currentRole === "ADMIN" || currentRole === "MODERATOR" || currentRole === "USER";
  const rawItems = data?.items ?? [];
  const filteredItems = useMemo(() => {
    if (holderFilter === "ALL") return rawItems;
    if (holderFilter === "Chưa gán") return rawItems.filter((pp: any) => !pp.holder);
    return rawItems.filter((pp: any) => pp.holder === holderFilter);
  }, [rawItems, holderFilter]);
  const { sorted: items, sortKey, sortDir, handleSort } = useTableSort(filteredItems);

  // Column resize
  const [colWidths, setColWidths] = useState<Record<string, number>>({ ...DEFAULT_COL_WIDTHS });
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
    const onUp = () => { resizingCol.current = null; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [colWidths]);

  const saveField = useCallback((id: string, field: string, value: string) => {
    const payload: any = { projectId: projectId!, id };
    payload[field] = value || null;
    updatePaypal.mutate(payload);
  }, [projectId, updatePaypal]);

  // ─── Selection: checkbox click + Shift+Click range ─────────
  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const lastClickedIdx = useRef<number | null>(null);

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map((pp: any) => pp.id)));
  };

  const handleRowSelect = (id: string, idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey && lastClickedIdx.current !== null) {
      const from = Math.min(lastClickedIdx.current, idx);
      const to = Math.max(lastClickedIdx.current, idx);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(items[i]?.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }
    lastClickedIdx.current = idx;
  };

  // Status counts + holder counts + totals
  const { statusCounts, holderCounts, activeHolders, totalReceived, totalWithdrawn, totalBalance } = useMemo(() => {
    const sCounts: Record<string, number> = {};
    const hCounts: Record<string, number> = {};
    let recv = 0, wdraw = 0;
    rawItems.forEach((pp: any) => {
      sCounts[pp.status] = (sCounts[pp.status] || 0) + 1;
      const h = pp.holder || "Chưa gán";
      hCounts[h] = (hCounts[h] || 0) + 1;
      recv += Number(pp.totalReceived ?? 0);
      wdraw += Number(pp.totalWithdrawn ?? 0);
    });
    // Sort holders: PP01, PP02... first, then "Chưa gán" last
    const sorted = Object.keys(hCounts).sort((a, b) => {
      if (a === "Chưa gán") return 1;
      if (b === "Chưa gán") return -1;
      return a.localeCompare(b);
    });
    return { statusCounts: sCounts, holderCounts: hCounts, activeHolders: sorted, totalReceived: recv, totalWithdrawn: wdraw, totalBalance: recv - wdraw };
  }, [rawItems]);

  // Parse quick add lines: User Win | VMPP Code | Email | Password | 2FA
  // Supports tab or pipe separator, or email-only lines
  const parsedLines = useMemo(() => {
    return quickEmails.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      // Detect separator: tab or pipe
      const sep = line.includes("\t") ? "\t" : line.includes("|") ? "|" : null;
      if (sep) {
        const parts = line.split(sep).map((p) => p.trim());
        return {
          holder: parts[0] || "",
          vmppCode: parts[1] || "",
          email: parts[2] || "",
          password: parts[3] || "",
          twoFa: parts[4] || "",
        };
      }
      // Single value = email only
      return { holder: "", vmppCode: "", email: line, password: "", twoFa: "" };
    });
  }, [quickEmails]);

  const validLines = parsedLines.filter((p) => p.email.includes("@"));

  const saveQuickAdd = async () => {
    if (!validLines.length) { toast.error("Không có email hợp lệ"); return; }
    setSavingQuick(true);
    let created = 0;
    try {
      for (const row of validLines) {
        await trpcVanilla.paypal.create.mutate({
          projectId: projectId!,
          primaryEmail: row.email,
          holder: row.holder || quickHolder || undefined,
          vmppCode: row.vmppCode || undefined,
          password: row.password || undefined,
          twoFa: row.twoFa || undefined,
        });
        created++;
      }
      toast.success(`Đã tạo ${created} PayPal`);
      setQuickEmails("");
      setQuickHolder("");
      setShowQuickAdd(false);
      invalidate();
    } catch (e: any) {
      toast.error(`Tạo được ${created}/${validLines.length}. Lỗi: ${e.message}`);
      invalidate();
    } finally {
      setSavingQuick(false);
    }
  };

  const handleExport = () => {
    const exportItems = selectedIds.size > 0 ? items.filter((pp: any) => selectedIds.has(pp.id)) : items;
    if (!exportItems.length) return;
    exportToCSV(
      exportItems.map((pp: any) => ({
        "PP Code": pp.code,
        "Holder": pp.holder || "",
        "VMPP Code": pp.vmppCode || "",
        "Email": pp.primaryEmail,
        "Status": pp.status,
        "Role": pp.role,
        "Company": pp.company,
        "Notes": pp.notes || pp.limitNote || "",
      })),
      selectedIds.size > 0 ? `paypals-selected-${selectedIds.size}` : "paypals-export"
    );
  };

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  return (
    <div className="space-y-3">
      <PinVerifyDialog open={showPinDialog} onClose={() => setShowPinDialog(false)} onVerified={handlePinSuccess}
        title={t("srv_pin_required")} description="Nhập PIN để truy cập thông tin nhạy cảm" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("pp_title")}</h1>
          <p className="text-sm text-gray-500">{data?.total ?? 0} accounts</p>
        </div>
      </div>

      {/* Summary Cards */}
      {!isLoading && items.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
            <p className="text-[10px] uppercase text-green-600 font-semibold">Tổng nhận</p>
            <p className="text-lg font-bold text-green-800 font-mono">${totalReceived.toFixed(2)}</p>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5">
            <p className="text-[10px] uppercase text-orange-600 font-semibold">Tổng đã rút</p>
            <p className="text-lg font-bold text-orange-800 font-mono">${totalWithdrawn.toFixed(2)}</p>
          </div>
          <div className={`border rounded-lg px-4 py-2.5 ${totalBalance >= 0 ? "bg-blue-50 border-blue-200" : "bg-red-50 border-red-200"}`}>
            <p className={`text-[10px] uppercase font-semibold ${totalBalance >= 0 ? "text-blue-600" : "text-red-600"}`}>Tổng số dư</p>
            <p className={`text-lg font-bold font-mono ${totalBalance >= 0 ? "text-blue-800" : "text-red-800"}`}>${totalBalance.toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Status Filter Pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => setStatusFilter("ALL")}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${statusFilter === "ALL" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
          All ({data?.total ?? 0})
        </button>
        {PP_STATUSES.map((s) => (
          <button key={s} onClick={() => setStatusFilter(s === statusFilter ? "ALL" : s)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${statusFilter === s ? "bg-gray-900 text-white" : `${statusColors[s]} hover:opacity-80`}`}>
            {s} {statusCounts[s] ? `(${statusCounts[s]})` : ""}
          </button>
        ))}
      </div>

      {/* User Win Filter Pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-gray-400 mr-1">User Win:</span>
        <button onClick={() => setHolderFilter("ALL")}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${holderFilter === "ALL" ? "bg-indigo-700 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
          All
        </button>
        {activeHolders.map((h) => (
          <button key={h} onClick={() => setHolderFilter(h === holderFilter ? "ALL" : h)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${holderFilter === h ? "bg-indigo-700 text-white" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"}`}>
            {h} ({holderCounts[h]})
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap bg-gray-50 rounded-lg p-2.5 border">
        <div className="flex-1 min-w-[180px] relative">
          <svg className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white"
            placeholder={t("pp_search_placeholder")} />
        </div>
        <button onClick={handleExport} disabled={!items.length}
          className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50">
          {selectedIds.size > 0 ? `${t("pp_export")} (${selectedIds.size})` : t("pp_export")}
        </button>
        {canEdit && (
          <button onClick={() => setShowImport(true)} className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700">
            {t("pp_import")}
          </button>
        )}
        {canEdit && (
          <button onClick={() => setShowQuickAdd(!showQuickAdd)}
            className={`px-3 py-1.5 rounded text-xs font-medium ${showQuickAdd ? "bg-gray-600 text-white" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
            {showQuickAdd ? "Đóng" : "+ Thêm PP"}
          </button>
        )}
      </div>

      {/* Quick Add Panel */}
      {showQuickAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-blue-900">Thêm PayPal nhanh</h3>
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">User Win mặc định (nếu dòng không có)</label>
              <select value={quickHolder} onChange={(e) => setQuickHolder(e.target.value)}
                className="w-full px-2 py-1.5 border rounded text-sm bg-white">
                <option value="">-- Không chọn --</option>
                {PP_HOLDERS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="bg-white border rounded-lg px-3 py-1.5 text-sm self-end">
              <span className="text-gray-500">Hợp lệ: </span>
              <span className="font-bold text-blue-700">{validLines.length}</span>
              <span className="text-gray-400 text-xs ml-1">/ {parsedLines.length} dòng</span>
            </div>
          </div>
          {/* Data textarea */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Paste dữ liệu (mỗi dòng 1 PP, phân cách bằng Tab hoặc | )
            </label>
            <p className="text-[10px] text-gray-400 mb-1">Cột: User Win | VMPP Code | Email | Password | 2FA — hoặc chỉ email</p>
            <textarea value={quickEmails} onChange={(e) => setQuickEmails(e.target.value)}
              rows={5} autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other"
              className="w-full px-3 py-2 border rounded text-xs font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white resize-y"
              placeholder={"PP01|PP-VN453|user1@hotmail.com|Mi#o*AKxoOzk7G|AZKU IYVS 3RYR 5VBR\nPP02|PP-VN454|user2@hotmail.com|pass2|2FA2\nuser3@outlook.com"} />
          </div>
          {/* Preview table */}
          {parsedLines.length > 0 && (
            <div className="bg-white border rounded overflow-x-auto max-h-[200px] overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left text-gray-500 w-8">#</th>
                    <th className="px-2 py-1 text-left text-gray-500">User Win</th>
                    <th className="px-2 py-1 text-left text-gray-500">VMPP Code</th>
                    <th className="px-2 py-1 text-left text-gray-500">Email</th>
                    <th className="px-2 py-1 text-left text-gray-500">Password</th>
                    <th className="px-2 py-1 text-left text-gray-500">2FA</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parsedLines.map((row, i) => (
                    <tr key={i} className={row.email.includes("@") ? "" : "bg-red-50"}>
                      <td className="px-2 py-0.5 text-gray-400">{i + 1}</td>
                      <td className="px-2 py-0.5 font-medium">{row.holder || quickHolder || <span className="text-gray-300">—</span>}</td>
                      <td className="px-2 py-0.5 font-mono">{row.vmppCode || <span className="text-gray-300">—</span>}</td>
                      <td className="px-2 py-0.5 font-mono">{row.email || <span className="text-red-400">thiếu email</span>}</td>
                      <td className="px-2 py-0.5">{row.password ? "••••" : <span className="text-gray-300">—</span>}</td>
                      <td className="px-2 py-0.5">{row.twoFa ? "••••" : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={saveQuickAdd} disabled={savingQuick || !validLines.length}
              className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {savingQuick ? "Đang tạo..." : `Tạo ${validLines.length} PayPal`}
            </button>
            <button onClick={() => { setShowQuickAdd(false); setQuickEmails(""); setQuickHolder(""); }}
              className="px-3 py-1.5 bg-gray-200 rounded text-sm hover:bg-gray-300">Hủy</button>
            <span className="text-[10px] text-gray-400 ml-2">PP Code tự sinh</span>
          </div>
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <span className="text-sm font-medium text-blue-800">{selectedIds.size} selected</span>
          <span className="text-blue-300">|</span>
          <select onChange={(e) => {
            if (!e.target.value) return;
            bulkUpdateStatus.mutate({ projectId: projectId!, ids: Array.from(selectedIds), status: e.target.value as any });
            e.target.value = "";
          }} className="text-xs border rounded px-2 py-1 bg-white" defaultValue="">
            <option value="" disabled>Change Status...</option>
            {PP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select onChange={(e) => {
            if (!e.target.value) return;
            bulkUpdateHolder.mutate({ projectId: projectId!, ids: Array.from(selectedIds), holder: e.target.value });
            e.target.value = "";
          }} className="text-xs border rounded px-2 py-1 bg-white" defaultValue="">
            <option value="" disabled>Change User Win...</option>
            {PP_HOLDERS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <button onClick={() => {
            const selPPs = items.filter((pp: any) => selectedIds.has(pp.id));
            const hasFunds = selPPs.some((pp: any) => pp.totalReceived > 0);
            const hasWithdrawals = selPPs.some((pp: any) => pp.totalWithdrawn > 0);
            const codes = selPPs.map((pp: any) => pp.code).join(", ");
            let msg = `⚠️ XÓA ${selectedIds.size} PAYPAL\n\n${codes}\n\n`;
            if (hasFunds || hasWithdrawals) {
              msg += "⛔ CÁC PP NÀY CÓ DỮ LIỆU TÀI CHÍNH!\nTất cả Fund & Withdrawal liên quan sẽ bị XÓA VĨNH VIỄN.\n\n";
            }
            msg += "Hành động này KHÔNG THỂ hoàn tác. Tiếp tục?";
            if (!confirm(msg)) return;
            requirePinOnce(() => {
              bulkDelete.mutate({ projectId: projectId!, ids: Array.from(selectedIds) });
            });
          }} className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">
            Xóa ({selectedIds.size})
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1 bg-gray-200 rounded text-xs hover:bg-gray-300 ml-auto">
            {t("deselect")}
          </button>
        </div>
      )}

      {/* PayPal Table */}
      {isLoading ? (
        <p className="text-gray-500 p-4">{t("loading")}</p>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="text-xs" style={{ tableLayout: "fixed", width: Object.values(colWidths).reduce((a, b) => a + b, 0) }}>
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                {([
                  ["checkbox", "", false, false],
                  ["idx", "#", false, false],
                  ["status", t("col_status"), true, false],
                  ["code", t("pp_code"), true, false],
                  ["holder", "User Win", true, false],
                  ["vmppCode", "VMPP Code", true, false],
                  ["email", "Email", true, false],
                  ["pass", "Pass", false, false],
                  ["twoFa", "2FA", false, false],
                  ["token", "Token", false, false],
                  ["received", "Tổng nhận", true, true],
                  ["withdrawn", "Đã rút", true, true],
                  ["balance", "Số dư", true, true],
                  ["notes", t("col_notes"), false, false],
                ] as [string, string, boolean, boolean][]).map(([col, label, sortable, rightAlign]) => {
                  const sortField = col === "email" ? "primaryEmail" : col === "received" ? "totalReceived" : col === "withdrawn" ? "totalWithdrawn" : col;
                  return (
                    <th key={col} style={{ width: colWidths[col], minWidth: 36 }}
                      className={`px-2 py-2 font-medium text-gray-500 select-none relative ${sortable ? "cursor-pointer hover:bg-gray-100" : ""} ${rightAlign ? "text-right" : "text-left"}`}
                      onClick={sortable ? () => handleSort(sortField) : undefined}>
                      {col === "checkbox" ? (
                        <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-gray-300" />
                      ) : (
                        <>{label}{sortable && <SortIcon active={sortKey === sortField} direction={sortDir} />}</>
                      )}
                      <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-300 active:bg-blue-400"
                        onMouseDown={(e) => onResizeStart(col, e)} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y">
              {/* ═══ Existing Data Rows ═══ */}
              {items.length === 0 && (
                <tr><td colSpan={14} className="text-center py-12 text-gray-500">{t("pp_no_accounts")}</td></tr>
              )}
              {items.map((pp: any, idx: number) => (
                <tr key={pp.id} className={`hover:bg-blue-50/50 ${selectedIds.has(pp.id) ? "bg-blue-100/70" : ""}`}>
                  <td className="px-2 py-1">
                    <input type="checkbox" checked={selectedIds.has(pp.id)}
                      onClick={(e) => handleRowSelect(pp.id, idx, e as any)}
                      readOnly
                      className="rounded border-gray-300 cursor-pointer" />
                  </td>
                  <td className="px-2 py-1 text-gray-400">{idx + 1}</td>
                  {/* Status */}
                  <td className="px-2 py-0.5">
                    <div>
                      {canEdit ? (
                        <select value={pp.status}
                          onChange={(e) => updatePaypal.mutate({ projectId: projectId!, id: pp.id, status: e.target.value as any })}
                          className={`text-xs px-1.5 py-0.5 rounded border-0 font-medium cursor-pointer w-full ${statusColors[pp.status] ?? ""}`}>
                          {PP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <Badge className={`text-[10px] ${statusColors[pp.status] ?? ""}`}>{pp.status}</Badge>
                      )}
                      {/* LIMITED: show limit note / step */}
                      {pp.status === "LIMITED" && (
                        <span className="text-[9px] text-amber-700 block truncate" title={pp.limitNote || "Cần gỡ limit"}>
                          {pp.limitNote || "Cần gỡ limit"}
                        </span>
                      )}
                      {/* SUSPENDED: show 180-day countdown */}
                      {pp.status === "SUSPENDED" && (() => {
                        const dateStr = pp.suspendedAt;
                        if (!dateStr) return <span className="text-[9px] text-red-500 block">Chưa set ngày</span>;
                        const start = new Date(dateStr);
                        const deadline = new Date(start.getTime() + 180 * 24 * 60 * 60 * 1000);
                        const now = new Date();
                        const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                        if (daysLeft <= 0) return <span className="text-[9px] text-red-600 font-bold block animate-pulse">RÚT TIỀN!</span>;
                        const color = daysLeft <= 14 ? "text-red-600 font-bold" : daysLeft <= 30 ? "text-amber-600" : "text-gray-500";
                        return <span className={`text-[9px] ${color} block`}>{daysLeft}d / 180d</span>;
                      })()}
                    </div>
                  </td>
                  {/* Code */}
                  <td className="px-2 py-1">
                    <span className="font-medium font-mono text-blue-600 cursor-pointer hover:underline" onClick={() => router.push(`/paypals/${pp.id}`)}>{pp.code}</span>
                  </td>
                  {/* User Win */}
                  <td className="px-2 py-0.5">
                    {canEdit ? (
                      <select value={pp.holder ?? ""} onChange={(e) => saveField(pp.id, "holder", e.target.value)}
                        className="text-xs px-1 py-0.5 rounded border border-gray-200 bg-white cursor-pointer w-full">
                        <option value="">—</option>
                        {PP_HOLDERS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    ) : (
                      <span className="text-gray-600">{pp.holder || "—"}</span>
                    )}
                  </td>
                  {/* VMPP Code */}
                  <td className="px-2 py-0.5">
                    {canEdit ? (
                      <EditableCell value={pp.vmppCode ?? ""} onSave={(v) => saveField(pp.id, "vmppCode", v)} mono placeholder="VMPP..." />
                    ) : (
                      <span className="font-mono text-gray-500">{pp.vmppCode || "—"}</span>
                    )}
                  </td>
                  {/* Emails */}
                  <td className="px-2 py-0.5">
                    <div className="space-y-0.5">
                      {pp.emails && pp.emails.length > 0 ? (
                        pp.emails.map((em: any) => (
                          <div key={em.id} className="flex items-center gap-1">
                            <span className={`truncate text-xs ${em.isPrimary ? "font-medium" : "text-gray-500"}`}>{em.email}</span>
                            <CopyBtn value={em.email} />
                            {em.isPrimary && <span className="shrink-0 text-[8px] bg-blue-100 text-blue-700 px-1 rounded">P</span>}
                          </div>
                        ))
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="truncate text-xs">{pp.primaryEmail}</span>
                          <CopyBtn value={pp.primaryEmail} />
                        </div>
                      )}
                    </div>
                  </td>
                  {/* Password */}
                  <td className="px-2 py-1">
                    <SecretCell ppId={pp.id} field="password" projectId={projectId!} pinVerified={pinVerified} onNeedPin={() => setShowPinDialog(true)} t={t} />
                  </td>
                  {/* 2FA */}
                  <td className="px-2 py-1">
                    <SecretCell ppId={pp.id} field="twoFa" projectId={projectId!} pinVerified={pinVerified} onNeedPin={() => setShowPinDialog(true)} t={t} />
                  </td>
                  {/* Token */}
                  <td className="px-2 py-1">
                    <SecretCell ppId={pp.id} field="hotmailToken" projectId={projectId!} pinVerified={pinVerified} onNeedPin={() => setShowPinDialog(true)} t={t} />
                  </td>
                  {/* Received */}
                  <td className="px-2 py-1 text-right font-mono">
                    {pp.totalReceived > 0 ? <span className="text-green-700">${Number(pp.totalReceived).toFixed(2)}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  {/* Withdrawn */}
                  <td className="px-2 py-1 text-right font-mono">
                    {pp.totalWithdrawn > 0 ? <span className="text-orange-600">${Number(pp.totalWithdrawn).toFixed(2)}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  {/* Balance */}
                  <td className="px-2 py-1 text-right font-mono font-medium">
                    {pp.balance !== 0 ? <span className={pp.balance > 0 ? "text-blue-700" : "text-red-600"}>${Number(pp.balance).toFixed(2)}</span> : <span className="text-gray-300">$0.00</span>}
                  </td>
                  {/* Notes */}
                  <td className="px-2 py-0.5 max-w-[160px]">
                    {canEdit ? (
                      <EditableCell value={pp.notes ?? pp.limitNote ?? ""} onSave={(v) => saveField(pp.id, "notes", v)} placeholder="notes..." />
                    ) : (
                      <span className="text-gray-500 truncate block">{pp.limitNote || pp.notes || "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 bg-gray-50 border-t text-xs text-gray-500 flex items-center justify-between">
            <span>{items.length} {t("pp_shown")}</span>
            {selectedIds.size > 0 && <span className="font-medium text-blue-700">{selectedIds.size} selected</span>}
          </div>
        </div>
      )}

      {/* Import CSV Dialog */}
      <ImportCSVDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImport={(rows) => {
          bulkImport.mutate({
            projectId: projectId!,
            items: rows.map((r) => ({
              code: r["PP Code"] || r["Code"] || "",
              primaryEmail: r["Email"] || "",
              status: (r["Status"] as any) || "ACTIVE",
              role: (r["Role"] as any) || "NORMAL",
              company: r["Company"] || "Bright Data Ltd.",
              limitNote: r["Notes"] || undefined,
            })),
          });
        }}
        title="Import PayPals"
        description="Upload CSV. Required: PP Code, Email."
        templateColumns={["PP Code", "Holder", "Email", "Status", "Role", "Company", "Notes"]}
      />
    </div>
  );
}
