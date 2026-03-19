"use client";

import { useState, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { CostForm } from "@/components/forms/CostForm";
import { ImportCSVDialog } from "@/components/forms/ImportCSVDialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import { exportToCSV } from "@/lib/excel-export";
import { useTableSort, SortIcon } from "@/components/tables/useTableSort";
import { useT } from "@/lib/i18n";
import toast from "react-hot-toast";

const CATEGORIES = ["SERVER", "IP_PROXY", "GMAIL", "PAYPAL", "OTHER"] as const;
const categoryColors: Record<string, string> = {
  SERVER: "bg-blue-100 text-blue-800",
  IP_PROXY: "bg-purple-100 text-purple-800",
  GMAIL: "bg-red-100 text-red-800",
  PAYPAL: "bg-indigo-100 text-indigo-800",
  OTHER: "bg-gray-100 text-gray-800",
};

// ─── Inline editable number cell ──────────
function NumCell({ value, onSave }: { value: number | null; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const open = () => { setDraft(value != null ? String(value) : ""); setEditing(true); };
  const save = useCallback(() => {
    setEditing(false);
    const num = draft.trim() ? parseFloat(draft) : 0;
    if (num !== (value ?? 0)) onSave(num);
  }, [draft, value, onSave]);

  if (editing) {
    return <input autoFocus type="number" step="0.01" value={draft} onChange={(e) => setDraft(e.target.value)}
      onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
      className="w-full px-1 py-0 border border-blue-400 rounded text-xs bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none text-right" />;
  }
  return (
    <span className="cursor-pointer hover:text-blue-600 text-right block px-1" onClick={open}>
      {value != null && Number(value) > 0 ? `$${Number(value).toFixed(2)}` : "—"}
    </span>
  );
}

// ─── Inline editable text cell ──────────
function TextCell({ value, onSave, placeholder }: { value: string; onSave: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const open = () => { setDraft(value); setEditing(true); };
  const save = useCallback(() => { setEditing(false); if (draft !== value) onSave(draft); }, [draft, value, onSave]);

  if (editing) {
    return <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
      onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
      className="w-full px-1 py-0 border border-blue-400 rounded text-xs bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none" placeholder={placeholder} />;
  }
  return (
    <span className={`cursor-pointer hover:text-blue-600 block px-1 truncate ${value ? "" : "text-gray-300"}`} onClick={open}>
      {value || "—"}
    </span>
  );
}

export default function CostsPage() {
  const t = useT();
  const { currentProjectId: projectId, currentRole } = useProjectStore();
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const canEdit = currentRole === "ADMIN" || currentRole === "MODERATOR";
  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.cost.list.useQuery(
    { projectId: projectId!, year: viewYear, month: viewMonth, showAll, limit: showAll ? 500 : 100 },
    { enabled: !!projectId }
  );

  const { data: summary } = trpc.cost.monthlySummary.useQuery(
    { projectId: projectId!, year: viewYear, month: viewMonth },
    { enabled: !!projectId }
  );

  const { data: comparison } = trpc.cost.compare.useQuery(
    { projectId: projectId!, year: viewYear, month: viewMonth },
    { enabled: !!projectId }
  );

  const { data: billing } = trpc.cost.serverBilling.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const invalidate = () => {
    utils.cost.list.invalidate();
    utils.cost.monthlySummary.invalidate();
    utils.cost.compare.invalidate();
    refetch();
  };

  const updateCost = trpc.cost.update.useMutation({
    onSuccess: () => { invalidate(); toast.success(t("saved")); },
    onError: (e) => toast.error(e.message),
  });

  const deleteCost = trpc.cost.delete.useMutation({
    onSuccess: () => { invalidate(); toast.success(t("cost_deleted")); },
    onError: (e) => toast.error(e.message),
  });

  const bulkImport = trpc.cost.bulkImport.useMutation({
    onSuccess: (result) => { invalidate(); toast.success(`${t("cost_imported")} ${result.imported}`); if (result.errors.length > 0) toast.error(`${result.errors.length} errors`); },
    onError: (e) => toast.error(e.message),
  });

  const bulkDelete = trpc.cost.bulkDelete.useMutation({
    onSuccess: (d) => { invalidate(); setSelected(new Set()); toast.success(`${t("cost_deleted")} (${d.deleted})`); },
    onError: (e) => toast.error(e.message),
  });

  const saveField = (id: string, field: string, value: any) => {
    updateCost.mutate({ projectId: projectId!, id, [field]: value });
  };

  // Month navigation
  const goMonth = (delta: number) => {
    setShowAll(false);
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setViewMonth(m);
    setViewYear(y);
    setSelected(new Set());
  };

  const monthLabel = `${String(viewMonth).padStart(2, "0")}/${viewYear}`;
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth() + 1;

  // Filter + sort
  const rawItems = data?.items ?? [];
  const filtered = search.trim()
    ? rawItems.filter((c: any) => {
        const q = search.toLowerCase();
        return (c.code ?? "").toLowerCase().includes(q) || (c.note ?? "").toLowerCase().includes(q) ||
          (c.category ?? "").toLowerCase().includes(q) || String(c.amount).includes(q);
      })
    : rawItems;
  const { sorted: items, sortKey, sortDir, handleSort } = useTableSort(filtered);

  // Selection
  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((c: any) => c.id)));
  };

  const handleBulkDelete = () => {
    if (!confirm(`${t("cost_delete_confirm")} (${selected.size})`)) return;
    bulkDelete.mutate({ projectId: projectId!, ids: Array.from(selected) });
  };

  const handleDelete = (item: any) => {
    if (!confirm(`${t("cost_delete_confirm")} ${item.code ?? ""}`)) return;
    deleteCost.mutate({ projectId: projectId!, id: item.id });
  };

  // Comparison data
  const compCategories = useMemo(() => {
    if (!comparison) return [];
    const allCats = new Set([
      ...Object.keys(comparison.current.byCategory),
      ...Object.keys(comparison.previous.byCategory),
    ]);
    return Array.from(allCats).map((cat) => {
      const cur = comparison.current.byCategory[cat] ?? 0;
      const prev = comparison.previous.byCategory[cat] ?? 0;
      const diff = cur - prev;
      const pct = prev > 0 ? ((diff / prev) * 100) : (cur > 0 ? 100 : 0);
      return { cat, cur, prev, diff, pct };
    });
  }, [comparison]);

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  return (
    <div className="space-y-4">
      {/* Header + Month nav */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("cost_title")}</h1>
          <p className="text-sm text-gray-500">{t("cost_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => goMonth(-1)} className="px-2 py-1 border rounded text-sm hover:bg-gray-100">&laquo;</button>
          <span className={`text-sm font-semibold min-w-[80px] text-center ${showAll ? "text-gray-400" : ""}`}>{monthLabel}</span>
          <button onClick={() => goMonth(1)} disabled={isCurrentMonth && !showAll} className="px-2 py-1 border rounded text-sm hover:bg-gray-100 disabled:opacity-30">&raquo;</button>
          <span className="text-gray-300">|</span>
          <button onClick={() => { setShowAll(!showAll); setSelected(new Set()); }}
            className={`px-2 py-1 rounded text-xs font-medium ${showAll ? "bg-gray-900 text-white" : "border text-gray-600 hover:bg-gray-100"}`}>
            {t("all")}
          </button>
          {!isCurrentMonth && !showAll && (
            <button onClick={() => { setViewYear(now.getFullYear()); setViewMonth(now.getMonth() + 1); }}
              className="px-2 py-1 text-xs text-blue-600 hover:underline">
              {t("today")}
            </button>
          )}
        </div>
      </div>

      {/* Billing reminders */}
      {billing && (billing.dueSoon.length > 0 || billing.overdue.length > 0) && (
        <div className={`rounded-lg p-3 border ${billing.overdue.length > 0 ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
          <h3 className="text-xs font-semibold mb-2 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            {t("cost_billing_due")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {billing.overdue.map((s: any) => (
              <div key={s.id} className="bg-white rounded border border-red-200 px-2 py-1 text-xs flex items-center gap-1.5">
                <span className="font-medium">{s.code}</span>
                <span className="font-semibold text-red-700">${Number(s.monthlyCost).toFixed(0)}</span>
                <span className="text-red-500 text-[10px]">{t("cost_billing_overdue")}</span>
              </div>
            ))}
            {billing.dueSoon.filter((s: any) => !billing.overdue.find((o: any) => o.id === s.id)).map((s: any) => (
              <div key={s.id} className="bg-white rounded border border-amber-200 px-2 py-1 text-xs flex items-center gap-1.5">
                <span className="font-medium">{s.code}</span>
                <span className="font-semibold text-amber-700">${Number(s.monthlyCost).toFixed(0)}</span>
                <span className="text-amber-500 text-[10px]">{formatDate(s.expiryDate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly summary by category */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {CATEGORIES.map((cat) => {
            const val = summary.byCategory[cat] ?? 0;
            return (
              <div key={cat} className={`rounded-lg border p-3 ${categoryColors[cat]}`}>
                <p className="text-[11px] font-medium opacity-70">{t(`cost_cat_${cat}`)}</p>
                <p className="text-lg font-bold">{formatCurrency(val)}</p>
              </div>
            );
          })}
          <div className="rounded-lg border p-3 bg-gray-900 text-white">
            <p className="text-[11px] font-medium opacity-70">{t("total")}</p>
            <p className="text-lg font-bold">{formatCurrency(summary.total)}</p>
            <p className="text-[10px] opacity-50">{summary.count} {t("cost_records")}</p>
          </div>
        </div>
      )}

      {/* Comparison vs previous month */}
      {comparison && compCategories.length > 0 && (
        <div className="bg-gray-50 rounded-lg border p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-700">{t("cost_vs_prev")}</h3>
            <span className={`text-sm font-bold ${comparison.current.total > comparison.previous.total ? "text-red-600" : comparison.current.total < comparison.previous.total ? "text-green-600" : "text-gray-500"}`}>
              {comparison.current.total > comparison.previous.total ? "+" : ""}{formatCurrency(comparison.current.total - comparison.previous.total)}
              {comparison.previous.total > 0 && (
                <span className="text-[10px] ml-1">
                  ({comparison.current.total > comparison.previous.total ? "+" : ""}{(((comparison.current.total - comparison.previous.total) / comparison.previous.total) * 100).toFixed(1)}%)
                </span>
              )}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1 text-left text-gray-500">{t("cost_category")}</th>
                  <th className="px-2 py-1 text-right text-gray-500">T{comparison.prevMonth}</th>
                  <th className="px-2 py-1 text-right text-gray-500">T{viewMonth}</th>
                  <th className="px-2 py-1 text-right text-gray-500">{t("cost_change")}</th>
                </tr>
              </thead>
              <tbody>
                {compCategories.map(({ cat, cur, prev, diff, pct }) => (
                  <tr key={cat} className="border-b border-gray-100">
                    <td className="px-2 py-1"><Badge className={`text-[10px] ${categoryColors[cat]}`}>{t(`cost_cat_${cat}`)}</Badge></td>
                    <td className="px-2 py-1 text-right text-gray-500">{formatCurrency(prev)}</td>
                    <td className="px-2 py-1 text-right font-medium">{formatCurrency(cur)}</td>
                    <td className={`px-2 py-1 text-right font-medium ${diff > 0 ? "text-red-600" : diff < 0 ? "text-green-600" : "text-gray-400"}`}>
                      {diff !== 0 ? `${diff > 0 ? "+" : ""}${formatCurrency(diff)}` : "—"}
                      {diff !== 0 && prev > 0 && <span className="text-[10px] ml-0.5">({pct > 0 ? "+" : ""}{pct.toFixed(0)}%)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap bg-gray-50 rounded-lg p-2 border">
        <div className="relative flex-1 min-w-[180px]">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-7 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none" placeholder={t("cost_search_placeholder")} />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">&times;</button>}
        </div>
        <button onClick={() => {
          if (!rawItems.length) return;
          exportToCSV(rawItems.map((c: any, i: number) => ({
            "#": i + 1, [t("cost_code")]: c.code ?? "", [t("cost_date")]: formatDate(c.date),
            [t("cost_category")]: t(`cost_cat_${c.category}`), [t("cost_amount")]: Number(c.amount || c.total),
            [t("cost_prepaid")]: c.isPrepaid ? "Yes" : "", [t("cost_note")]: c.note ?? "",
          })), `costs-${monthLabel}`);
        }} disabled={!rawItems.length} className="px-2 py-1 bg-green-600 text-white rounded text-[11px] font-medium hover:bg-green-700 disabled:opacity-50">
          CSV
        </button>
        {canEdit && (
          <>
            <button onClick={() => setShowImport(true)} className="px-2 py-1 border text-gray-600 rounded text-[11px] font-medium hover:bg-gray-100">
              {t("cost_import")}
            </button>
            <button onClick={() => setShowForm(true)} className="px-2 py-1 bg-blue-600 text-white rounded text-[11px] font-medium hover:bg-blue-700">
              + {t("cost_add")}
            </button>
          </>
        )}
        {selected.size > 0 && canEdit && (
          <>
            <span className="text-gray-300">|</span>
            <span className="text-[11px] font-medium text-blue-600">{selected.size} {t("selected")}</span>
            <button onClick={handleBulkDelete} disabled={bulkDelete.isLoading}
              className="px-2 py-1 bg-red-600 text-white rounded text-[11px] font-medium hover:bg-red-700 disabled:opacity-50">
              {t("cost_delete_selected")}
            </button>
            <button onClick={() => setSelected(new Set())} className="text-[11px] text-gray-500 hover:underline">{t("deselect")}</button>
          </>
        )}
      </div>

      {/* Table */}
      {isLoading ? <p className="text-gray-500 p-4 text-sm">{t("loading")}</p> : items.length === 0 ? (
        <div className="text-center py-10 bg-white border rounded-lg">
          <p className="text-gray-500 text-sm">{t("cost_no_records")}</p>
          {canEdit && <button onClick={() => setShowForm(true)} className="mt-2 text-blue-600 text-sm hover:underline">+ {t("cost_add")}</button>}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-2 py-1.5 w-8"><input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} className="rounded border-gray-300" /></th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500 w-8">#</th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500 cursor-pointer hover:bg-gray-100" onClick={() => handleSort("code")}>
                  {t("cost_code")} <SortIcon active={sortKey === "code"} direction={sortDir} />
                </th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500 cursor-pointer hover:bg-gray-100" onClick={() => handleSort("date")}>
                  {t("cost_date")} <SortIcon active={sortKey === "date"} direction={sortDir} />
                </th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500 cursor-pointer hover:bg-gray-100" onClick={() => handleSort("category")}>
                  {t("cost_category")} <SortIcon active={sortKey === "category"} direction={sortDir} />
                </th>
                <th className="px-2 py-1.5 text-right font-medium text-gray-500 cursor-pointer hover:bg-gray-100" onClick={() => handleSort("amount")}>
                  {t("cost_amount")} <SortIcon active={sortKey === "amount"} direction={sortDir} />
                </th>
                <th className="px-2 py-1.5 text-center font-medium text-gray-500">{t("cost_prepaid")}</th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500">{t("cost_note")}</th>
                {canEdit && <th className="px-1 py-1.5 w-8"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((c: any, idx: number) => (
                <tr key={c.id} className={`${selected.has(c.id) ? "bg-blue-50" : "hover:bg-gray-50/50"}`}>
                  <td className="px-2 py-0.5 text-center">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} className="rounded border-gray-300" />
                  </td>
                  <td className="px-2 py-0.5 text-gray-400">{idx + 1}</td>
                  <td className="px-2 py-0.5 font-mono text-gray-600 text-[11px]">{c.code ?? "—"}</td>
                  <td className="px-2 py-0.5 text-gray-700 whitespace-nowrap">{formatDate(c.date)}</td>
                  <td className="px-2 py-0.5">
                    {canEdit ? (
                      <button onClick={() => {
                        const i = CATEGORIES.indexOf(c.category);
                        const next = CATEGORIES[(i + 1) % CATEGORIES.length];
                        saveField(c.id, "category", next);
                      }} className={`text-[11px] px-2 py-0.5 rounded font-medium cursor-pointer hover:opacity-80 transition-opacity ${categoryColors[c.category] ?? ""}`}>
                        {t(`cost_cat_${c.category}`)}
                      </button>
                    ) : <Badge className={`text-[10px] ${categoryColors[c.category] ?? ""}`}>{t(`cost_cat_${c.category}`)}</Badge>}
                  </td>
                  <td className="py-0.5 text-right font-semibold">
                    {canEdit
                      ? <NumCell value={Number(c.amount) || Number(c.total) || null} onSave={(v) => saveField(c.id, "amount", v)} />
                      : <span className="px-1">{formatCurrency(c.amount || c.total)}</span>}
                  </td>
                  <td className="px-2 py-0.5 text-center">
                    {canEdit ? (
                      <input type="checkbox" checked={c.isPrepaid} onChange={(e) => saveField(c.id, "isPrepaid", e.target.checked)} className="rounded border-gray-300" />
                    ) : (c.isPrepaid ? <Badge className="bg-blue-100 text-blue-800 text-[10px]">{t("cost_prepaid")}</Badge> : null)}
                  </td>
                  <td className="py-0.5 max-w-[200px]">
                    {canEdit ? <TextCell value={c.note ?? ""} onSave={(v) => saveField(c.id, "note", v || null)} placeholder={t("cost_note_placeholder")} />
                      : <span className="px-1 text-xs truncate block">{c.note ?? "—"}</span>}
                  </td>
                  {canEdit && (
                    <td className="px-1 py-0.5">
                      <button onClick={() => handleDelete(c)} disabled={deleteCost.isLoading}
                        className="p-1 text-gray-300 hover:text-red-600 rounded hover:bg-red-50">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-1.5 bg-gray-50 border-t text-[11px] text-gray-500 flex items-center justify-between">
            <span>{data?.total ?? 0} {t("cost_records")}</span>
            <span className="font-semibold text-gray-700">{t("total")}: {formatCurrency(summary?.total ?? 0)}</span>
          </div>
        </div>
      )}

      <CostForm open={showForm} onClose={() => setShowForm(false)} onSuccess={invalidate} />

      <ImportCSVDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        title={t("cost_import_title")}
        description={t("cost_import_desc")}
        templateColumns={["Date", "Category", "Amount", "Note", "Prepaid"]}
        onImport={(rows) => {
          const catMap: Record<string, string> = { server: "SERVER", ip: "IP_PROXY", "ip/proxy": "IP_PROXY", proxy: "IP_PROXY", gmail: "GMAIL", paypal: "PAYPAL", other: "OTHER", khác: "OTHER", "khac": "OTHER" };
          const items = rows.map((r) => ({
            date: r["Date"] || new Date().toISOString().split("T")[0],
            category: (catMap[(r["Category"] || "").toLowerCase()] || "OTHER") as any,
            amount: Number(r["Amount"] || 0),
            note: r["Note"] || undefined,
            isPrepaid: ["yes", "true", "1"].includes((r["Prepaid"] || "").toLowerCase()),
          }));
          bulkImport.mutate({ projectId: projectId!, items });
        }}
      />
    </div>
  );
}
