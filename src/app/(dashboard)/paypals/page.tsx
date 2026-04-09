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
import { PageHistory } from "@/components/PageHistory";
import { useT } from "@/lib/i18n";
import { extractEmails } from "@/lib/pp-data-utils";
import toast from "react-hot-toast";

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  LIMITED: "bg-yellow-100 text-yellow-800",
  SUSPENDED: "bg-red-100 text-red-800",
};
const PP_STATUSES = ["ACTIVE", "LIMITED", "SUSPENDED"] as const;
const BUILTIN_HOLDERS = [
  ...Array.from({ length: 19 }, (_, i) => `PP${String(i + 1).padStart(2, "0")}`),
  "UNDETECTABLE", "MULTILOGIN",
];

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
function SecretCell({ ppId, field, projectId, pinVerified, onNeedPin, t, hasData = true }: {
  ppId: string; field: "password" | "twoFa" | "hotmailToken"; projectId: string;
  pinVerified: boolean; onNeedPin: () => void; t: (k: string) => string; hasData?: boolean;
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
      <div className="space-y-0.5">
        <div className="flex items-center gap-1">
          <CopyBtn value={revealed} />
          <button onClick={() => { setDraft(revealed === "—" ? "" : revealed); setEditing(true); }} className="text-gray-400 hover:text-blue-600 shrink-0" title="Edit">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
          </button>
          <button onClick={() => setRevealed(null)} className="text-gray-400 hover:text-gray-600 shrink-0" title="Hide">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243" /></svg>
          </button>
        </div>
        <span className="font-mono text-[10px] break-all leading-tight text-gray-800 select-all bg-gray-50 px-1 py-0.5 rounded block">{revealed}</span>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-red-400 font-medium">nodata</span>
        <button onClick={() => { setDraft(""); setEditing(true); }} className="text-gray-300 hover:text-blue-600 shrink-0" title="Thêm">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
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

// ─── All columns definition ─────────
const ALL_COLUMNS: Array<{ key: string; label: string; width: number; sortable?: boolean; rightAlign?: boolean; defaultVisible?: boolean }> = [
  { key: "checkbox", label: "", width: 28, defaultVisible: true },
  { key: "idx", label: "#", width: 28, defaultVisible: false },
  { key: "status", label: "Trạng thái", width: 50, sortable: true, defaultVisible: true },
  { key: "health", label: "Health", width: 50, defaultVisible: false },
  { key: "code", label: "Mã PP", width: 68, sortable: true, defaultVisible: true },
  { key: "holder", label: "User Win", width: 45, sortable: true, defaultVisible: true },
  { key: "vmppCode", label: "VMPP Code", width: 68, sortable: true, defaultVisible: true },
  { key: "email", label: "Email", width: 145, sortable: true, defaultVisible: true },
  { key: "pass", label: "Password", width: 75, defaultVisible: true },
  { key: "twoFa", label: "2FA", width: 75, defaultVisible: true },
  { key: "token", label: "Email Token", width: 95, defaultVisible: false },
  { key: "received", label: "Tổng nhận", width: 70, sortable: true, rightAlign: true, defaultVisible: false },
  { key: "withdrawn", label: "Đã rút", width: 70, sortable: true, rightAlign: true, defaultVisible: false },
  { key: "balance", label: "Số dư", width: 70, sortable: true, rightAlign: true, defaultVisible: true },
  { key: "notes", label: "Ghi chú", width: 120, defaultVisible: true },
  { key: "createdBy", label: "Người tạo", width: 60, defaultVisible: true },
];

const DEFAULT_VISIBLE_KEYS = ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

function getInitialVisibleCols(): string[] {
  if (typeof window === "undefined") return DEFAULT_VISIBLE_KEYS;
  try {
    const saved = localStorage.getItem("pp-visible-cols");
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_VISIBLE_KEYS;
}

// Checkbox column is fixed at position 0 — not reorderable
const REORDERABLE_KEYS = ALL_COLUMNS.filter((c) => c.key !== "checkbox").map((c) => c.key);

function getInitialColOrder(): string[] {
  if (typeof window === "undefined") return REORDERABLE_KEYS;
  try {
    const saved = localStorage.getItem("pp-col-order");
    if (saved) {
      const parsed = JSON.parse(saved) as string[];
      // Keep only valid keys, append any new keys not in saved order
      const valid = parsed.filter((k) => REORDERABLE_KEYS.includes(k));
      const missing = REORDERABLE_KEYS.filter((k) => !valid.includes(k));
      return [...valid, ...missing];
    }
  } catch {}
  return REORDERABLE_KEYS;
}

const DEFAULT_COL_WIDTHS: Record<string, number> = Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, c.width]));

// ─── Quick Add types ─────────

export default function PayPalsPage() {
  const router = useRouter();
  const t = useT();
  const { currentProjectId: projectId, currentRole } = useProjectStore();
  const utils = trpc.useUtils();

  // PIN verification — once per session for entire PayPals section
  const [pinVerified, setPinVerified] = useState(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("pp_pin_ok") === "1";
    return false;
  });
  const [showHistory, setShowHistory] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(getInitialVisibleCols);
  const [colOrder, setColOrder] = useState<string[]>(getInitialColOrder);
  const [showColPicker, setShowColPicker] = useState(false);
  const toggleCol = (key: string) => {
    setVisibleCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { localStorage.setItem("pp-visible-cols", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const isColVisible = (key: string) => visibleCols.includes(key);
  const moveCol = (key: string, direction: "up" | "down") => {
    setColOrder((prev) => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      try { localStorage.setItem("pp-col-order", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const resetColOrder = () => {
    setColOrder(REORDERABLE_KEYS);
    try { localStorage.setItem("pp-col-order", JSON.stringify(REORDERABLE_KEYS)); } catch {}
  };
  // Build ordered list of column definitions — checkbox always first, then by colOrder
  const orderedColumns = useMemo(() => {
    const map = new Map(ALL_COLUMNS.map((c) => [c.key, c]));
    const checkbox = map.get("checkbox")!;
    const rest = colOrder.map((k) => map.get(k)).filter(Boolean) as typeof ALL_COLUMNS;
    return [checkbox, ...rest];
  }, [colOrder]);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pendingPinAction, setPendingPinAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (projectId && !pinVerified) setShowPinDialog(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handlePinSuccess = () => {
    setPinVerified(true);
    sessionStorage.setItem("pp_pin_ok", "1");
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
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTermCount = useMemo(() => {
    return searchInput.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean).length;
  }, [searchInput]);
  const handleSearchChange = useCallback((val: string) => {
    setSearchInput(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setSearch(val), 400);
  }, []);
  const [showImport, setShowImport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Quick add panel
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickHolder, setQuickHolder] = useState("");
  const [quickEmails, setQuickEmails] = useState(""); // one email per line
  const [savingQuick, setSavingQuick] = useState(false);

  // Sheet import
  const [showSheetImport, setShowSheetImport] = useState(false);
  const [sheetUrl, setSheetUrl] = useState("https://docs.google.com/spreadsheets/d/1kJqc2HiH7x0BzAj4HxU8MZKQtUb60jj-0oKZU3TiBNo/edit?gid=1086067347#gid=1086067347");
  const [sheetPPCodes, setSheetPPCodes] = useState("");
  const [sheetResult, setSheetResult] = useState<any>(null);
  const [sheetTabs, setSheetTabs] = useState<Array<{ name: string; gid: string }>>([]);
  const [sheetSelectedGid, setSheetSelectedGid] = useState<string>("");
  const [sheetTabsLoading, setSheetTabsLoading] = useState(false);

  // Fix Broken Emails dialog state
  const [showFixBroken, setShowFixBroken] = useState(false);
  // Sheet import result dialog state
  const [importResult, setImportResult] = useState<null | {
    imported: number;
    updated: number;
    skipped: number;
    emailsCreated: number;
    emailsUpdated: number;
    changes: Array<{ ppCode: string; email?: string; fields: string[] }>;
    errors: string[];
  }>(null);

  // Get custom User Win list from project settings
  const { data: projectSettings } = trpc.project.getSettings.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );
  const allHolderOptions = useMemo(() => {
    const saved: string[] = (projectSettings as any)?.userWinList ?? [];
    // If settings has a list, use it as-is. Otherwise fallback to builtins.
    const base = saved.length > 0 ? saved : BUILTIN_HOLDERS;
    return [...base].sort((a, b) => a.localeCompare(b));
  }, [projectSettings]);

  const { data, isLoading } = trpc.paypal.list.useQuery(
    { projectId: projectId!, page: 1, limit: 500, search: search || undefined, status: (statusFilter !== "ALL" ? statusFilter : undefined) as any, role: (roleFilter !== "ALL" ? roleFilter : undefined) as any },
    { enabled: !!projectId, staleTime: 30000 }
  );

  const invalidate = () => { utils.paypal.list.invalidate(); };
  // Undo: save last edit locally, revert via editHistory.revert
  const lastEditRef = useRef<{ id: string; field: string; oldValue: any } | null>(null);
  const revertLastEdit = () => {
    const last = lastEditRef.current;
    if (!last || !projectId) return;
    const payload: any = { projectId, id: last.id };
    payload[last.field] = last.oldValue;
    updatePaypalSilent.mutate(payload);
    lastEditRef.current = null;
  };
  const updatePaypalSilent = trpc.paypal.update.useMutation({
    onSuccess: () => { invalidate(); toast.success("Đã hoàn tác"); },
    onError: (e) => toast.error(e.message),
  });
  const [showUndo, setShowUndo] = useState(false);
  const updatePaypal = trpc.paypal.update.useMutation({
    onSuccess: () => {
      invalidate();
      if (lastEditRef.current) {
        setShowUndo(true);
        setTimeout(() => setShowUndo(false), 15000);
      } else {
        toast.success(t("saved"));
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const bulkImport = trpc.paypal.bulkImport.useMutation({
    onSuccess: (res) => { invalidate(); toast.success(`Imported ${res.imported}, skipped ${res.skipped}`); },
    onError: (e) => toast.error(e.message),
  });
  const bulkUpdateStatus = trpc.paypal.bulkUpdateStatus.useMutation({ onSuccess: (res) => { invalidate(); setSelectedIds(new Set()); toast.success(`Updated ${res.updated}`); }, onError: (e) => toast.error(e.message) });
  const bulkUpdateHolder = trpc.paypal.bulkUpdateHolder.useMutation({ onSuccess: (res) => { invalidate(); setSelectedIds(new Set()); toast.success(`Updated ${res.updated}`); }, onError: (e) => toast.error(e.message) });
  const bulkDelete = trpc.paypal.bulkDelete.useMutation({ onSuccess: (res) => { invalidate(); setSelectedIds(new Set()); toast.success(`Deleted ${res.deleted}`); }, onError: (e) => toast.error(e.message) });

  // ─── Fix Broken Emails ───
  const { data: brokenEmails, refetch: refetchBroken, isLoading: brokenLoading } = trpc.paypal.scanBrokenEmails.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && showFixBroken, staleTime: 0 }
  );
  const fixBrokenMutation = trpc.paypal.fixBrokenEmails.useMutation({
    onSuccess: (res) => {
      toast.success(t("pp_fix_success").replace("{count}", String(res.fixed)).replace("{created}", String(res.newEmails)));
      refetchBroken();
      utils.paypal.list.invalidate();
      setShowFixBroken(false);
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Check PP Status ───
  const [checkResult, setCheckResult] = useState<any>(null);
  const checkPPStatus = trpc.paypal.checkStatus.useMutation({
    onSuccess: (res) => {
      setCheckResult(res);
      invalidate();
      if (res.suspended > 0 || res.limited > 0) {
        toast.error(`Phát hiện: ${res.suspended} SUSPENDED, ${res.limited} LIMITED`);
      } else if (res.checked > 0) {
        toast.success(`Đã check ${res.checked} PP — Tất cả OK`);
      } else {
        toast(res.message || "Không có PP nào có token để check");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Token Health ───
  const refreshTokenHealth = trpc.paypal.refreshTokenHealth.useMutation({
    onSuccess: (res) => {
      invalidate();
      toast.success(`Health check: ${res.healthy} healthy, ${res.invalid} invalid, ${res.errors} errors`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Workflow Status ───
  const updateWorkflow = trpc.paypal.updateWorkflowStatus.useMutation({
    onSuccess: () => { invalidate(); toast.success("Đã cập nhật workflow"); },
    onError: (e) => toast.error(e.message),
  });

  const getSheetTabs = trpc.paypal.getSheetTabs.useMutation({
    onSuccess: (tabs: any) => {
      setSheetTabsLoading(false);
      setSheetTabs(tabs);
      if (tabs.length > 0 && !sheetSelectedGid) setSheetSelectedGid(tabs[0].gid);
    },
    onError: (e) => { setSheetTabsLoading(false); toast.error(e.message); },
  });
  const importFromSheet = trpc.paypal.importFromSheet.useMutation({
    onSuccess: (res) => {
      invalidate();
      setSheetResult(res);
      setImportResult({
        imported: res.imported ?? 0,
        updated: (res as any).updated ?? 0,
        skipped: res.skipped ?? 0,
        emailsCreated: (res as any).emailsCreated ?? 0,
        emailsUpdated: (res as any).emailsUpdated ?? 0,
        changes: (res as any).changes ?? [],
        errors: res.errors ?? [],
      });
      const createdCount = res.imported ?? 0;
      const updatedCount = (res as any).updated ?? 0;
      if (createdCount > 0 || updatedCount > 0) {
        toast.success(`Imported ${createdCount}, updated ${updatedCount}`);
      } else {
        toast("Không có thay đổi nào");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const canEdit = currentRole === "ADMIN" || currentRole === "MODERATOR" || currentRole === "USER";
  const rawItems = useMemo(() => data?.items ?? [], [data?.items]);
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

  const saveField = useCallback((id: string, field: string, value: string, oldValue?: string) => {
    // Store for undo
    lastEditRef.current = { id, field, oldValue: oldValue ?? null };
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

  // Dynamic holder list: builtins + custom + any from data
  const allHolders = useMemo(() => {
    const set = new Set([...allHolderOptions]);
    rawItems.forEach((pp: any) => { if (pp.holder) set.add(pp.holder); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rawItems, allHolderOptions]);

  // Get project PP prefix for validation
  const { data: nextCodeData } = trpc.paypal.nextCode.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );
  const ppPrefix = nextCodeData?.prefix || "";

  // Smart parse: auto-detect fields from each part
  const parsedLines = useMemo(() => {
    const isPPCode = (s: string) => /^[A-Z]{1,5}-\d{1,5}$/i.test(s) || /^[A-Z]{1,5}-[A-Z]{0,3}\d{1,5}[A-Z]?$/i.test(s);
    const isVMPP = (s: string) => /^(PP-?)?[A-Z]{0,3}\d{2,5}[A-Z]?$/i.test(s) && extractEmails(s).length === 0;
    const isHolder = (s: string) => /^PP\d{2}$/i.test(s) || BUILTIN_HOLDERS.includes(s.toUpperCase());
    const is2FA = (s: string) => /^[A-Z0-9]{4}\s[A-Z0-9]{4}\s[A-Z0-9]{4}\s[A-Z0-9]{4}$/i.test(s) || /^[A-Z0-9]{16,20}$/i.test(s);

    return quickEmails.split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
      const sep = line.includes("\t") ? "\t" : line.includes("|") ? "|" : null;
      const parts = sep ? line.split(sep).map((p) => p.trim()) : [line];

      const base: { ppCode: string; holder: string; vmppCode: string; email: string; password: string; twoFa: string; warnings: string[] } = {
        ppCode: "", holder: "", vmppCode: "", email: "", password: "", twoFa: "", warnings: [],
      };
      const unmatched: string[] = [];
      let allEmails: string[] = [];

      for (const p of parts) {
        if (!p) continue;
        const extracted = extractEmails(p);
        if (extracted.length > 0) {
          allEmails = allEmails.concat(extracted);
          continue;
        }
        if (isPPCode(p) && !base.ppCode) base.ppCode = p;
        else if (isHolder(p) && !base.holder) base.holder = p.toUpperCase();
        else if (is2FA(p) && !base.twoFa) base.twoFa = p;
        else if (isVMPP(p) && !base.vmppCode) base.vmppCode = p;
        else unmatched.push(p);
      }

      if (unmatched.length > 0 && !base.password) {
        base.password = unmatched.sort((a, b) => b.length - a.length)[0];
        unmatched.splice(unmatched.indexOf(base.password), 1);
      }
      if (unmatched.length > 0 && !base.vmppCode) base.vmppCode = unmatched[0];

      if (base.ppCode && ppPrefix && !base.ppCode.toUpperCase().startsWith(ppPrefix.toUpperCase())) {
        base.warnings.push(`Mã PP "${base.ppCode}" không đúng prefix "${ppPrefix}"`);
      }

      // Dedupe emails across the line
      allEmails = Array.from(new Set(allEmails));

      // If no emails extracted, return one row with empty email (preserves existing error UX).
      if (allEmails.length === 0) return [{ ...base, email: "" }];

      // One row per extracted email. First row keeps ppCode/password/twoFa; subsequent rows auto.
      return allEmails.map((email, idx) => ({
        ...base,
        ppCode: idx === 0 ? base.ppCode : "",
        email,
        password: idx === 0 ? base.password : "",
        twoFa: idx === 0 ? base.twoFa : "",
        warnings: idx === 0 ? base.warnings : [],
      }));
    });
  }, [quickEmails, ppPrefix]);

  const validLines = parsedLines.filter((p) => p.email.includes("@"));
  const warningLines = parsedLines.filter((p) => p.warnings.length > 0);

  const saveQuickAdd = async () => {
    if (!validLines.length) { toast.error("Không có email hợp lệ"); return; }
    setSavingQuick(true);
    let created = 0;
    try {
      for (const row of validLines) {
        await trpcVanilla.paypal.create.mutate({
          projectId: projectId!,
          code: row.ppCode || undefined,
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
        title={t("srv_pin_required")} description="Nhập PIN để truy cập thông tin nhạy cảm" required={!pinVerified} />

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

      {/* Health Overview Dashboard */}
      {!isLoading && data?.healthOverview && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              Token Health
            </h3>
            {data.healthOverview.lastCheckAt && (
              <span className="text-[10px] text-slate-400">
                Last: {new Date(data.healthOverview.lastCheckAt).toLocaleString("vi-VN")} • Cron: {data.healthOverview.cronExpression}
              </span>
            )}
          </div>
          <div className="grid grid-cols-5 gap-2">
            <div className="text-center bg-white rounded px-2 py-1.5 border">
              <p className="text-lg font-bold text-green-600">{data.healthOverview.healthy}</p>
              <p className="text-[9px] text-green-600 uppercase font-medium">Healthy</p>
            </div>
            <div className="text-center bg-white rounded px-2 py-1.5 border">
              <p className="text-lg font-bold text-red-600">{data.healthOverview.invalid}</p>
              <p className="text-[9px] text-red-600 uppercase font-medium">Invalid</p>
            </div>
            <div className="text-center bg-white rounded px-2 py-1.5 border">
              <p className="text-lg font-bold text-orange-500">{data.healthOverview.errors}</p>
              <p className="text-[9px] text-orange-500 uppercase font-medium">Error</p>
            </div>
            <div className="text-center bg-white rounded px-2 py-1.5 border">
              <p className="text-lg font-bold text-gray-400">{data.healthOverview.missing}</p>
              <p className="text-[9px] text-gray-400 uppercase font-medium">Missing</p>
            </div>
            <div className="text-center bg-white rounded px-2 py-1.5 border">
              <p className="text-lg font-bold text-slate-400">{data.healthOverview.noData}</p>
              <p className="text-[9px] text-slate-400 uppercase font-medium">No Data</p>
            </div>
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
          <svg className="w-4 h-4 absolute left-2.5 top-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <textarea value={searchInput} onChange={(e) => handleSearchChange(e.target.value)}
            rows={searchTermCount > 1 ? Math.min(searchTermCount, 5) : 1}
            className="w-full pl-8 pr-16 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white resize-none leading-5"
            placeholder={t("pp_search_placeholder")} />
          {searchTermCount > 1 && (
            <span className="absolute right-2 top-1.5 bg-blue-100 text-blue-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
              {searchTermCount} mã
            </span>
          )}
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
        {canEdit && (
          <button onClick={() => {
              setShowSheetImport(true);
              setSheetResult(null);
              // Auto-load tabs if URL exists and tabs not loaded
              if (sheetUrl && sheetTabs.length === 0) {
                setSheetTabsLoading(true);
                getSheetTabs.mutate({ projectId: projectId!, sheetUrl });
              }
            }}
            className="px-3 py-1.5 bg-teal-600 text-white rounded text-xs font-medium hover:bg-teal-700 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Import Sheet
          </button>
        )}
        {(currentRole === "ADMIN" || currentRole === "MODERATOR") && (
          <button
            type="button"
            onClick={() => setShowFixBroken(true)}
            className="px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded text-xs font-medium hover:bg-red-100 flex items-center gap-1"
            title={t("pp_scan_broken_emails")}
          >
            <span>⚠</span>
            <span>{t("pp_fix_broken_emails")}</span>
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => {
              const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
              checkPPStatus.mutate({ projectId: projectId!, paypalIds: ids });
            }}
            disabled={checkPPStatus.isLoading}
            className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {checkPPStatus.isLoading ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Đang check...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {selectedIds.size > 0 ? `Check PP (${selectedIds.size})` : "Check PP"}
              </>
            )}
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => {
              const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
              refreshTokenHealth.mutate({ projectId: projectId!, paypalIds: ids });
            }}
            disabled={refreshTokenHealth.isLoading}
            className="px-3 py-1.5 bg-cyan-600 text-white rounded text-xs font-medium hover:bg-cyan-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {refreshTokenHealth.isLoading ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Checking tokens...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                {selectedIds.size > 0 ? `Token Health (${selectedIds.size})` : "Token Health"}
              </>
            )}
          </button>
        )}
        {/* Column Picker */}
        <div className="relative">
          <button onClick={() => setShowColPicker(!showColPicker)}
            className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${showColPicker ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
            Cột
          </button>
          {showColPicker && (
            <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-xl p-3 z-50 w-64">
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-2">Hiện/ẩn & sắp xếp cột</p>
              <div className="space-y-0.5 max-h-[320px] overflow-y-auto">
                {colOrder.map((key, i) => {
                  const c = ALL_COLUMNS.find((x) => x.key === key);
                  if (!c) return null;
                  const visible = isColVisible(key);
                  return (
                    <div key={key} className="flex items-center gap-1 hover:bg-gray-50 px-1 py-0.5 rounded group">
                      <label className="flex items-center gap-2 text-xs cursor-pointer flex-1 min-w-0">
                        <input type="checkbox" checked={visible} onChange={() => toggleCol(key)} className="rounded border-gray-300 shrink-0" />
                        <span className={`truncate ${visible ? "text-gray-800 font-medium" : "text-gray-400"}`}>{c.label || c.key}</span>
                      </label>
                      <div className="flex items-center shrink-0">
                        <button
                          onClick={() => moveCol(key, "up")}
                          disabled={i === 0}
                          title="Lên"
                          className="p-0.5 text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:cursor-not-allowed">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          onClick={() => moveCol(key, "down")}
                          disabled={i === colOrder.length - 1}
                          title="Xuống"
                          className="p-0.5 text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:cursor-not-allowed">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-2 pt-2 border-t flex-wrap">
                <button onClick={() => { setVisibleCols(DEFAULT_VISIBLE_KEYS); localStorage.setItem("pp-visible-cols", JSON.stringify(DEFAULT_VISIBLE_KEYS)); }}
                  className="text-[10px] text-blue-600 hover:underline">Mặc định hiện</button>
                <button onClick={() => { const all = ALL_COLUMNS.map((c) => c.key); setVisibleCols(all); localStorage.setItem("pp-visible-cols", JSON.stringify(all)); }}
                  className="text-[10px] text-gray-500 hover:underline">Hiện tất cả</button>
                <button onClick={resetColOrder}
                  className="text-[10px] text-amber-600 hover:underline">Reset thứ tự</button>
              </div>
            </div>
          )}
        </div>
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
                {allHolders.map((u) => <option key={u} value={u}>{u}</option>)}
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
          {/* Warnings */}
          {warningLines.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded px-3 py-2">
              {warningLines.map((w, i) => (
                <p key={i} className="text-xs text-orange-700">{w.warnings.join("; ")}</p>
              ))}
            </div>
          )}
          {/* Preview table */}
          {parsedLines.length > 0 && (
            <div className="bg-white border rounded overflow-x-auto max-h-[250px] overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left text-gray-500 w-8">#</th>
                    <th className="px-2 py-1 text-left text-gray-500">Mã PP</th>
                    <th className="px-2 py-1 text-left text-gray-500">User Win</th>
                    <th className="px-2 py-1 text-left text-gray-500">VMPP</th>
                    <th className="px-2 py-1 text-left text-gray-500">Email</th>
                    <th className="px-2 py-1 text-left text-gray-500">Password</th>
                    <th className="px-2 py-1 text-left text-gray-500">2FA</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parsedLines.map((row, i) => (
                    <tr key={i} className={!row.email.includes("@") ? "bg-red-50" : row.warnings.length > 0 ? "bg-orange-50" : ""}>
                      <td className="px-2 py-0.5 text-gray-400">{i + 1}</td>
                      <td className="px-2 py-0.5 font-mono font-medium text-blue-700">{row.ppCode || <span className="text-gray-300 text-[10px]">auto</span>}</td>
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
            <button onClick={() => {
              if (warningLines.length > 0 && !confirm(`Có ${warningLines.length} cảnh báo. Tiếp tục?`)) return;
              saveQuickAdd();
            }} disabled={savingQuick || !validLines.length}
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
            {allHolders.map((u) => <option key={u} value={u}>{u}</option>)}
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
          <table className="text-[11px] w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                {orderedColumns.filter((c) => isColVisible(c.key)).map((colDef) => {
                  const col = colDef.key;
                  const label = colDef.label;
                  const sortable = colDef.sortable;
                  const rightAlign = colDef.rightAlign;
                  const sortField = col === "email" ? "primaryEmail" : col === "received" ? "totalReceived" : col === "withdrawn" ? "totalWithdrawn" : col;
                  return (
                    <th key={col} style={{ minWidth: colWidths[col] || 24 }}
                      className={`px-1.5 py-1.5 font-medium text-gray-500 select-none relative whitespace-nowrap ${sortable ? "cursor-pointer hover:bg-gray-100" : ""} ${rightAlign ? "text-right" : "text-left"}`}
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
                <tr><td colSpan={visibleCols.length} className="text-center py-12 text-gray-500">{t("pp_no_accounts")}</td></tr>
              )}
              {items.map((pp: any, idx: number) => {
                const cells: Record<string, React.ReactNode> = {
                  checkbox: (
                    <td key="checkbox" className="px-2 py-1">
                      <input type="checkbox" checked={selectedIds.has(pp.id)}
                        onClick={(e) => handleRowSelect(pp.id, idx, e as any)}
                        readOnly
                        className="rounded border-gray-300 cursor-pointer" />
                    </td>
                  ),
                  idx: <td key="idx" className="px-2 py-1 text-gray-400 text-xs">{idx + 1}</td>,
                  status: (
                    <td key="status" className="px-1 py-0.5">
                      <div>
                        {canEdit ? (
                          <select value={pp.status}
                            onChange={(e) => updatePaypal.mutate({ projectId: projectId!, id: pp.id, status: e.target.value as any })}
                            className={`text-[10px] px-1 py-0.5 rounded border-0 font-semibold cursor-pointer ${statusColors[pp.status] ?? ""}`}>
                            {PP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : (
                          <Badge className={`text-[10px] ${statusColors[pp.status] ?? ""}`}>{pp.status}</Badge>
                        )}
                        {/* LIMITED: show limit note + workflow buttons */}
                        {pp.status === "LIMITED" && (
                          <>
                            <span className="text-[9px] text-amber-700 block truncate" title={pp.limitNote || "Cần gỡ limit"}>
                              {pp.limitNote || "Cần gỡ limit"}
                            </span>
                            {canEdit && (
                              <div className="flex gap-0.5 mt-0.5">
                                {(["updocs", "appeal", "resolved"] as const).map((ws) => (
                                  <button key={ws} onClick={(e) => { e.stopPropagation(); updateWorkflow.mutate({ projectId: projectId!, id: pp.id, workflowStatus: pp.workflowStatus === ws ? null : ws }); }}
                                    className={`px-1 py-0 rounded text-[8px] font-medium transition ${pp.workflowStatus === ws ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                                    {ws}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                        {/* SUSPENDED: show 180-day countdown + workflow */}
                        {pp.status === "SUSPENDED" && (() => {
                          const dateStr = pp.suspendedAt;
                          const countdown = !dateStr ? <span className="text-[9px] text-red-500 block">Chưa set ngày</span> : (() => {
                            const start = new Date(dateStr);
                            const deadline = new Date(start.getTime() + 180 * 24 * 60 * 60 * 1000);
                            const now = new Date();
                            const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                            if (daysLeft <= 0) return <span className="text-[9px] text-red-600 font-bold block animate-pulse">RÚT TIỀN!</span>;
                            const color = daysLeft <= 14 ? "text-red-600 font-bold animate-pulse" : daysLeft <= 30 ? "text-amber-600" : "text-gray-500";
                            return <span className={`text-[9px] ${color} block`}>{daysLeft}d / 180d</span>;
                          })();
                          return (
                            <>
                              {countdown}
                              {canEdit && (
                                <div className="flex gap-0.5 mt-0.5">
                                  {(["updocs", "appeal", "resolved"] as const).map((ws) => (
                                    <button key={ws} onClick={(e) => { e.stopPropagation(); updateWorkflow.mutate({ projectId: projectId!, id: pp.id, workflowStatus: pp.workflowStatus === ws ? null : ws }); }}
                                      className={`px-1 py-0 rounded text-[8px] font-medium transition ${pp.workflowStatus === ws ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                                      {ws}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {pp.missingFields && pp.missingFields.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); router.push(`/paypals/${pp.id}`); }}
                            className="text-[9px] text-red-600 font-semibold block hover:underline mt-0.5 text-left"
                            title={`${t("pp_missing_data_tooltip")}: ${pp.missingFields.map((f: string) => t(`pp_missing_${f.toLowerCase()}` as any)).join(", ")}`}
                          >
                            ⚠ {t("pp_missing_data")}
                          </button>
                        )}
                      </div>
                    </td>
                  ),
                  health: (
                    <td key="health" className="px-1 py-0.5 text-center">
                      {(() => {
                        const hs = pp.tokenHealthStatus;
                        if (!hs) return <span className="text-[8px] text-slate-300">N/A</span>;
                        const cfg: Record<string, string> = { HEALTHY: "bg-green-100 text-green-700", INVALID: "bg-red-100 text-red-700", ERROR: "bg-orange-100 text-orange-700", MISSING: "bg-gray-100 text-gray-500" };
                        return <span className={`text-[8px] font-bold px-1 py-0.5 rounded uppercase ${cfg[hs] || cfg.MISSING}`}>{hs}</span>;
                      })()}
                    </td>
                  ),
                  code: (
                    <td key="code" className="px-2 py-0.5">
                      {canEdit ? (
                        <div className="flex items-center gap-1">
                          <EditableCell value={pp.code} onSave={(v) => {
                            if (!v.trim()) { toast.error("Mã PP không được trống"); return; }
                            saveField(pp.id, "code", v.trim(), pp.code);
                          }} mono />
                          <button onClick={() => router.push(`/paypals/${pp.id}`)} className="text-blue-500 hover:text-blue-700 shrink-0" title="Chi tiết">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          </button>
                        </div>
                      ) : (
                        <span className="font-medium font-mono text-blue-600 cursor-pointer hover:underline" onClick={() => router.push(`/paypals/${pp.id}`)}>{pp.code}</span>
                      )}
                    </td>
                  ),
                  holder: (
                    <td key="holder" className="px-1 py-0.5">
                      {canEdit ? (
                        <select value={pp.holder ?? ""} onChange={(e) => saveField(pp.id, "holder", e.target.value, pp.holder ?? "")}
                          className="text-[10px] px-0.5 py-0.5 rounded border border-gray-200 bg-white cursor-pointer">
                          <option value="">—</option>
                          {allHolders.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      ) : (
                        <span className="text-gray-600">{pp.holder || "—"}</span>
                      )}
                    </td>
                  ),
                  vmppCode: (
                    <td key="vmppCode" className="px-2 py-0.5">
                      {canEdit ? (
                        <EditableCell value={pp.vmppCode ?? ""} onSave={(v) => saveField(pp.id, "vmppCode", v, pp.vmppCode ?? "")} mono placeholder="VMPP..." />
                      ) : (
                        <span className="font-mono text-gray-500">{pp.vmppCode || "—"}</span>
                      )}
                    </td>
                  ),
                  email: (
                    <td key="email" className="px-2 py-0.5">
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
                  ),
                  pass: (
                    <td key="pass" className="px-2 py-1">
                      <SecretCell ppId={pp.id} field="password" projectId={projectId!} pinVerified={pinVerified} onNeedPin={() => setShowPinDialog(true)} t={t} hasData={pp.hasPassword} />
                    </td>
                  ),
                  twoFa: (
                    <td key="twoFa" className="px-2 py-1">
                      <SecretCell ppId={pp.id} field="twoFa" projectId={projectId!} pinVerified={pinVerified} onNeedPin={() => setShowPinDialog(true)} t={t} hasData={pp.hasTwoFa} />
                    </td>
                  ),
                  token: (
                    <td key="token" className="px-2 py-1">
                      <SecretCell ppId={pp.id} field="hotmailToken" projectId={projectId!} pinVerified={pinVerified} onNeedPin={() => setShowPinDialog(true)} t={t} hasData={pp.hasToken} />
                    </td>
                  ),
                  received: (
                    <td key="received" className="px-2 py-1 text-right font-mono">
                      {pp.totalReceived > 0 ? <span className="text-green-700">${Number(pp.totalReceived).toFixed(2)}</span> : <span className="text-gray-300">—</span>}
                    </td>
                  ),
                  withdrawn: (
                    <td key="withdrawn" className="px-2 py-1 text-right font-mono">
                      {pp.totalWithdrawn > 0 ? <span className="text-orange-600">${Number(pp.totalWithdrawn).toFixed(2)}</span> : <span className="text-gray-300">—</span>}
                    </td>
                  ),
                  balance: (
                    <td key="balance" className="px-2 py-1 text-right font-mono font-medium">
                      {pp.balance !== 0 ? <span className={pp.balance > 0 ? "text-blue-700" : "text-red-600"}>${Number(pp.balance).toFixed(2)}</span> : <span className="text-gray-300">$0.00</span>}
                    </td>
                  ),
                  notes: (
                    <td key="notes" className="px-2 py-0.5 max-w-[160px]">
                      {canEdit ? (
                        <EditableCell value={pp.notes ?? pp.limitNote ?? ""} onSave={(v) => saveField(pp.id, "notes", v, pp.notes ?? pp.limitNote ?? "")} placeholder="notes..." />
                      ) : (
                        <span className="text-gray-500 truncate block">{pp.limitNote || pp.notes || "—"}</span>
                      )}
                    </td>
                  ),
                  createdBy: <td key="createdBy" className="px-2 py-1 text-[10px] text-gray-400">{pp.createdByName || "—"}</td>,
                };
                return (
                  <tr key={pp.id} className={`hover:bg-blue-50/50 ${selectedIds.has(pp.id) ? "bg-blue-100/70" : ""}`}>
                    {orderedColumns.filter((c) => isColVisible(c.key)).map((c) => cells[c.key])}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-3 py-2 bg-gray-50 border-t text-xs text-gray-500 flex items-center justify-between">
            <span>{items.length} {t("pp_shown")}</span>
            {selectedIds.size > 0 && <span className="font-medium text-blue-700">{selectedIds.size} selected</span>}
          </div>
        </div>
      )}

      {/* Undo Bar */}
      {showUndo && lastEditRef.current && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-4 animate-slide-up">
          <span className="text-sm">Đã lưu thay đổi</span>
          <button onClick={() => { revertLastEdit(); setShowUndo(false); }}
            className="px-3 py-1 bg-blue-500 hover:bg-blue-400 text-white rounded-lg text-sm font-semibold transition-colors">
            Hoàn tác
          </button>
          <button onClick={() => { setShowUndo(false); lastEditRef.current = null; }}
            className="text-gray-400 hover:text-white">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
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

      {/* Check PP Result Dialog */}
      {checkResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCheckResult(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">Kết quả Check PP</h3>
                <button onClick={() => setCheckResult(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {(checkResult.durationMs / 1000).toFixed(1)}s
                {checkResult.updated > 0 && <span className="ml-2 text-orange-600 font-medium">({checkResult.updated} PP đã cập nhật status)</span>}
              </p>
            </div>
            {/* Summary */}
            <div className="grid grid-cols-5 gap-2 p-4 bg-gray-50 border-b">
              <div className="text-center">
                <p className="text-xl font-bold text-gray-800">{checkResult.total}</p>
                <p className="text-[10px] text-gray-500 uppercase">Tổng</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-green-600">{checkResult.clean}</p>
                <p className="text-[10px] text-green-600 uppercase">OK</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-red-600">{checkResult.suspended}</p>
                <p className="text-[10px] text-red-600 uppercase">Suspended</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-yellow-600">{checkResult.limited}</p>
                <p className="text-[10px] text-yellow-600 uppercase">Limited</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-gray-400">{checkResult.errors}</p>
                <p className="text-[10px] text-gray-400 uppercase">Lỗi</p>
              </div>
            </div>
            {/* Result list — show ALL results */}
            <div className="overflow-y-auto max-h-[50vh] divide-y">
              {checkResult.results?.map((r: any, i: number) => (
                <div key={i} className={`px-4 py-2.5 ${r.newStatus ? "bg-red-50" : r.error ? "bg-orange-50" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${r.newStatus ? (r.newStatus === "SUSPENDED" ? "bg-red-500" : "bg-yellow-500") : r.error ? "bg-orange-400" : "bg-green-500"}`} />
                    <span className="text-sm font-medium">{r.paypalCode}</span>
                    {r.newStatus && (
                      <Badge className={r.newStatus === "SUSPENDED" ? "bg-red-100 text-red-800 text-[10px]" : "bg-yellow-100 text-yellow-800 text-[10px]"}>
                        {r.newStatus}
                      </Badge>
                    )}
                    {r.error && <Badge className="bg-orange-100 text-orange-700 text-[10px]">ERROR</Badge>}
                    {!r.newStatus && !r.error && <Badge className="bg-green-100 text-green-700 text-[10px]">OK</Badge>}
                    {r.emailsScanned !== undefined && (
                      <span className="text-[10px] text-gray-400 ml-auto">{r.emailsScanned} emails • {r.tokenType}</span>
                    )}
                  </div>
                  {/* Alert info */}
                  {r.alertSubject && (
                    <p className="text-[11px] text-red-700 mt-0.5 ml-4">
                      {r.alertSubject}
                      {r.alertDate && <span className="text-gray-400 ml-2">{new Date(r.alertDate).toLocaleDateString("vi-VN")}</span>}
                    </p>
                  )}
                  {/* Error detail */}
                  {r.error && (
                    <p className="text-[11px] text-orange-700 mt-0.5 ml-4 break-words">{r.error}</p>
                  )}
                  {/* Debug info for OK results */}
                  {r.debugInfo && !r.error && !r.newStatus && (
                    <p className="text-[10px] text-gray-400 mt-0.5 ml-4 truncate" title={r.debugInfo}>{r.debugInfo}</p>
                  )}
                </div>
              ))}
              {(!checkResult.results || checkResult.results.length === 0) && (
                <div className="px-4 py-8 text-center text-gray-400 text-sm">
                  Không có PP nào có token để check
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sheet Import Dialog */}
      {showSheetImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowSheetImport(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  <h3 className="text-lg font-bold text-gray-900">Import từ Google Sheet</h3>
                </div>
                <button onClick={() => setShowSheetImport(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Nhập mã PayPal (cột A) → hệ thống tự lấy dữ liệu từ sheet (userwin, pass, 2FA, emails, tokens)</p>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Sheet URL */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Google Sheet URL</label>
                <div className="flex gap-2">
                  <input value={sheetUrl} onChange={(e) => { setSheetUrl(e.target.value); setSheetTabs([]); setSheetSelectedGid(""); }}
                    className="flex-1 px-3 py-2 border rounded text-xs font-mono focus:ring-1 focus:ring-teal-500 focus:outline-none"
                    placeholder="https://docs.google.com/spreadsheets/d/..." />
                  <button
                    onClick={() => {
                      if (!sheetUrl) return;
                      setSheetTabsLoading(true);
                      getSheetTabs.mutate({ projectId: projectId!, sheetUrl });
                    }}
                    disabled={sheetTabsLoading || !sheetUrl}
                    className="px-3 py-2 bg-gray-100 border rounded text-xs font-medium hover:bg-gray-200 disabled:opacity-50 shrink-0"
                  >
                    {sheetTabsLoading ? "..." : "Load tabs"}
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">Sheet phải public (Anyone with link can view)</p>
              </div>

              {/* Sheet Tab Selector */}
              {sheetTabs.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Chọn sheet tab</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {sheetTabs.map((tab) => (
                      <button
                        key={tab.gid}
                        onClick={() => setSheetSelectedGid(tab.gid)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                          sheetSelectedGid === tab.gid
                            ? "bg-teal-600 text-white border-teal-600"
                            : "bg-white text-gray-700 border-gray-300 hover:border-teal-400 hover:text-teal-700"
                        }`}
                      >
                        {tab.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* PP Codes */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Mã PayPal — cột A trong sheet (mỗi dòng 1 mã)</label>
                <textarea value={sheetPPCodes} onChange={(e) => setSheetPPCodes(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border rounded text-xs font-mono focus:ring-1 focus:ring-teal-500 focus:outline-none resize-y"
                  placeholder={"PP-271\nPP-272\nPP-273\nAE-010\nAE-011"} />
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {sheetPPCodes.split("\n").filter((l) => l.trim()).length} mã PayPal
                </p>
              </div>

              {/* Import button */}
              <button
                onClick={() => {
                  const codes = sheetPPCodes.split("\n").map((l) => l.trim()).filter(Boolean);
                  if (!codes.length) { toast.error("Chưa nhập mã PayPal"); return; }
                  if (!sheetUrl) { toast.error("Chưa nhập Sheet URL"); return; }
                  importFromSheet.mutate({
                    projectId: projectId!,
                    sheetUrl,
                    gid: sheetSelectedGid || undefined,
                    ppCodes: codes,
                  });
                }}
                disabled={importFromSheet.isLoading}
                className="w-full px-4 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {importFromSheet.isLoading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Đang import...
                  </>
                ) : (
                  `Import ${sheetPPCodes.split("\n").filter((l) => l.trim()).length} PP từ Sheet`
                )}
              </button>

              {/* Results */}
              {sheetResult && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-4 gap-2 p-3 bg-gray-50 border-b">
                    <div className="text-center">
                      <p className="text-lg font-bold text-green-600">{sheetResult.imported}</p>
                      <p className="text-[10px] text-gray-500">Imported</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-yellow-600">{sheetResult.skipped}</p>
                      <p className="text-[10px] text-gray-500">Đã tồn tại</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-red-600">{sheetResult.errors?.length || 0}</p>
                      <p className="text-[10px] text-gray-500">Lỗi</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-400">{sheetResult.totalInSheet}</p>
                      <p className="text-[10px] text-gray-500">Tổng sheet</p>
                    </div>
                  </div>
                  {sheetResult.results?.length > 0 && (
                    <div className="divide-y max-h-[200px] overflow-y-auto">
                      {sheetResult.results.map((r: any, i: number) => (
                        <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${
                            r.status === "created" ? "bg-green-500" : r.status === "skipped" ? "bg-yellow-500" : "bg-red-500"
                          }`} />
                          <span className="font-mono font-medium">{r.ppcode}</span>
                          <span className="text-gray-400">
                            {r.status === "created" ? "OK" : r.status === "skipped" ? "Đã tồn tại" : r.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History */}
      
      
      {/* History */}
      <button onClick={() => setShowHistory(!showHistory)}
        className={"flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors " + (showHistory ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50")}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        {showHistory ? "Ẩn lịch sử" : "Lịch sử"}
      </button>
      <PageHistory entity="PayPalAccount" show={showHistory} />

      {/* Import Result Dialog */}
      {importResult && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
             onClick={() => setImportResult(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">{t("pp_import_changes_title")}</h2>
              <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              <div className="grid grid-cols-5 gap-2 text-center">
                <div className="bg-green-50 rounded p-2">
                  <div className="text-xl font-bold text-green-700">{importResult.imported}</div>
                  <div className="text-[10px] text-gray-500">New</div>
                </div>
                <div className="bg-blue-50 rounded p-2">
                  <div className="text-xl font-bold text-blue-700">{importResult.updated}</div>
                  <div className="text-[10px] text-gray-500">Updated</div>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <div className="text-xl font-bold text-gray-700">{importResult.skipped}</div>
                  <div className="text-[10px] text-gray-500">Skipped</div>
                </div>
                <div className="bg-emerald-50 rounded p-2">
                  <div className="text-xl font-bold text-emerald-700">+{importResult.emailsCreated}</div>
                  <div className="text-[10px] text-gray-500">New emails</div>
                </div>
                <div className="bg-amber-50 rounded p-2">
                  <div className="text-xl font-bold text-amber-700">~{importResult.emailsUpdated}</div>
                  <div className="text-[10px] text-gray-500">Updated emails</div>
                </div>
              </div>

              {importResult.changes.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">{t("pp_import_no_changes")}</p>
              ) : (
                <table className="min-w-full text-xs border">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">PP</th>
                      <th className="px-2 py-1 text-left">Email</th>
                      <th className="px-2 py-1 text-left">{t("pp_import_changes_field")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {importResult.changes.map((c, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 font-mono font-medium text-blue-700">{c.ppCode}</td>
                        <td className="px-2 py-1 font-mono text-gray-600">{c.email || "—"}</td>
                        <td className="px-2 py-1 text-orange-700">{c.fields.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {importResult.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded p-2">
                  <p className="text-xs font-medium text-red-700 mb-1">Errors:</p>
                  {importResult.errors.map((e, i) => (
                    <p key={i} className="text-[10px] text-red-600 font-mono">{e}</p>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t flex justify-end">
              <button onClick={() => setImportResult(null)} className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fix Broken Emails Dialog */}
      {showFixBroken && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
             onClick={() => setShowFixBroken(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">{t("pp_fix_broken_emails")}</h2>
              <button onClick={() => setShowFixBroken(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {brokenLoading ? (
                <p className="text-sm text-gray-500">{t("loading")}</p>
              ) : !brokenEmails || brokenEmails.length === 0 ? (
                <p className="text-sm text-gray-500">{t("pp_broken_emails_none")}</p>
              ) : (
                <div>
                  <p className="text-sm font-medium mb-2">{t("pp_broken_emails_found")}: {brokenEmails.length}</p>
                  <table className="min-w-full text-xs border">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 text-left">PP</th>
                        <th className="px-2 py-1 text-left">{t("pp_original_email")}</th>
                        <th className="px-2 py-1 text-left">{t("pp_split_into")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {brokenEmails.map((b: any) => (
                        <tr key={b.id}>
                          <td className="px-2 py-1 font-mono font-medium text-blue-700">{b.ppCode}</td>
                          <td className="px-2 py-1 font-mono text-red-600 break-all">{b.originalEmail}</td>
                          <td className="px-2 py-1 font-mono text-green-700">
                            {b.extractedEmails.map((e: string) => <div key={e}>{e}</div>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="p-4 border-t flex items-center gap-2 justify-end">
              <button onClick={() => setShowFixBroken(false)} className="px-3 py-1.5 bg-gray-200 rounded text-sm hover:bg-gray-300">
                {t("cancel")}
              </button>
              {brokenEmails && brokenEmails.length > 0 && (
                <button
                  onClick={() => {
                    requirePinOnce(() => {
                      fixBrokenMutation.mutate({
                        projectId: projectId!,
                        items: brokenEmails.map((b: any) => ({ emailId: b.id, extractedEmails: b.extractedEmails })),
                      });
                    });
                  }}
                  disabled={fixBrokenMutation.isLoading}
                  className="px-4 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {fixBrokenMutation.isLoading ? t("loading") : `${t("pp_fix_all")} (${brokenEmails.length})`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
