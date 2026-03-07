"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

const statusColors: Record<string, string> = {
  BUILDING: "bg-blue-100 text-blue-800",
  ACTIVE: "bg-green-100 text-green-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  EXPIRED: "bg-gray-100 text-gray-800",
  MAINTENANCE: "bg-orange-100 text-orange-800",
};

export default function ServersPage() {
  const router = useRouter();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data, isLoading } = trpc.server.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const columns: Column<any>[] = [
    { key: "code", header: "Code", render: (item) => <span className="font-medium">{item.code}</span> },
    { key: "ipAddress", header: "IP Address" },
    { key: "provider", header: "Provider" },
    { key: "cpu", header: "CPU" },
    { key: "ram", header: "RAM" },
    {
      key: "status",
      header: "Status",
      render: (item) => <Badge className={statusColors[item.status] ?? ""}>{item.status}</Badge>,
    },
    {
      key: "vms",
      header: "VMs",
      render: (item) => <span className="font-semibold">{item._count?.vms ?? 0}</span>,
    },
  ];

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Servers</h1>
        <p className="text-gray-500">Physical server management</p>
      </div>
      <DataTable
        columns={columns}
        data={data ?? []}
        total={data?.length ?? 0}
        isLoading={isLoading}
        emptyMessage="No servers yet."
        onRowClick={(item) => router.push(`/infrastructure/servers/${item.id}`)}
      />
    </div>
  );
}
