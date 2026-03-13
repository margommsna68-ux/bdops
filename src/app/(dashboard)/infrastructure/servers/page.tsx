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
import { trpcVanilla } from "@/lib/trpc-vanilla";
import { useProjectStore } from "@/lib/store";
import { exportToCSV, parseCSV } from "@/lib/excel-export";
import { usePinAction } from "@/components/PinVerify";
import toast from "react-hot-toast";
import { useT } from "@/lib/i18n";

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
  monthlyCost: "",
  billingCycle: "1",
  createdDate: "",
  expiryDate: "",
  notes: "",
  gmailGroup: "1",
  users: [{ username: "", password: "" }] as { username: string; password: string }[],
  ipmiIp: "",
  ipmiUser: "",
  ipmiPass: "",
};

type ServerForm = typeof emptyForm;

// ═══ Shared field wrapper ═══
const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
    {children}
  </div>
);

// ═══ Copy button for inline fields ═══
function CopyBtn({ value, prefix }: { value: string; prefix?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button type="button" onClick={() => { navigator.clipboard.writeText((prefix || "") + value); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="shrink-0 text-gray-400 hover:text-gray-600 p-1" title="Copy">
      {copied ? (
        <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      )}
    </button>
  );
}

// ═══ Extracted Server Form Component (prevents full-page re-render on each keystroke) ═══
import React from "react";

const ServerFormPanel = React.memo(function ServerFormPanel({
  form, setForm, editId, projectId, onSave, onCancel, isLoading, error, requirePin, t,
}: {
  form: ServerForm;
  setForm: React.Dispatch<React.SetStateAction<ServerForm>>;
  editId: string | null;
  projectId: string;
  onSave: (payload: any, isEdit: boolean) => void;
  onCancel: () => void;
  isLoading: boolean;
  error?: string;
  requirePin: (action: () => void, title?: string, desc?: string) => void;
  t: (key: string) => string;
}) {
  const updateField = useCallback((field: keyof ServerForm, value: string) => {
    setForm(f => ({ ...f, [field]: value }));
  }, [setForm]);

  const updateUser = useCallback((idx: number, field: "username" | "password", value: string) => {
    setForm(f => {
      const users = [...f.users];
      users[idx] = { ...users[idx], [field]: value };
      return { ...f, users };
    });
  }, [setForm]);

  const addUser = useCallback(() => {
    setForm(f => ({ ...f, users: [...f.users, { username: "", password: "" }] }));
  }, [setForm]);

  const removeUser = useCallback((idx: number) => {
    setForm(f => ({ ...f, users: f.users.filter((_, i) => i !== idx) }));
  }, [setForm]);

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
      projectId,
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
      gmailGroup: Number(form.gmailGroup),
      monthlyCost: form.monthlyCost ? Number(form.monthlyCost) : undefined,
      billingCycle: form.billingCycle ? Number(form.billingCycle) : undefined,
      createdDate: form.createdDate || undefined,
      expiryDate: form.expiryDate || undefined,
    };
    if (Object.keys(creds).length > 0) payload.credentials = creds;
    if (editId) onSave({ ...payload, id: editId }, true);
    else onSave(payload, false);
  };

  return (
    <div className="bg-white border-b border-gray-200 px-4 py-4 shrink-0 overflow-y-auto max-h-[50vh]">
      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">{editId ? t("srv_edit") : t("srv_add_new")}</h2>

        <div>
          <p className="text-[10px] font-semibold uppercase text-gray-400 mb-2">{t("srv_basic_info")}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <F label={t("srv_server_name") + " *"}><Input required value={form.code} onChange={(e) => updateField("code", e.target.value)} placeholder="SERVER-01-8939CC" className="h-8 text-sm" /></F>
            <F label={t("srv_inventory_id")}><Input value={form.inventoryId} onChange={(e) => updateField("inventoryId", e.target.value)} placeholder="8939CC-RYZN" className="h-8 text-sm" /></F>
            <F label={t("col_status")}>
              <select value={form.status} onChange={(e) => updateField("status", e.target.value)} className="w-full h-8 px-2 border rounded-md text-sm bg-white">
                {ALL_SERVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </F>
            <F label={t("srv_created_date")}><Input type="date" value={form.createdDate} onChange={(e) => updateField("createdDate", e.target.value)} className="h-8 text-sm" /></F>
            <F label={t("srv_gmail_group")}>
              <select value={form.gmailGroup} onChange={(e) => updateField("gmailGroup", e.target.value)} className="w-full h-8 px-2 border rounded-md text-sm bg-white">
                <option value="1">Group 1 (1 VM = 1 Gmail)</option>
                <option value="2">Group 2 (2 VM = 1 Gmail)</option>
              </select>
            </F>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase text-gray-400 mb-2">{t("srv_billing")}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <F label={t("srv_monthly_cost")}><Input type="number" step="0.01" min="0" value={form.monthlyCost} onChange={(e) => updateField("monthlyCost", e.target.value)} placeholder="150.00" className="h-8 text-sm" /></F>
            <F label={t("srv_billing_cycle")}><Input type="number" min="1" value={form.billingCycle} onChange={(e) => updateField("billingCycle", e.target.value)} className="h-8 text-sm" /></F>
            <F label={t("srv_expiry_renewal")}><Input type="date" value={form.expiryDate} onChange={(e) => updateField("expiryDate", e.target.value)} className="h-8 text-sm" /></F>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase text-gray-400 mb-2">{t("srv_network_info")}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <F label={t("srv_server_ip")}><div className="flex items-center gap-1"><Input value={form.ipAddress} onChange={(e) => updateField("ipAddress", e.target.value)} placeholder="107.172.249.42" className="h-8 text-sm font-mono flex-1" /><CopyBtn value={form.ipAddress} /></div></F>
            <F label={t("srv_netmask")}><div className="flex items-center gap-1"><Input value={form.netmask} onChange={(e) => updateField("netmask", e.target.value)} placeholder="255.255.255.252" className="h-8 text-sm font-mono flex-1" /><CopyBtn value={form.netmask} /></div></F>
            <F label={t("srv_gateway")}><div className="flex items-center gap-1"><Input value={form.gateway} onChange={(e) => updateField("gateway", e.target.value)} placeholder="107.172.249.41" className="h-8 text-sm font-mono flex-1" /><CopyBtn value={form.gateway} /></div></F>
            <F label={t("srv_allocation")}><div className="flex items-center gap-1"><Input value={form.allocation} onChange={(e) => updateField("allocation", e.target.value)} placeholder="107.172.249.40/30" className="h-8 text-sm font-mono flex-1" /><CopyBtn value={form.allocation} /></div></F>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase text-gray-400">{t("srv_vps_login")}</p>
            <button type="button" onClick={addUser} className="text-xs text-blue-600 hover:underline">{t("srv_add_login")}</button>
          </div>
          {form.users.map((cred, idx) => (
            <div key={idx} className="flex gap-2 mb-1.5 items-center">
              <div className="flex items-center gap-1 flex-1"><Input value={cred.username} onChange={(e) => updateUser(idx, "username", e.target.value)} placeholder={t("srv_username")} className="h-8 text-sm flex-1" /><CopyBtn value={cred.username} /></div>
              <div className="flex items-center gap-1 flex-1"><PasswordInput value={cred.password} onChange={(v) => updateUser(idx, "password", v)} placeholder={t("password")} className="h-8 text-sm flex-1" onRequestShow={(cb) => requirePin(cb, t("srv_pin_required"), t("srv_pin_view_pass"))} /><CopyBtn value={cred.password} /></div>
              {form.users.length > 1 && <button type="button" onClick={() => removeUser(idx)} className="text-red-500 hover:text-red-700 px-1 text-sm">x</button>}
            </div>
          ))}
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase text-gray-400 mb-2">{t("srv_hardware")}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <F label={t("srv_provider")}><Input value={form.provider} onChange={(e) => updateField("provider", e.target.value)} placeholder="ColoCrossing" className="h-8 text-sm" /></F>
            <F label={t("srv_cpu")}><Input value={form.cpu} onChange={(e) => updateField("cpu", e.target.value)} placeholder="32 vCPU" className="h-8 text-sm" /></F>
            <F label={t("srv_ram")}><Input value={form.ram} onChange={(e) => updateField("ram", e.target.value)} placeholder="64 GB" className="h-8 text-sm" /></F>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase text-gray-400 mb-2">{t("srv_ipmi_info")}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <F label={t("srv_ipmi_ip")}><div className="flex items-center gap-1"><Input value={form.ipmiIp} onChange={(e) => updateField("ipmiIp", e.target.value)} placeholder="206.217.138.162" className="h-8 text-sm font-mono flex-1" /><CopyBtn value={form.ipmiIp} prefix="https://" /></div></F>
            <F label={t("srv_ipmi_user")}><div className="flex items-center gap-1"><Input value={form.ipmiUser} onChange={(e) => updateField("ipmiUser", e.target.value)} placeholder="IPMI_USER" className="h-8 text-sm flex-1" /><CopyBtn value={form.ipmiUser} /></div></F>
            <F label={t("srv_ipmi_password")}><div className="flex items-center gap-1"><PasswordInput value={form.ipmiPass} onChange={(v) => updateField("ipmiPass", v)} placeholder="********" className="h-8 text-sm flex-1" onRequestShow={(cb) => requirePin(cb, t("srv_pin_required"), t("srv_pin_view_pass"))} /><CopyBtn value={form.ipmiPass} /></div></F>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t("srv_notes")}</label>
          <textarea value={form.notes} onChange={(e) => updateField("notes", e.target.value)} rows={2} className="w-full px-3 py-1.5 border rounded-md text-sm" placeholder="Server notes..." />
        </div>

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isLoading}>
            {isLoading ? t("saving") : editId ? t("update") : t("create")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>{t("cancel")}</Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </div>
  );
});

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

// Password field with eye toggle + optional PIN requirement
function PasswordInput({ value, onChange, placeholder, className, onRequestShow }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; onRequestShow?: (cb: () => void) => void }) {
  const [show, setShow] = useState(false);
  const handleToggle = () => {
    if (show) { setShow(false); return; }
    if (onRequestShow) { onRequestShow(() => setShow(true)); }
    else { setShow(true); }
  };
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`pr-8 ${className ?? ""}`}
      />
      <button type="button" onClick={handleToggle} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
        {show ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.05 6.05m3.828 3.828L6.05 6.05M6.05 6.05L3 3m18 18l-3.05-3.05m0 0a9.953 9.953 0 01-4.073 1.95M17.95 17.95L21 21" /></svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        )}
      </button>
    </div>
  );
}

// Helper: days until expiry
function getDaysUntilExpiry(expiryDate: string | Date | null | undefined): number | null {
  if (!expiryDate) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDate);
  exp.setHours(0, 0, 0, 0);
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function ExpiryBadge({ expiryDate }: { expiryDate: string | Date | null | undefined }) {
  const t = useT();
  const days = getDaysUntilExpiry(expiryDate);
  if (days === null) return null;
  if (days < 0) return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">{t("overdue")} {Math.abs(days)}d</span>;
  if (days <= 5) return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium animate-pulse">{days === 0 ? t("srv_expires_today") : `${days}${t("srv_days_left")}`}</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{days}{t("srv_days_left")}</span>;
}

// Inline cell editor dropdown for VM gmail/proxy assignment

// Info row with copy button for popup details
function InfoRow({ label, value, secret, badge, onRequestShow }: { label: string; value?: string | null; secret?: boolean; badge?: boolean; onRequestShow?: (cb: () => void) => void }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const displayVal = secret && !show ? "••••••••" : value;
  const handleToggleShow = () => {
    if (show) { setShow(false); return; }
    if (onRequestShow) { onRequestShow(() => setShow(true)); }
    else { setShow(true); }
  };
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-gray-500 text-xs shrink-0 w-24">{label}</span>
      <div className="flex items-center gap-1 flex-1 min-w-0">
        {badge ? (
          <Badge className="text-[10px] px-1.5 py-0">{value}</Badge>
        ) : (
          <span className="font-mono text-xs truncate">{displayVal}</span>
        )}
        {secret && (
          <button onClick={handleToggleShow} className="text-gray-400 hover:text-gray-600 shrink-0" title={show ? "Hide" : "Show"}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {show ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242" />
                : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>}
            </svg>
          </button>
        )}
        {!badge && (
          <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="text-gray-400 hover:text-gray-600 shrink-0" title="Copy">
            {copied ? (
              <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ServersPage() {
  const { currentProjectId: projectId, currentRole } = useProjectStore();
  const utils = trpc.useUtils();
  const { requirePin, PinDialog } = usePinAction();
  const t = useT();

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

  // (credentials removed from UI)

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

  // Mutations
  const createServer = trpc.server.create.useMutation({
    onSuccess: () => { utils.server.list.invalidate(); setShowForm(false); setForm({ ...emptyForm }); toast.success(t("srv_created")); },
    onError: (e) => toast.error(e.message),
  });
  const updateServer = trpc.server.update.useMutation({
    onSuccess: () => { utils.server.list.invalidate(); utils.server.getById.invalidate(); setEditId(null); setShowForm(false); setForm({ ...emptyForm }); toast.success(t("srv_updated")); },
    onError: (e) => toast.error(e.message),
  });
  const deleteServer = trpc.server.delete.useMutation({
    onSuccess: () => { utils.server.list.invalidate(); setDeleteConfirm(null); if (deleteConfirm === selectedServerId) setSelectedServerId(null); toast.success(t("srv_deleted")); },
    onError: (e) => toast.error(e.message),
  });
  const bulkUpdateStatus = trpc.server.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { utils.server.list.invalidate(); setSelectedServerIds(new Set()); setBulkStatusTarget(""); toast.success(`${r.updated} ${t("srv_servers_updated")}`); },
    onError: (e) => toast.error(e.message),
  });
  const bulkDelete = trpc.server.bulkDelete.useMutation({
    onSuccess: (r) => { utils.server.list.invalidate(); setSelectedServerIds(new Set()); setShowBulkDelete(false); if (selectedServerId && selectedServerIds.has(selectedServerId)) setSelectedServerId(null); toast.success(`${r.deleted} ${t("srv_servers_deleted")}`); },
    onError: (e) => toast.error(e.message),
  });
  const importFromCSV = trpc.server.importFromCSV.useMutation({
    onSuccess: (r) => { utils.server.list.invalidate(); setShowImport(false); setImportPreview([]); toast.success(`${t("srv_imported")} ${r.imported}, ${t("srv_skipped")} ${r.skipped}`); if (r.errors.length) toast.error(r.errors.join("\n")); },
    onError: (e) => toast.error(e.message),
  });
  const bulkAssignSelected = trpc.vm.bulkAssignSelected.useMutation({
    onSuccess: (r) => { utils.server.getById.invalidate(); utils.vm.availableCounts.invalidate(); toast.success(`${t("qa_assigned")}: ${r.assigned}/${r.total}`); if (r.errors.length) toast.error(r.errors.slice(0, 5).join("\n")); },
    onError: (e) => toast.error(e.message),
  });
  const vmBulkUpdateStatus = trpc.vm.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { utils.server.getById.invalidate(); setSelectedVmIds(new Set()); setVmBulkStatus(""); toast.success(`${r.updated} ${t("srv_vms")} updated`); },
    onError: (e) => toast.error(e.message),
  });
  const vmBulkDelete = trpc.vm.bulkDelete.useMutation({
    onSuccess: (r) => { utils.server.getById.invalidate(); utils.server.list.invalidate(); setSelectedVmIds(new Set()); toast.success(`${r.deleted} ${t("vm_deleted_count")}`); },
    onError: (e) => toast.error(e.message),
  });
  const vmCreate = trpc.vm.create.useMutation({
    onSuccess: () => { utils.server.getById.invalidate(); utils.server.list.invalidate(); setShowVmCreate(false); setVmSingleCode(""); toast.success(t("vm_created")); },
    onError: (e) => toast.error(e.message),
  });
  const vmBulkCreate = trpc.vm.bulkCreate.useMutation({
    onSuccess: (r) => { utils.server.getById.invalidate(); utils.server.list.invalidate(); setShowVmCreate(false); toast.success(`${r.created} ${t("vm_created_count")}`); if (r.errors.length) toast.error(r.errors.join("\n")); },
    onError: (e) => toast.error(e.message),
  });
  const assignGmail = trpc.vm.assignGmail.useMutation({
    onSuccess: () => { utils.server.getById.invalidate(); utils.vm.availableCounts.invalidate(); toast.success(t("saved")); },
    onError: (e) => toast.error(e.message),
  });
  const assignProxy = trpc.vm.assignProxy.useMutation({
    onSuccess: () => { utils.server.getById.invalidate(); utils.vm.availableCounts.invalidate(); toast.success(t("saved")); },
    onError: (e) => toast.error(e.message),
  });
  const bulkAutoAssign = trpc.vm.bulkAutoAssign.useMutation({
    onSuccess: (r) => { utils.server.getById.invalidate(); utils.server.list.invalidate(); utils.vm.availableCounts.invalidate(); setSelectedVmIds(new Set()); setShowQuickAssign(false); toast.success(`${t("qa_assigned")}: ${r.gmail} Gmail, ${r.proxy} Proxy`); },
    onError: (e) => toast.error(e.message),
  });

  // Quick Assign
  const [showQuickAssign, setShowQuickAssign] = useState(false);
  const [qaGmail, setQaGmail] = useState(true);
  const [qaProxy, setQaProxy] = useState(true);

  // Info popup (click Gmail/Proxy/PayPal to see details)
  const [infoPopup, setInfoPopup] = useState<{ type: "gmail" | "proxy" | "paypal"; data: any; vmId: string } | null>(null);
  // Decrypted credentials for info popup
  const [decryptedCreds, setDecryptedCreds] = useState<{ password?: string | null; twoFaCurrent?: string | null } | null>(null);
  const [loadingCreds, setLoadingCreds] = useState(false);

  // Change assignment popup (from info popup)
  const [changePopup, setChangePopup] = useState<{ field: "gmail" | "proxy"; vmId: string } | null>(null);
  const [changeSearch, setChangeSearch] = useState("");

  // Picker dialog (bulk select from available data to assign to multiple VMs)
  const [pickerDialog, setPickerDialog] = useState<{ field: "gmail" | "proxy" } | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());

  // Queries for change popup & picker dialog
  const { data: availableGmails } = trpc.gmail.list.useQuery(
    { projectId: projectId!, page: 1, limit: 500 },
    { enabled: !!projectId && (changePopup?.field === "gmail" || pickerDialog?.field === "gmail") }
  );
  const { data: availableProxies } = trpc.proxy.list.useQuery(
    { projectId: projectId!, page: 1, limit: 200 },
    { enabled: !!projectId && (changePopup?.field === "proxy" || pickerDialog?.field === "proxy") }
  );

  const canEdit = currentRole === "ADMIN" || currentRole === "MODERATOR" || currentRole === "USER";
  const canDelete = currentRole === "ADMIN" || currentRole === "MODERATOR";

  // Form save handler - receives payload directly from ServerFormPanel
  const handleSave = useCallback((payload: any, isEdit: boolean) => {
    if (isEdit) updateServer.mutate(payload);
    else createServer.mutate(payload);
  }, [createServer, updateServer]);

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  const startEdit = (server: any) => {
    const baseForm: ServerForm = {
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
      monthlyCost: server.monthlyCost ? String(server.monthlyCost) : "",
      billingCycle: server.billingCycle ? String(server.billingCycle) : "1",
      createdDate: server.createdDate ? new Date(server.createdDate).toISOString().split("T")[0] : "",
      expiryDate: server.expiryDate ? new Date(server.expiryDate).toISOString().split("T")[0] : "",
      notes: server.notes || "",
      gmailGroup: String(server.gmailGroup ?? 1),
      users: [{ username: "", password: "" }],
      ipmiIp: "", ipmiUser: "", ipmiPass: "",
    };
    setForm(baseForm);
    setEditId(server.id);
    setShowForm(true);

    // Load decrypted credentials async
    trpcVanilla.server.getCredentials.query({ projectId: projectId!, id: server.id })
      .then((creds: any) => {
        if (!creds) return;
        setForm(f => ({
          ...f,
          users: creds.users?.length ? creds.users.map((u: any) => ({ username: u.username || "", password: u.password || "" })) : [{ username: "", password: "" }],
          ipmiIp: creds.ipmi?.ip || "",
          ipmiUser: creds.ipmi?.user || "",
          ipmiPass: creds.ipmi?.password || "",
        }));
      })
      .catch(() => { /* credentials not available or no permission */ });
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
  const { data: availCounts } = trpc.vm.availableCounts.useQuery(
    { projectId: projectId!, serverId: selectedServerId ?? undefined },
    { enabled: !!projectId && (showQuickAssign || hasVmSelection) }
  );

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {PinDialog}

      {/* Top action bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900">{t("srv_title")}</h1>
          <span className="text-xs text-gray-400">({servers?.length ?? 0} {t("srv_title").toLowerCase()}, {servers?.reduce((s: number, sv: any) => s + (sv._count?.vms ?? 0), 0) ?? 0} {t("srv_vms")})</span>
          {servers && servers.length > 0 && (
            <>
              <span className="text-xs font-medium text-gray-600 ml-2">${servers.reduce((s: number, sv: any) => s + Number(sv.monthlyCost ?? 0), 0).toFixed(2)}{t("srv_per_mo")}</span>
              {(() => { const expiring = servers.filter((s: any) => { const d = getDaysUntilExpiry(s.expiryDate); return d !== null && d <= 5; }).length; return expiring > 0 ? <span className="text-xs font-medium text-amber-600 ml-1">({expiring} {t("srv_expiring")})</span> : null; })()}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!servers?.length}>{t("export_csv")}</Button>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>{t("import_csv")}</Button>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
          {canEdit && (
            <Button size="sm" onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ ...emptyForm }); }}>
              {showForm ? t("cancel") : "+ " + t("srv_add")}
            </Button>
          )}
        </div>
      </div>

      {/* Bulk server action bar */}
      {hasSelection && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-3 shrink-0">
          <span className="text-sm font-medium text-blue-800">{selectedServerIds.size} {t("selected")}</span>
          <select value={bulkStatusTarget} onChange={(e) => setBulkStatusTarget(e.target.value)} className="h-7 px-2 border rounded text-sm">
            <option value="">{t("change_status")}</option>
            {ALL_SERVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {bulkStatusTarget && <Button size="sm" onClick={() => bulkUpdateStatus.mutate({ projectId: projectId!, serverIds: Array.from(selectedServerIds), status: bulkStatusTarget as any })}>Apply</Button>}
          {canDelete && <Button size="sm" variant="destructive" onClick={() => setShowBulkDelete(true)}>{t("delete_selected")}</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSelectedServerIds(new Set())}>{t("clear")}</Button>
        </div>
      )}
      {showBulkDelete && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between shrink-0">
          <p className="text-sm text-red-800">{t("delete")} {selectedServerIds.size} {t("srv_bulk_delete_confirm")}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => bulkDelete.mutate({ projectId: projectId!, serverIds: Array.from(selectedServerIds) })} disabled={bulkDelete.isLoading}>{bulkDelete.isLoading ? "..." : t("confirm")}</Button>
            <Button size="sm" variant="outline" onClick={() => setShowBulkDelete(false)}>{t("cancel")}</Button>
          </div>
        </div>
      )}

      {/* Create/Edit Form - extracted component to prevent re-render lag */}
      {showForm && (
        <ServerFormPanel
          form={form}
          setForm={setForm}
          editId={editId}
          projectId={projectId!}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditId(null); }}
          isLoading={createServer.isLoading || updateServer.isLoading}
          error={createServer.error?.message || updateServer.error?.message}
          requirePin={requirePin}
          t={t}
        />
      )}

      {deleteConfirm && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between shrink-0">
          <p className="text-sm text-red-800">{t("srv_delete_confirm")}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => deleteServer.mutate({ projectId: projectId!, id: deleteConfirm })} disabled={deleteServer.isLoading}>{deleteServer.isLoading ? "..." : t("delete")}</Button>
            <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)}>{t("cancel")}</Button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left - Server List */}
        <div className="w-72 xl:w-80 border-r border-gray-200 bg-white flex flex-col shrink-0">
          <div className="p-3 border-b border-gray-200">
            <Input placeholder={t("srv_search")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
            <input type="checkbox" checked={filteredServers.length > 0 && selectedServerIds.size === filteredServers.length} onChange={toggleSelectAll} className="rounded border-gray-300" />
            <span className="text-[10px] text-gray-500">{t("select_all")} ({filteredServers.length})</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? <p className="p-4 text-gray-400 text-sm">{t("loading")}</p> : filteredServers.length === 0 ? <p className="p-4 text-gray-400 text-sm">{t("srv_no_servers")}</p> : (
              filteredServers.map((server: any) => {
                const isSelected = selectedServerId === server.id;
                const isChecked = selectedServerIds.has(server.id);
                const daysLeft = getDaysUntilExpiry(server.expiryDate);
                const isExpiring = daysLeft !== null && daysLeft <= 5;
                const isOverdue = daysLeft !== null && daysLeft < 0;
                return (
                  <div key={server.id} className={`px-3 py-2.5 border-b border-gray-50 cursor-pointer transition-colors group ${isSelected ? "bg-blue-50 border-l-2 border-l-blue-500" : isChecked ? "bg-blue-50/50 border-l-2 border-l-transparent" : isOverdue ? "bg-red-50/50 border-l-2 border-l-red-400" : isExpiring ? "bg-amber-50/50 border-l-2 border-l-amber-400" : "hover:bg-gray-50 border-l-2 border-l-transparent"}`}>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={isChecked} onChange={() => toggleServerSelect(server.id)} onClick={(e) => e.stopPropagation()} className="rounded border-gray-300 shrink-0" />
                      <div className="flex-1 min-w-0" onClick={() => { setSelectedServerId(server.id); setSelectedVmIds(new Set()); }}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm text-gray-900 truncate">{server.code}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge className={`text-[10px] px-1.5 py-0 ${serverStatusColors[server.status] ?? ""}`}>{server.status}</Badge>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-xs text-gray-500">{server.ipAddress ?? t("no_ip")}</span>
                          <span className="text-xs text-gray-500">{server._count?.vms ?? 0} {t("srv_vms")}</span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[10px] text-gray-400">{server.provider || ""}{server.monthlyCost ? ` · $${Number(server.monthlyCost).toFixed(0)}${t("srv_per_mo")}` : ""}</span>
                          <ExpiryBadge expiryDate={server.expiryDate} />
                        </div>
                      </div>
                      {/* Edit / Delete buttons */}
                      <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {canEdit && (
                          <button onClick={(e) => { e.stopPropagation(); startEdit(server); }} className="p-1 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50" title={t("edit")}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={(e) => { e.stopPropagation(); requirePin(() => setDeleteConfirm(server.id), t("srv_pin_required"), "Enter PIN to delete server"); }} className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50" title={t("delete")}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        )}
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
                <p className="text-sm">{t("srv_select_detail")}</p>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center text-gray-400"><p>{t("loading")}</p></div>
          ) : serverDetail ? (
            <>
              {/* Server Info Header */}
              <div className="bg-white border-b border-gray-200 p-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-gray-900">{serverDetail.code}</h2>
                  <Badge className={serverStatusColors[serverDetail.status] ?? ""}>{serverDetail.status}</Badge>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => startEdit(serverDetail)} title={t("srv_edit")}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </Button>
                </div>
                {(serverDetail.cpu || serverDetail.ram || serverDetail.provider) && (
                  <div className="flex items-center gap-2 mt-1">
                    {serverDetail.cpu && <Badge variant="outline" className="text-xs">{serverDetail.cpu}</Badge>}
                    {serverDetail.ram && <Badge variant="outline" className="text-xs">{serverDetail.ram}</Badge>}
                    {serverDetail.provider && <Badge variant="outline" className="text-xs">{serverDetail.provider}</Badge>}
                    <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                      Gmail Group {serverDetail.gmailGroup ?? 1} ({serverDetail.gmailGroup === 2 ? "2VM:1Gmail" : "1VM:1Gmail"})
                    </Badge>
                  </div>
                )}
                <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 flex-wrap">
                  <span className="font-mono">{serverDetail.ipAddress ?? t("no_ip")}</span>
                  {serverDetail.netmask && <span>{t("srv_mask")} {serverDetail.netmask}</span>}
                  {serverDetail.gateway && <span>{t("srv_gw")} {serverDetail.gateway}</span>}
                  {serverDetail.allocation && <span>{t("srv_alloc")} {serverDetail.allocation}</span>}
                  {serverDetail.inventoryId && <span>{t("srv_inv")} {serverDetail.inventoryId}</span>}
                  {serverDetail.monthlyCost && <span className="font-medium text-gray-700">${Number(serverDetail.monthlyCost).toFixed(2)}{t("srv_per_mo")}</span>}
                  {serverDetail.expiryDate && (
                    <span className="flex items-center gap-1">
                      {t("srv_exp")} {new Date(serverDetail.expiryDate).toLocaleDateString()}
                      <ExpiryBadge expiryDate={serverDetail.expiryDate} />
                    </span>
                  )}
                </div>

                {/* Stats */}
                <div className="flex gap-3 mt-3 flex-wrap">
                  <div className="bg-gray-50 rounded-lg px-3 py-2 min-w-[80px]">
                    <p className="text-[10px] font-medium text-gray-500 uppercase">{t("srv_vms")}</p>
                    <p className="text-xl font-bold text-gray-900">{serverDetail.vms.length}</p>
                  </div>
                  <div className="bg-green-50 rounded-lg px-3 py-2 min-w-[80px]">
                    <p className="text-[10px] font-medium text-green-600 uppercase">{t("srv_24h")}</p>
                    <p className="text-xl font-bold text-green-700">${totalEarn24h.toFixed(2)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg px-3 py-2 min-w-[80px]">
                    <p className="text-[10px] font-medium text-blue-600 uppercase">{t("total")}</p>
                    <p className="text-xl font-bold text-blue-700">${totalEarnAll.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              {/* VM action bar */}
              <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-wrap">
                <Button size="sm" variant={vmStatusFilter === "" ? "default" : "outline"} className="h-6 text-xs px-2" onClick={() => setVmStatusFilter("")}>{t("all").toUpperCase()} ({serverDetail.vms.length})</Button>
                {ALL_VM_STATUSES.map((s) => {
                  const cnt = vmStatusCounts[s] ?? 0;
                  if (cnt === 0) return null;
                  return <Button key={s} size="sm" variant={vmStatusFilter === s ? "default" : "outline"} className="h-6 text-xs px-2" onClick={() => setVmStatusFilter(vmStatusFilter === s ? "" : s)}>{s} ({cnt})</Button>;
                })}
                <div className="ml-auto flex items-center gap-2">
                  {hasVmSelection && (
                    <>
                      <span className="text-xs text-blue-600 font-medium">{selectedVmIds.size} {t("srv_vms")}</span>
                      <Button size="sm" className="h-6 text-xs px-2 bg-green-600 hover:bg-green-700" onClick={() => setShowQuickAssign(true)}>{t("qa_title")}</Button>
                      <select value={vmBulkStatus} onChange={(e) => setVmBulkStatus(e.target.value)} className="h-6 px-1 border rounded text-xs">
                        <option value="">{t("srv_status_filter")}</option>
                        {ALL_VM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {vmBulkStatus && <Button size="sm" className="h-6 text-xs px-2" onClick={() => vmBulkUpdateStatus.mutate({ projectId: projectId!, vmIds: Array.from(selectedVmIds), status: vmBulkStatus as any })}>Apply</Button>}
                      {canDelete && <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={() => requirePin(() => vmBulkDelete.mutate({ projectId: projectId!, vmIds: Array.from(selectedVmIds) }), t("srv_pin_required"), `${t("delete")} ${selectedVmIds.size} ${t("srv_vms")}?`)} disabled={vmBulkDelete.isLoading}>{vmBulkDelete.isLoading ? "..." : t("delete")}</Button>}
                      <span className="text-gray-300">|</span>
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setPickerDialog({ field: "gmail" }); setPickerSearch(""); setPickerSelected(new Set()); }}>+ Gmail</Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setPickerDialog({ field: "proxy" }); setPickerSearch(""); setPickerSelected(new Set()); }}>+ Proxy</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-1" onClick={() => setSelectedVmIds(new Set())}>x</Button>
                    </>
                  )}
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setShowVmCreate(true); setVmCreateMode("single"); setVmSingleCode(""); }}>{t("srv_add_vm")}</Button>
                  <Input placeholder={t("srv_search_vm")} value={vmSearch} onChange={(e) => setVmSearch(e.target.value)} className="h-7 text-xs w-36" />
                </div>
              </div>

              {/* Quick Assign Panel */}
              {showQuickAssign && hasVmSelection && (
                <div className="bg-green-50 border-b border-green-200 px-4 py-3 shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-green-900">{t("qa_title")} - {selectedVmIds.size} {t("srv_vms")}</h3>
                    <button onClick={() => setShowQuickAssign(false)} className="text-green-600 hover:text-green-800">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <div className="flex items-center gap-4 mb-3">
                    <label className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={qaGmail} onChange={(e) => setQaGmail(e.target.checked)} className="rounded border-gray-300" />
                      <span className="font-medium">{t("qa_gmail")}</span>
                      <span className="text-green-700">({availCounts?.gmail ?? 0} {t("qa_available")})</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={qaProxy} onChange={(e) => setQaProxy(e.target.checked)} className="rounded border-gray-300" />
                      <span className="font-medium">{t("qa_proxy")}</span>
                      <span className="text-green-700">({availCounts?.proxy ?? 0} {t("qa_available")})</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => bulkAutoAssign.mutate({ projectId: projectId!, vmIds: Array.from(selectedVmIds), assignGmail: qaGmail, assignProxy: qaProxy })} disabled={bulkAutoAssign.isLoading}>
                      {bulkAutoAssign.isLoading ? t("saving") : `${t("qa_assign_all")} (${selectedVmIds.size} ${t("srv_vms")})`}
                    </Button>
                    <span className="text-[10px] text-green-700">{t("qa_assign_desc")}</span>
                  </div>
                </div>
              )}

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
                      <tr><td colSpan={VM_COLUMNS.length + 2} className="text-center py-8 text-gray-400 text-sm">{vmStatusFilter ? t("vm_no_vms_status") : t("vm_no_vms_server")}</td></tr>
                    ) : (
                      filteredVMs.map((vm: any, idx: number) => (
                        <tr key={vm.id} className={`hover:bg-blue-50/30 transition-colors ${selectedVmIds.has(vm.id) ? "bg-blue-50/50" : ""}`}>
                          <td className="px-2 py-1.5 w-8"><input type="checkbox" checked={selectedVmIds.has(vm.id)} onChange={() => toggleVmSelect(vm.id)} className="rounded border-gray-300" /></td>
                          <td className="px-2 py-1.5 text-xs text-gray-400">{idx + 1}</td>
                          <td className="px-2 py-1.5"><Badge className={`text-[10px] px-1.5 py-0 ${vmStatusColors[vm.status] ?? ""}`}>{vm.status}</Badge></td>
                          <td className="px-2 py-1.5 text-xs font-medium text-gray-700 truncate">{serverDetail.code}</td>
                          <td className="px-2 py-1.5 font-medium text-gray-900 truncate">{vm.code}</td>
                          {/* Gmail cell */}
                          <td className="px-2 py-1.5 text-xs truncate">
                            {vm.gmail ? (
                              <span onClick={() => { setInfoPopup({ type: "gmail", data: vm.gmail, vmId: vm.id }); setDecryptedCreds(null); }} className="cursor-pointer hover:bg-blue-50 rounded px-1 -mx-1 block truncate text-gray-700 underline decoration-dotted">{vm.gmail.email}</span>
                            ) : (
                              <span className="text-gray-300">&mdash;</span>
                            )}
                          </td>
                          {/* Proxy cell */}
                          <td className="px-2 py-1.5 text-xs font-mono truncate">
                            {vm.proxy ? (
                              <span onClick={() => setInfoPopup({ type: "proxy", data: vm.proxy, vmId: vm.id })} className="cursor-pointer hover:bg-blue-50 rounded px-1 -mx-1 block truncate text-blue-600 underline decoration-dotted">{vm.proxy.address}</span>
                            ) : (
                              <span className="text-gray-300">&mdash;</span>
                            )}
                          </td>
                          {/* PayPal cell - read-only */}
                          <td className="px-2 py-1.5 text-xs text-gray-500 truncate">
                            {vm.gmail?.paypal ? (
                              <span className="cursor-pointer hover:bg-blue-50 rounded px-1 -mx-1 block truncate underline decoration-dotted" onClick={() => setInfoPopup({ type: "paypal", data: vm.gmail.paypal, vmId: vm.id })}>{vm.gmail.paypal.code}</span>
                            ) : "\u2014"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-medium">${Number(vm.earnTotal ?? 0).toFixed(2)}</td>
                          <td className={`px-2 py-1.5 text-right font-medium ${Number(vm.earn24h ?? 0) > 0 ? "text-green-600" : "text-gray-400"}`}>${Number(vm.earn24h ?? 0).toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-xs text-gray-500">{vm.uptime ?? "\u2014"}</td>
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
          <DialogHeader><DialogTitle>{t("srv_import_title")}</DialogTitle></DialogHeader>
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
              <Button onClick={handleImport} disabled={importFromCSV.isLoading || !importPreview.length}>{importFromCSV.isLoading ? "..." : `${t("import")} ${importPreview.length}`}</Button>
              <Button variant="outline" onClick={() => { setShowImport(false); setImportPreview([]); }}>{t("cancel")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Picker Dialog - Select available data to assign */}
      <Dialog open={!!pickerDialog} onOpenChange={(v) => { if (!v) { setPickerDialog(null); setPickerSelected(new Set()); } }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {pickerDialog?.field === "gmail" ? t("pick_select_gmail") : t("pick_select_proxy")}
              <span className="text-sm font-normal text-gray-500 ml-2">&rarr; {selectedVmIds.size} {t("pick_vms_selected")}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 flex-1 min-h-0">
            <div className="flex items-center gap-2">
              <Input placeholder={t("search") + "..."} value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} className="h-8 text-sm" autoFocus />
              <span className="text-xs text-gray-500 whitespace-nowrap">{pickerSelected.size} {t("selected")}</span>
            </div>
            <p className="text-[10px] text-gray-400">{t("pick_select_max")} {selectedVmIds.size} {t("pick_assign_order")}</p>
            <div className="flex-1 overflow-y-auto border rounded-lg min-h-0 max-h-[50vh]">
              {pickerDialog?.field === "gmail" && (() => {
                const maxVms = serverDetail?.gmailGroup === 2 ? 2 : 1;
                const filtered = (availableGmails?.items ?? []).filter((g: any) => g.status === "ACTIVE" && (g._count?.vms ?? 0) < maxVms).filter((g: any) => !pickerSearch || g.email.toLowerCase().includes(pickerSearch.toLowerCase()));
                return filtered.length === 0
                  ? <p className="text-xs text-gray-400 p-4 text-center">{t("pick_no_gmail")}</p>
                  : filtered.map((g: any) => (
                    <label key={g.id} className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 ${pickerSelected.has(g.id) ? "bg-blue-50" : ""}`}>
                      <input type="checkbox" checked={pickerSelected.has(g.id)} onChange={() => setPickerSelected((prev) => { const next = new Set(prev); if (next.has(g.id)) next.delete(g.id); else { if (next.size >= selectedVmIds.size) return prev; next.add(g.id); } return next; })} disabled={!pickerSelected.has(g.id) && pickerSelected.size >= selectedVmIds.size} className="rounded border-gray-300" />
                      <span className="font-mono text-xs">{g.email}</span>
                      <span className="text-[10px] text-gray-400 ml-auto">{g._count?.vms ?? 0}/{maxVms}</span>
                    </label>
                  ));
              })()}
              {pickerDialog?.field === "proxy" && (
                (availableProxies?.items ?? []).filter((p: any) => p.status === "AVAILABLE").filter((p: any) => !pickerSearch || p.address.toLowerCase().includes(pickerSearch.toLowerCase())).length === 0
                ? <p className="text-xs text-gray-400 p-4 text-center">{t("pick_no_proxy")}</p>
                : (availableProxies?.items ?? []).filter((p: any) => p.status === "AVAILABLE").filter((p: any) => !pickerSearch || p.address.toLowerCase().includes(pickerSearch.toLowerCase())).map((p: any) => (
                  <label key={p.id} className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 ${pickerSelected.has(p.id) ? "bg-blue-50" : ""}`}>
                    <input type="checkbox" checked={pickerSelected.has(p.id)} onChange={() => setPickerSelected((prev) => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else { if (next.size >= selectedVmIds.size) return prev; next.add(p.id); } return next; })} disabled={!pickerSelected.has(p.id) && pickerSelected.size >= selectedVmIds.size} className="rounded border-gray-300" />
                    <span className="font-mono text-xs">{p.address}</span>
                    {p.subnet && <span className="text-[10px] text-gray-400">{p.subnet}</span>}
                    <Badge className="text-[10px] px-1 py-0 bg-green-100 text-green-700 ml-auto">AVAILABLE</Badge>
                  </label>
                ))
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => {
                if (!pickerDialog || pickerSelected.size === 0 || selectedVmIds.size === 0) return;
                const itemIds = Array.from(pickerSelected);
                const vmIds = Array.from(selectedVmIds);
                bulkAssignSelected.mutate({ projectId: projectId!, vmIds, field: pickerDialog.field, itemIds });
                setPickerDialog(null); setPickerSelected(new Set());
              }} disabled={bulkAssignSelected.isLoading || pickerSelected.size === 0}>
                {bulkAssignSelected.isLoading ? t("saving") : `${t("pick_assign_to_vms")} (${pickerSelected.size} → ${selectedVmIds.size})`}
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => {
                if (pickerSelected.size > 0) { setPickerSelected(new Set()); return; }
                const field = pickerDialog?.field;
                let allIds: string[] = [];
                const maxVms = serverDetail?.gmailGroup === 2 ? 2 : 1;
                if (field === "gmail") allIds = (availableGmails?.items ?? []).filter((g: any) => g.status === "ACTIVE" && (g._count?.vms ?? 0) < maxVms).filter((g: any) => !pickerSearch || g.email.toLowerCase().includes(pickerSearch.toLowerCase())).map((g: any) => g.id);
                else if (field === "proxy") allIds = (availableProxies?.items ?? []).filter((p: any) => p.status === "AVAILABLE").filter((p: any) => !pickerSearch || p.address.toLowerCase().includes(pickerSearch.toLowerCase())).map((p: any) => p.id);
                // Limit to number of selected VMs
                setPickerSelected(new Set(allIds.slice(0, selectedVmIds.size)));
              }}>
                {pickerSelected.size > 0 ? t("deselect_all") : `${t("select_all")} (${Math.min(selectedVmIds.size, 999)})`}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setPickerDialog(null); setPickerSelected(new Set()); }}>{t("cancel")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Info Popup - Gmail/Proxy/PayPal details */}
      <Dialog open={!!infoPopup} onOpenChange={(v) => { if (!v) { setInfoPopup(null); setDecryptedCreds(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {infoPopup?.type === "gmail" ? t("info_gmail_details") : infoPopup?.type === "proxy" ? t("info_proxy_details") : t("info_paypal_details")}
            </DialogTitle>
          </DialogHeader>
          {infoPopup?.type === "gmail" && infoPopup.data && (
            <div className="space-y-3">
              <InfoRow label={t("email")} value={infoPopup.data.email} />
              {decryptedCreds ? (
                <>
                  <InfoRow label={t("password")} value={decryptedCreds.password} secret />
                  <InfoRow label={t("info_2fa_code")} value={decryptedCreds.twoFaCurrent} secret />
                </>
              ) : (
                <Button size="sm" variant="outline" className="w-full text-xs" disabled={loadingCreds} onClick={() => {
                  const gmailId = infoPopup.data.id;
                  requirePin(() => {
                    setLoadingCreds(true);
                    trpcVanilla.gmail.getCredentials.query({ projectId: projectId!, id: gmailId })
                      .then((creds) => {
                        setDecryptedCreds(creds ?? null);
                      })
                      .catch(() => { toast.error("Failed to load credentials"); })
                      .finally(() => setLoadingCreds(false));
                  }, t("srv_pin_required"), t("srv_pin_view_pass"));
                }}>
                  {loadingCreds ? (
                    <svg className="w-3.5 h-3.5 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                  {loadingCreds ? t("loading") : t("info_show_pass_pin")}
                </Button>
              )}
              <InfoRow label={t("info_recovery_email")} value={infoPopup.data.recoveryEmail} />
              <InfoRow label={t("col_status")} value={infoPopup.data.status} badge />
              {canEdit && (
                <Button size="sm" variant="outline" className="w-full text-xs mt-2" onClick={() => {
                  const vmId = infoPopup.vmId;
                  setInfoPopup(null);
                  setDecryptedCreds(null);
                  setTimeout(() => { setChangePopup({ field: "gmail", vmId }); setChangeSearch(""); }, 100);
                }}>{t("info_change_gmail")}</Button>
              )}
            </div>
          )}
          {infoPopup?.type === "proxy" && infoPopup.data && (
            <div className="space-y-3">
              <InfoRow label={t("info_address")} value={infoPopup.data.address} />
              <InfoRow label={t("info_host")} value={infoPopup.data.host} />
              <InfoRow label={t("info_port")} value={infoPopup.data.port?.toString()} />
              <InfoRow label={t("info_subnet")} value={infoPopup.data.subnet} />
              <InfoRow label={t("info_outbound_ip")} value={infoPopup.data.outboundIP} />
              <InfoRow label={t("col_status")} value={infoPopup.data.status} badge />
              {canEdit && (
                <Button size="sm" variant="outline" className="w-full text-xs mt-2" onClick={() => {
                  const vmId = infoPopup!.vmId;
                  setInfoPopup(null);
                  setTimeout(() => { setChangePopup({ field: "proxy", vmId }); setChangeSearch(""); }, 100);
                }}>{t("info_change_proxy")}</Button>
              )}
            </div>
          )}
          {infoPopup?.type === "paypal" && infoPopup.data && (
            <div className="space-y-3">
              <InfoRow label={t("pp_code")} value={infoPopup.data.code} />
              <InfoRow label={t("email")} value={infoPopup.data.primaryEmail} />
              <InfoRow label={t("col_status")} value={infoPopup.data.status} badge />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Change Assignment Popup */}
      <Dialog open={!!changePopup} onOpenChange={(v) => { if (!v) setChangePopup(null); }}>
        <DialogContent className="sm:max-w-md max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {changePopup?.field === "gmail" ? t("info_change_gmail_for") : t("info_change_proxy_for")}
              {changePopup && serverDetail?.vms && (() => {
                const vm = serverDetail.vms.find((v: any) => v.id === changePopup.vmId);
                return vm ? <span className="text-sm font-normal text-gray-500 ml-2">{vm.code}</span> : null;
              })()}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 flex-1 min-h-0">
            <Input placeholder={t("search") + "..."} value={changeSearch} onChange={(e) => setChangeSearch(e.target.value)} className="h-8 text-sm" autoFocus />
            <div className="flex-1 overflow-y-auto border rounded-lg min-h-0 max-h-[45vh]">
              {changePopup?.field === "gmail" && (() => {
                const maxVms = serverDetail?.gmailGroup === 2 ? 2 : 1;
                const filtered = (availableGmails?.items ?? []).filter((g: any) => g.status === "ACTIVE" && (g._count?.vms ?? 0) < maxVms).filter((g: any) => !changeSearch || g.email.toLowerCase().includes(changeSearch.toLowerCase()));
                return filtered.length === 0
                  ? <p className="text-xs text-gray-400 p-4 text-center">{t("pick_no_gmail")}</p>
                  : filtered.map((g: any) => (
                    <button key={g.id} onClick={() => { assignGmail.mutate({ projectId: projectId!, vmId: changePopup.vmId, gmailId: g.id }); setChangePopup(null); }} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 flex items-center justify-between">
                      <span className="font-mono text-xs truncate">{g.email}</span>
                      <span className="text-[10px] text-gray-400 ml-2 shrink-0">{g._count?.vms ?? 0}/{maxVms}</span>
                    </button>
                  ));
              })()}
              {changePopup?.field === "proxy" && (() => {
                const filtered = (availableProxies?.items ?? []).filter((p: any) => p.status === "AVAILABLE").filter((p: any) => !changeSearch || p.address.toLowerCase().includes(changeSearch.toLowerCase()));
                return filtered.length === 0
                  ? <p className="text-xs text-gray-400 p-4 text-center">{t("pick_no_proxy")}</p>
                  : filtered.map((p: any) => (
                    <button key={p.id} onClick={() => { assignProxy.mutate({ projectId: projectId!, vmId: changePopup.vmId, proxyId: p.id }); setChangePopup(null); }} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 flex items-center justify-between">
                      <span className="font-mono text-xs truncate">{p.address}</span>
                      <Badge className="text-[10px] px-1 py-0 bg-green-100 text-green-700 ml-2">AVAILABLE</Badge>
                    </button>
                  ));
              })()}
            </div>
            {changePopup && (
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" className="text-xs" onClick={() => {
                  if (changePopup.field === "gmail") assignGmail.mutate({ projectId: projectId!, vmId: changePopup.vmId, gmailId: null });
                  else assignProxy.mutate({ projectId: projectId!, vmId: changePopup.vmId, proxyId: null });
                  setChangePopup(null);
                }}>{t("info_unassign")}</Button>
                <Button size="sm" variant="outline" className="text-xs" onClick={() => setChangePopup(null)}>{t("cancel")}</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* VM Create Dialog */}
      <Dialog open={showVmCreate} onOpenChange={(v) => { if (!v) setShowVmCreate(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("vm_add_title")} {serverDetail?.code}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button size="sm" variant={vmCreateMode === "single" ? "default" : "outline"} onClick={() => setVmCreateMode("single")}>{t("vm_single")}</Button>
              <Button size="sm" variant={vmCreateMode === "bulk" ? "default" : "outline"} onClick={() => setVmCreateMode("bulk")}>{t("vm_bulk")}</Button>
            </div>
            {vmCreateMode === "single" ? (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t("vm_vm_code")}</label>
                <Input value={vmSingleCode} onChange={(e) => setVmSingleCode(e.target.value)} placeholder="M-001" className="text-sm" autoFocus />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <F label={t("vm_prefix")}><Input value={vmBulkPrefix} onChange={(e) => setVmBulkPrefix(e.target.value)} className="text-sm" /></F>
                  <F label={t("vm_start_num")}><Input type="number" min={1} value={vmBulkStart} onChange={(e) => setVmBulkStart(Number(e.target.value))} className="text-sm" /></F>
                  <F label={t("vm_count")}><Input type="number" min={1} max={200} value={vmBulkCount} onChange={(e) => setVmBulkCount(Number(e.target.value))} className="text-sm" /></F>
                </div>
                <p className="text-xs text-gray-400">{t("vm_preview")}: {vmBulkPrefix}-{String(vmBulkStart).padStart(3, "0")} to {vmBulkPrefix}-{String(vmBulkStart + vmBulkCount - 1).padStart(3, "0")}</p>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={handleVmCreate} disabled={vmCreate.isLoading || vmBulkCreate.isLoading}>
                {vmCreate.isLoading || vmBulkCreate.isLoading ? "..." : vmCreateMode === "single" ? t("vm_create_vm") : `${t("vm_create_vms")} (${vmBulkCount})`}
              </Button>
              <Button variant="outline" onClick={() => setShowVmCreate(false)}>{t("cancel")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
