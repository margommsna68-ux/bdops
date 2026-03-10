"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { useTableSort, SortIcon } from "@/components/tables/useTableSort";
import { exportToExcel } from "@/lib/excel-export";
import toast from "react-hot-toast";

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  LIMITED: "bg-yellow-100 text-yellow-800",
  SUSPENDED: "bg-red-100 text-red-800",
  CLOSED: "bg-gray-100 text-gray-800",
  PENDING_VERIFY: "bg-blue-100 text-blue-800",
};
const roleColors: Record<string, string> = {
  NORMAL: "bg-gray-100 text-gray-700",
  MASTER: "bg-purple-100 text-purple-800",
  USDT: "bg-orange-100 text-orange-800",
};
const PP_STATUSES = ["ACTIVE", "LIMITED", "SUSPENDED", "CLOSED", "PENDING_VERIFY"] as const;
const PP_ROLES = ["NORMAL", "MASTER", "USDT"] as const;

// ─── Inline Editable Cell ─────────
function EditableCell({ value, onSave, mono, placeholder }: {
  value: string;
  onSave: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
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
        onClick={(e) => e.stopPropagation()}
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

export default function PayPalsPage() {
  const router = useRouter();
  const { currentProjectId: projectId, currentRole } = useProjectStore();
  const utils = trpc.useUtils();

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  // Add form state
  const [addCode, setAddCode] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<string>("NORMAL");
  const [addCompany, setAddCompany] = useState("Bright Data Ltd.");

  const { data, isLoading, refetch } = trpc.paypal.list.useQuery(
    {
      projectId: projectId!,
      page: 1,
      search: search || undefined,
      status: (statusFilter !== "ALL" ? statusFilter : undefined) as any,
      role: (roleFilter !== "ALL" ? roleFilter : undefined) as any,
    },
    { enabled: !!projectId }
  );

  const invalidate = () => { utils.paypal.list.invalidate(); refetch(); };
  const createPaypal = trpc.paypal.create.useMutation({
    onSuccess: () => { invalidate(); setShowAdd(false); setAddCode(""); setAddEmail(""); setAddRole("NORMAL"); toast.success("PayPal created"); },
    onError: (e) => toast.error(e.message),
  });
  const updatePaypal = trpc.paypal.update.useMutation({ onSuccess: () => { invalidate(); toast.success("Saved"); }, onError: (e) => toast.error(e.message) });

  const canEdit = currentRole === "ADMIN" || currentRole === "MODERATOR" || currentRole === "USER";
  const rawItems = data?.items ?? [];
  const { sorted: items, sortKey, sortDir, handleSort } = useTableSort(rawItems);

  const saveField = (id: string, field: string, value: string) => {
    const payload: any = { projectId: projectId!, id };
    payload[field] = value || null;
    updatePaypal.mutate(payload);
  };

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PayPal Accounts</h1>
          <p className="text-sm text-gray-500">{canEdit ? "Click cell to edit inline." : "Manage PayPal accounts for fund collection"}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter("ALL")}
          className={`px-3 py-1 rounded-full text-xs font-medium transition ${statusFilter === "ALL" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
        >
          All ({data?.total ?? 0})
        </button>
        {PP_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s === statusFilter ? "ALL" : s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition ${statusFilter === s ? "bg-gray-900 text-white" : `${statusColors[s]} hover:opacity-80`}`}
          >
            {s}
          </button>
        ))}
        <span className="text-gray-300 mx-1">|</span>
        {PP_ROLES.map((r) => (
          <button
            key={r}
            onClick={() => setRoleFilter(r === roleFilter ? "ALL" : r)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition ${roleFilter === r ? "bg-gray-900 text-white" : `${roleColors[r]} hover:opacity-80`}`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Search + Toolbar */}
      <div className="flex items-center gap-2 flex-wrap bg-gray-50 rounded-lg p-3 border">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
          placeholder="Search by code or email..."
        />
        <button
          onClick={() => {
            if (!items.length) return;
            exportToExcel(
              items.map((pp: any) => ({
                Code: pp.code,
                Email: pp.primaryEmail,
                Status: pp.status,
                Role: pp.role,
                Company: pp.company,
                Gmails: pp._count?.gmails ?? 0,
                Txns: pp._count?.fundsReceived ?? 0,
                Notes: pp.limitNote || pp.notes || "",
              })),
              "paypals-export",
              "PayPals"
            );
          }}
          disabled={!items.length}
          className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
        >
          Export Excel
        </button>
        {canEdit && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
          >
            + Add PayPal
          </button>
        )}
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold">Add PayPal Account</h3>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Code *</label>
              <input value={addCode} onChange={(e) => setAddCode(e.target.value)} className="w-28 px-2 py-1.5 border rounded text-xs" placeholder="PP-011" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Primary Email *</label>
              <input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} className="w-56 px-2 py-1.5 border rounded text-xs" placeholder="business@outlook.com" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Role</label>
              <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className="px-2 py-1.5 border rounded text-xs">
                {PP_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Company</label>
              <input value={addCompany} onChange={(e) => setAddCompany(e.target.value)} className="w-44 px-2 py-1.5 border rounded text-xs" />
            </div>
            <button
              onClick={() => createPaypal.mutate({ projectId: projectId!, code: addCode, primaryEmail: addEmail, role: addRole as any, company: addCompany })}
              disabled={createPaypal.isLoading || !addCode || !addEmail}
              className="px-4 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {createPaypal.isLoading ? "Creating..." : "Create"}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 bg-gray-100 rounded text-xs hover:bg-gray-200">Cancel</button>
          </div>
          {createPaypal.error && <p className="text-xs text-red-600">{createPaypal.error.message}</p>}
        </div>
      )}

      {/* PayPal Table */}
      {isLoading ? (
        <p className="text-gray-500 p-4">Loading...</p>
      ) : items.length === 0 ? (
        <div className="text-center py-12 bg-white border rounded-lg">
          <p className="text-gray-500">No PayPal accounts yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500 w-8">#</th>
                {([
                  ["code", "Code", "text-left"],
                  ["primaryEmail", "Email", "text-left"],
                  ["status", "Status", "text-left w-28"],
                  ["role", "Role", "text-left w-20"],
                  ["company", "Company", "text-left"],
                ] as [string, string, string][]).map(([key, label, cls]) => (
                  <th
                    key={key}
                    className={`px-3 py-2 font-medium text-gray-500 cursor-pointer select-none hover:bg-gray-100 ${cls}`}
                    onClick={() => handleSort(key)}
                  >
                    {label}<SortIcon active={sortKey === key} direction={sortDir} />
                  </th>
                ))}
                <th className="px-3 py-2 text-left font-medium text-gray-500">Gmails</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Txns</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((pp: any, idx: number) => (
                <tr
                  key={pp.id}
                  className="hover:bg-blue-50/50"
                >
                  <td className="px-3 py-1.5 text-gray-400">{idx + 1}</td>
                  <td className="px-3 py-0.5">
                    {canEdit ? (
                      <EditableCell value={pp.code} onSave={(v) => saveField(pp.id, "code", v)} mono />
                    ) : (
                      <span className="font-medium text-blue-600 cursor-pointer hover:underline" onClick={() => router.push(`/paypals/${pp.id}`)}>{pp.code}</span>
                    )}
                  </td>
                  <td className="px-3 py-0.5">
                    {canEdit ? (
                      <EditableCell value={pp.primaryEmail} onSave={(v) => saveField(pp.id, "primaryEmail", v)} />
                    ) : (
                      <span>{pp.primaryEmail}</span>
                    )}
                  </td>
                  <td className="px-3 py-0.5">
                    {canEdit ? (
                      <select
                        value={pp.status}
                        onChange={(e) => { e.stopPropagation(); updatePaypal.mutate({ projectId: projectId!, id: pp.id, status: e.target.value as any }); }}
                        onClick={(e) => e.stopPropagation()}
                        className={`text-xs px-2 py-1 rounded border-0 font-medium cursor-pointer w-full ${statusColors[pp.status] ?? ""}`}
                      >
                        {PP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <Badge className={`text-xs ${statusColors[pp.status] ?? ""}`}>{pp.status}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-0.5">
                    {canEdit ? (
                      <select
                        value={pp.role}
                        onChange={(e) => { e.stopPropagation(); updatePaypal.mutate({ projectId: projectId!, id: pp.id, role: e.target.value as any }); }}
                        onClick={(e) => e.stopPropagation()}
                        className={`text-xs px-2 py-1 rounded border-0 font-medium cursor-pointer w-full ${roleColors[pp.role] ?? ""}`}
                      >
                        {PP_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <Badge variant="outline" className={`text-xs ${roleColors[pp.role] ?? ""}`}>{pp.role}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-0.5">
                    {canEdit ? (
                      <EditableCell value={pp.company ?? ""} onSave={(v) => saveField(pp.id, "company", v)} />
                    ) : (
                      <span className="text-gray-600">{pp.company}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className="cursor-pointer hover:underline text-blue-600"
                      onClick={() => router.push(`/paypals/${pp.id}`)}
                    >
                      {pp._count?.gmails > 0 ? pp._count.gmails : <span className="text-gray-300">0</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <span
                      className="cursor-pointer hover:underline text-blue-600"
                      onClick={() => router.push(`/paypals/${pp.id}`)}
                    >
                      {pp._count?.fundsReceived > 0 ? pp._count.fundsReceived : <span className="text-gray-300">0</span>}
                    </span>
                  </td>
                  <td className="px-3 py-0.5">
                    {canEdit ? (
                      <EditableCell value={pp.notes ?? pp.limitNote ?? ""} onSave={(v) => saveField(pp.id, "notes", v)} placeholder="notes..." />
                    ) : (
                      <span className="text-gray-500 truncate max-w-[150px]">{pp.limitNote || pp.notes || "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-500">
            {items.length} PayPal accounts shown
          </div>
        </div>
      )}
    </div>
  );
}
