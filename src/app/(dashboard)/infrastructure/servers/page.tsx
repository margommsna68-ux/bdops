"use client";

import { useState, useRef, useCallback } from "react";
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
import { usePinAction } from "@/components/PinVerify";
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

const ALL_VM_STATUSES = ["OK", "ERROR", "SUSPENDED", "NEW", "NOT_CONNECTED", "NOT_AVC", "BLOCKED"] as const;
const ALL_SERVER_STATUSES = ["BUILDING", "ACTIVE", "SUSPENDED", "EXPIRED", "MAINTENANCE"] as const;

const emptyForm = {
  code: "",
  inventoryId: "",
  status: "BUILDING" as string,
  ipAddress: "",
  netmask: "",
  gateway: "",
  allocation: "",
  provider: "",
  cpu: "",
  ram: "",
  createdDate: "",
  notes: "",
  users: [{ username: "", password: "" }] as { username: string; password: string }[],
  ipmiIp: "",
  ipmiUser: "",
  ipmiPass: "",
};

type ServerForm = typeof emptyForm;

// VM column definitions for resize
const VM_COLUMNS = [
  { key: "idx", label: "#", defaultWidth: 40, minWidth: 30 },
  { key: "status", label: "Status", defaultWidth: 100, minWidth: 70 },
  { key: "server", label: "Server", defaultWidth: 120, minWidth: 80 },
  { key: "code", label: "VM Code", defaultWidth: 100, minWidth: 70 },
  { key: "gmail", label: "Gmail (BD Account)", defaultWidth: 160, minWidth: 100 },
  { key: "proxy", label: "Proxy", defaultWidth: 150, minWidth: 80 },
  { key: "paypal", label: "PayPal", defaultWidth: 100, minWidth: 70 },
  { key: "earnTotal", label: "Earn Total", defaultWidth: 100, minWidth: 70 },
  { key: "earn24h", label: "24h", defaultWidth: 80, minWidth: 60 },
  { key: "uptime", label: "Uptime", defaultWidth: 80, minWidth: 50 },
];

// Password field with eye toggle
function PasswordInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`pr-8 ${className ?? ""}`}
      />
      <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
        {show ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.05 6.05m3.828 3.828L6.05 6.05M6.05 6.05L3 3m18 18l-3.05-3.05m0 0a9.953 9.953 0 01-4.073 1.95M17.95 17.95L21 21" /></svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        )}
      </button>
    </div>
  );
}

export default function ServersPage() {
  const { currentProjectId: projectId, currentRole } = useProjectStore();
  const utils = trpc.useUtils();
  const { requirePin, PinDialog } = usePinAction();

  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [vmStatusFilter, setVmStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [vmSearch, setVmSearch] = useState("");

  // CRUD state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ServerForm>({ ...emptyForm });
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Bulk server selection
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

  // Credentials (PIN protected)
  const [showCreds, setShowCreds] = useState(false);

  // VM selection
  const [selectedVmIds, setSelectedVmIds] = useState<Set<string>>(new Set());
  const [vmBulkStatus, setVmBulkStatus] = useState("");

  // VM create dialog
  const [showVmCreate, setShowVmCreate] = useState(false);
  const [vmCreateMode, setVmCreateMode] = useState<"single" | "bulk">("single");
  const [vmSingleCode, setVmSingleCode] = useState("");
  const [vmBulkPrefix, setVmBulkPrefix] = useState("M");
  const [vmBulkCount, setVmBulkCount] = useState(10);
  const [vmBulkStart, setVmBulkStart] = useState(1);

  // VM column resize
  const [vmColWidths, setVmColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("vm-col-widths");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    const defaults: Record<string, number> = {};
    VM_COLUMNS.forEach((c) => { defaults[c.key] = c.defaultWidth; });
    return defaults;
  });
  const resizingCol = useRef<string | null>(null);
  const startX = useRef(0);
  const startW = useRef(0);

  const handleColResize = useCallback((e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = colKey;
    startX.current = e.clientX;
    startW.current = vmColWidths[colKey] ?? 100;
    const onMove = (ev: MouseEvent) => {
      if (!resizingCol.current) return;
      const diff = ev.clientX - startX.current;
      const col = VM_COLUMNS.find((c) => c.key === resizingCol.current);
      const minW = col?.minWidth ?? 50;
      const newW = Math.max(minW, startW.current + diff);
      setVmColWidths((prev) => {
        const next = { ...prev, [resizingCol.current!]: newW };
        try { localStorage.setItem("vm-col-widths", JSON.stringify(next)); } catch {}
        return next;
      });
    };
    const onUp = () => {
      resizingCol.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [vmColWidths]);

  // Queries
  const { data: servers, isLoading } = trpc.server.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const { data: serverDetail, isLoading: detailLoading } = trpc.server.getById.useQuery(
    { projectId: projectId!, id: selectedServerId! },
    { enabled: !!projectId && !!selectedServerId }
  );
  const { data: credentials } = trpc.server.getCredentials.useQuery(
    { projectId: projectId!, id: selectedServerId! },
    { enabled: !!projectId && !!selectedServerId && showCreds }
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
  const vmBulkUpdateStatus = trpc.vm.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { utils.server.getById.invalidate(); setSelectedVmIds(new Set()); setVmBulkStatus(""); toast.success(`${r.updated} VMs updated`); },
    onError: (e) => toast.error(e.message),
  });
  const vmCreate = trpc.vm.create.useMutation({
    onSuccess: () => { utils.server.getById.invalidate(); utils.server.list.invalidate(); setShowVmCreate(false); setVmSingleCode(""); toast.success("VM created"); },
    onError: (e) => toast.error(e.message),
  });
  const vmBulkCreate = trpc.vm.bulkCreate.useMutation({
    onSuccess: (r) => { utils.server.getById.invalidate(); utils.server.list.invalidate(); setShowVmCreate(false); toast.success(`Created ${r.created} VMs`); if (r.errors.length) toast.error(r.errors.join("\n")); },
    onError: (e) => toast.error(e.message),
  });

  const canEdit = currentRole === "ADMIN" || currentRole === "MODERATOR" || currentRole === "USER";
  const canDelete = currentRole === "ADMIN" || currentRole === "MODERATOR";

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  // Form handlers
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const creds: any = {};
    if (form.users.some((u) => u.username)) {
      creds.users = form.users.filter((u) => u.username);
    }
    if (form.ipmiIp || form.ipmiUser) {
      creds.ipmi = { ip: form.ipmiIp, user: form.ipmiUser, password: form.ipmiPass };
    }
    const payload: any = {
      projectId: projectId!,
      code: form.code,
      inventoryId: form.inventoryId || undefined,
      status: form.status as any,
      ipAddress: form.ipAddress || undefined,
      netmask: form.netmask || undefined,
      gateway: form.gateway || undefined,
      allocation: form.allocation || undefined,
      provider: form.provider || undefined,
      cpu: form.cpu || undefined,
      ram: form.ram || undefined,
      notes: form.notes || undefined,
      createdDate: form.createdDate || undefined,
    };
    if (Object.keys(creds).length > 0) payload.credentials = creds;
    if (editId) updateServer.mutate({ ...payload, id: editId });
    else createServer.mutate(payload);
  };

  const startEdit = (server: any) => {
    setForm({
      code: server.code,
      inventoryId: server.inventoryId || "",
      status: server.status,
      ipAddress: server.ipAddress || "",
      netmask: server.netmask || "",
      gateway: server.gateway || "",
      allocation: server.allocation || "",
      provider: server.provider || "",
      cpu: server.cpu || "",
      ram: server.ram || "",
      createdDate: server.createdDate ? new Date(server.createdDate).toISOString().split("T")[0] : "",
      notes: server.notes || "",
      users: [{ username: "", password: "" }],
      ipmiIp: "", ipmiUser: "", ipmiPass: "",
    });
    setEditId(server.id);
    setShowForm(true);
  };

  const handleExportCSV = () => {
    if (!servers?.length) return;
    exportToCSV(servers.map((s: any) => ({
      code: s.code, inventoryId: s.inventoryId ?? "", status: s.status,
      ipAddress: s.ipAddress ?? "", netmask: s.netmask ?? "", gateway: s.gateway ?? "", allocation: s.allocation ?? "",
      provider: s.provider ?? "", cpu: s.cpu ?? "", ram: s.ram ?? "", notes: s.notes ?? "",
    })), "servers-backup");
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setImportPreview(parseCSV(ev.target?.result as string)); setShowImport(true); };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleImport = () => {
    const items = importPreview.map((row) => ({
      code: row.code || row.Code || "",
      ipAddress: row.ipAddress || row["IP Address"] || row.ip || undefined,
      netmask: row.netmask || row.Netmask || undefined,
      gateway: row.gateway || row.Gateway || undefined,
      allocation: row.allocation || row.Allocation || undefined,
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

  const toggleServerSelect = (id: string) => {
    setSelectedServerIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    setSelectedServerIds(selectedServerIds.size === filteredServers.length ? new Set() : new Set(filteredServers.map((s: any) => s.id)));
  };
  const toggleVmSelect = (id: string) => {
    setSelectedVmIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleVmSelectAll = () => {
    setSelectedVmIds(selectedVmIds.size === filteredVMs.length ? new Set() : new Set(filteredVMs.map((vm: any) => vm.id)));
  };

  const handleBulkPaste = () => {
    if (!pasteDialog || !selectedServerId || !pasteText.trim()) return;
    bulkPaste.mutate({ projectId: projectId!, serverId: selectedServerId, field: pasteDialog.field, values: pasteText.split("\n").map((l) => l.trim()).filter(Boolean) });
  };

  const handleShowCreds = () => {
    requirePin(() => setShowCreds(true), "PIN Required", "Enter PIN to view credentials");
  };

  const handleVmCreate = () => {
    if (!selectedServerId) return;
    if (vmCreateMode === "single") {
      if (!vmSingleCode.trim()) return;
      vmCreate.mutate({ projectId: projectId!, serverId: selectedServerId, code: vmSingleCode.trim() });
    } else {
      vmBulkCreate.mutate({ projectId: projectId!, serverId: selectedServerId, prefix: vmBulkPrefix, count: vmBulkCount, startFrom: vmBulkStart });
    }
  };

  // Filter VMs
  const filteredVMs = serverDetail?.vms?.filter((vm: any) => {
    if (vmStatusFilter && vm.status !== vmStatusFilter) return false;
    if (vmSearch) {
      const q = vmSearch.toLowerCase();
      return vm.code.toLowerCase().includes(q) || (vm.proxy?.address && vm.proxy.address.toLowerCase().includes(q)) || (vm.gmail?.email && vm.gmail.email.toLowerCase().includes(q));
    }
    return true;
  }) ?? [];

  const vmStatusCounts: Record<string, number> = {};
  serverDetail?.vms?.forEach((vm: any) => { vmStatusCounts[vm.status] = (vmStatusCounts[vm.status] || 0) + 1; });
  const totalEarn24h = serverDetail?.vms?.reduce((sum: number, vm: any) => sum + Number(vm.earn24h ?? 0), 0) ?? 0;
  const totalEarnAll = serverDetail?.vms?.reduce((sum: number, vm: any) => sum + Number(vm.earnTotal ?? 0), 0) ?? 0;

  const filteredServers = servers?.filter((s: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.code.toLowerCase().includes(q) || (s.ipAddress && s.ipAddress.toLowerCase().includes(q)) || (s.provider && s.provider.toLowerCase().includes(q));
  }) ?? [];

  const hasSelection = selectedServerIds.size > 0;
  const hasVmSelection = selectedVmIds.size > 0;

  const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {PinDialog}

      {/* Top action bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900">Servers</h1>
          <span className="text-xs text-gray-400">({servers?.length ?? 0} servers, {servers?.reduce((s: number, sv: any) => s + (sv._count?.vms ?? 0), 0) ?? 0} VMs)</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!servers?.length}>Export CSV</Button>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>Import CSV</Button>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
          {canEdit && (
            <Button size="sm" onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ ...emptyForm }); }}>
              {showForm ? "Cancel" : "+ Add Server"}
            </Button>
          )}
        </div>
      </div>

      {/* Bulk server action bar */}
      {hasSelection && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-3 shrink-0">
          <span className="text-sm font-medium text-blue-800">{selectedServerIds.size} selected</span>
          <select value={bulkStatusTarget} onChange={(e) => setBulkStatusTarget(e.target.value)} className="h-7 px-2 border rounded text-sm">
            <option value="">Change status...</option>
            {ALL_SERVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {bulkStatusTarget && <Button size="sm" onClick={() => bulkUpdateStatus.mutate({ projectId: projectId!, serverIds: Array.from(selectedServerIds), status: bulkStatusTarget as any })}>Apply</Button>}
          {canDelete && <Button size="sm" variant="destructive" onClick={() => setShowBulkDelete(true)}>Delete Selected</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSelectedServerIds(new Set())}>Clear</Button>
        </div>
      )}
      {showBulkDelete && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between shrink-0">
          <p className="text-sm text-red-800">Delete {selectedServerIds.size} servers and all their VMs?</p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => bulkDelete.mutate({ projectId: projectId!, serverIds: Array.from(selectedServerIds) })} disabled={bulkDelete.isLoading}>{bulkDelete.isLoading ? "..." : "Confirm"}</Button>
            <Button size="sm" variant="outline" onClick={() => setShowBulkDelete(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Create/Edit Form */}
      {showForm && (
        <div className="bg-white border-b border-gray-200 px-4 py-4 shrink-0 overflow-y-auto max-h-[50vh]">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">{editId ? "Edit Server" : "Add New Server"}</h2>

            <div>
              <p className="text-[10px] font-semibold uppercase text-gray-400 mb-2">Basic Info</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <F label="Server Name *"><Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SERVER-01-8939CC" className="h-8 text-sm" /></F>
                <F label="Inventory ID"><Input value={form.inventoryId} onChange={(e) => setForm({ ...form, inventoryId: e.target.value })} placeholder="8939CC-RYZN" className="h-8 text-sm" /></F>
                <F label="Status">
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full h-8 px-2 border rounded-md text-sm bg-white">
                    {ALL_SERVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </F>
                <F label="Created Date"><Input type="date" value={form.createdDate} onChange={(e) => setForm({ ...form, createdDate: e.target.value })} className="h-8 text-sm" /></F>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase text-gray-400 mb-2">Network Info</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <F label="Server IP"><Input value={form.ipAddress} onChange={(e) => setForm({ ...form, ipAddress: e.target.value })} placeholder="107.172.249.42" className="h-8 text-sm font-mono" /></F>
                <F label="Netmask"><Input value={form.netmask} onChange={(e) => setForm({ ...form, netmask: e.target.value })} placeholder="255.255.255.252" className="h-8 text-sm font-mono" /></F>
                <F label="Gateway"><Input value={form.gateway} onChange={(e) => setForm({ ...form, gateway: e.target.value })} placeholder="107.172.249.41" className="h-8 text-sm font-mono" /></F>
                <F label="Allocation"><Input value={form.allocation} onChange={(e) => setForm({ ...form, allocation: e.target.value })} placeholder="107.172.249.40/30" className="h-8 text-sm font-mono" /></F>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase text-gray-400 mb-2">Hardware & Provider</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <F label="Provider"><Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="ColoCrossing" className="h-8 text-sm" /></F>
                <F label="CPU"><Input value={form.cpu} onChange={(e) => setForm({ ...form, cpu: e.target.value })} placeholder="32 vCPU" className="h-8 text-sm" /></F>
                <F label="RAM"><Input value={form.ram} onChange={(e) => setForm({ ...form, ram: e.target.value })} placeholder="64 GB" className="h-8 text-sm" /></F>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase text-gray-400 mb-2">IPMI Info</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <F label="IPMI IP"><Input value={form.ipmiIp} onChange={(e) => setForm({ ...form, ipmiIp: e.target.value })} placeholder="206.217.138.162" className="h-8 text-sm font-mono" /></F>
                <F label="IPMI User"><Input value={form.ipmiUser} onChange={(e) => setForm({ ...form, ipmiUser: e.target.value })} placeholder="IPMI_USER" className="h-8 text-sm" /></F>
                <F label="IPMI Password"><PasswordInput value={form.ipmiPass} onChange={(v) => setForm({ ...form, ipmiPass: v })} placeholder="********" className="h-8 text-sm" /></F>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase text-gray-400">VPS Login Credentials</p>
                <button type="button" onClick={() => setForm((f) => ({ ...f, users: [...f.users, { username: "", password: "" }] }))} className="text-xs text-blue-600 hover:underline">+ Add Login</button>
              </div>
              {form.users.map((cred, idx) => (
                <div key={idx} className="flex gap-2 mb-1.5">
                  <Input value={cred.username} onChange={(e) => { const users = [...form.users]; users[idx] = { ...users[idx], username: e.target.value }; setForm({ ...form, users }); }} placeholder="Username" className="h-8 text-sm flex-1" />
                  <div className="flex-1">
                    <PasswordInput value={cred.password} onChange={(v) => { const users = [...form.users]; users[idx] = { ...users[idx], password: v }; setForm({ ...form, users }); }} placeholder="Password" className="h-8 text-sm" />
                  </div>
                  {form.users.length > 1 && <button type="button" onClick={() => setForm((f) => ({ ...f, users: f.users.filter((_, i) => i !== idx) }))} className="text-red-500 hover:text-red-700 px-1 text-sm">x</button>}
                </div>
              ))}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-1.5 border rounded-md text-sm" placeholder="Server notes..." />
            </div>

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={createServer.isLoading || updateServer.isLoading}>
                {createServer.isLoading || updateServer.isLoading ? "Saving..." : editId ? "Update" : "Create"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</Button>
            </div>
            {(createServer.error || updateServer.error) && <p className="text-xs text-red-600">{createServer.error?.message || updateServer.error?.message}</p>}
          </form>
        </div>
      )}

      {deleteConfirm && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between shrink-0">
          <p className="text-sm text-red-800">Delete this server and all its VMs?</p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => deleteServer.mutate({ projectId: projectId!, id: deleteConfirm })} disabled={deleteServer.isLoading}>{deleteServer.isLoading ? "..." : "Delete"}</Button>
            <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left - Server List */}
        <div className="w-72 xl:w-80 border-r border-gray-200 bg-white flex flex-col shrink-0">
          <div className="p-3 border-b border-gray-200">
            <Input placeholder="Search servers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
            <input type="checkbox" checked={filteredServers.length > 0 && selectedServerIds.size === filteredServers.length} onChange={toggleSelectAll} className="rounded border-gray-300" />
            <span className="text-[10px] text-gray-500">Select all ({filteredServers.length})</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? <p className="p-4 text-gray-400 text-sm">Loading...</p> : filteredServers.length === 0 ? <p className="p-4 text-gray-400 text-sm">No servers found.</p> : (
              filteredServers.map((server: any) => {
                const isSelected = selectedServerId === server.id;
                const isChecked = selectedServerIds.has(server.id);
                return (
                  <div key={server.id} className={`px-3 py-2.5 border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? "bg-blue-50 border-l-2 border-l-blue-500" : isChecked ? "bg-blue-50/50 border-l-2 border-l-transparent" : "hover:bg-gray-50 border-l-2 border-l-transparent"}`}>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={isChecked} onChange={() => toggleServerSelect(server.id)} onClick={(e) => e.stopPropagation()} className="rounded border-gray-300 shrink-0" />
                      <div className="flex-1 min-w-0" onClick={() => { setSelectedServerId(server.id); setShowCreds(false); setSelectedVmIds(new Set()); }}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm text-gray-900 truncate">{server.code}</span>
                          <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${serverStatusColors[server.status] ?? ""}`}>{server.status}</Badge>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-xs text-gray-500">{server.ipAddress ?? "No IP"}</span>
                          <span className="text-xs text-gray-500">{server._count?.vms ?? 0} VMs</span>
                        </div>
                        {server.provider && <span className="text-[10px] text-gray-400">{server.provider}</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right - Server Detail + VMs */}
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
            <div className="flex-1 flex items-center justify-center text-gray-400"><p>Loading...</p></div>
          ) : serverDetail ? (
            <>
              {/* Server Info Header */}
              <div className="bg-white border-b border-gray-200 p-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-gray-900">{serverDetail.code}</h2>
                  <Badge className={serverStatusColors[serverDetail.status] ?? ""}>{serverDetail.status}</Badge>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => startEdit(serverDetail)} title="Edit Server">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </Button>
                  {serverDetail.cpu && <Badge variant="outline" className="text-xs">{serverDetail.cpu}</Badge>}
                  {serverDetail.ram && <Badge variant="outline" className="text-xs">{serverDetail.ram}</Badge>}
                </div>
                <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 flex-wrap">
                  <span className="font-mono">{serverDetail.ipAddress ?? "No IP"}</span>
                  {serverDetail.netmask && <span>Mask: {serverDetail.netmask}</span>}
                  {serverDetail.gateway && <span>GW: {serverDetail.gateway}</span>}
                  {serverDetail.allocation && <span>Alloc: {serverDetail.allocation}</span>}
                  {serverDetail.provider && <span>{serverDetail.provider}</span>}
                  {serverDetail.inventoryId && <span>Inv: {serverDetail.inventoryId}</span>}
                  {!showCreds && (
                    <button onClick={handleShowCreds} className="text-blue-600 hover:underline flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                      Credentials
                    </button>
                  )}
                  {showCreds && (
                    <button onClick={() => setShowCreds(false)} className="text-gray-500 hover:underline">Hide Credentials</button>
                  )}
                </div>

                {/* Credentials */}
                {showCreds && credentials && (
                  <div className="mt-2 bg-gray-50 rounded-lg p-3 text-xs space-y-2">
                    {credentials.users?.length > 0 && (
                      <div>
                        <p className="font-semibold text-gray-600 mb-1">VPS Login:</p>
                        {credentials.users.map((u: any, i: number) => (
                          <p key={i} className="font-mono text-gray-800">{u.username}: <span className="select-all">{u.password}</span></p>
                        ))}
                      </div>
                    )}
                    {credentials.ipmi && (
                      <div>
                        <p className="font-semibold text-gray-600 mb-1">IPMI:</p>
                        <p className="font-mono text-gray-800">{credentials.ipmi.ip} - {credentials.ipmi.user} / <span className="select-all">{credentials.ipmi.password}</span></p>
                      </div>
                    )}
                    {!credentials.users?.length && !credentials.ipmi && <p className="text-gray-400">No credentials saved</p>}
                  </div>
                )}

                {/* Stats */}
                <div className="flex gap-3 mt-3 flex-wrap">
                  <div className="bg-gray-50 rounded-lg px-3 py-2 min-w-[80px]">
                    <p className="text-[10px] font-medium text-gray-500 uppercase">VMs</p>
                    <p className="text-xl font-bold text-gray-900">{serverDetail.vms.length}</p>
                  </div>
                  <div className="bg-green-50 rounded-lg px-3 py-2 min-w-[80px]">
                    <p className="text-[10px] font-medium text-green-600 uppercase">24h</p>
                    <p className="text-xl font-bold text-green-700">${totalEarn24h.toFixed(2)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg px-3 py-2 min-w-[80px]">
                    <p className="text-[10px] font-medium text-blue-600 uppercase">Total</p>
                    <p className="text-xl font-bold text-blue-700">${totalEarnAll.toFixed(2)}</p>
                  </div>
                  {Object.entries(vmStatusCounts).map(([status, count]) => (
                    <div key={status} onClick={() => setVmStatusFilter(vmStatusFilter === status ? "" : status)} className={`rounded-lg px-3 py-2 min-w-[60px] cursor-pointer transition-all ${vmStatusFilter === status ? "ring-2 ring-blue-500 bg-blue-50" : "bg-gray-50"}`}>
                      <p className="text-[10px] font-medium text-gray-500 uppercase">{status}</p>
                      <p className="text-xl font-bold text-gray-900">{count}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* VM action bar */}
              <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-wrap">
                <Button size="sm" variant={vmStatusFilter === "" ? "default" : "outline"} className="h-6 text-xs px-2" onClick={() => setVmStatusFilter("")}>ALL ({serverDetail.vms.length})</Button>
                {ALL_VM_STATUSES.map((s) => {
                  const cnt = vmStatusCounts[s] ?? 0;
                  if (cnt === 0) return null;
                  return <Button key={s} size="sm" variant={vmStatusFilter === s ? "default" : "outline"} className="h-6 text-xs px-2" onClick={() => setVmStatusFilter(vmStatusFilter === s ? "" : s)}>{s} ({cnt})</Button>;
                })}
                <div className="ml-auto flex items-center gap-2">
                  {hasVmSelection && (
                    <>
                      <span className="text-xs text-blue-600 font-medium">{selectedVmIds.size} VMs</span>
                      <select value={vmBulkStatus} onChange={(e) => setVmBulkStatus(e.target.value)} className="h-6 px-1 border rounded text-xs">
                        <option value="">Status...</option>
                        {ALL_VM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {vmBulkStatus && <Button size="sm" className="h-6 text-xs px-2" onClick={() => vmBulkUpdateStatus.mutate({ projectId: projectId!, vmIds: Array.from(selectedVmIds), status: vmBulkStatus as any })}>Apply</Button>}
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-1" onClick={() => setSelectedVmIds(new Set())}>x</Button>
                      <span className="text-gray-300">|</span>
                    </>
                  )}
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setPasteDialog({ field: "gmail" }); setPasteText(""); }}>Paste Gmail</Button>
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setPasteDialog({ field: "proxy" }); setPasteText(""); }}>Paste Proxy</Button>
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setShowVmCreate(true); setVmCreateMode("single"); setVmSingleCode(""); }}>+ Add VM</Button>
                  <Input placeholder="Search VM..." value={vmSearch} onChange={(e) => setVmSearch(e.target.value)} className="h-7 text-xs w-36" />
                </div>
              </div>

              {/* VMs Table */}
              <div className="flex-1 overflow-auto">
                <table className="text-sm" style={{ minWidth: "100%", tableLayout: "fixed" }}>
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left w-8">
                        <input type="checkbox" checked={filteredVMs.length > 0 && selectedVmIds.size === filteredVMs.length} onChange={toggleVmSelectAll} className="rounded border-gray-300" />
                      </th>
                      {VM_COLUMNS.map((col) => (
                        <th key={col.key} className="relative group select-none px-2 py-2 text-left font-medium text-gray-600 text-xs" style={{ width: vmColWidths[col.key] ?? col.defaultWidth, minWidth: col.minWidth }}>
                          {col.label}
                          <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400 group-hover:bg-blue-200 transition-colors" onMouseDown={(e) => handleColResize(e, col.key)} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {filteredVMs.length === 0 ? (
                      <tr><td colSpan={VM_COLUMNS.length + 1} className="text-center py-8 text-gray-400 text-sm">{vmStatusFilter ? "No VMs with this status" : "No VMs on this server"}</td></tr>
                    ) : (
                      filteredVMs.map((vm: any, idx: number) => (
                        <tr key={vm.id} className={`hover:bg-blue-50/30 transition-colors ${selectedVmIds.has(vm.id) ? "bg-blue-50/50" : ""}`}>
                          <td className="px-2 py-1.5 w-8"><input type="checkbox" checked={selectedVmIds.has(vm.id)} onChange={() => toggleVmSelect(vm.id)} className="rounded border-gray-300" /></td>
                          <td className="px-2 py-1.5 text-xs text-gray-400">{idx + 1}</td>
                          <td className="px-2 py-1.5"><Badge className={`text-[10px] px-1.5 py-0 ${vmStatusColors[vm.status] ?? ""}`}>{vm.status}</Badge></td>
                          <td className="px-2 py-1.5 text-xs font-medium text-gray-700 truncate">{serverDetail.code}</td>
                          <td className="px-2 py-1.5 font-medium text-gray-900 truncate">{vm.code}</td>
                          <td className="px-2 py-1.5 text-xs truncate">{vm.gmail?.email ? <span className="text-gray-700">{vm.gmail.email.split("@")[0]}</span> : <span className="text-gray-300">—</span>}</td>
                          <td className="px-2 py-1.5 text-xs font-mono truncate">{vm.proxy ? <span className="text-blue-600">{vm.proxy.address}</span> : <span className="text-orange-400">No proxy</span>}</td>
                          <td className="px-2 py-1.5 text-xs text-gray-500 truncate">{vm.gmail?.paypal?.code ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right font-medium">${Number(vm.earnTotal ?? 0).toFixed(2)}</td>
                          <td className={`px-2 py-1.5 text-right font-medium ${Number(vm.earn24h ?? 0) > 0 ? "text-green-600" : "text-gray-400"}`}>${Number(vm.earn24h ?? 0).toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-xs text-gray-500">{vm.uptime ?? "—"}</td>
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

      {/* Import CSV Dialog */}
      <Dialog open={showImport} onOpenChange={(v) => { if (!v) { setShowImport(false); setImportPreview([]); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Import Servers from CSV</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{importPreview.length} rows. Duplicates skipped.</p>
            {importPreview.length > 0 && (
              <div className="border rounded-lg overflow-x-auto max-h-60">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50"><tr>{Object.keys(importPreview[0]).map((k) => <th key={k} className="px-2 py-1.5 text-left font-medium text-gray-600">{k}</th>)}</tr></thead>
                  <tbody className="divide-y">{importPreview.slice(0, 20).map((row, i) => <tr key={i}>{Object.values(row).map((v, j) => <td key={j} className="px-2 py-1 text-gray-700">{v}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={handleImport} disabled={importFromCSV.isLoading || !importPreview.length}>{importFromCSV.isLoading ? "..." : `Import ${importPreview.length}`}</Button>
              <Button variant="outline" onClick={() => { setShowImport(false); setImportPreview([]); }}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Paste Dialog */}
      <Dialog open={!!pasteDialog} onOpenChange={(v) => { if (!v) { setPasteDialog(null); setPasteText(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Paste {pasteDialog?.field === "gmail" ? "Gmail Emails" : "Proxy Addresses"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-gray-500">One per line. Assigns to VMs in order.{serverDetail && <span className="font-medium"> {serverDetail.vms.length} VMs</span>}</p>
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={10} className="w-full px-3 py-2 border rounded-lg text-sm font-mono" placeholder={pasteDialog?.field === "gmail" ? "email1@gmail.com\nemail2@gmail.com" : "1.2.3.4:8080\n5.6.7.8:8080"} autoFocus />
            <p className="text-xs text-gray-400">{pasteText.split("\n").filter((l) => l.trim()).length} values</p>
            <div className="flex gap-2">
              <Button onClick={handleBulkPaste} disabled={bulkPaste.isLoading || !pasteText.trim()}>{bulkPaste.isLoading ? "..." : "Assign"}</Button>
              <Button variant="outline" onClick={() => { setPasteDialog(null); setPasteText(""); }}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* VM Create Dialog */}
      <Dialog open={showVmCreate} onOpenChange={(v) => { if (!v) setShowVmCreate(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add VMs to {serverDetail?.code}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button size="sm" variant={vmCreateMode === "single" ? "default" : "outline"} onClick={() => setVmCreateMode("single")}>Single</Button>
              <Button size="sm" variant={vmCreateMode === "bulk" ? "default" : "outline"} onClick={() => setVmCreateMode("bulk")}>Bulk</Button>
            </div>
            {vmCreateMode === "single" ? (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">VM Code</label>
                <Input value={vmSingleCode} onChange={(e) => setVmSingleCode(e.target.value)} placeholder="M-001" className="text-sm" autoFocus />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <F label="Prefix"><Input value={vmBulkPrefix} onChange={(e) => setVmBulkPrefix(e.target.value)} className="text-sm" /></F>
                  <F label="Start #"><Input type="number" min={1} value={vmBulkStart} onChange={(e) => setVmBulkStart(Number(e.target.value))} className="text-sm" /></F>
                  <F label="Count"><Input type="number" min={1} max={200} value={vmBulkCount} onChange={(e) => setVmBulkCount(Number(e.target.value))} className="text-sm" /></F>
                </div>
                <p className="text-xs text-gray-400">Preview: {vmBulkPrefix}-{String(vmBulkStart).padStart(3, "0")} to {vmBulkPrefix}-{String(vmBulkStart + vmBulkCount - 1).padStart(3, "0")}</p>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={handleVmCreate} disabled={vmCreate.isLoading || vmBulkCreate.isLoading}>
                {vmCreate.isLoading || vmBulkCreate.isLoading ? "..." : vmCreateMode === "single" ? "Create VM" : `Create ${vmBulkCount} VMs`}
              </Button>
              <Button variant="outline" onClick={() => setShowVmCreate(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
