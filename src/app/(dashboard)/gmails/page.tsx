"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { trpcVanilla } from "@/lib/trpc-vanilla";
import { useProjectStore } from "@/lib/store";
import { useTableSort, SortIcon } from "@/components/tables/useTableSort";
import { exportToCSV } from "@/lib/excel-export";
import { useT } from "@/lib/i18n";
import toast from "react-hot-toast";

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  NEEDS_RECOVERY: "bg-orange-100 text-orange-800",
  NEEDS_2FA_UPDATE: "bg-purple-100 text-purple-800",
  BLOCKED: "bg-red-100 text-red-800",
  DISABLED: "bg-gray-100 text-gray-800",
};
const GMAIL_STATUSES = ["ACTIVE", "SUSPENDED", "NEEDS_RECOVERY", "NEEDS_2FA_UPDATE", "BLOCKED", "DISABLED"] as const;

// ─── Smart Cell: click text=copy, pencil=edit ──────────
function SmartCell({ value, onSave, mono, placeholder, copyable = true }: {
  value: string; onSave?: (v: string) => void; mono?: boolean; placeholder?: string; copyable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const startEdit = () => { if (!onSave) return; setDraft(value); setEditing(true); };
  const save = useCallback(() => { setEditing(false); if (draft !== value && onSave) onSave(draft); }, [draft, value, onSave]);
  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); if (e.key === "Tab") save(); };

  if (editing) {
    return (
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={onKeyDown}
        className={`w-full px-1 py-0 border border-blue-400 rounded text-xs bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none ${mono ? "font-mono" : ""}`}
        placeholder={placeholder} />
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <span
        className={`truncate flex-1 text-xs ${mono ? "font-mono" : ""} ${value ? (copyable ? "cursor-pointer hover:text-blue-600" : "") : "text-gray-300"}`}
        onClick={value && copyable ? () => { navigator.clipboard.writeText(value); toast.success("Copied!"); } : undefined}
        onDoubleClick={!copyable && onSave ? startEdit : undefined}
        title={value && copyable ? "Click to copy" : undefined}
      >
        {value || placeholder || "—"}
      </span>
      {onSave && (
        <button onClick={startEdit} className="text-gray-300 hover:text-blue-600 shrink-0" title="Edit">
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
        </button>
      )}
    </div>
  );
}

// ─── Secret Cell: •••  [eye] [copy] [pencil] ──────────
function GmailSecretCell({ gmailId, field, projectId, onSave }: {
  gmailId: string; field: "password" | "twoFaCurrent" | "token"; projectId: string;
  onSave: (v: string) => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copying, setCopying] = useState(false);

  const fetchCred = (): Promise<string> =>
    trpcVanilla.gmail.getCredentials.query({ projectId, id: gmailId }).then((c: any) => c?.[field] ?? "");

  const reveal = () => {
    if (revealed !== null) { setRevealed(null); return; }
    setLoading(true);
    fetchCred().then((v) => setRevealed(v || "")).catch(() => toast.error("Failed")).finally(() => setLoading(false));
  };

  const copy = () => {
    setCopying(true);
    fetchCred().then((v) => { if (v) { navigator.clipboard.writeText(v); toast.success("Copied!"); } else toast.error("Empty"); })
      .catch(() => toast.error("Failed")).finally(() => setCopying(false));
  };

  const save = () => { if (draft) onSave(draft); setEditing(false); setRevealed(null); };

  if (editing) {
    return (
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        onBlur={save}
        className="w-full px-1 py-0 border border-blue-400 rounded text-xs font-mono bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none" />
    );
  }

  if (revealed !== null) {
    return (
      <div className="flex items-center gap-0.5">
        <span className="font-mono text-xs truncate flex-1 cursor-pointer hover:text-blue-600"
          onClick={() => { if (revealed) { navigator.clipboard.writeText(revealed); toast.success("Copied!"); } }}
          title="Click to copy">{revealed || <span className="text-gray-300">—</span>}</span>
        <button onClick={() => { setDraft(revealed || ""); setEditing(true); }} className="text-gray-300 hover:text-blue-600 shrink-0">
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
        </button>
        <button onClick={() => setRevealed(null)} className="text-gray-300 hover:text-gray-600 shrink-0">
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M3 3l18 18" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <span className="text-gray-400 text-xs flex-1">•••</span>
      <button onClick={reveal} disabled={loading} className="text-gray-300 hover:text-blue-600 shrink-0" title="Show">
        {loading ? <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          : <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
      </button>
      <button onClick={copy} disabled={copying} className="text-gray-300 hover:text-blue-600 shrink-0" title="Copy">
        {copying ? <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          : <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
      </button>
      <button onClick={() => { setDraft(""); setEditing(true); }} className="text-gray-300 hover:text-blue-600 shrink-0" title="Edit">
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
      </button>
    </div>
  );
}

// ─── Default column widths ─────────
const DEFAULT_WIDTHS: Record<string, number> = {
  checkbox: 32, num: 32, email: 220, password: 130, twofa: 130, recovery: 200, token: 130, status: 120, server: 70, vm: 90, notes: 130,
};

export default function GmailsPage() {
  const { currentProjectId: projectId, currentRole } = useProjectStore();
  const utils = trpc.useUtils();
  const t = useT();

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [pasteText, setPasteText] = useState("");

  // Column resize
  const [colWidths, setColWidths] = useState<Record<string, number>>({ ...DEFAULT_WIDTHS });
  const resizingCol = useRef<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  const onResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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

  const { data, isLoading, refetch } = trpc.gmail.list.useQuery(
    { projectId: projectId!, status: statusFilter !== "ALL" ? statusFilter : undefined, unassigned: showUnassigned || undefined, limit: 200 },
    { enabled: !!projectId }
  );

  const invalidate = () => { utils.gmail.list.invalidate(); refetch(); };
  const bulkImport = trpc.gmail.bulkImport.useMutation({
    onSuccess: (d) => { invalidate(); setPasteText(""); setShowImport(false); toast.success(`Imported ${d.imported} gmails`); },
    onError: (e) => toast.error(e.message),
  });
  const updateGmail = trpc.gmail.update.useMutation({ onSuccess: () => { invalidate(); toast.success(t("saved")); }, onError: (e) => toast.error(e.message) });
  const bulkDeleteGmail = trpc.gmail.bulkDelete.useMutation({ onSuccess: (d) => { invalidate(); setSelected(new Set()); toast.success(`Deleted ${d.deleted} gmails`); } });

  const canEdit = currentRole === "ADMIN" || currentRole === "MODERATOR" || currentRole === "USER";
  const canDelete = currentRole === "ADMIN" || currentRole === "MODERATOR";
  const rawItems = data?.items ?? [];
  const searchedItems = search.trim()
    ? rawItems.filter((g: any) => {
        const q = search.toLowerCase();
        return (
          (g.email ?? "").toLowerCase().includes(q) ||
          (g.recoveryEmail ?? "").toLowerCase().includes(q) ||
          (g.vms?.[0]?.code ?? "").toLowerCase().includes(q) ||
          (g.vms?.[0]?.server?.code ?? "").toLowerCase().includes(q) ||
          (g.notes ?? "").toLowerCase().includes(q) ||
          (g.status ?? "").toLowerCase().includes(q)
        );
      })
    : rawItems;
  const { sorted: items, sortKey, sortDir, handleSort } = useTableSort(searchedItems);

  const parsedPaste = useMemo(() => {
    if (!pasteText.trim()) return [];
    return pasteText.trim().split("\n").filter((l) => l.trim()).map((line) => {
      const parts = line.includes("|") ? line.split("|").map((s) => s.trim()) : line.split(/\t/).map((s) => s.trim());
      return { email: parts[0] || "", password: parts[1] || "", recoveryEmail: parts[2] || "", twoFaCurrent: parts[3] || "", token: parts[4] || "" };
    });
  }, [pasteText]);
  const validPaste = parsedPaste.filter((r) => r.email.includes("@"));

  const saveField = (id: string, field: string, value: string) => {
    const payload: any = { projectId: projectId!, id };
    if (field === "password" || field === "twoFaCurrent" || field === "token") {
      if (value) payload[field] = value; else return;
    } else { payload[field] = value || null; }
    updateGmail.mutate(payload);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((g: any) => g.id)));
  };

  const bulkUpdateStatus = (status: string) => {
    const ids = Array.from(selected);
    Promise.all(ids.map((id) => updateGmail.mutateAsync({ projectId: projectId!, id, status: status as any })))
      .then(() => { invalidate(); setSelected(new Set()); });
  };
  const bulkDisable = () => {
    if (!confirm(`${t("gmail_disable_confirm").replace("?", "")} (${selected.size})?`)) return;
    const ids = Array.from(selected);
    Promise.all(ids.map((id) => updateGmail.mutateAsync({ projectId: projectId!, id, status: "DISABLED" as any })))
      .then(() => { invalidate(); setSelected(new Set()); });
  };
  const bulkDelete = () => {
    if (!confirm(`${t("gmail_delete_confirm")} (${selected.size})`)) return;
    bulkDeleteGmail.mutate({ projectId: projectId!, ids: Array.from(selected) });
  };

  const columns = [
    { key: "checkbox", label: "", width: colWidths.checkbox, sortable: false, resizable: false },
    { key: "num", label: "#", width: colWidths.num, sortable: false, resizable: false },
    { key: "email", label: t("email"), width: colWidths.email, sortable: true, resizable: true },
    { key: "password", label: t("password"), width: colWidths.password, sortable: false, resizable: true },
    { key: "twofa", label: "2FA", width: colWidths.twofa, sortable: false, resizable: true },
    { key: "recovery", label: t("gmail_recovery_mail"), width: colWidths.recovery, sortable: true, sortKey: "recoveryEmail", resizable: true },
    { key: "token", label: "Token", width: colWidths.token, sortable: false, resizable: true },
    { key: "status", label: t("col_status"), width: colWidths.status, sortable: true, resizable: true },
    { key: "server", label: t("col_server"), width: colWidths.server, sortable: true, sortKey: "vm.server.code", resizable: true },
    { key: "vm", label: "VM", width: colWidths.vm, sortable: true, sortKey: "vm.code", resizable: true },
    { key: "notes", label: t("col_notes"), width: colWidths.notes, sortable: true, resizable: true },
  ];

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("gmail_title")}</h1>
          <p className="text-sm text-gray-500">{t("gmail_subtitle")}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => { setStatusFilter("ALL"); setShowUnassigned(false); }} className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition ${statusFilter === "ALL" && !showUnassigned ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
          {t("all")} ({data?.total ?? 0})
        </button>
        <button onClick={() => { setShowUnassigned(!showUnassigned); setStatusFilter("ALL"); }} className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition ${showUnassigned ? "bg-orange-600 text-white" : "bg-orange-50 text-orange-700 hover:bg-orange-100"}`}>
          {t("unassigned")}
        </button>
        {GMAIL_STATUSES.map((s) => (
          <button key={s} onClick={() => { setStatusFilter(s === statusFilter ? "ALL" : s); setShowUnassigned(false); }} className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition ${statusFilter === s ? "bg-gray-900 text-white" : `${statusColors[s]} hover:opacity-80`}`}>
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap bg-gray-50 rounded-lg p-2 border">
        <div className="relative flex-1 min-w-[180px]">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-7 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none" placeholder={t("gmail_search")} />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">&times;</button>}
        </div>
        {search && <span className="text-[10px] text-gray-500">{items.length}</span>}
        <button onClick={() => { if (!items.length) return; exportToCSV(items.map((g: any, i: number) => ({ "#": i + 1, [t("email")]: g.email ?? "", [t("gmail_recovery_mail")]: g.recoveryEmail ?? "", [t("col_status")]: g.status ?? "", [t("col_server")]: g.vms?.[0]?.server?.code ?? "", [t("col_vm")]: g.vms?.[0]?.code ?? "", [t("col_notes")]: g.notes ?? "" })), "gmails-export"); }}
          disabled={!items.length} className="px-2 py-1 bg-green-600 text-white rounded text-[11px] font-medium hover:bg-green-700 disabled:opacity-50">
          CSV
        </button>
        {canEdit && (
          <>
            <button onClick={() => setShowImport(!showImport)} className={`px-2 py-1 rounded text-[11px] font-medium ${showImport ? "bg-blue-700 text-white ring-2 ring-blue-300" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
              + {t("gmail_add")}
            </button>
            {selected.size > 0 && (
              <>
                <span className="text-gray-300">|</span>
                <span className="text-[11px] font-medium text-blue-600">{selected.size} {t("selected")}</span>
                <select defaultValue="" onChange={(e) => { if (e.target.value) { bulkUpdateStatus(e.target.value); e.target.value = ""; } }} className="px-1.5 py-0.5 border rounded text-[11px]">
                  <option value="" disabled>{t("change_status")}</option>
                  {GMAIL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
                {canDelete && <button onClick={bulkDisable} className="px-2 py-1 bg-red-50 text-red-600 rounded text-[11px] font-medium hover:bg-red-100">{t("gmail_disable_selected")}</button>}
                {canDelete && <button onClick={bulkDelete} disabled={bulkDeleteGmail.isLoading} className="px-2 py-1 bg-red-600 text-white rounded text-[11px] font-medium hover:bg-red-700 disabled:opacity-50">{bulkDeleteGmail.isLoading ? "..." : t("delete_selected")}</button>}
                <button onClick={() => setSelected(new Set())} className="text-[11px] text-gray-500 hover:underline">{t("clear")}</button>
              </>
            )}
          </>
        )}
      </div>

      {/* Paste Import */}
      {showImport && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-600">Paste: <span className="font-mono text-blue-700">Gmail | Password | Recovery | 2FA | Token</span></p>
            <span className="text-[11px] text-gray-500">OK: <b className="text-blue-700">{validPaste.length}</b>/{parsedPaste.length}</span>
          </div>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
            rows={3} autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other"
            className="w-full px-2 py-1.5 border rounded text-xs font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white resize-y"
            placeholder={"user1@gmail.com|Pass123!|recovery@hotmail.com|abcd efgh ijkl|token\nuser2@gmail.com|Pass456!|||"} />
          {parsedPaste.length > 0 && (
            <div className="bg-white border rounded overflow-x-auto max-h-[140px] overflow-y-auto">
              <table className="min-w-full text-[11px]">
                <thead className="bg-gray-50 sticky top-0"><tr>
                  <th className="px-1.5 py-0.5 text-left text-gray-500 w-6">#</th>
                  <th className="px-1.5 py-0.5 text-left text-gray-500">Gmail</th>
                  <th className="px-1.5 py-0.5 text-left text-gray-500">Pass</th>
                  <th className="px-1.5 py-0.5 text-left text-gray-500">Recovery</th>
                  <th className="px-1.5 py-0.5 text-left text-gray-500">2FA</th>
                  <th className="px-1.5 py-0.5 text-left text-gray-500">Token</th>
                </tr></thead>
                <tbody className="divide-y">
                  {parsedPaste.map((row, i) => (
                    <tr key={i} className={row.email.includes("@") ? "" : "bg-red-50"}>
                      <td className="px-1.5 py-0 text-gray-400">{i + 1}</td>
                      <td className="px-1.5 py-0 font-mono">{row.email || <span className="text-red-400">?</span>}</td>
                      <td className="px-1.5 py-0">{row.password ? "***" : "—"}</td>
                      <td className="px-1.5 py-0 font-mono text-gray-500">{row.recoveryEmail || "—"}</td>
                      <td className="px-1.5 py-0">{row.twoFaCurrent ? "***" : "—"}</td>
                      <td className="px-1.5 py-0">{row.token ? "***" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={() => { if (validPaste.length === 0) return; bulkImport.mutate({ projectId: projectId!, gmails: validPaste.map((r) => ({ email: r.email, password: r.password || undefined, recoveryEmail: r.recoveryEmail || undefined, twoFaCurrent: r.twoFaCurrent || undefined, token: r.token || undefined })) }); }}
              disabled={validPaste.length === 0 || bulkImport.isLoading}
              className="px-3 py-1 bg-blue-600 text-white rounded text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
              {bulkImport.isLoading ? "..." : `Import ${validPaste.length}`}
            </button>
            <button onClick={() => { setShowImport(false); setPasteText(""); }} className="px-2 py-1 bg-gray-100 rounded text-[11px] hover:bg-gray-200">{t("cancel")}</button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? <p className="text-gray-500 p-4 text-sm">{t("loading")}</p> : items.length === 0 ? (
        <div className="text-center py-10 bg-white border rounded-lg"><p className="text-gray-500 text-sm">{t("gmail_no_accounts")}</p></div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="text-xs" style={{ minWidth: Object.values(colWidths).reduce((a, b) => a + b, 0) }}>
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {columns.map((col) => (
                  <th key={col.key}
                    style={{ width: col.width, minWidth: col.width }}
                    className={`px-1 py-1.5 text-left font-medium text-gray-500 text-[11px] relative select-none ${col.sortable ? "cursor-pointer hover:bg-gray-100" : ""}`}
                    onClick={() => col.sortable && handleSort((col as any).sortKey || col.key)}
                  >
                    {col.key === "checkbox"
                      ? <input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} className="rounded border-gray-300 ml-1" />
                      : col.label}
                    {col.sortable && <SortIcon active={sortKey === ((col as any).sortKey || col.key)} direction={sortDir} />}
                    {col.resizable && (
                      <div className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize group/resize z-10"
                        onMouseDown={(e) => onResizeStart(col.key, e)}
                        onClick={(e) => e.stopPropagation()}>
                        <div className="absolute right-0 top-1 bottom-1 w-0.5 bg-transparent group-hover/resize:bg-blue-400" />
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((gmail: any, idx: number) => (
                <tr key={gmail.id} className={`${selected.has(gmail.id) ? "bg-blue-50" : "hover:bg-gray-50/50"}`}>
                  <td style={{ width: colWidths.checkbox }} className="px-1 py-0 text-center">
                    <input type="checkbox" checked={selected.has(gmail.id)} onChange={() => toggleSelect(gmail.id)} className="rounded border-gray-300" />
                  </td>
                  <td style={{ width: colWidths.num }} className="px-1 py-0 text-gray-400 text-center">{idx + 1}</td>
                  <td style={{ width: colWidths.email }} className="px-1 py-0 overflow-hidden">
                    <SmartCell value={gmail.email ?? ""} onSave={canEdit ? (v) => saveField(gmail.id, "email", v) : undefined} mono />
                  </td>
                  <td style={{ width: colWidths.password }} className="px-1 py-0 overflow-hidden">
                    {canEdit ? <GmailSecretCell gmailId={gmail.id} field="password" projectId={projectId!} onSave={(v) => saveField(gmail.id, "password", v)} /> : <span className="text-gray-400">•••</span>}
                  </td>
                  <td style={{ width: colWidths.twofa }} className="px-1 py-0 overflow-hidden">
                    {canEdit ? <GmailSecretCell gmailId={gmail.id} field="twoFaCurrent" projectId={projectId!} onSave={(v) => saveField(gmail.id, "twoFaCurrent", v)} /> : <span className="text-gray-400">•••</span>}
                  </td>
                  <td style={{ width: colWidths.recovery }} className="px-1 py-0 overflow-hidden">
                    <SmartCell value={gmail.recoveryEmail ?? ""} onSave={canEdit ? (v) => saveField(gmail.id, "recoveryEmail", v) : undefined} mono placeholder="—" />
                  </td>
                  <td style={{ width: colWidths.token }} className="px-1 py-0 overflow-hidden">
                    {canEdit ? <GmailSecretCell gmailId={gmail.id} field="token" projectId={projectId!} onSave={(v) => saveField(gmail.id, "token", v)} /> : <span className="text-gray-400">•••</span>}
                  </td>
                  <td style={{ width: colWidths.status }} className="px-1 py-0">
                    {canEdit ? (
                      <select value={gmail.status} onChange={(e) => updateGmail.mutate({ projectId: projectId!, id: gmail.id, status: e.target.value as any })}
                        className={`text-[11px] px-1 py-0.5 rounded border-0 font-medium cursor-pointer w-full ${statusColors[gmail.status] ?? ""}`}>
                        {GMAIL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                      </select>
                    ) : <Badge className={`text-[10px] ${statusColors[gmail.status] ?? ""}`}>{gmail.status}</Badge>}
                  </td>
                  <td style={{ width: colWidths.server }} className="px-1 py-0 text-gray-600">{gmail.vms?.[0]?.server?.code ?? "—"}</td>
                  <td style={{ width: colWidths.vm }} className="px-1 py-0 font-mono">
                    {gmail.vms?.length > 0
                      ? gmail.vms.map((v: any) => v.code).join(", ")
                      : <span className="text-orange-500 text-[10px]">free</span>}
                  </td>
                  <td style={{ width: colWidths.notes }} className="px-1 py-0 overflow-hidden">
                    <SmartCell value={gmail.notes ?? ""} onSave={canEdit ? (v) => saveField(gmail.id, "notes", v) : undefined} copyable={false} placeholder="—" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-1.5 bg-gray-50 border-t text-[11px] text-gray-500">{items.length} {t("gmail_accounts")}</div>
        </div>
      )}
    </div>
  );
}
