"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { useTableSort, SortIcon } from "@/components/tables/useTableSort";
import { exportToExcel } from "@/lib/excel-export";
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
function SecretCell({ onSave, placeholder }: {
  onSave: (v: string) => void;
  placeholder: string;
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
      *** click
    </div>
  );
}

export default function GmailsPage() {
  const { currentProjectId: projectId, currentRole } = useProjectStore();
  const utils = trpc.useUtils();

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
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
  const createGmail = trpc.gmail.create.useMutation({ onSuccess: () => { invalidate(); setAddEmail(""); setAddPassword(""); setAddRecovery(""); setAdd2fa(""); toast.success("Gmail created"); }, onError: (e) => toast.error(e.message) });
  const bulkImport = trpc.gmail.bulkImport.useMutation({ onSuccess: (d) => { invalidate(); setShowPaste(false); setPasteText(""); toast.success(`Imported ${d.imported} gmails`); }, onError: (e) => toast.error(e.message) });
  const assignGmail = trpc.gmail.assignToVm.useMutation({ onSuccess: () => { invalidate(); toast.success("Assigned"); } });
  const updateGmail = trpc.gmail.update.useMutation({ onSuccess: () => { invalidate(); toast.success("Saved"); }, onError: (e) => toast.error(e.message) });
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
          (g.vm?.code ?? "").toLowerCase().includes(q) ||
          (g.vm?.server?.code ?? "").toLowerCase().includes(q) ||
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

  const bulkUnassignVm = () => {
    if (!confirm(`Unassign ${selected.size} Gmail accounts from their VMs?`)) return;
    const ids = Array.from(selected);
    Promise.all(ids.map((id) => assignGmail.mutateAsync({ projectId: projectId!, gmailId: id, vmId: null })))
      .then(() => { invalidate(); setSelected(new Set()); });
  };

  const bulkDisable = () => {
    if (!confirm(`Disable ${selected.size} Gmail accounts?`)) return;
    const ids = Array.from(selected);
    Promise.all(ids.map((id) => updateGmail.mutateAsync({ projectId: projectId!, id, status: "DISABLED" as any })))
      .then(() => { invalidate(); setSelected(new Set()); });
  };

  const bulkDelete = () => {
    if (!confirm(`XOA VINH VIEN ${selected.size} Gmail accounts? Khong the hoan tac!`)) return;
    bulkDeleteGmail.mutate({ projectId: projectId!, ids: Array.from(selected) });
  };

  const handlePasteImport = () => {
    const lines = pasteText.trim().split("\n").filter(Boolean);
    const gmails = lines.map((line) => {
      const parts = line.split("\t");
      return { email: parts[0]?.trim() ?? "", password: parts[1]?.trim() || undefined, recoveryEmail: parts[2]?.trim() || undefined, twoFaCurrent: parts[3]?.trim() || undefined };
    }).filter((g) => g.email.includes("@"));
    if (gmails.length === 0) return;
    bulkImport.mutate({ projectId: projectId!, gmails });
  };

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gmail Accounts</h1>
          <p className="text-sm text-gray-500">Click any cell to edit inline. Checkbox to select for bulk actions.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => { setStatusFilter("ALL"); setShowUnassigned(false); }} className={`px-3 py-1 rounded-full text-xs font-medium transition ${statusFilter === "ALL" && !showUnassigned ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
          All ({data?.total ?? 0})
        </button>
        <button onClick={() => { setShowUnassigned(!showUnassigned); setStatusFilter("ALL"); }} className={`px-3 py-1 rounded-full text-xs font-medium transition ${showUnassigned ? "bg-orange-600 text-white" : "bg-orange-50 text-orange-700 hover:bg-orange-100"}`}>
          Unassigned
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
            placeholder="Search email, VM, server, notes..."
          />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">&times;</button>}
        </div>
        {search && <span className="text-xs text-gray-500">{items.length} results</span>}
        <button
          onClick={() => {
            if (!items.length) return;
            exportToExcel(
              items.map((g: any, i: number) => ({
                "#": i + 1,
                Email: g.email ?? "",
                "Recovery Mail": g.recoveryEmail ?? "",
                Status: g.status ?? "",
                Server: g.vm?.server?.code ?? "",
                VM: g.vm?.code ?? "",
                Notes: g.notes ?? "",
              })),
              "gmails-export",
              "Gmails"
            );
          }}
          disabled={!items.length}
          className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
        >
          Export Excel
        </button>
      {canEdit && (
        <>
          <button onClick={() => { setShowAdd(!showAdd); setShowPaste(false); }} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700">+ Add Gmail</button>
          <button onClick={() => { setShowPaste(!showPaste); setShowAdd(false); }} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700">Paste Import</button>

          {selected.size > 0 && (
            <>
              <span className="text-gray-300 mx-1">|</span>
              <span className="text-xs font-medium text-blue-600">{selected.size} selected</span>
              <select defaultValue="" onChange={(e) => { if (e.target.value) { bulkUpdateStatus(e.target.value); e.target.value = ""; } }} className="px-2 py-1 border rounded text-xs">
                <option value="" disabled>Change Status...</option>
                {GMAIL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
              <button onClick={bulkUnassignVm} className="px-3 py-1.5 bg-orange-50 text-orange-600 rounded text-xs font-medium hover:bg-orange-100">Unassign VMs</button>
              {canDelete && <button onClick={bulkDisable} className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-medium hover:bg-red-100">Disable Selected</button>}
              {canDelete && <button onClick={bulkDelete} disabled={bulkDeleteGmail.isLoading} className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50">{bulkDeleteGmail.isLoading ? "Deleting..." : "Delete Selected"}</button>}
              <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:underline">Clear</button>
            </>
          )}
        </>
      )}
      </div>

      {/* Add */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold">Add Gmail Account</h3>
          <div className="flex items-end gap-3 flex-wrap">
            <div><label className="block text-xs text-gray-600 mb-1">Email *</label><input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} className="w-56 px-2 py-1.5 border rounded text-xs" placeholder="abc@gmail.com" /></div>
            <div><label className="block text-xs text-gray-600 mb-1">Password</label><input value={addPassword} onChange={(e) => setAddPassword(e.target.value)} className="w-40 px-2 py-1.5 border rounded text-xs" placeholder="password" /></div>
            <div><label className="block text-xs text-gray-600 mb-1">Recovery</label><input value={addRecovery} onChange={(e) => setAddRecovery(e.target.value)} className="w-48 px-2 py-1.5 border rounded text-xs" placeholder="recovery@yahoo.com" /></div>
            <div><label className="block text-xs text-gray-600 mb-1">2FA Codes</label><input value={add2fa} onChange={(e) => setAdd2fa(e.target.value)} className="w-48 px-2 py-1.5 border rounded text-xs" placeholder="abcd efgh ijkl" /></div>
            <button onClick={() => createGmail.mutate({ projectId: projectId!, email: addEmail, password: addPassword || undefined, recoveryEmail: addRecovery || undefined, twoFaCurrent: add2fa || undefined })} disabled={createGmail.isLoading || !addEmail} className="px-4 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50">{createGmail.isLoading ? "..." : "Add"}</button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 bg-gray-100 rounded text-xs hover:bg-gray-200">Cancel</button>
          </div>
          {createGmail.error && <p className="text-xs text-red-600">{createGmail.error.message}</p>}
        </div>
      )}

      {/* Paste Import */}
      {showPaste && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold">Paste Gmail Data</h3>
          <p className="text-xs text-gray-500">Tab-separated: email, password, recovery_email, 2fa_codes</p>
          <div className="flex gap-3">
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={5} className="flex-1 px-3 py-2 border rounded text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none" placeholder={"abc@gmail.com\tpass123\trecovery@yahoo.com\tabcd efgh"} />
            <div className="flex flex-col gap-2 w-36">
              <button onClick={handlePasteImport} disabled={bulkImport.isLoading || !pasteText.trim()} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">{bulkImport.isLoading ? "..." : `Import (${pasteText.trim().split("\n").filter(Boolean).length})`}</button>
              <button onClick={() => { setShowPaste(false); setPasteText(""); }} className="px-3 py-1.5 bg-gray-100 rounded text-xs hover:bg-gray-200">Cancel</button>
            </div>
          </div>
          {bulkImport.data && <p className="text-xs text-green-700">Imported {bulkImport.data.imported}/{bulkImport.data.total}</p>}
        </div>
      )}

      {/* Table */}
      {isLoading ? <p className="text-gray-500 p-4">Loading...</p> : items.length === 0 ? (
        <div className="text-center py-12 bg-white border rounded-lg"><p className="text-gray-500">No Gmail accounts yet.</p></div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="w-8 px-2 py-2"><input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} className="rounded" /></th>
                <th className="px-2 py-2 text-left font-medium text-gray-500 w-8">#</th>
                {([
                  ["email", "Email", ""],
                  ["_pw", "Password", "w-24"],
                  ["_2fa", "2FA", "w-24"],
                  ["recoveryEmail", "Recovery Mail", ""],
                  ["status", "Status", "w-28"],
                  ["vm.server.code", "Server", ""],
                  ["vm.code", "VM", ""],
                  ["notes", "Notes", ""],
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
                  <td className="px-1 py-0.5">{canEdit ? <SecretCell onSave={(v) => saveField(gmail.id, "password", v)} placeholder="password" /> : <span className="px-2 text-gray-400">***</span>}</td>
                  <td className="px-1 py-0.5">{canEdit ? <SecretCell onSave={(v) => saveField(gmail.id, "twoFaCurrent", v)} placeholder="2FA codes" /> : <span className="px-2 text-gray-400">***</span>}</td>
                  <td className="px-1 py-0.5">{canEdit ? <EditableCell value={gmail.recoveryEmail ?? ""} onSave={(v) => saveField(gmail.id, "recoveryEmail", v)} placeholder="recovery@..." /> : <span className="px-2">{gmail.recoveryEmail ?? "—"}</span>}</td>
                  <td className="px-1 py-0.5">
                    {canEdit ? (
                      <select value={gmail.status} onChange={(e) => updateGmail.mutate({ projectId: projectId!, id: gmail.id, status: e.target.value as any })} className={`text-xs px-2 py-1 rounded border-0 font-medium cursor-pointer w-full ${statusColors[gmail.status] ?? ""}`}>
                        {GMAIL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                      </select>
                    ) : <Badge className={`text-xs ${statusColors[gmail.status] ?? ""}`}>{gmail.status}</Badge>}
                  </td>
                  <td className="px-1 py-0.5 text-gray-600 px-2">{gmail.vm?.server?.code ?? "—"}</td>
                  <td className="px-1 py-0.5 font-mono">
                    {gmail.vm ? (
                      <div className="flex items-center gap-1 group px-2">
                        <span>{gmail.vm.code}</span>
                        {canEdit && <button onClick={() => assignGmail.mutate({ projectId: projectId!, gmailId: gmail.id, vmId: null })} className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 text-sm leading-none">&times;</button>}
                      </div>
                    ) : <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">Free</Badge>}
                  </td>
                  <td className="px-1 py-0.5">{canEdit ? <EditableCell value={gmail.notes ?? ""} onSave={(v) => saveField(gmail.id, "notes", v)} placeholder="notes..." /> : <span className="px-2">{gmail.notes ?? "—"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-500">{items.length} Gmail accounts</div>
        </div>
      )}
    </div>
  );
}
