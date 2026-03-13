"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { StatCard } from "@/components/dashboard/StatCard";
import { CostForm } from "@/components/forms/CostForm";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import { exportToCSV } from "@/lib/excel-export";
import { ImportCSVDialog } from "@/components/forms/ImportCSVDialog";
import { useT } from "@/lib/i18n";
import toast from "react-hot-toast";

export default function CostsPage() {
  const t = useT();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch } = trpc.cost.list.useQuery(
    { projectId: projectId!, page },
    { enabled: !!projectId }
  );

  const { data: summary } = trpc.cost.summary.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const { data: billing } = trpc.cost.serverBilling.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const utils = trpc.useUtils();

  const bulkImport = trpc.cost.bulkImport.useMutation({
    onSuccess: (result) => {
      utils.cost.list.invalidate();
      utils.cost.summary.invalidate();
      toast.success(`Imported ${result.imported} rows`);
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} errors: ${result.errors[0]}`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const generateCost = trpc.cost.generateFromBilling.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(t("cost_generated"));
    },
    onError: (e) => toast.error(e.message),
  });

  const columns: Column<any>[] = [
    {
      key: "date",
      header: t("cost_date"),
      render: (item) => formatDate(item.date),
      sortFn: (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    },
    {
      key: "serverCost",
      header: t("cost_server_col"),
      render: (item) => item.serverCost ? formatCurrency(item.serverCost) : "—",
      sortFn: (a, b) => Number(a.serverCost ?? 0) - Number(b.serverCost ?? 0),
    },
    {
      key: "ipCost",
      header: t("cost_ip_col"),
      render: (item) => item.ipCost ? formatCurrency(item.ipCost) : "—",
      sortFn: (a, b) => Number(a.ipCost ?? 0) - Number(b.ipCost ?? 0),
    },
    {
      key: "extraCost",
      header: t("cost_extra_col"),
      render: (item) => item.extraCost ? formatCurrency(item.extraCost) : "—",
      sortFn: (a, b) => Number(a.extraCost ?? 0) - Number(b.extraCost ?? 0),
    },
    {
      key: "total",
      header: t("total"),
      render: (item) => (
        <span className="font-semibold text-red-700">{formatCurrency(item.total)}</span>
      ),
      sortFn: (a, b) => Number(a.total ?? 0) - Number(b.total ?? 0),
    },
    {
      key: "isPrepaid",
      header: t("cost_prepaid"),
      render: (item) =>
        item.isPrepaid ? <Badge className="bg-blue-100 text-blue-800 text-xs">{t("cost_prepaid")}</Badge> : null,
      sortFn: (a, b) => Number(a.isPrepaid) - Number(b.isPrepaid),
    },
    { key: "fundingSource", header: t("cost_source") },
    { key: "note", header: t("cost_note") },
  ];

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("cost_title")}</h1>
          <p className="text-gray-500">{t("cost_subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()} className="hidden sm:inline-flex">
            {t("cost_print")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!data?.items?.length) return;
              exportToCSV(
                data.items.map((c: any) => ({
                  Date: formatDate(c.date),
                  Server: c.serverCost ? Number(c.serverCost) : "",
                  "IP/Proxy": c.ipCost ? Number(c.ipCost) : "",
                  Extra: c.extraCost ? Number(c.extraCost) : "",
                  Total: Number(c.total),
                  Prepaid: c.isPrepaid ? "Yes" : "No",
                  Source: c.fundingSource ?? "",
                  Note: c.note ?? "",
                })),
                "costs-export"
              );
            }}
            disabled={!data?.items?.length}
          >
            {t("cost_export")}
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            Import CSV
          </Button>
          <Button onClick={() => setShowForm(true)}>{t("cost_add")}</Button>
        </div>
      </div>

      {/* Server Billing Integration */}
      {billing && billing.activeCount > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-indigo-900">{t("cost_billing_title")}</h3>
              <p className="text-xs text-indigo-600">{t("cost_billing_subtitle")}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-indigo-700">{formatCurrency(billing.totalMonthly)}{t("cost_per_month")}</p>
              <p className="text-xs text-indigo-500">{billing.activeCount} {t("cost_active_servers")}</p>
            </div>
          </div>

          {/* Server breakdown */}
          <div className="flex flex-wrap gap-2 mb-3">
            {billing.servers.map((s: any) => (
              <div key={s.id} className="bg-white rounded border border-indigo-100 px-2 py-1 text-xs flex items-center gap-1.5">
                <span className="font-medium text-gray-800">{s.code}</span>
                <span className="text-indigo-700 font-semibold">${Number(s.monthlyCost).toFixed(0)}</span>
                <span className="text-gray-400">{s._count?.vms ?? 0} VM</span>
              </div>
            ))}
          </div>

          {/* Expiring alert */}
          {billing.expiringSoon.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
              <p className="text-xs font-medium text-amber-800">
                {billing.expiringSoon.length} {t("cost_expiring_soon")}:
                {" "}{billing.expiringSoon.map((s: any) => s.code).join(", ")}
              </p>
            </div>
          )}

          {/* Generate button */}
          <Button
            size="sm"
            variant="outline"
            className="border-indigo-300 text-indigo-700 hover:bg-indigo-100"
            onClick={() => {
              const today = new Date().toISOString().split("T")[0];
              generateCost.mutate({ projectId: projectId!, date: today });
            }}
            disabled={generateCost.isLoading}
          >
            {generateCost.isLoading ? t("cost_generating") : t("cost_generate")}
          </Button>
        </div>
      )}

      {/* Category summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title={t("cost_server")}
          value={formatCurrency(Number(summary?.serverCost ?? 0))}
          subtitle={t("all_time")}
        />
        <StatCard
          title={t("cost_ip")}
          value={formatCurrency(Number(summary?.ipCost ?? 0))}
          subtitle={t("all_time")}
        />
        <StatCard
          title={t("cost_extra")}
          value={formatCurrency(Number(summary?.extraCost ?? 0))}
          subtitle={t("all_time")}
        />
        <StatCard
          title={t("cost_total")}
          value={formatCurrency(Number(summary?.total ?? 0))}
          subtitle={`${summary?.count ?? 0} ${t("cost_records")}`}
          trend="down"
        />
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-8 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          placeholder={t("cost_search_placeholder")}
        />
        {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">&times;</button>}
      </div>

      <DataTable
        columns={columns}
        data={search.trim() ? (data?.items ?? []).filter((c: any) => {
          const q = search.toLowerCase();
          return (c.fundingSource ?? "").toLowerCase().includes(q) || (c.note ?? "").toLowerCase().includes(q) || String(c.total).includes(q) || String(c.serverCost ?? "").includes(q);
        }) : data?.items ?? []}
        total={data?.total ?? 0}
        page={page}
        limit={50}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage={t("cost_no_records")}
      />

      <CostForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSuccess={() => refetch()}
      />

      <ImportCSVDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import Costs from CSV"
        description="Upload a CSV file with cost records. Download the template for the expected format."
        templateColumns={["Date", "Server Cost", "IP Cost", "Extra Cost", "Total", "Prepaid", "Funding Source", "Note"]}
        onImport={(rows) => {
          const items = rows.map((r) => ({
            date: r["Date"] || new Date().toISOString().split("T")[0],
            serverCost: r["Server Cost"] ? Number(r["Server Cost"]) : undefined,
            ipCost: r["IP Cost"] ? Number(r["IP Cost"]) : undefined,
            extraCost: r["Extra Cost"] ? Number(r["Extra Cost"]) : undefined,
            total: r["Total"] ? Number(r["Total"]) : (Number(r["Server Cost"] || 0) + Number(r["IP Cost"] || 0) + Number(r["Extra Cost"] || 0)),
            isPrepaid: (r["Prepaid"] || "").toLowerCase() === "yes" || r["Prepaid"] === "true" || r["Prepaid"] === "1",
            fundingSource: r["Funding Source"] || undefined,
            note: r["Note"] || undefined,
          }));
          bulkImport.mutate({ projectId: projectId!, items });
        }}
      />
    </div>
  );
}
