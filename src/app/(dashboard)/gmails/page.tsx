"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { useTableSort, SortIcon } from "@/components/tables/useTableSort";
import { exportToCSV } from "@/lib/excel-export";
import { ImportCSVDialog } from "@/components/forms/ImportCSVDialog";
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

// ─── Self-contained Editable Cell ─────────
function EditableCell({ value, onSave, mono, placeholder }: {
  value: string;
  onSave: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const open = () => {
    setDraft(value);
    setEditing(true);
  };

  const save = useCallback(() => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }, [draft, value, onSave]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") setEditing(false);
    if (e.key === "Tab") save();
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
        className={`w-full px-2 py-1 border border-blue-400 rounded text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none ${mono ? "font-mono" : ""}`}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div
      className={`w-full min-h-[28px] flex items-center px-2 py-1 rounded cursor-pointer hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-colors ${mono ? "font-mono" : ""}`}
      onClick={open}
    >
      <span className={value ? "" : "text-gray-300"}>{value || placeholder || "—"}</span>
    </div>
  );
}

// ─── Self-contained Secret Cell (password/2FA) ─────────
function SecretCell({ onSave, placeholder, displayText }: {
  onSave: (v: string) => void;
  placeholder: string;
  displayText?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const open = () => {
    setDraft("");
    setEditing(true);
  };

  const save = useCallback(() => {
    setEditing(false);
    if (draft) onSave(draft);
  }, [draft, onSave]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") setEditing(false);
    if (e.key === "Tab") save();
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
        className="w-full px-2 py-1 border border-blue-400 rounded text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
        placeholder={placeholder}
      />
    );
  }

  return (
    <div
      className="w-full min-h-[28px] flex items-center px-2 py-1 rounded cursor-pointer hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-colors text-gray-400 text-xs"
      onClick={open}
      title={`Click to change ${placeholder}`}
    >
      {displayText ?? "*** click"}
    </div>
  );
}

export default function GmailsPage() {
  const { currentProjectId: projectId, currentRole } = useProjectStore();
  const utils = trpc.useUtils();
  const t = useT();

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // Add form
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addRecovery, setAddRecovery] = useState("");
  const [add2fa, setAdd2fa] = useState("");

  const { data, isLoading, refetch } = trpc.gmail.list.useQuery(
    { projectId: projectId!, status: statusFilter !== "ALL" ? statusFilter : undefined, unassigned: showUnassigned || undefined, limit: 200 },
    { enabled: !!projectId }
  );

  const invalidate = () => { utils.gmail.list.invalidate(); refetch(); };
  const createGmail = trpc.gmail.create.useMutation({ onSuccess: () => { invalidate(); setAddEmail(""); setAddPassword(""); setAddRecovery(""); setAdd2fa(""); toast.success(t("gmail_created")); }, onError: (e) => toast.error(e.message) });
  const bulkImport = trpc.gmail.bulkImport.useMutation({ onSuccess: (d) => { invalidate(); setShowImport(false); toast.success(`Imported ${d.imported} gmails`); }, onError: (e) => toast.error(e.message) });
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

  // ─── Save field ───────────────────────────
  const saveField = (id: string, field: string, value: string) => {
    const payload: any = { projectId: projectId!, id };
    if (field === "password" || field === "twoFaCurrent") {
      if (value) payload[field] = value;
      else return; // don't save empty secret
    } else {
      payload[field] = value || null;
    }
    updateGmail.mutate(payload);
  };

  // ─── Selection ────────────────────────────
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

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("gmail_title")}</h1>
          <p className="text-sm text-gray-500">{t("gmail_subtitle")}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => { setStatusFilter("ALL"); setShowUnassigned(false); }} className={`px-3 py-1 rounded-full text-xs font-medium transition ${statusFilter === "ALL" && !showUnassigned ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
          {t("all")} ({data?.total ?? 0})
        </button>
        <button onClick={() => { setShowUnassigned(!showUnassigned); setStatusFilter("ALL"); }} className={`px-3 py-1 rounded-full text-xs font-medium transition ${showUnassigned ? "bg-orange-600 text-white" : "bg-orange-50 text-orange-700 hover:bg-orange-100"}`}>
          {t("unassigned")}
        </button>
        {GMAIL_STATUSES.map((s) => (
          <button key={s} onClick={() => { setStatusFilter(s === statusFilter ? "ALL" : s); setShowUnassigned(false); }} className={`px-3 py-1 rounded-full text-xs font-medium transition ${statusFilter === s ? "bg-gray-900 text-white" : `${statusColors[s]} hover:opacity-80`}`}>
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* Search + Toolbar */}
      <div className="flex items-center gap-2 flex-wrap bg-gray-50 rounded-lg p-3 border">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 border rounded text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder={t("gmail_search")}
          />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">&times;</button>}
        </div>
        {search && <span className="text-xs text-gray-500">{items.length} results</span>}
        <button
          onClick={() => {
            if (!items.length) return;
            exportToCSV(
              items.map((g: any, i: number) => ({
                "#": i + 1,
                [t("email")]: g.email ?? "",
                [t("gmail_recovery_mail")]: g.recoveryEmail ?? "",
                [t("col_status")]: g.status ?? "",
                [t("col_server")]: g.vm?.server?.code ?? "",
                [t("col_vm")]: g.vm?.code ?? "",
                [t("col_notes")]: g.notes ?? "",
              })),
              "gmails-export"
            );
          }}
          disabled={!items.length}
          className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
        >
          {t("export_excel")}
        </button>
      {canEdit && (
        <>
          <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700">{t("gmail_add")}</button>
          <button onClick={() => setShowImport(true)} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700">{t("gmail_paste_import")}</button>

          {selected.size > 0 && (
            <>
              <span className="text-gray-300 mx-1">|</span>
              <span className="text-xs font-medium text-blue-600">{selected.size} {t("selected")}</span>
              <select defaultValue="" onChange={(e) => { if (e.target.value) { bulkUpdateStatus(e.target.value); e.target.value = ""; } }} className="px-2 py-1 border rounded text-xs">
                <option value="" disabled>{t("change_status")}</option>
                {GMAIL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
              {canDelete && <button onClick={bulkDisable} className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-medium hover:bg-red-100">{t("gmail_disable_selected")}</button>}
              {canDelete && <button onClick={bulkDelete} disabled={bulkDeleteGmail.isLoading} className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50">{bulkDeleteGmail.isLoading ? "Deleting..." : t("delete_selected")}</button>}
              <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:underline">{t("clear")}</button>
            </>
          )}
        </>
      )}
      </div>

      {/* Add */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold">{t("gmail_add_title")}</h3>
          <div className="flex items-end gap-3 flex-wrap">
            <div><label className="block text-xs text-gray-600 mb-1">{t("email")} *</label><input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} className="w-56 px-2 py-1.5 border rounded text-xs" placeholder="abc@gmail.com" /></div>
            <div><label className="block text-xs text-gray-600 mb-1">{t("password")}</label><input value={addPassword} onChange={(e) => setAddPassword(e.target.value)} className="w-40 px-2 py-1.5 border rounded text-xs" placeholder="password" /></div>
            <div><label className="block text-xs text-gray-600 mb-1">{t("gmail_recovery")}</label><input value={addRecovery} onChange={(e) => setAddRecovery(e.target.value)} className="w-48 px-2 py-1.5 border rounded text-xs" placeholder="recovery@yahoo.com" /></div>
            <div><label className="block text-xs text-gray-600 mb-1">{t("gmail_2fa")}</label><input value={add2fa} onChange={(e) => setAdd2fa(e.target.value)} className="w-48 px-2 py-1.5 border rounded text-xs" placeholder="abcd efgh ijkl" /></div>
            <button onClick={() => createGmail.mutate({ projectId: projectId!, email: addEmail, password: addPassword || undefined, recoveryEmail: addRecovery || undefined, twoFaCurrent: add2fa || undefined })} disabled={createGmail.isLoading || !addEmail} className="px-4 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50">{createGmail.isLoading ? "..." : t("add")}</button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 bg-gray-100 rounded text-xs hover:bg-gray-200">{t("cancel")}</button>
          </div>
          {createGmail.error && <p className="text-xs text-red-600">{createGmail.error.message}</p>}
        </div>
      )}

      {/* CSV Import Dialog */}
      <ImportCSVDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        title={t("gmail_paste_title")}
        description={t("gmail_paste_desc")}
        templateColumns={["Email", "Password", "Recovery Email", "2FA Code"]}
        onImport={(rows) => {
          const gmails = rows
            .map((row) => ({
              email: (row["Email"] ?? "").trim(),
              password: (row["Password"] ?? "").trim() || undefined,
              twoFaCurrent: (row["2FA Code"] ?? "").trim() || undefined,
              recoveryEmail: (row["Recovery Email"] ?? "").trim() || undefined,
            }))
            .filter((g) => g.email.includes("@"));
          if (gmails.length === 0) return;
          bulkImport.mutate({ projectId: projectId!, gmails });
        }}
      />

      {/* Table */}
      {isLoading ? <p className="text-gray-500 p-4">{t("loading")}</p> : items.length === 0 ? (
        <div className="text-center py-12 bg-white border rounded-lg"><p className="text-gray-500">{t("gmail_no_accounts")}</p></div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="w-8 px-2 py-2"><input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} className="rounded" /></th>
                <th className="px-2 py-2 text-left font-medium text-gray-500 w-8">#</th>
                {([
                  ["email", t("email"), ""],
                  ["_pw", t("password"), "w-24"],
                  ["_2fa", t("gmail_2fa_col"), "w-24"],
                  ["recoveryEmail", t("gmail_recovery_mail"), ""],
                  ["status", t("col_status"), "w-28"],
                  ["vm.server.code", t("col_server"), ""],
                  ["vm.code", t("col_vm"), ""],
                  ["notes", t("col_notes"), ""],
                ] as [string, string, string][]).map(([key, label, cls]) => (
                  <th
                    key={key}
                    className={`px-1 py-2 text-left font-medium text-gray-500 ${key.startsWith("_") ? "" : "cursor-pointer select-none hover:bg-gray-100"} ${cls}`}
                    onClick={() => !key.startsWith("_") && handleSort(key)}
                  >
                    {label}{!key.startsWith("_") && <SortIcon active={sortKey === key} direction={sortDir} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((gmail: any, idx: number) => (
                <tr key={gmail.id} className={`${selected.has(gmail.id) ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                  <td className="px-2 py-0.5 text-center"><input type="checkbox" checked={selected.has(gmail.id)} onChange={() => toggleSelect(gmail.id)} className="rounded" /></td>
                  <td className="px-2 py-0.5 text-gray-400">{idx + 1}</td>
                  <td className="px-1 py-0.5">{canEdit ? <EditableCell value={gmail.email ?? ""} onSave={(v) => saveField(gmail.id, "email", v)} mono /> : <span className="font-mono px-2">{gmail.email}</span>}</td>
                  <td className="px-1 py-0.5">{canEdit ? <SecretCell onSave={(v) => saveField(gmail.id, "password", v)} placeholder="password" displayText={t("gmail_click_pass")} /> : <span className="px-2 text-gray-400">***</span>}</td>
                  <td className="px-1 py-0.5">{canEdit ? <SecretCell onSave={(v) => saveField(gmail.id, "twoFaCurrent", v)} placeholder="2FA codes" displayText={t("gmail_click_pass")} /> : <span className="px-2 text-gray-400">***</span>}</td>
                  <td className="px-1 py-0.5">{canEdit ? <EditableCell value={gmail.recoveryEmail ?? ""} onSave={(v) => saveField(gmail.id, "recoveryEmail", v)} placeholder="recovery@..." /> : <span className="px-2">{gmail.recoveryEmail ?? "—"}</span>}</td>
                  <td className="px-1 py-0.5">
                    {canEdit ? (
                      <select value={gmail.status} onChange={(e) => updateGmail.mutate({ projectId: projectId!, id: gmail.id, status: e.target.value as any })} className={`text-xs px-2 py-1 rounded border-0 font-medium cursor-pointer w-full ${statusColors[gmail.status] ?? ""}`}>
                        {GMAIL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                      </select>
                    ) : <Badge className={`text-xs ${statusColors[gmail.status] ?? ""}`}>{gmail.status}</Badge>}
                  </td>
                  <td className="px-1 py-0.5 text-gray-600 px-2">{gmail.vms?.[0]?.server?.code ?? "—"}</td>
                  <td className="px-1 py-0.5 font-mono">
                    {gmail.vms && gmail.vms.length > 0 ? (
                      <div className="flex items-center gap-1 px-2">
                        {gmail.vms.map((v: any) => <span key={v.id} className="text-xs">{v.code}</span>)}
                        <span className="text-[10px] text-gray-400">({gmail.vms.length}/2)</span>
                      </div>
                    ) : <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">{t("free")}</Badge>}
                  </td>
                  <td className="px-1 py-0.5">{canEdit ? <EditableCell value={gmail.notes ?? ""} onSave={(v) => saveField(gmail.id, "notes", v)} placeholder={t("col_notes").toLowerCase() + "..."} /> : <span className="px-2">{gmail.notes ?? "—"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-500">{items.length} {t("gmail_accounts")}</div>
        </div>
      )}
    </div>
  );
}
