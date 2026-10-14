"use client";

import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/StatCard";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

const serverStatusColors: Record<string, string> = {
  BUILDING: "bg-blue-100 text-blue-800",
  ACTIVE: "bg-green-100 text-green-800",
  SUSPENDED: "bg-red-100 text-red-800",
  EXPIRED: "bg-gray-100 text-gray-800",
  MAINTENANCE: "bg-yellow-100 text-yellow-800",
};

const vmStatusColors: Record<string, string> = {
  OK: "bg-green-100 text-green-800",
  ERROR: "bg-red-100 text-red-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  NEW: "bg-blue-100 text-blue-800",
  NOT_CONNECTED: "bg-orange-100 text-orange-800",
  NOT_AVC: "bg-purple-100 text-purple-800",
  BLOCKED: "bg-red-100 text-red-800",
};

export default function ServerDetailPage() {
  const params = useParams();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data: server, isLoading } = trpc.server.getById.useQuery(
    { projectId: projectId!, id: params.id as string },
    { enabled: !!projectId && !!params.id }
  );

  if (!projectId) return <p className="text-gray-500 p-8">Select a project.</p>;
  if (isLoading) return <p className="p-8">Loading...</p>;
  if (!server) return <p className="p-8">Server not found.</p>;

  const vmsByStatus = server.vms.reduce((acc, vm) => {
    acc[vm.status] = (acc[vm.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{server.code}</h1>
        <p className="text-gray-500">{server.ipAddress} - {server.provider}</p>
      </div>

      <div className="flex gap-2">
        <Badge className={serverStatusColors[server.status] ?? "bg-gray-100 text-gray-800"}>{server.status}</Badge>
        {server.cpu && <Badge variant="outline">{server.cpu}</Badge>}
        {server.ram && <Badge variant="outline">{server.ram}</Badge>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Total VMs" value={server.vms.length} />
        {Object.entries(vmsByStatus).map(([status, count]) => (
          <StatCard key={status} title={status} value={count} />
        ))}
      </div>

      {/* VMs Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Code</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">SDK ID</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Earn Total</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">24h</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Proxy</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Gmail</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">PayPal</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {server.vms.map((vm) => (
              <tr key={vm.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-medium">{vm.code}</td>
                <td className="px-4 py-2">
                  <Badge className={`text-xs ${vmStatusColors[vm.status] ?? ""}`}>{vm.status}</Badge>
                </td>
                <td className="px-4 py-2 text-xs text-gray-500 max-w-[120px] truncate">{vm.sdkId ?? "—"}</td>
                <td className="px-4 py-2">${Number(vm.earnTotal ?? 0).toFixed(2)}</td>
                <td className="px-4 py-2">${Number(vm.earn24h ?? 0).toFixed(2)}</td>
                <td className="px-4 py-2 text-xs">{vm.proxy?.address?.split(":")[0] ?? "—"}</td>
                <td className="px-4 py-2 text-xs">{vm.gmail?.email ?? "—"}</td>
                <td className="px-4 py-2 text-xs">{vm.gmail?.paypal?.code ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
