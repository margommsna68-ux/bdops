"use client";

import { useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { exportToCSV, parseCSV } from "@/lib/excel-export";
import toast from "react-hot-toast";

const serverStatusColors: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-800",
  BUILDING: "bg-blue-100 text-blue-800",
  ACTIVE: "bg-green-100 text-green-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  EXPIRED: "bg-gray-100 text-gray-800",
  MAINTENANCE: "bg-orange-100 text-orange-800",
};

const vmStatusColors: Record<string, string> = {
  OK: "bg-green-100 text-green-800",
  ERROR: "bg-red-100 text-red-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  NEW: "bg-blue-100 text-blue-800",
  NOT_CONNECTED: "bg-orange-100 text-orange-800",
  NOT_AVC: "bg-purple-100 text-purple-800",
  BLOCKED: "bg-red-200 text-red-900",
};

const ALL_VM_STATUSES = ["OK", "ERROR", "SUSPENDED", "NEW", "NOT_CONNECTED", "NOT_AVC", "BLOCKED"];
const ALL_SERVER_STATUSES = ["BUILDING", "ACTIVE", "SUSPENDED", "EXPIRED", "MAINTENANCE"];

const emptyForm = {
  code: "",
  ipAddress: "",
  provider: "",
  cpu: "",
  ram: "",
  status: "BUILDING" as const,
  inventoryId: "",
  notes: "",
  createdDate: "",
  expiryDate: "",
  credentials: { users: [{ username: "", password: "", role: "" }] },
};

type ServerForm = typeof emptyForm;

export default function ServersPage() {
  const { currentProjectId: projectId, currentRole } = useProjectStore();
  const utils = trpc.useUtils();

  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [vmStatusFilter, setVmStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [vmSearch, setVmSearch] = useState("");

  // CRUD state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ServerForm>({ ...emptyForm });
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Bulk selection
  const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(new Set());
  const [bulkStatusTarget, setBulkStatusTarget] = useState("");
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  // Import CSV
  const [showImport, setShowImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<Record<string, string>[]>([]);

  // Bulk paste dialog for VMs
  const [pasteDialog, setPasteDialog] = useState<{ field: "gmail" | "proxy" } | null>(null);
  const [pasteText, setPasteText] = useState("");

  // Server list
  const { data: servers, isLoading } = trpc.server.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  // Selected server detail
  const { data: serverDetail, isLoading: detailLoading } = trpc.server.getById.useQuery(
    { projectId: projectId!, id: selectedServerId! },
    { enabled: !!projectId && !!selectedServerId }
  );

  // Mutations
  const createServer = trpc.server.create.useMutation({
    onSuccess: () => { utils.server.list.invalidate(); setShowForm(false); setForm({ ...emptyForm }); toast.success("Server created"); },
    onError: (e) => toast.error(e.message),
  });
  const updateServer = trpc.server.update.useMutation({
    onSuccess: () => { utils.server.list.invalidate(); utils.server.getById.invalidate(); setEditId(null); setShowForm(false); setForm({ ...emptyForm }); toast.success("Server updated"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteServer = trpc.server.delete.useMutation({
    onSuccess: () => { utils.server.list.invalidate(); setDeleteConfirm(null); if (deleteConfirm === selectedServerId) setSelectedServerId(null); toast.success("Server deleted"); },
    onError: (e) => toast.error(e.message),
  });
  const bulkUpdateStatus = trpc.server.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { utils.server.list.invalidate(); setSelectedServerIds(new Set()); setBulkStatusTarget(""); toast.success(`${r.updated} servers updated`); },
    onError: (e) => toast.error(e.message),
  });
  const bulkDelete = trpc.server.bulkDelete.useMutation({
    onSuccess: (r) => { utils.server.list.invalidate(); setSelectedServerIds(new Set()); setShowBulkDelete(false); if (selectedServerId && selectedServerIds.has(selectedServerId)) setSelectedServerId(null); toast.success(`${r.deleted} servers deleted`); },
    onError: (e) => toast.error(e.message),
  });
  const importFromCSV = trpc.server.importFromCSV.useMutation({
    onSuccess: (r) => { utils.server.list.invalidate(); setShowImport(false); setImportPreview([]); toast.success(`Imported ${r.imported}, skipped ${r.skipped}`); if (r.errors.length) toast.error(r.errors.join("\n")); },
    onError: (e) => toast.error(e.message),
  });
  const bulkPaste = trpc.vm.bulkPaste.useMutation({
    onSuccess: (r) => { utils.server.getById.invalidate(); setPasteDialog(null); setPasteText(""); toast.success(`Assigned ${r.assigned}/${r.total}`); if (r.errors.length) toast.error(r.errors.slice(0, 5).join("\n")); },
    onError: (e) => toast.error(e.message),
  });

  const canEdit = currentRole === "ADMIN" || currentRole === "MODERATOR" || currentRole === "USER";
  const canDelete = currentRole === "ADMIN" || currentRole === "MODERATOR";

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  // Form handlers
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      projectId: projectId!,
      code: form.code,
      ipAddress: form.ipAddress || undefined,
      provider: form.provider || undefined,
      cpu: form.cpu || undefined,
      ram: form.ram || undefined,
      status: form.status,
      inventoryId: form.inventoryId || undefined,
      notes: form.notes || undefined,
      createdDate: form.createdDate || undefined,
      expiryDate: form.expiryDate || undefined,
    };
    if (form.credentials.users.some((u) => u.username)) {
      payload.credentials = form.credentials;
    }
    if (editId) {
      updateServer.mutate({ ...payload, id: editId });
    } else {
      createServer.mutate(payload);
    }
  };

  const startEdit = (server: any) => {
    setForm({
      code: server.code,
      ipAddress: server.ipAddress || "",
      provider: server.provider || "",
      cpu: server.cpu || "",
      ram: server.ram || "",
      status: server.status,
      inventoryId: server.inventoryId || "",
      notes: server.notes || "",
      createdDate: server.createdDate ? new Date(server.createdDate).toISOString().split("T")[0] : "",
      expiryDate: server.expiryDate ? new Date(server.expiryDate).toISOString().split("T")[0] : "",
      credentials: { users: [{ username: "", password: "", role: "" }] },
    });
    setEditId(server.id);
    setShowForm(true);
  };

  const addCredentialRow = () => {
    setForm((f) => ({
      ...f,
      credentials: { users: [...f.credentials.users, { username: "", password: "", role: "" }] },
    }));
  };

  const updateCredential = (idx: number, field: string, value: string) => {
    setForm((f) => {
      const users = [...f.credentials.users];
      users[idx] = { ...users[idx], [field]: value };
      return { ...f, credentials: { users } };
    });
  };

  const removeCredential = (idx: number) => {
    setForm((f) => ({
      ...f,
      credentials: { users: f.credentials.users.filter((_, i) => i !== idx) },
    }));
  };

  const handleExportCSV = () => {
    if (!servers?.length) return;
    exportToCSV(
      servers.map((s: any) => ({
        code: s.code,
        ipAddress: s.ipAddress ?? "",
        provider: s.provider ?? "",
        cpu: s.cpu ?? "",
        ram: s.ram ?? "",
        status: s.status,
        inventoryId: s.inventoryId ?? "",
        notes: s.notes ?? "",
      })),
      "servers-backup"
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setImportPreview(parsed);
      setShowImport(true);
    };
    reader.readAsText(file);
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  const handleImport = () => {
    const items = importPreview.map((row) => ({
      code: row.code || row.Code || "",
      ipAddress: row.ipAddress || row["IP Address"] || row.ip || undefined,
      provider: row.provider || row.Provider || undefined,
      cpu: row.cpu || row.CPU || undefined,
      ram: row.ram || row.RAM || undefined,
      status: (row.status || row.Status || "BUILDING") as any,
      inventoryId: row.inventoryId || row["Inventory ID"] || undefined,
      notes: row.notes || row.Notes || undefined,
    })).filter((i) => i.code);
    if (!items.length) { toast.error("No valid rows"); return; }
    importFromCSV.mutate({ projectId: projectId!, items });
  };

  // Bulk selection helpers
  const toggleServerSelect = (id: string) => {
    setSelectedServerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedServerIds.size === filteredServers.length) {
      setSelectedServerIds(new Set());
    } else {
      setSelectedServerIds(new Set(filteredServers.map((s: any) => s.id)));
    }
  };

  // Handle bulk paste
  const handleBulkPaste = () => {
    if (!pasteDialog || !selectedServerId || !pasteText.trim()) return;
    const values = pasteText.split("\n").map((l) => l.trim()).filter(Boolean);
    bulkPaste.mutate({
      projectId: projectId!,
      serverId: selectedServerId,
      field: pasteDialog.field,
      values,
    });
  };

  // Filter VMs in detail view
  const filteredVMs = serverDetail?.vms?.filter((vm: any) => {
    if (vmStatusFilter && vm.status !== vmStatusFilter) return false;
    if (vmSearch) {
      const q = vmSearch.toLowerCase();
      return (
        vm.code.toLowerCase().includes(q) ||
        (vm.sdkId && vm.sdkId.toLowerCase().includes(q)) ||
        (vm.proxy?.address && vm.proxy.address.toLowerCase().includes(q)) ||
        (vm.gmail?.email && vm.gmail.email.toLowerCase().includes(q))
      );
    }
    return true;
  }) ?? [];

  // VM status breakdown
  const vmStatusCounts: Record<string, number> = {};
  serverDetail?.vms?.forEach((vm: any) => {
    vmStatusCounts[vm.status] = (vmStatusCounts[vm.status] || 0) + 1;
  });

  const totalEarn24h = serverDetail?.vms?.reduce((sum: number, vm: any) => sum + Number(vm.earn24h ?? 0), 0) ?? 0;
  const totalEarnAll = serverDetail?.vms?.reduce((sum: number, vm: any) => sum + Number(vm.earnTotal ?? 0), 0) ?? 0;

  // Filter servers by search
  const filteredServers = servers?.filter((s: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.code.toLowerCase().includes(q) || (s.ipAddress && s.ipAddress.toLowerCase().includes(q)) || (s.provider && s.provider.toLowerCase().includes(q));
  }) ?? [];

  const hasSelection = selectedServerIds.size > 0;

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {/* Top action bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900">Servers</h1>
          <span className="text-xs text-gray-400">({servers?.length ?? 0} servers, {servers?.reduce((s: number, sv: any) => s + (sv._count?.vms ?? 0), 0) ?? 0} VMs)</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!servers?.length}>
            Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
            Import CSV
          </Button>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
          {canEdit && (
            <Button size="sm" onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ ...emptyForm }); }}>
              {showForm ? "Cancel" : "+ Add Server"}
            </Button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {hasSelection && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-3 shrink-0">
          <span className="text-sm font-medium text-blue-800">{selectedServerIds.size} selected</span>
          <select
            value={bulkStatusTarget}
            onChange={(e) => setBulkStatusTarget(e.target.value)}
            className="h-7 px-2 border rounded text-sm"
          >
            <option value="">Change status...</option>
            {ALL_SERVER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {bulkStatusTarget && (
            <Button size="sm" onClick={() => bulkUpdateStatus.mutate({ projectId: projectId!, serverIds: Array.from(selectedServerIds), status: bulkStatusTarget as any })} disabled={bulkUpdateStatus.isLoading}>
              Apply
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="destructive" onClick={() => setShowBulkDelete(true)}>
              Delete Selected
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelectedServerIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Bulk delete confirmation */}
      {showBulkDelete && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between shrink-0">
          <p className="text-sm text-red-800">Delete {selectedServerIds.size} servers and all their VMs?</p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => bulkDelete.mutate({ projectId: projectId!, serverIds: Array.from(selectedServerIds) })} disabled={bulkDelete.isLoading}>
              {bulkDelete.isLoading ? "..." : "Confirm Delete"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowBulkDelete(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Create/Edit Form */}
      {showForm && (
        <div className="bg-white border-b border-gray-200 px-4 py-4 shrink-0 overflow-y-auto max-h-[40vh]">
          <form onSubmit={handleSubmit} className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">{editId ? "Edit Server" : "Add New Server"}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Server Code *</label>
                <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SERVER-01" className="h-8 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">IP Address</label>
                <Input value={form.ipAddress} onChange={(e) => setForm({ ...form, ipAddress: e.target.value })} placeholder="107.172.249.42" className="h-8 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Provider</label>
                <Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="ColoCrossing" className="h-8 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as any })}
                  className="w-full h-8 px-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {ALL_SERVER_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">CPU</label>
                <Input value={form.cpu} onChange={(e) => setForm({ ...form, cpu: e.target.value })} placeholder="32 vCPU" className="h-8 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">RAM</label>
                <Input value={form.ram} onChange={(e) => setForm({ ...form, ram: e.target.value })} placeholder="64 GB" className="h-8 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Inventory ID</label>
                <Input value={form.inventoryId} onChange={(e) => setForm({ ...form, inventoryId: e.target.value })} placeholder="INV-001" className="h-8 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Created Date</label>
                <Input type="date" value={form.createdDate} onChange={(e) => setForm({ ...form, createdDate: e.target.value })} className="h-8 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-1.5 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="Server notes..."
              />
            </div>
            {/* Login Credentials */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-600">Login Credentials</label>
                <button type="button" onClick={addCredentialRow} className="text-xs text-blue-600 hover:underline">+ Add Login</button>
              </div>
              {form.credentials.users.map((cred, idx) => (
                <div key={idx} className="flex gap-2 mb-1.5">
                  <Input value={cred.username} onChange={(e) => updateCredential(idx, "username", e.target.value)} placeholder="Username" className="h-8 text-sm flex-1" />
                  <Input value={cred.password} onChange={(e) => updateCredential(idx, "password", e.target.value)} placeholder="Password" className="h-8 text-sm flex-1" />
                  <Input value={cred.role} onChange={(e) => updateCredential(idx, "role", e.target.value)} placeholder="Role" className="h-8 text-sm w-28" />
                  {form.credentials.users.length > 1 && (
                    <button type="button" onClick={() => removeCredential(idx)} className="text-red-500 hover:text-red-700 px-1 text-sm">x</button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={createServer.isLoading || updateServer.isLoading}>
                {createServer.isLoading || updateServer.isLoading ? "Saving..." : editId ? "Update" : "Create"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</Button>
            </div>
            {(createServer.error || updateServer.error) && (
              <p className="text-xs text-red-600">{createServer.error?.message || updateServer.error?.message}</p>
            )}
          </form>
        </div>
      )}

      {/* Delete single confirmation */}
      {deleteConfirm && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between shrink-0">
          <p className="text-sm text-red-800">Delete this server and all its VMs?</p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => deleteServer.mutate({ projectId: projectId!, id: deleteConfirm })} disabled={deleteServer.isLoading}>
              {deleteServer.isLoading ? "..." : "Delete"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Main content - master-detail split */}
      <div className="flex flex-1 min-h-0">
        {/* Left Panel - Server List */}
        <div className="w-72 xl:w-80 border-r border-gray-200 bg-white flex flex-col shrink-0">
          <div className="p-3 border-b border-gray-200">
            <Input
              placeholder="Search servers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          {/* Select all */}
          <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
            <input
              type="checkbox"
              checked={filteredServers.length > 0 && selectedServerIds.size === filteredServers.length}
              onChange={toggleSelectAll}
              className="rounded border-gray-300"
            />
            <span className="text-[10px] text-gray-500">Select all ({filteredServers.length})</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <p className="p-4 text-gray-400 text-sm">Loading...</p>
            ) : filteredServers.length === 0 ? (
              <p className="p-4 text-gray-400 text-sm">No servers found.</p>
            ) : (
              filteredServers.map((server: any) => {
                const vmCount = server._count?.vms ?? 0;
                const isSelected = selectedServerId === server.id;
                const isChecked = selectedServerIds.has(server.id);
                return (
                  <div
                    key={server.id}
                    className={`px-3 py-2.5 border-b border-gray-50 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-blue-50 border-l-2 border-l-blue-500"
                        : isChecked
                        ? "bg-blue-50/50 border-l-2 border-l-transparent"
                        : "hover:bg-gray-50 border-l-2 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => { e.stopPropagation(); toggleServerSelect(server.id); }}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-gray-300 shrink-0"
                      />
                      <div className="flex-1 min-w-0" onClick={() => setSelectedServerId(server.id)}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm text-gray-900 truncate">{server.code}</span>
                          <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${serverStatusColors[server.status] ?? ""}`}>
                            {server.status}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-xs text-gray-500">{server.ipAddress ?? "No IP"}</span>
                          <span className="text-xs text-gray-500">{vmCount} VMs</span>
                        </div>
                        {server.provider && (
                          <span className="text-[10px] text-gray-400">{server.provider}</span>
                        )}
                      </div>
                    </div>
                    {/* Action buttons */}
                    <div className="flex gap-1 mt-1 ml-6">
                      {canEdit && (
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(server); }}
                          className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                        >
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(server.id); }}
                          className="px-1.5 py-0.5 text-[10px] bg-red-50 text-red-600 rounded hover:bg-red-100"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Panel - Server Detail + VMs */}
        <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
          {!selectedServerId ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <svg className="w-16 h-16 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                </svg>
                <p className="text-sm">Select a server to view details</p>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <p>Loading server details...</p>
            </div>
          ) : serverDetail ? (
            <>
              {/* Server Info Header */}
              <div className="bg-white border-b border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-gray-900">{serverDetail.code}</h2>
                      <Badge className={serverStatusColors[serverDetail.status] ?? ""}>{serverDetail.status}</Badge>
                      {serverDetail.cpu && <Badge variant="outline" className="text-xs">{serverDetail.cpu}</Badge>}
                      {serverDetail.ram && <Badge variant="outline" className="text-xs">{serverDetail.ram}</Badge>}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {serverDetail.ipAddress ?? "No IP"} {serverDetail.provider ? `- ${serverDetail.provider}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => startEdit(serverDetail)}>Edit</Button>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="outline" className="text-red-600" onClick={() => setDeleteConfirm(serverDetail.id)}>Delete</Button>
                    )}
                  </div>
                </div>

                {/* Stats Row */}
                <div className="flex gap-4 mt-3 flex-wrap">
                  <div className="bg-gray-50 rounded-lg px-3 py-2 min-w-[100px]">
                    <p className="text-[10px] font-medium text-gray-500 uppercase">Total VMs</p>
                    <p className="text-xl font-bold text-gray-900">{serverDetail.vms.length}</p>
                  </div>
                  <div className="bg-green-50 rounded-lg px-3 py-2 min-w-[100px]">
                    <p className="text-[10px] font-medium text-green-600 uppercase">Earn 24h</p>
                    <p className="text-xl font-bold text-green-700">${totalEarn24h.toFixed(2)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg px-3 py-2 min-w-[100px]">
                    <p className="text-[10px] font-medium text-blue-600 uppercase">Total Earn</p>
                    <p className="text-xl font-bold text-blue-700">${totalEarnAll.toFixed(2)}</p>
                  </div>
                  {Object.entries(vmStatusCounts).map(([status, count]) => (
                    <div
                      key={status}
                      onClick={() => setVmStatusFilter(vmStatusFilter === status ? "" : status)}
                      className={`rounded-lg px-3 py-2 min-w-[70px] cursor-pointer transition-all ${
                        vmStatusFilter === status ? "ring-2 ring-blue-500" : ""
                      }`}
                      style={{ backgroundColor: vmStatusFilter === status ? "#eff6ff" : "#f9fafb" }}
                    >
                      <p className="text-[10px] font-medium text-gray-500 uppercase">{status}</p>
                      <p className="text-xl font-bold text-gray-900">{count}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* VM Filter Bar + Bulk Paste buttons */}
              <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-gray-500">Filter:</span>
                <Button
                  size="sm"
                  variant={vmStatusFilter === "" ? "default" : "outline"}
                  className="h-6 text-xs px-2"
                  onClick={() => setVmStatusFilter("")}
                >
                  ALL ({serverDetail.vms.length})
                </Button>
                {ALL_VM_STATUSES.map((s) => {
                  const cnt = vmStatusCounts[s] ?? 0;
                  if (cnt === 0) return null;
                  return (
                    <Button
                      key={s}
                      size="sm"
                      variant={vmStatusFilter === s ? "default" : "outline"}
                      className="h-6 text-xs px-2"
                      onClick={() => setVmStatusFilter(vmStatusFilter === s ? "" : s)}
                    >
                      {s} ({cnt})
                    </Button>
                  );
                })}
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setPasteDialog({ field: "gmail" }); setPasteText(""); }}>
                    Paste Gmail
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setPasteDialog({ field: "proxy" }); setPasteText(""); }}>
                    Paste Proxy
                  </Button>
                  <Input
                    placeholder="Search VM..."
                    value={vmSearch}
                    onChange={(e) => setVmSearch(e.target.value)}
                    className="h-7 text-xs w-48"
                  />
                </div>
              </div>

              {/* VMs Table */}
              <div className="flex-1 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">#</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Status</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Server</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">VM Code</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Gmail (BD Account)</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Proxy</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">PayPal</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">Earn Total</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">24h</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Uptime</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {filteredVMs.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="text-center py-8 text-gray-400 text-sm">
                          {vmStatusFilter ? "No VMs with this status" : "No VMs on this server"}
                        </td>
                      </tr>
                    ) : (
                      filteredVMs.map((vm: any, idx: number) => (
                        <tr key={vm.id} className="hover:bg-blue-50/30 transition-colors">
                          <td className="px-3 py-1.5 text-xs text-gray-400">{idx + 1}</td>
                          <td className="px-3 py-1.5">
                            <Badge className={`text-[10px] px-1.5 py-0 ${vmStatusColors[vm.status] ?? ""}`}>
                              {vm.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-1.5 text-xs font-medium text-gray-700">
                            {serverDetail.code}
                          </td>
                          <td className="px-3 py-1.5 font-medium text-gray-900">{vm.code}</td>
                          <td className="px-3 py-1.5 text-xs">
                            {vm.gmail?.email ? (
                              <span className="text-gray-700">{vm.gmail.email.split("@")[0]}</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-xs font-mono">
                            {vm.proxy ? (
                              <span className="text-blue-600">{vm.proxy.address?.split(":")[0]}</span>
                            ) : (
                              <span className="text-orange-400">No proxy</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-xs text-gray-500">
                            {vm.gmail?.paypal?.code ?? "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium">
                            ${Number(vm.earnTotal ?? 0).toFixed(2)}
                          </td>
                          <td className={`px-3 py-1.5 text-right font-medium ${
                            Number(vm.earn24h ?? 0) > 0 ? "text-green-600" : "text-gray-400"
                          }`}>
                            ${Number(vm.earn24h ?? 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 text-xs text-gray-500">
                            {vm.uptime ?? "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Import CSV Preview Dialog */}
      <Dialog open={showImport} onOpenChange={(v) => { if (!v) { setShowImport(false); setImportPreview([]); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Servers from CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {importPreview.length} rows found. Existing servers (same code) will be skipped.
            </p>
            {importPreview.length > 0 && (
              <div className="border rounded-lg overflow-x-auto max-h-60">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {Object.keys(importPreview[0]).map((k) => (
                        <th key={k} className="px-2 py-1.5 text-left font-medium text-gray-600">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {importPreview.slice(0, 20).map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="px-2 py-1 text-gray-700">{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importPreview.length > 20 && (
                  <p className="text-xs text-gray-400 p-2">...and {importPreview.length - 20} more rows</p>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={handleImport} disabled={importFromCSV.isLoading || !importPreview.length}>
                {importFromCSV.isLoading ? "Importing..." : `Import ${importPreview.length} servers`}
              </Button>
              <Button variant="outline" onClick={() => { setShowImport(false); setImportPreview([]); }}>Cancel</Button>
            </div>
            {importFromCSV.error && <p className="text-sm text-red-600">{importFromCSV.error.message}</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Paste Dialog */}
      <Dialog open={!!pasteDialog} onOpenChange={(v) => { if (!v) { setPasteDialog(null); setPasteText(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Paste {pasteDialog?.field === "gmail" ? "Gmail Emails" : "Proxy Addresses"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Paste one value per line. Each line will be assigned to VMs in order (VM 1 gets line 1, VM 2 gets line 2, etc.)
              {serverDetail && <span className="font-medium"> - {serverDetail.vms.length} VMs on this server</span>}
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder={pasteDialog?.field === "gmail"
                ? "example1@gmail.com\nexample2@gmail.com\nexample3@gmail.com"
                : "192.168.1.1:8080\n192.168.1.2:8080\n192.168.1.3:8080"
              }
              autoFocus
            />
            <p className="text-xs text-gray-400">
              {pasteText.split("\n").filter((l) => l.trim()).length} values entered
            </p>
            <div className="flex gap-2">
              <Button onClick={handleBulkPaste} disabled={bulkPaste.isLoading || !pasteText.trim()}>
                {bulkPaste.isLoading ? "Assigning..." : "Assign"}
              </Button>
              <Button variant="outline" onClick={() => { setPasteDialog(null); setPasteText(""); }}>Cancel</Button>
            </div>
            {bulkPaste.error && <p className="text-sm text-red-600">{bulkPaste.error.message}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
