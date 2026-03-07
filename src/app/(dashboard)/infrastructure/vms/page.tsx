"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { ImportExcelDialog } from "@/components/forms/ImportExcelDialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

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
    { key: "server", header: "Server", render: (item) => item.server?.code ?? "—" },
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
      render: (item) => (
        <span className="text-xs">{item.proxy?.address?.split(":")[0] ?? "—"}</span>
      ),
    },
    {
      key: "gmail",
      header: "Gmail",
      render: (item) => <span className="text-xs">{item.gmail?.email ?? "—"}</span>,
    },
  ];

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Virtual Machines</h1>
          <p className="text-gray-500">VM status, SDK, earn tracking</p>
        </div>
        <div className="flex gap-2">
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

      <DataTable
        columns={columns}
        data={data?.items ?? []}
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
          alert(`Imported: ${result.imported}, Skipped: ${result.skipped}${result.errors.length ? '\nErrors: ' + result.errors.join(', ') : ''}`);
          refetch();
        }}
      />
    </div>
  );
}
