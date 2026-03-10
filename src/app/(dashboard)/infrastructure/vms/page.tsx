"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { ImportExcelDialog } from "@/components/forms/ImportExcelDialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { exportToExcel } from "@/lib/excel-export";
import toast from "react-hot-toast";

const statusColors: Record<string, string> = {
  OK: "bg-green-100 text-green-800",
  ERROR: "bg-red-100 text-red-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  NEW: "bg-blue-100 text-blue-800",
  NOT_CONNECTED: "bg-orange-100 text-orange-800",
  NOT_AVC: "bg-purple-100 text-purple-800",
  BLOCKED: "bg-red-200 text-red-900",
};

const ALL_STATUSES = ["OK", "ERROR", "SUSPENDED", "NEW", "NOT_CONNECTED", "NOT_AVC", "BLOCKED"];

export default function VMsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState("");

  const bulkImport = trpc.vm.bulkImport.useMutation();

  const { data, isLoading, refetch } = trpc.vm.list.useQuery(
    {
      projectId: projectId!,
      page,
      status: statusFilter || undefined,
    },
    { enabled: !!projectId }
  );

  const columns: Column<any>[] = [
    { key: "code", header: "Code", render: (item) => <span className="font-medium">{item.code}</span> },
    {
      key: "server",
      header: "Server",
      render: (item) => item.server?.code ?? "—",
      sortFn: (a, b) => (a.server?.code ?? "").localeCompare(b.server?.code ?? ""),
    },
    {
      key: "status",
      header: "Status",
      render: (item) => <Badge className={`text-xs ${statusColors[item.status] ?? ""}`}>{item.status}</Badge>,
    },
    {
      key: "sdkId",
      header: "SDK ID",
      render: (item) => (
        <span className="text-xs text-gray-500 max-w-[100px] truncate block">
          {item.sdkId ? item.sdkId.slice(0, 16) + "..." : "—"}
        </span>
      ),
    },
    {
      key: "earnTotal",
      header: "Earn Total",
      render: (item) => `$${Number(item.earnTotal ?? 0).toFixed(2)}`,
    },
    {
      key: "earn24h",
      header: "24h",
      render: (item) => (
        <span className={Number(item.earn24h ?? 0) > 0 ? "text-green-700" : "text-gray-400"}>
          ${Number(item.earn24h ?? 0).toFixed(2)}
        </span>
      ),
    },
    {
      key: "proxy",
      header: "Proxy",
      sortable: false,
      render: (item) => (
        <span className="text-xs">{item.proxy?.address?.split(":")[0] ?? "—"}</span>
      ),
    },
    {
      key: "gmail",
      header: "Gmail",
      sortable: false,
      render: (item) => <span className="text-xs">{item.gmail?.email ?? "—"}</span>,
    },
  ];

  // Client-side search filtering
  const filteredData = search.trim()
    ? (data?.items ?? []).filter((vm: any) => {
        const q = search.toLowerCase();
        return (
          (vm.code ?? "").toLowerCase().includes(q) ||
          (vm.server?.code ?? "").toLowerCase().includes(q) ||
          (vm.sdkId ?? "").toLowerCase().includes(q) ||
          (vm.status ?? "").toLowerCase().includes(q) ||
          (vm.proxy?.address ?? "").toLowerCase().includes(q) ||
          (vm.gmail?.email ?? "").toLowerCase().includes(q)
        );
      })
    : data?.items ?? [];

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Virtual Machines</h1>
          <p className="text-gray-500">VM status, SDK, earn tracking</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (!filteredData.length) return;
              exportToExcel(
                filteredData.map((vm: any) => ({
                  Code: vm.code,
                  Server: vm.server?.code ?? "",
                  Status: vm.status,
                  "SDK ID": vm.sdkId ?? "",
                  "Earn Total": Number(vm.earnTotal ?? 0),
                  "24h": Number(vm.earn24h ?? 0),
                  Proxy: vm.proxy?.address?.split(":")[0] ?? "",
                  Gmail: vm.gmail?.email ?? "",
                })),
                "vms-export",
                "VMs"
              );
            }}
            disabled={!filteredData.length}
          >
            Export Excel
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            Import Excel
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={statusFilter === "" ? "default" : "outline"}
          size="sm"
          onClick={() => { setStatusFilter(""); setPage(1); }}
        >
          ALL
        </Button>
        {ALL_STATUSES.map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s}
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-8 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          placeholder="Search VM code, server, SDK ID, proxy, gmail..."
        />
        {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">&times;</button>}
      </div>

      <DataTable
        columns={columns}
        data={filteredData}
        total={data?.total ?? 0}
        page={page}
        limit={50}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No VMs yet."
      />

      <ImportExcelDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import Virtual Machines"
        description="Required columns: Code (VM code), Server (server code). Optional: Status, SDK ID, Notes"
        onImport={async (rows) => {
          const items = rows.map((r: any) => ({
            code: String(r["Code"] || r["code"] || r["VM Code"] || ""),
            serverCode: String(r["Server"] || r["server"] || r["Server Code"] || ""),
            status: (String(r["Status"] || "NEW").toUpperCase().replace(/ /g, "_")) as any,
            sdkId: r["SDK ID"] || r["sdkId"] ? String(r["SDK ID"] || r["sdkId"]) : undefined,
            notes: r["Notes"] ? String(r["Notes"]) : undefined,
          }));
          const result = await bulkImport.mutateAsync({ projectId: projectId!, items });
          toast.success(`Imported: ${result.imported}, Skipped: ${result.skipped}${result.errors.length ? ' | Errors: ' + result.errors.join(', ') : ''}`);
          refetch();
        }}
      />
    </div>
  );
}
