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
  AVAILABLE: "bg-green-100 text-green-800",
  IN_USE: "bg-blue-100 text-blue-800",
  BLOCKED: "bg-red-100 text-red-800",
  RESERVED: "bg-yellow-100 text-yellow-800",
};
const PROXY_STATUSES = ["AVAILABLE", "IN_USE", "BLOCKED", "RESERVED"] as const;

// ─── Editable Cell (self-contained) ─────────
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

export default function ProxiesPage() {
  const { currentProjectId: projectId, currentRole } = useProjectStore();
  const utils = trpc.useUtils();
  const t = useT();

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch } = trpc.proxy.list.useQuery(
    { projectId: projectId!, status: (statusFilter !== "ALL" ? statusFilter : undefined) as any, limit: 200 },
    { enabled: !!projectId }
  );
  const { data: counts } = trpc.proxy.statusCounts.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const invalidate = () => { utils.proxy.list.invalidate(); utils.proxy.statusCounts.invalidate(); refetch(); };
  const autoAssign = trpc.proxy.autoAssign.useMutation({ onSuccess: (d) => { invalidate(); toast.success(d.message); }, onError: (e) => toast.error(e.message) });
  const bulkImport = trpc.proxy.bulkImport.useMutation({ onSuccess: (d) => { invalidate(); setShowImport(false); toast.success(`Imported ${d.imported} proxies`); }, onError: (e) => toast.error(e.message) });
  const unassignProxy = trpc.proxy.unassign.useMutation({ onSuccess: () => { invalidate(); toast.success(t("proxy_unassigned")); } });
  const updateProxy = trpc.proxy.update.useMutation({ onSuccess: () => { invalidate(); toast.success(t("saved")); }, onError: (e) => toast.error(e.message) });
  const bulkDeleteProxy = trpc.proxy.bulkDelete.useMutation({ onSuccess: (d) => { invalidate(); setSelected(new Set()); toast.success(`Deleted ${d.deleted} proxies`); } });

  const canEdit = currentRole === "ADMIN" || currentRole === "MODERATOR" || currentRole === "USER";
  const canDelete = currentRole === "ADMIN" || currentRole === "MODERATOR";

  const countMap = Object.fromEntries((counts ?? []).map((c) => [c.status, c._count]));
  const totalProxies = Object.values(countMap).reduce((a: number, b: any) => a + b, 0);
  const rawItems = data?.items ?? [];
  const searchedItems = search.trim()
    ? rawItems.filter((p: any) => {
        const q = search.toLowerCase();
        return (
          (p.address ?? "").toLowerCase().includes(q) ||
          (p.host ?? "").toLowerCase().includes(q) ||
          (p.subnet ?? "").toLowerCase().includes(q) ||
          (p.vm?.code ?? "").toLowerCase().includes(q) ||
          (p.status ?? "").toLowerCase().includes(q)
        );
      })
    : rawItems;
  const { sorted: items, sortKey, sortDir, handleSort } = useTableSort(searchedItems);

  // ─── Save field ───────────────────────────
  const saveField = (id: string, field: string, value: string) => {
    const payload: any = { projectId: projectId!, id };
    if (field === "port") {
      payload[field] = value ? parseInt(value) : null;
    } else {
      payload[field] = value || null;
    }
    updateProxy.mutate(payload);
  };

  // ─── Selection ────────────────────────────
  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((p: any) => p.id)));
  };

  const bulkUpdateStatus = (status: string) => {
    const ids = Array.from(selected);
    Promise.all(ids.map((id) => updateProxy.mutateAsync({ projectId: projectId!, id, status: status as any })))
      .then(() => { invalidate(); setSelected(new Set()); });
  };

  const bulkBlock = () => {
    if (!confirm(`Block ${selected.size} proxies?`)) return;
    bulkUpdateStatus("BLOCKED");
  };

  const bulkDelete = () => {
    if (!confirm(t("proxy_delete_confirm"))) return;
    bulkDeleteProxy.mutate({ projectId: projectId!, ids: Array.from(selected) });
  };

  const handleCSVImport = (rows: Record<string, string>[]) => {
    const proxies = rows.map((row) => ({
      address: row["Address"] || row["address"] || "",
      subnet: row["Subnet"] || row["subnet"] || undefined,
    })).filter((p) => p.address);
    if (proxies.length === 0) return;
    bulkImport.mutate({ projectId: projectId!, proxies });
  };

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("proxy_title")}</h1>
          <p className="text-sm text-gray-500">{t("proxy_subtitle")}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setStatusFilter("ALL")} className={`px-3 py-1 rounded-full text-xs font-medium transition ${statusFilter === "ALL" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{t("all")} ({totalProxies})</button>
        {PROXY_STATUSES.map((s) => (
          <button key={s} onClick={() => setStatusFilter(s === statusFilter ? "ALL" : s)} className={`px-3 py-1 rounded-full text-xs font-medium transition ${statusFilter === s ? "bg-gray-900 text-white" : `${statusColors[s]} hover:opacity-80`}`}>{s} ({countMap[s] ?? 0})</button>
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
            placeholder={t("proxy_search")}
          />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">&times;</button>}
        </div>
        {search && <span className="text-xs text-gray-500">{items.length} {t("proxy_results")}</span>}
        <button
          onClick={() => {
            if (!items.length) return;
            exportToCSV(
              items.map((p: any, i: number) => ({
                "#": i + 1,
                [t("info_address")]: p.address ?? "",
                [t("col_status")]: p.status ?? "",
                [t("col_vm")]: p.vm?.code ?? "",
                [t("proxy_subnet")]: p.subnet ?? "",
              })),
              "proxies-export"
            );
          }}
          disabled={!items.length}
          className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
        >
          {t("export_excel")}
        </button>
      {canEdit && (
        <>
          <button onClick={() => setShowImport(true)} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700">{t("proxy_import")}</button>
          <button onClick={() => autoAssign.mutate({ projectId: projectId! })} disabled={autoAssign.isLoading} className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50">
            {autoAssign.isLoading ? "Assigning..." : `${t("proxy_auto_assign")} (${countMap["AVAILABLE"] ?? 0} ${t("proxy_avail")})`}
          </button>
          {selected.size > 0 && (
            <>
              <span className="text-gray-300 mx-1">|</span>
              <span className="text-xs font-medium text-blue-600">{selected.size} {t("selected")}</span>
              <select defaultValue="" onChange={(e) => { if (e.target.value) { bulkUpdateStatus(e.target.value); e.target.value = ""; } }} className="px-2 py-1 border rounded text-xs">
                <option value="" disabled>{t("change_status")}</option>
                {PROXY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {canDelete && <button onClick={bulkBlock} className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-medium hover:bg-red-100">{t("proxy_block_selected")}</button>}
              {canDelete && <button onClick={bulkDelete} disabled={bulkDeleteProxy.isLoading} className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50">{bulkDeleteProxy.isLoading ? "Deleting..." : t("delete_selected")}</button>}
              <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:underline">{t("clear")}</button>
            </>
          )}
        </>
      )}
      </div>

      {/* Import CSV Dialog */}
      <ImportCSVDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleCSVImport}
        title={t("proxy_import")}
        description={t("proxy_paste_desc")}
        templateColumns={["Address", "Subnet"]}
      />

      {autoAssign.data && <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">{autoAssign.data.message}</div>}

      {/* Table */}
      {isLoading ? <p className="text-gray-500 p-4">{t("loading")}</p> : items.length === 0 ? (
        <div className="text-center py-12 bg-white border rounded-lg"><p className="text-gray-500">{t("proxy_no_proxies")}</p></div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="w-8 px-2 py-2"><input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} className="rounded" /></th>
                <th className="px-2 py-2 text-left font-medium text-gray-500 w-8">#</th>
                {([
                  ["address", t("info_address"), ""],
                  ["status", t("col_status"), "w-28"],
                  ["vm.code", t("col_vm"), ""],
                ] as [string, string, string][]).map(([key, label, cls]) => (
                  <th
                    key={key}
                    className={`px-1 py-2 text-left font-medium text-gray-500 cursor-pointer select-none hover:bg-gray-100 ${cls}`}
                    onClick={() => handleSort(key)}
                  >
                    {label}<SortIcon active={sortKey === key} direction={sortDir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((proxy: any, idx: number) => (
                <tr key={proxy.id} className={`${selected.has(proxy.id) ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                  <td className="px-2 py-0.5 text-center"><input type="checkbox" checked={selected.has(proxy.id)} onChange={() => toggleSelect(proxy.id)} className="rounded" /></td>
                  <td className="px-2 py-0.5 text-gray-400">{idx + 1}</td>
                  <td className="px-1 py-0.5">{canEdit ? <EditableCell value={proxy.address ?? ""} onSave={(v) => saveField(proxy.id, "address", v)} mono /> : <span className="font-mono px-2">{proxy.address}</span>}</td>
                  <td className="px-1 py-0.5">
                    {canEdit ? (
                      <select value={proxy.status} onChange={(e) => updateProxy.mutate({ projectId: projectId!, id: proxy.id, status: e.target.value as any })} className={`text-xs px-2 py-1 rounded border-0 font-medium cursor-pointer w-full ${statusColors[proxy.status] ?? ""}`}>
                        {PROXY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <Badge className={`text-xs ${statusColors[proxy.status] ?? ""}`}>{proxy.status}</Badge>}
                  </td>
                  <td className="px-1 py-0.5 font-medium">
                    {proxy.vm ? (
                      <div className="flex items-center gap-1 group px-2">
                        <span>{proxy.vm.code}</span>
                        {canEdit && <button onClick={() => unassignProxy.mutate({ projectId: projectId!, proxyId: proxy.id })} className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 text-sm leading-none">&times;</button>}
                      </div>
                    ) : <span className="text-gray-300 px-2">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-500">{items.length} {t("proxy_proxies")}</div>
        </div>
      )}
    </div>
  );
}
