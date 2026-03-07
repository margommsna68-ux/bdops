"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { ProxyAssignDialog } from "@/components/forms/ProxyAssignDialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

const statusColors: Record<string, string> = {
  AVAILABLE: "bg-green-100 text-green-800",
  IN_USE: "bg-blue-100 text-blue-800",
  BLOCKED: "bg-red-100 text-red-800",
  RESERVED: "bg-yellow-100 text-yellow-800",
};

export default function ProxiesPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [showAssign, setShowAssign] = useState(false);

  const { data, isLoading, refetch } = trpc.proxy.list.useQuery(
    {
      projectId: projectId!,
      page,
      status: (statusFilter || undefined) as any,
    },
    { enabled: !!projectId }
  );

  const { data: counts } = trpc.proxy.statusCounts.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const autoAssign = trpc.proxy.autoAssign.useMutation({
    onSuccess: (result) => {
      alert(result.message);
      refetch();
    },
  });

  const columns: Column<any>[] = [
    {
      key: "address",
      header: "Address",
      render: (item) => <span className="text-xs font-mono">{item.address}</span>,
    },
    { key: "subnet", header: "Subnet" },
    {
      key: "status",
      header: "Status",
      render: (item) => <Badge className={`text-xs ${statusColors[item.status] ?? ""}`}>{item.status}</Badge>,
    },
    {
      key: "vm",
      header: "Assigned VM",
      render: (item) => item.vm?.code ?? "—",
    },
  ];

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  const countMap = Object.fromEntries(
    (counts ?? []).map((c) => [c.status, c._count])
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proxy IPs</h1>
          <p className="text-gray-500">Residential proxy inventory and assignment</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowAssign(true)}>
            Manual Assign
          </Button>
          <Button
            className="bg-green-600 hover:bg-green-700"
            onClick={() => autoAssign.mutate({ projectId: projectId! })}
            disabled={autoAssign.isLoading}
          >
            {autoAssign.isLoading ? "Assigning..." : "Auto-Assign to VMs"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(["AVAILABLE", "IN_USE", "BLOCKED", "RESERVED"] as const).map((s) => (
          <div key={s} className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <p className={`text-2xl font-bold ${
              s === "AVAILABLE" ? "text-green-600" :
              s === "IN_USE" ? "text-blue-600" :
              s === "BLOCKED" ? "text-red-600" : "text-yellow-600"
            }`}>
              {countMap[s] ?? 0}
            </p>
            <p className="text-sm text-gray-500">{s}</p>
          </div>
        ))}
      </div>

      {/* Filter buttons */}
      <div className="flex gap-2">
        <Button
          variant={statusFilter === "" ? "default" : "outline"}
          size="sm"
          onClick={() => { setStatusFilter(""); setPage(1); }}
        >
          All
        </Button>
        {["AVAILABLE", "IN_USE", "BLOCKED", "RESERVED"].map((s) => (
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
        emptyMessage="No proxies yet."
      />

      <ProxyAssignDialog
        open={showAssign}
        onClose={() => setShowAssign(false)}
        onSuccess={() => refetch()}
      />
    </div>
  );
}
