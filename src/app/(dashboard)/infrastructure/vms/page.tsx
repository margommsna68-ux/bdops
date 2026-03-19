"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-500",
  WITHDRAWAL: "bg-yellow-100 text-yellow-800 font-bold",
  PAID: "bg-emerald-100 text-emerald-800 font-bold",
  SUSPEND: "bg-red-200 text-red-900 font-bold",
  PP_LIMIT: "bg-orange-200 text-orange-900 font-bold",
};
const STATUS_LABELS: Record<string, string> = {
  PENDING: "—", WITHDRAWAL: "Withdrawal", PAID: "Paid", SUSPEND: "Suspend", PP_LIMIT: "PP Limit",
};
const ROW_COLORS: Record<string, string> = {
  PENDING: "", WITHDRAWAL: "bg-yellow-50", PAID: "bg-emerald-50", SUSPEND: "bg-red-50", PP_LIMIT: "bg-orange-50",
};
const ALL_STATUSES = ["PENDING", "WITHDRAWAL", "PAID", "SUSPEND", "PP_LIMIT"] as const;

function cleanVmCode(code: string): string { return code.replace(/^M-/i, ""); }

// ═══ MAIN PAGE ═══
export default function EarnAppPage() {
  const t = useT();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [historyGmail, setHistoryGmail] = useState<{ gmailId: string; serverId: string; email: string } | null>(null);
  const [ppPickerFor, setPpPickerFor] = useState<{ withdrawalId: string; currentPpId: string | null } | null>(null);

  const { data: servers, isLoading, refetch } = trpc.earnWithdrawal.listByServer.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );
  const { data: overview, refetch: refetchOverview } = trpc.earnWithdrawal.serverOverview.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );
  // PP list for picker (all statuses for visibility, filter in picker)
  const { data: ppListData } = trpc.paypal.list.useQuery(
    { projectId: projectId!, limit: 500 }, { enabled: !!projectId, staleTime: 60000 }
  );
  const ppPickerItems = useMemo(() => (ppListData?.items ?? [])
    .filter((pp: any) => !["CLOSED"].includes(pp.status))
    .map((pp: any) => ({
      id: pp.id, code: pp.code, status: pp.status, primaryEmail: pp.primaryEmail,
      emails: pp.emails ?? [], holder: pp.holder,
    })), [ppListData]);

  const softRefetch = useCallback(() => { refetchOverview(); }, [refetchOverview]);
  const createMut = trpc.earnWithdrawal.create.useMutation({ onSuccess: () => refetch() });
  const updateMut = trpc.earnWithdrawal.update.useMutation({ onSuccess: () => softRefetch() });

  const allServers = useMemo(() => servers ?? [], [servers]);
  const visibleServers = useMemo(() => {
    if (selectedIds.size === 0) return allServers;
    return allServers.filter((s: any) => selectedIds.has(s.serverId));
  }, [allServers, selectedIds]);
  const gridCols = useMemo(() => {
    const c = visibleServers.length;
    if (c <= 1) return "grid-cols-1";
    if (c === 2) return "grid-cols-1 lg:grid-cols-2";
    if (c === 3) return "grid-cols-1 lg:grid-cols-3";
    return "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3";
  }, [visibleServers.length]);

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  const toggleServer = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">{t("earn_title")}</h1>
        {overview && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-500">{overview.totalAccounts} acc</span>
            <span className="text-green-600 font-bold">{overview.counts.PAID} Paid</span>
            <span className="text-blue-600 font-bold">{overview.counts.WITHDRAWAL} WD</span>
            <span className="text-red-600 font-bold">{overview.counts.SUSPEND} Sus</span>
            <span className="text-orange-600 font-bold">{overview.counts.PP_LIMIT} Limit</span>
            <span className="text-amber-600 font-bold">${overview.totalAmount.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Server cards */}
      {allServers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => {
            if (selectedIds.size === allServers.length) setSelectedIds(new Set());
            else setSelectedIds(new Set(allServers.map((s: any) => s.serverId)));
          }}
            className={`px-3 py-2 text-xs font-bold rounded-lg border-2 transition-all ${
              selectedIds.size === 0 ? "border-blue-500 bg-blue-50 text-blue-700"
                : selectedIds.size === allServers.length ? "border-blue-500 bg-blue-600 text-white"
                : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
            }`}>
            {selectedIds.size === 0 ? "Tất cả" : selectedIds.size === allServers.length ? "Tất cả ✓" : "Tất cả"}
          </button>
          {allServers.map((sv: any) => {
            const selected = selectedIds.has(sv.serverId);
            const active = selected || selectedIds.size === 0;
            return (
              <button key={sv.serverId} onClick={() => toggleServer(sv.serverId)}
                className={`px-3 py-2 rounded-lg border-2 transition-all flex items-center gap-2 ${
                  selected ? "border-blue-500 bg-blue-50 shadow-sm"
                    : active ? "border-gray-200 bg-white hover:border-blue-300"
                    : "border-gray-200 bg-gray-50 opacity-50 hover:opacity-100"
                }`}>
                <span className={`text-xs font-bold ${selected ? "text-blue-700" : "text-gray-700"}`}>{sv.serverCode}</span>
                <span className="text-[10px] text-gray-400">{sv.totalRows}</span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading && <div className="text-center py-8 text-gray-400">Loading...</div>}

      {visibleServers.length > 0 && (
        <div className={`grid ${gridCols} gap-3`} style={{ alignItems: "start" }}>
          {visibleServers.map((sv: any) => (
            <ServerPanel key={sv.serverId} server={sv}
              onNewRound={(gmailId, vmCodes, paypalId) => createMut.mutate({ projectId: projectId!, serverId: sv.serverId, gmailId, vmCodes, paypalId })}
              onUpdate={(id, data) => updateMut.mutate({ projectId: projectId!, id, ...data })}
              onPickPP={(wId, ppId) => setPpPickerFor({ withdrawalId: wId, currentPpId: ppId })}
              onViewHistory={(gmailId, email) => setHistoryGmail({ gmailId, serverId: sv.serverId, email })}
              ppPickerItems={ppPickerItems}
              t={t} />
          ))}
        </div>
      )}

      {!isLoading && allServers.length === 0 && (
        <div className="text-center py-12 text-gray-400">{t("earn_no_data")}</div>
      )}

      {/* PP Picker Dialog */}
      {ppPickerFor && (
        <PPPickerDialog open items={ppPickerItems} selectedId={ppPickerFor.currentPpId ?? ""}
          onSelect={async (ppId, _email) => {
            try {
              await updateMut.mutateAsync({ projectId: projectId!, id: ppPickerFor.withdrawalId, paypalId: ppId });
              setPpPickerFor(null);
              refetch();
            } catch (e: any) {
              toast.error(e.message || "Lỗi cập nhật PP");
            }
          }}
          onClose={() => setPpPickerFor(null)} />
      )}

      {/* History Dialog */}
      {historyGmail && (
        <HistoryDialog projectId={projectId!} gmailId={historyGmail.gmailId}
          serverId={historyGmail.serverId} email={historyGmail.email}
          onClose={() => setHistoryGmail(null)} t={t} />
      )}
    </div>
  );
}

// ═══ Server Panel ═══
function ServerPanel({ server, onNewRound, onUpdate, onPickPP, onViewHistory, ppPickerItems, t }: {
  server: any;
  onNewRound: (gmailId: string, vmCodes: string, paypalId: string | null) => void;
  onUpdate: (id: string, data: any) => void;
  onPickPP: (withdrawalId: string, currentPpId: string | null) => void;
  onViewHistory: (gmailId: string, email: string) => void;
  ppPickerItems: any[];
  t: (k: string) => string;
}) {
  // Build ppId → pp info map for quick lookup
  const ppMap = useMemo(() => {
    const m = new Map<string, { code: string; email: string }>();
    for (const pp of ppPickerItems) {
      const email = pp.emails?.[0]?.email || pp.primaryEmail || "";
      m.set(pp.id, { code: pp.code, email });
    }
    return m;
  }, [ppPickerItems]);

  // Column resize
  const [colWidths, setColWidths] = useState({ vm: 65, pp: 230, date: 95, time: 58, status: 90, amount: 70, actions: 40 });
  const resizingCol = useRef<string | null>(null);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = (col: string, e: React.MouseEvent) => {
    e.preventDefault();
    resizingCol.current = col;
    startX.current = e.clientX;
    startW.current = colWidths[col as keyof typeof colWidths];
    const onMouseMove = (ev: MouseEvent) => {
      const diff = ev.clientX - startX.current;
      setColWidths((prev) => ({ ...prev, [col]: Math.max(30, startW.current + diff) }));
    };
    const onMouseUp = () => {
      resizingCol.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const th = (key: string, label: string, align?: string) => (
    <th style={{ width: colWidths[key as keyof typeof colWidths] }}
      className={`px-2 py-2 font-bold text-slate-700 text-[11px] relative select-none ${align === "right" ? "text-right" : "text-left"}`}>
      {label}
      <div onMouseDown={(e) => onMouseDown(key, e)}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/40" />
    </th>
  );

  return (
    <div className="bg-white rounded-lg border shadow-sm overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 200px)" }}>
      <div className="px-3 py-2 border-b bg-gray-50 flex items-center gap-2 flex-shrink-0">
        <h3 className="text-sm font-bold text-gray-900">{server.serverCode}</h3>
        <span className="text-[10px] text-gray-400">{server.totalRows} acc</span>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-[11px]" style={{ tableLayout: "fixed" }}>
          <thead className="bg-slate-100 border-b-2 border-slate-300 sticky top-0 z-10">
            <tr>
              {th("vm", "VM#")}
              {th("pp", "Paypal #")}
              {th("date", "W. Date")}
              {th("time", "W. Time")}
              {th("status", "Status")}
              {th("amount", "Amount $", "right")}
              <th style={{ width: colWidths.actions }} className="px-1 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {server.rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">{t("earn_no_data")}</td></tr>
            ) : server.rows.map((row: any, idx: number) => (
              <EarnRow key={row.gmailId ?? `ng-${idx}`} row={row} ppMap={ppMap}
                onNewRound={onNewRound} onUpdate={onUpdate} onPickPP={onPickPP} onViewHistory={onViewHistory} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══ Earn Row ═══
function EarnRow({ row, ppMap, onNewRound, onUpdate, onPickPP, onViewHistory }: {
  row: any;
  ppMap: Map<string, { code: string; email: string }>;
  onNewRound: (gmailId: string, vmCodes: string, paypalId: string | null) => void;
  onUpdate: (id: string, data: any) => void;
  onPickPP: (withdrawalId: string, currentPpId: string | null) => void;
  onViewHistory: (gmailId: string, email: string) => void;
}) {
  const w = row.latest;
  const noGmail = !row.gmailId;
  const [localVmCodes, setLocalVmCodes] = useState(cleanVmCode(row.vmCodes));

  const ppInfo = ppMap.get(row.paypalId) ?? (row.paypalCode ? { code: row.paypalCode, email: "" } : null);

  let rowBg = "";
  if (noGmail) rowBg = "bg-gray-100";
  else if (w?.status) rowBg = ROW_COLORS[w.status] ?? "";
  else if (!w && row.gmailId) rowBg = "bg-amber-50";

  const handleStatusChange = (newStatus: string) => {
    if (!w) return;
    const updates: any = { status: newStatus };
    if (newStatus === "WITHDRAWAL" && !w.date) {
      const now = new Date();
      updates.date = now.toISOString().slice(0, 10);
      updates.time = now.toTimeString().slice(0, 5);
    }
    onUpdate(w.id, updates);
  };

  const handleClear = () => {
    if (!w) return;
    onUpdate(w.id, { date: null, time: null, status: "PENDING", amount: null, notes: null });
  };

  return (
    <tr className={`${rowBg} hover:bg-gray-200/50 border-b border-gray-100`}>
      <td className="px-2 py-1.5 overflow-hidden">
        <input value={localVmCodes} onChange={(e) => setLocalVmCodes(e.target.value)}
          className="w-full font-mono text-[12px] font-extrabold text-gray-800 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-0.5"
          title={`Gmail: ${row.gmailEmail ?? "—"}`} />
      </td>
      {/* PP Code + Email — click code to pick, click email to copy */}
      <td className="px-2 py-1.5 overflow-hidden">
        {w ? (
          <div className="flex items-center gap-1">
            <button onClick={() => onPickPP(w.id, row.paypalId)}
              className="text-[11px] text-indigo-700 font-bold hover:bg-indigo-50 rounded px-1 py-0.5 shrink-0 border border-transparent hover:border-indigo-200 transition-colors"
              title="Đổi PayPal">
              {ppInfo?.code ?? "PP..."}
            </button>
            {ppInfo?.email && (
              <button onClick={() => { navigator.clipboard.writeText(ppInfo.email); toast.success("Copied"); }}
                className="text-[10px] text-gray-500 hover:text-blue-600 truncate min-w-0 text-left"
                title={`${ppInfo.email} — click copy`}>
                {ppInfo.email}
              </button>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-gray-300">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 overflow-hidden">
        {w ? <div className="flex items-center gap-0.5">
          <input type="date" key={`d-${w.id}-${w.date}`}
            defaultValue={w.date ? new Date(w.date).toISOString().slice(0, 10) : ""}
            className="flex-1 min-w-0 text-[11px] border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-0.5 text-gray-700"
            onBlur={(e) => onUpdate(w.id, { date: e.target.value || null })} />
          {w.date && <button onClick={() => onUpdate(w.id, { date: null })}
            className="text-[9px] text-red-400 hover:text-red-600 flex-shrink-0">×</button>}
        </div> : <span className="text-[11px] text-gray-300">—</span>}
      </td>
      <td className="px-2 py-1.5 overflow-hidden">
        {w ? <div className="flex items-center gap-0.5">
          <input type="time" key={`t-${w.id}-${w.time}`}
            defaultValue={w.time ?? ""}
            className="flex-1 min-w-0 text-[11px] border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded px-0.5 text-gray-700"
            onBlur={(e) => onUpdate(w.id, { time: e.target.value || null })} />
          {w.time && <button onClick={() => onUpdate(w.id, { time: null })}
            className="text-[9px] text-red-400 hover:text-red-600 flex-shrink-0">×</button>}
        </div> : <span className="text-[11px] text-gray-300">—</span>}
      </td>
      <td className="px-2 py-1.5 overflow-hidden">
        {w ? <select key={`s-${w.id}-${w.status}`} defaultValue={w.status}
          className={`text-[11px] rounded px-1.5 py-0.5 border border-gray-200 w-full cursor-pointer ${STATUS_COLORS[w.status] ?? ""}`}
          onChange={(e) => handleStatusChange(e.target.value)}>
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select> : <span className="text-[11px] text-gray-300">—</span>}
      </td>
      <td className="px-2 py-1.5 text-right overflow-hidden">
        {w ? <input type="number" step="0.01" key={`a-${w.id}-${w.amount}`}
          defaultValue={w.amount ? Number(w.amount) : ""}
          className="w-full text-[11px] border-0 bg-transparent text-right focus:ring-1 focus:ring-blue-400 rounded px-0.5 font-bold text-gray-800"
          onBlur={(e) => { const val = parseFloat(e.target.value); onUpdate(w.id, { amount: isNaN(val) ? null : val }); }} />
        : <span className="text-[11px] text-gray-300">—</span>}
      </td>
      <td className="px-1 py-1.5 text-center overflow-hidden">
        {row.gmailId && (
          <div className="flex gap-0.5 justify-center">
            {w && (w.date || w.amount || w.status !== "PENDING") && (
              <button onClick={handleClear}
                className="text-[9px] text-red-400 hover:bg-red-100 w-4 h-4 rounded flex items-center justify-center" title="Xóa">×</button>
            )}
            <button onClick={() => onNewRound(row.gmailId, localVmCodes, row.paypalId)}
              className="text-[9px] text-blue-600 hover:bg-blue-100 w-4 h-4 rounded flex items-center justify-center" title="Đợt mới">+</button>
            <button onClick={() => onViewHistory(row.gmailId, row.gmailEmail)}
              className="text-[9px] text-gray-400 hover:bg-gray-200 w-4 h-4 rounded flex items-center justify-center" title="Lịch sử">H</button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ═══ PP Picker Dialog (giống Funds) ═══
function PPPickerDialog({ open, items, selectedId, onSelect, onClose }: {
  open: boolean; items: any[]; selectedId: string;
  onSelect: (ppId: string, email: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = items.filter((pp: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return pp.code.toLowerCase().includes(q)
      || pp.primaryEmail?.toLowerCase().includes(q)
      || pp.emails?.some((e: any) => e.email.toLowerCase().includes(q))
      || pp.holder?.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a: any, b: any) => a.code.localeCompare(b.code));

  const handleSelect = (ppId: string, email: string) => { onSelect(ppId, email); setSearch(""); };
  const handleClose = () => { setSearch(""); onClose(); };
  const copyEmail = (email: string, e: React.MouseEvent) => {
    e.stopPropagation(); navigator.clipboard.writeText(email); toast.success(`Copied: ${email}`);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Chọn PayPal — <span className="text-purple-600">click email để chọn</span></DialogTitle>
        </DialogHeader>
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Input placeholder="Tìm PP code, email, holder..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" autoFocus />
          </div>
          <span className="text-xs text-gray-400">{sorted.length} PP</span>
        </div>
        <div className="flex-1 overflow-y-auto -mx-2 space-y-1">
          {sorted.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">Không tìm thấy</div>}
          {sorted.map((pp: any) => {
            const isSelected = pp.id === selectedId;
            const allEmails = pp.emails?.length > 0 ? pp.emails : (pp.primaryEmail ? [{ id: "primary", email: pp.primaryEmail, isPrimary: true }] : []);
            return (
              <div key={pp.id} className={`px-3 py-2.5 rounded-lg border-2 transition-all hover:shadow-sm ${
                isSelected ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200" : "border-transparent hover:border-gray-200 hover:bg-gray-50"
              }`}>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-bold min-w-[60px] ${isSelected ? "text-blue-700" : "text-gray-900"}`}>{pp.code}</span>
                  <Badge className={`text-[10px] ${
                    pp.status === "ACTIVE" ? "bg-green-100 text-green-700" :
                    pp.status === "LIMITED" ? "bg-red-100 text-red-700" :
                    pp.status === "SUSPENDED" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"
                  }`}>{pp.status}</Badge>
                  {pp.holder && <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{pp.holder}</span>}
                </div>
                {allEmails.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {allEmails.map((em: any) => (
                      <span key={em.id || em.email}
                        onClick={() => handleSelect(pp.id, em.email)}
                        className="inline-flex items-center gap-1.5 text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded-md px-2.5 py-1 cursor-pointer hover:bg-purple-600 hover:text-white hover:border-purple-600 transition-all group"
                        title={`Chọn ${pp.code} với email này`}>
                        <svg className="w-3 h-3 shrink-0 opacity-50 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <span className="font-medium">{em.email}</span>
                        {em.isPrimary && <span className="text-[8px] opacity-60">PRIMARY</span>}
                        <button onClick={(e) => copyEmail(em.email, e)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 ml-0.5">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══ History Dialog ═══
function HistoryDialog({ projectId, gmailId, serverId, email, onClose, t }: {
  projectId: string; gmailId: string; serverId: string; email: string;
  onClose: () => void; t: (k: string) => string;
}) {
  const { data: history } = trpc.earnWithdrawal.history.useQuery(
    { projectId, gmailId, serverId }, { enabled: true }
  );
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("earn_history")}</DialogTitle>
          <p className="text-sm text-gray-500">{email}</p>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {(!history || history.length === 0) ? (
            <p className="text-sm text-gray-400 text-center py-4">Chưa có lịch sử</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">$</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">PP</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.map((h: any) => (
                  <tr key={h.id}>
                    <td className="px-3 py-2 text-xs font-medium">#{h.round}</td>
                    <td className="px-3 py-2 text-xs">{h.date ? formatDate(h.date) : "—"}</td>
                    <td className="px-3 py-2 text-xs">{h.time ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge className={`text-[10px] ${STATUS_COLORS[h.status] ?? ""}`}>{STATUS_LABELS[h.status]}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-right font-medium">
                      {h.amount ? `$${Number(h.amount).toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{h.paypal?.code ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
