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
import { exportToExcel } from "@/lib/excel-export";

export default function CostsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch } = trpc.cost.list.useQuery(
    { projectId: projectId!, page },
    { enabled: !!projectId }
  );

  const { data: summary } = trpc.cost.summary.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const columns: Column<any>[] = [
    {
      key: "date",
      header: "Date",
      render: (item) => formatDate(item.date),
      sortFn: (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    },
    {
      key: "serverCost",
      header: "Server",
      render: (item) => item.serverCost ? formatCurrency(item.serverCost) : "—",
      sortFn: (a, b) => Number(a.serverCost ?? 0) - Number(b.serverCost ?? 0),
    },
    {
      key: "ipCost",
      header: "IP/Proxy",
      render: (item) => item.ipCost ? formatCurrency(item.ipCost) : "—",
      sortFn: (a, b) => Number(a.ipCost ?? 0) - Number(b.ipCost ?? 0),
    },
    {
      key: "extraCost",
      header: "Extra",
      render: (item) => item.extraCost ? formatCurrency(item.extraCost) : "—",
      sortFn: (a, b) => Number(a.extraCost ?? 0) - Number(b.extraCost ?? 0),
    },
    {
      key: "total",
      header: "Total",
      render: (item) => (
        <span className="font-semibold text-red-700">{formatCurrency(item.total)}</span>
      ),
      sortFn: (a, b) => Number(a.total ?? 0) - Number(b.total ?? 0),
    },
    {
      key: "isPrepaid",
      header: "Prepaid",
      render: (item) =>
        item.isPrepaid ? <Badge className="bg-blue-100 text-blue-800 text-xs">Prepaid</Badge> : null,
      sortFn: (a, b) => Number(a.isPrepaid) - Number(b.isPrepaid),
    },
    { key: "fundingSource", header: "Source" },
    { key: "note", header: "Note" },
  ];

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cost Management</h1>
          <p className="text-gray-500">Track server, proxy, and operational costs</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()} className="hidden sm:inline-flex">
            Print / PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!data?.items?.length) return;
              exportToExcel(
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
                "costs-export",
                "Costs"
              );
            }}
            disabled={!data?.items?.length}
          >
            Export Excel
          </Button>
          <Button onClick={() => setShowForm(true)}>+ Add Cost</Button>
        </div>
      </div>

      {/* Category summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Server Costs"
          value={formatCurrency(Number(summary?.serverCost ?? 0))}
          subtitle="All time"
        />
        <StatCard
          title="IP/Proxy Costs"
          value={formatCurrency(Number(summary?.ipCost ?? 0))}
          subtitle="All time"
        />
        <StatCard
          title="Extra Costs"
          value={formatCurrency(Number(summary?.extraCost ?? 0))}
          subtitle="All time"
        />
        <StatCard
          title="Total Costs"
          value={formatCurrency(Number(summary?.total ?? 0))}
          subtitle={`${summary?.count ?? 0} records`}
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
          placeholder="Search source, notes, amount..."
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
        emptyMessage="No cost records yet."
      />

      <CostForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSuccess={() => refetch()}
      />
    </div>
  );
}
