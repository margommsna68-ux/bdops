"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import toast from "react-hot-toast";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export default function ProfitPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const t = useT();

  // View state
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [viewMode, setViewMode] = useState<"month" | "quarter" | "year">("month");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "settled">("all");

  // Dialogs
  const [showCreate, setShowCreate] = useState(false);
  const [showPartners, setShowPartners] = useState(false);
  const [expandedSplit, setExpandedSplit] = useState<string | null>(null);

  // Data
  const { data: splits, isLoading, refetch } = trpc.profitSplit.list.useQuery(
    { projectId: projectId!, year, month, viewMode, status: statusFilter },
    { enabled: !!projectId }
  );

  const { data: partners, refetch: refetchPartners } = trpc.partner.list.useQuery(
    { projectId: projectId!, activeOnly: false },
    { enabled: !!projectId }
  );

  const activePartners = useMemo(() => partners?.filter((p) => p.active) ?? [], [partners]);

  // Mutations
  const createSplit = trpc.profitSplit.create.useMutation({
    onSuccess: () => { refetch(); setShowCreate(false); toast.success(t("saved")); },
    onError: (e) => toast.error(e.message),
  });
  const recalculate = trpc.profitSplit.recalculate.useMutation({
    onSuccess: () => { refetch(); toast.success(t("saved")); },
  });
  const settle = trpc.profitSplit.settle.useMutation({
    onSuccess: () => { refetch(); toast.success(t("profit_settled_label")); },
  });
  const markPaid = trpc.profitSplit.markAllocationPaid.useMutation({
    onSuccess: () => refetch(),
  });
  const deleteSplit = trpc.profitSplit.deleteSplit.useMutation({
    onSuccess: () => { refetch(); toast.success(t("deleted")); },
    onError: (e) => toast.error(e.message),
  });
  const updateSplit = trpc.profitSplit.updateSplit.useMutation({
    onSuccess: () => { refetch(); toast.success(t("saved")); },
  });

  // Partner mutations
  const createPartner = trpc.partner.create.useMutation({
    onSuccess: () => { refetchPartners(); toast.success(t("saved")); },
    onError: (e) => toast.error(e.message),
  });
  const updatePartner = trpc.partner.update.useMutation({
    onSuccess: () => { refetchPartners(); toast.success(t("saved")); },
  });
  const deletePartner = trpc.partner.delete.useMutation({
    onSuccess: () => { refetchPartners(); toast.success(t("deleted")); },
  });

  // Grand totals for displayed splits
  const grandWithdrawal = splits?.reduce((s, sp) => s + Number(sp.totalWithdrawal), 0) ?? 0;
  const grandCost = splits?.reduce((s, sp) => s + Number(sp.totalCost), 0) ?? 0;
  const grandProfit = splits?.reduce((s, sp) => s + Number(sp.netProfit), 0) ?? 0;
  const grandProfitUsdt = splits?.reduce((s, sp) => s + (Number(sp.netProfitUsdt) || 0), 0) ?? 0;

  // Navigation
  const goMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setMonth(m);
    setYear(y);
  };

  const viewLabel = viewMode === "month"
    ? `${t("profit_view_month")} ${month}/${year}`
    : viewMode === "quarter"
      ? `Q${Math.ceil(month / 3)}/${year}`
      : `${year}`;

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  return (
    <div className="space-y-4">
      {/* Header + Month nav + View mode */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("profit_title")}</h1>
          <p className="text-sm text-gray-500">{t("profit_formula")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(["month", "quarter", "year"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 ${viewMode === m ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                {t(`profit_view_${m}`)}
              </button>
            ))}
          </div>
          {/* Month nav */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => viewMode === "year" ? setYear(year - 1) : goMonth(viewMode === "quarter" ? -3 : -1)}>
              &larr;
            </Button>
            <span className="text-sm font-medium min-w-[100px] text-center">{viewLabel}</span>
            <Button variant="outline" size="sm" onClick={() => viewMode === "year" ? setYear(year + 1) : goMonth(viewMode === "quarter" ? 3 : 1)}>
              &rarr;
            </Button>
          </div>
        </div>
      </div>

      {/* Summary formula bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="grid grid-cols-2 md:grid-cols-7 gap-3 items-center text-center">
          <div>
            <p className="text-xs text-gray-500">{t("profit_total_exchange")}</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(grandWithdrawal)}</p>
          </div>
          <div className="text-xl font-bold text-gray-300 hidden md:block">-</div>
          <div>
            <p className="text-xs text-gray-500">{t("profit_total_costs")}</p>
            <p className="text-lg font-bold text-red-600">{formatCurrency(grandCost)}</p>
          </div>
          <div className="text-xl font-bold text-gray-300 hidden md:block">=</div>
          <div>
            <p className="text-xs text-gray-500">{t("profit_net")} (USD)</p>
            <p className={`text-lg font-bold ${grandProfit >= 0 ? "text-blue-600" : "text-red-600"}`}>
              {formatCurrency(grandProfit)}
            </p>
          </div>
          <div className="text-xl font-bold text-gray-300 hidden md:block">&times;</div>
          <div>
            <p className="text-xs text-gray-500">{t("profit_net_usdt")}</p>
            <p className="text-lg font-bold text-purple-600">
              {grandProfitUsdt ? grandProfitUsdt.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowPartners(true)}>
          {t("profit_manage_partners")}
        </Button>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          {t("profit_new_period")}
        </Button>
        <div className="flex-1" />
        {/* Status filter */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          {(["all", "pending", "settled"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 ${statusFilter === s ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              {t(`profit_filter_${s}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Split periods */}
      {isLoading ? (
        <p className="text-gray-500">{t("loading")}</p>
      ) : splits?.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          {t("profit_no_periods")}
        </div>
      ) : (
        <div className="space-y-3">
          {splits?.map((split) => {
            const isExpanded = expandedSplit === split.id;
            const netProfit = Number(split.netProfit);
            const usdtRate = split.usdtRate ? Number(split.usdtRate) : null;
            const netProfitUsdt = split.netProfitUsdt ? Number(split.netProfitUsdt) : null;

            return (
              <div key={split.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {/* Period header - clickable */}
                <button
                  type="button"
                  onClick={() => setExpandedSplit(isExpanded ? null : split.id)}
                  className="w-full p-4 text-left hover:bg-gray-50 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{isExpanded ? "▾" : "▸"}</span>
                      <div>
                        <h3 className="font-semibold">
                          {formatDate(split.periodStart)} — {formatDate(split.periodEnd)}
                        </h3>
                        <Badge className={`text-xs ${split.settled ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                          {split.settled ? t("profit_settled_label") : t("profit_pending_label")}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <p className="text-xs text-gray-500">{t("profit_net")}</p>
                        <p className={`font-bold ${netProfit >= 0 ? "text-blue-600" : "text-red-600"}`}>
                          {formatCurrency(netProfit)}
                        </p>
                      </div>
                      {netProfitUsdt !== null && (
                        <div>
                          <p className="text-xs text-gray-500">USDT</p>
                          <p className="font-bold text-purple-600">{netProfitUsdt.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t px-4 pb-4">
                    {/* Numbers row */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 py-3 text-center">
                      <div>
                        <p className="text-xs text-gray-500">{t("profit_withdrawal")}</p>
                        <p className="font-bold text-green-600">{formatCurrency(Number(split.totalWithdrawal))}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">{t("profit_cost")}</p>
                        <p className="font-bold text-red-600">{formatCurrency(Number(split.totalCost))}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">{t("profit_net")} USD</p>
                        <p className={`font-bold ${netProfit >= 0 ? "text-blue-600" : "text-red-600"}`}>{formatCurrency(netProfit)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">{t("profit_usdt_rate")}</p>
                        <p className="font-bold text-gray-700">{usdtRate ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">{t("profit_net_usdt")}</p>
                        <p className="font-bold text-purple-600">{netProfitUsdt?.toLocaleString("en-US", { minimumFractionDigits: 2 }) ?? "—"}</p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {!split.settled && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => recalculate.mutate({ projectId: projectId!, id: split.id })}
                            disabled={recalculate.isLoading}
                          >
                            {t("profit_recalculate")}
                          </Button>
                          <UsdtRateInput
                            currentRate={usdtRate}
                            onSave={(rate) => updateSplit.mutate({ projectId: projectId!, id: split.id, usdtRate: rate })}
                            t={t}
                          />
                          <Button
                            size="sm"
                            onClick={() => {
                              if (confirm(t("profit_settle_confirm"))) {
                                settle.mutate({ projectId: projectId!, id: split.id });
                              }
                            }}
                            disabled={settle.isLoading}
                          >
                            {t("profit_mark_settled")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => {
                              if (confirm(t("profit_delete_confirm"))) {
                                deleteSplit.mutate({ projectId: projectId!, id: split.id });
                              }
                            }}
                          >
                            {t("profit_delete_split")}
                          </Button>
                        </>
                      )}
                    </div>

                    {/* Allocations table */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-500 mb-2">{t("profit_allocations")}</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-500 border-b">
                              <th className="py-2 pr-4">{t("profit_partner_name")}</th>
                              <th className="py-2 pr-4 text-right">%</th>
                              <th className="py-2 pr-4 text-right">{t("profit_amount_usd")}</th>
                              <th className="py-2 pr-4 text-right">{t("profit_amount_usdt")}</th>
                              <th className="py-2 pr-4">{t("profit_notes")}</th>
                              <th className="py-2 text-center">{t("col_status")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {split.allocations.map((alloc) => (
                              <tr key={alloc.id} className="border-b last:border-0">
                                <td className="py-2 pr-4 font-medium">{alloc.partnerName}</td>
                                <td className="py-2 pr-4 text-right text-gray-600">{Number(alloc.percentage)}%</td>
                                <td className="py-2 pr-4 text-right font-mono">{formatCurrency(Number(alloc.amount))}</td>
                                <td className="py-2 pr-4 text-right font-mono text-purple-600">
                                  {alloc.amountUsdt ? Number(alloc.amountUsdt).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}
                                </td>
                                <td className="py-2 pr-4 text-gray-500 text-xs">{alloc.note ?? ""}</td>
                                <td className="py-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => markPaid.mutate({
                                      projectId: projectId!,
                                      allocationId: alloc.id,
                                      paid: !alloc.paid,
                                    })}
                                    disabled={markPaid.isLoading}
                                  >
                                    <Badge className={`cursor-pointer text-xs ${alloc.paid ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                                      {alloc.paid ? t("paid") : t("unpaid")}
                                    </Badge>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Notes */}
                    {split.notes && (
                      <p className="text-xs text-gray-500 mt-2 italic">{split.notes}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Period Dialog */}
      <CreatePeriodDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        projectId={projectId!}
        partners={activePartners}
        onSubmit={(data) => createSplit.mutate(data)}
        isLoading={createSplit.isLoading}
        error={createSplit.error?.message}
        t={t}
        currentMonth={month}
        currentYear={year}
      />

      {/* Partners Dialog */}
      <PartnersDialog
        open={showPartners}
        onClose={() => setShowPartners(false)}
        partners={partners ?? []}
        onCreate={(data) => createPartner.mutate({ projectId: projectId!, ...data })}
        onUpdate={(data) => updatePartner.mutate({ projectId: projectId!, ...data })}
        onDelete={(id) => deletePartner.mutate({ projectId: projectId!, id })}
        t={t}
      />
    </div>
  );
}

// ═══ USDT Rate inline input ═══
function UsdtRateInput({
  currentRate,
  onSave,
  t,
}: {
  currentRate: number | null;
  onSave: (rate: number) => void;
  t: (key: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentRate?.toString() ?? "");

  if (!editing) {
    return (
      <Button variant="outline" size="sm" onClick={() => { setValue(currentRate?.toString() ?? ""); setEditing(true); }}>
        {t("profit_usdt_rate")}: {currentRate ?? "—"}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        step="0.0001"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-28 h-8 text-sm"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const rate = parseFloat(value);
            if (rate > 0) { onSave(rate); setEditing(false); }
          }
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <Button size="sm" variant="outline" className="h-8" onClick={() => {
        const rate = parseFloat(value);
        if (rate > 0) { onSave(rate); setEditing(false); }
      }}>OK</Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>✕</Button>
    </div>
  );
}

// ═══ Create Period Dialog ═══
function CreatePeriodDialog({
  open, onClose, projectId, partners, onSubmit, isLoading, error, t, currentMonth, currentYear,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  partners: { id: string; name: string; percentage: any }[];
  onSubmit: (data: any) => void;
  isLoading: boolean;
  error?: string;
  t: (key: string) => string;
  currentMonth: number;
  currentYear: number;
}) {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [usdtRate, setUsdtRate] = useState("");

  // Auto-fill dates
  const periodStart = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
  const periodEnd = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-${lastDay}`;

  const partnerList = partners.map((p) => ({
    name: p.name,
    percentage: Number(p.percentage),
  }));
  const totalPct = partnerList.reduce((s, p) => s + p.percentage, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("profit_create_title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Month selector */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("profit_view_month")}</Label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t("profit_view_year")}</Label>
              <Input type="number" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} />
            </div>
          </div>

          {/* Auto-filled dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-gray-500">{t("profit_period_start")}</Label>
              <p className="text-sm font-mono bg-gray-50 rounded px-2 py-1.5">{periodStart}</p>
            </div>
            <div>
              <Label className="text-xs text-gray-500">{t("profit_period_end")}</Label>
              <p className="text-sm font-mono bg-gray-50 rounded px-2 py-1.5">{periodEnd}</p>
            </div>
          </div>

          {/* USDT Rate */}
          <div>
            <Label>{t("profit_usdt_rate")} ({t("optional")})</Label>
            <Input
              type="number"
              step="0.0001"
              placeholder="e.g. 25600"
              value={usdtRate}
              onChange={(e) => setUsdtRate(e.target.value)}
            />
          </div>

          {/* Partners from config */}
          <div>
            <Label>{t("profit_partners")}</Label>
            {partners.length === 0 ? (
              <p className="text-sm text-amber-600 mt-1">{t("profit_no_partners")}</p>
            ) : (
              <div className="mt-2 space-y-1">
                {partnerList.map((p) => (
                  <div key={p.name} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2 text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-gray-500">{p.percentage}%</span>
                  </div>
                ))}
                <p className={`text-xs mt-1 ${Math.abs(totalPct - 100) < 0.01 ? "text-green-600" : "text-red-600"}`}>
                  {t("profit_partner_total")}: {totalPct}%
                </p>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button
              disabled={isLoading || partners.length === 0 || Math.abs(totalPct - 100) > 0.01}
              onClick={() => onSubmit({
                projectId,
                periodStart,
                periodEnd,
                usdtRate: usdtRate ? parseFloat(usdtRate) : undefined,
                partners: partnerList,
              })}
            >
              {isLoading ? t("creating") : t("profit_create_calc")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══ Partners Management Dialog ═══
function PartnersDialog({
  open, onClose, partners, onCreate, onUpdate, onDelete, t,
}: {
  open: boolean;
  onClose: () => void;
  partners: { id: string; name: string; percentage: any; note: string | null; active: boolean }[];
  onCreate: (data: { name: string; percentage: number; note?: string }) => void;
  onUpdate: (data: { id: string; name?: string; percentage?: number; note?: string | null; active?: boolean }) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
}) {
  const [newName, setNewName] = useState("");
  const [newPct, setNewPct] = useState("");
  const [newNote, setNewNote] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editPct, setEditPct] = useState("");
  const [editNote, setEditNote] = useState("");

  const totalPct = partners.filter((p) => p.active).reduce((s, p) => s + Number(p.percentage), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("profit_manage_partners")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Existing partners */}
          {partners.length === 0 ? (
            <p className="text-sm text-gray-500">{t("profit_no_partners")}</p>
          ) : (
            <div className="space-y-2">
              {partners.map((p) => (
                <div key={p.id} className={`flex items-center gap-2 rounded-md px-3 py-2 ${p.active ? "bg-gray-50" : "bg-gray-100 opacity-60"}`}>
                  {editId === p.id ? (
                    <>
                      <span className="font-medium text-sm flex-1">{p.name}</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={editPct}
                        onChange={(e) => setEditPct(e.target.value)}
                        className="w-20 h-7 text-sm"
                        placeholder="%"
                      />
                      <Input
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        className="w-32 h-7 text-sm"
                        placeholder={t("profit_partner_note")}
                      />
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                        onUpdate({ id: p.id, percentage: parseFloat(editPct) || Number(p.percentage), note: editNote || null });
                        setEditId(null);
                      }}>OK</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditId(null)}>✕</Button>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-sm flex-1">{p.name}</span>
                      <span className="text-sm text-gray-600 w-14 text-right">{Number(p.percentage)}%</span>
                      <span className="text-xs text-gray-400 flex-1 truncate">{p.note ?? ""}</span>
                      <button
                        type="button"
                        onClick={() => onUpdate({ id: p.id, active: !p.active })}
                        className="text-xs"
                      >
                        <Badge className={`text-xs cursor-pointer ${p.active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
                          {p.active ? t("profit_partner_active") : t("profit_partner_inactive")}
                        </Badge>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditId(p.id); setEditPct(String(Number(p.percentage))); setEditNote(p.note ?? ""); }}
                        className="text-gray-400 hover:text-gray-600 text-xs"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (confirm(t("confirm_delete"))) onDelete(p.id); }}
                        className="text-gray-400 hover:text-red-500 text-xs"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              ))}
              <p className={`text-xs ${Math.abs(totalPct - 100) < 0.01 ? "text-green-600" : "text-amber-600"}`}>
                {t("profit_partner_total")} ({t("profit_partner_active")}): {totalPct}%
              </p>
            </div>
          )}

          {/* Add new partner */}
          <div className="border-t pt-3">
            <Label className="text-sm">{t("profit_add_partner")}</Label>
            <div className="flex gap-2 mt-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("profit_partner_name")}
                className="flex-1"
              />
              <Input
                type="number"
                step="0.01"
                value={newPct}
                onChange={(e) => setNewPct(e.target.value)}
                placeholder="%"
                className="w-20"
              />
              <Input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder={t("profit_partner_note")}
                className="w-32"
              />
              <Button
                size="sm"
                disabled={!newName.trim() || !newPct}
                onClick={() => {
                  onCreate({ name: newName.trim(), percentage: parseFloat(newPct) || 0, note: newNote || undefined });
                  setNewName("");
                  setNewPct("");
                  setNewNote("");
                }}
              >
                {t("add")}
              </Button>
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
