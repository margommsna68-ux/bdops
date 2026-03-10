"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

const serverStatusColors: Record<string, string> = {
  BUILDING: "bg-blue-100 text-blue-800",
  ACTIVE: "bg-green-100 text-green-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  EXPIRED: "bg-gray-100 text-gray-800",
  MAINTENANCE: "bg-orange-100 text-orange-800",
};

const vmStatusColors: Record<string, string> = {
  OK: "bg-green-100 text-green-800",
  ERROR: "bg-red-100 text-red-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  NEW: "bg-blue-100 text-blue-800",
  NOT_CONNECTED: "bg-orange-100 text-orange-800",
  NOT_AVC: "bg-purple-100 text-purple-800",
  BLOCKED: "bg-red-200 text-red-900",
};

const ALL_VM_STATUSES = ["OK", "ERROR", "SUSPENDED", "NEW", "NOT_CONNECTED", "NOT_AVC", "BLOCKED"];

export default function ServersPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [vmStatusFilter, setVmStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Server list
  const { data: servers, isLoading } = trpc.server.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  // Selected server detail
  const { data: serverDetail, isLoading: detailLoading } = trpc.server.getById.useQuery(
    { projectId: projectId!, id: selectedServerId! },
    { enabled: !!projectId && !!selectedServerId }
  );

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  // Filter VMs in detail view
  const filteredVMs = serverDetail?.vms?.filter((vm: any) => {
    if (vmStatusFilter && vm.status !== vmStatusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        vm.code.toLowerCase().includes(q) ||
        (vm.sdkId && vm.sdkId.toLowerCase().includes(q)) ||
        (vm.proxy?.address && vm.proxy.address.toLowerCase().includes(q)) ||
        (vm.gmail?.email && vm.gmail.email.toLowerCase().includes(q))
      );
    }
    return true;
  }) ?? [];

  // VM status breakdown for selected server
  const vmStatusCounts: Record<string, number> = {};
  serverDetail?.vms?.forEach((vm: any) => {
    vmStatusCounts[vm.status] = (vmStatusCounts[vm.status] || 0) + 1;
  });

  const totalEarn24h = serverDetail?.vms?.reduce((sum: number, vm: any) => sum + Number(vm.earn24h ?? 0), 0) ?? 0;
  const totalEarnAll = serverDetail?.vms?.reduce((sum: number, vm: any) => sum + Number(vm.earnTotal ?? 0), 0) ?? 0;

  // Filter servers by search
  const filteredServers = servers?.filter((s: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.code.toLowerCase().includes(q) || (s.ipAddress && s.ipAddress.toLowerCase().includes(q));
  }) ?? [];

  return (
    <div className="flex h-[calc(100vh-5rem)] gap-0">
      {/* Left Panel - Server List */}
      <div className="w-72 xl:w-80 border-r border-gray-200 bg-white flex flex-col shrink-0">
        <div className="p-3 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900 mb-2">Servers</h2>
          <Input
            placeholder="Search servers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {/* Server summary */}
        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 text-xs text-gray-500 flex justify-between">
          <span>{servers?.length ?? 0} servers</span>
          <span>{servers?.reduce((s: number, sv: any) => s + (sv._count?.vms ?? 0), 0) ?? 0} total VMs</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="p-4 text-gray-400 text-sm">Loading...</p>
          ) : filteredServers.length === 0 ? (
            <p className="p-4 text-gray-400 text-sm">No servers found.</p>
          ) : (
            filteredServers.map((server: any) => {
              const vmCount = server._count?.vms ?? 0;
              const isSelected = selectedServerId === server.id;
              return (
                <div
                  key={server.id}
                  onClick={() => setSelectedServerId(server.id)}
                  className={`px-3 py-2.5 border-b border-gray-50 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-blue-50 border-l-2 border-l-blue-500"
                      : "hover:bg-gray-50 border-l-2 border-l-transparent"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm text-gray-900">{server.code}</span>
                    <Badge className={`text-[10px] px-1.5 py-0 ${serverStatusColors[server.status] ?? ""}`}>
                      {server.status}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-500">{server.ipAddress ?? "No IP"}</span>
                    <span className="text-xs text-gray-500">{vmCount} VMs</span>
                  </div>
                  {server.provider && (
                    <span className="text-[10px] text-gray-400">{server.provider}</span>
                  )}
                  {/* Mini VM health bar */}
                  {vmCount > 0 && (
                    <div className="mt-1.5 h-1 bg-gray-200 rounded-full overflow-hidden flex">
                      {/* We'll show a simple bar based on vmCount */}
                      <div className="h-full bg-green-400 rounded-full" style={{ width: "100%" }} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Panel - Server Detail + VMs */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
        {!selectedServerId ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
              </svg>
              <p className="text-sm">Select a server to view details</p>
            </div>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <p>Loading server details...</p>
          </div>
        ) : serverDetail ? (
          <>
            {/* Server Info Header */}
            <div className="bg-white border-b border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-gray-900">{serverDetail.code}</h2>
                    <Badge className={serverStatusColors[serverDetail.status] ?? ""}>{serverDetail.status}</Badge>
                    {serverDetail.cpu && <Badge variant="outline" className="text-xs">{serverDetail.cpu}</Badge>}
                    {serverDetail.ram && <Badge variant="outline" className="text-xs">{serverDetail.ram}</Badge>}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {serverDetail.ipAddress ?? "No IP"} {serverDetail.provider ? `- ${serverDetail.provider}` : ""}
                  </p>
                </div>
              </div>

              {/* Stats Row */}
              <div className="flex gap-4 mt-3 flex-wrap">
                <div className="bg-gray-50 rounded-lg px-3 py-2 min-w-[100px]">
                  <p className="text-[10px] font-medium text-gray-500 uppercase">Total VMs</p>
                  <p className="text-xl font-bold text-gray-900">{serverDetail.vms.length}</p>
                </div>
                <div className="bg-green-50 rounded-lg px-3 py-2 min-w-[100px]">
                  <p className="text-[10px] font-medium text-green-600 uppercase">Earn 24h</p>
                  <p className="text-xl font-bold text-green-700">${totalEarn24h.toFixed(2)}</p>
                </div>
                <div className="bg-blue-50 rounded-lg px-3 py-2 min-w-[100px]">
                  <p className="text-[10px] font-medium text-blue-600 uppercase">Total Earn</p>
                  <p className="text-xl font-bold text-blue-700">${totalEarnAll.toFixed(2)}</p>
                </div>
                {/* Status breakdown pills */}
                {Object.entries(vmStatusCounts).map(([status, count]) => (
                  <div
                    key={status}
                    onClick={() => setVmStatusFilter(vmStatusFilter === status ? "" : status)}
                    className={`rounded-lg px-3 py-2 min-w-[70px] cursor-pointer transition-all ${
                      vmStatusFilter === status ? "ring-2 ring-blue-500" : ""
                    }`}
                    style={{ backgroundColor: vmStatusFilter === status ? "#eff6ff" : "#f9fafb" }}
                  >
                    <p className="text-[10px] font-medium text-gray-500 uppercase">{status}</p>
                    <p className="text-xl font-bold text-gray-900">{count}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* VM Filter Bar */}
            <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-gray-500">Filter:</span>
              <Button
                size="sm"
                variant={vmStatusFilter === "" ? "default" : "outline"}
                className="h-6 text-xs px-2"
                onClick={() => setVmStatusFilter("")}
              >
                ALL ({serverDetail.vms.length})
              </Button>
              {ALL_VM_STATUSES.map((s) => {
                const cnt = vmStatusCounts[s] ?? 0;
                if (cnt === 0) return null;
                return (
                  <Button
                    key={s}
                    size="sm"
                    variant={vmStatusFilter === s ? "default" : "outline"}
                    className="h-6 text-xs px-2"
                    onClick={() => setVmStatusFilter(vmStatusFilter === s ? "" : s)}
                  >
                    {s} ({cnt})
                  </Button>
                );
              })}
              <div className="ml-auto">
                <Input
                  placeholder="Search VM..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7 text-xs w-48"
                />
              </div>
            </div>

            {/* VMs Table */}
            <div className="flex-1 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">#</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">VM Code</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">SDK ID</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">Earn Total</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">24h</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Proxy IP</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Gmail</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">PayPal</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Uptime</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {filteredVMs.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-8 text-gray-400 text-sm">
                        {vmStatusFilter ? "No VMs with this status" : "No VMs on this server"}
                      </td>
                    </tr>
                  ) : (
                    filteredVMs.map((vm: any, idx: number) => (
                      <tr key={vm.id} className="hover:bg-blue-50/30 transition-colors group">
                        <td className="px-3 py-1.5 text-xs text-gray-400">{idx + 1}</td>
                        <td className="px-3 py-1.5 font-medium text-gray-900">{vm.code}</td>
                        <td className="px-3 py-1.5">
                          <Badge className={`text-[10px] px-1.5 py-0 ${vmStatusColors[vm.status] ?? ""}`}>
                            {vm.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-500 max-w-[120px] truncate font-mono">
                          {vm.sdkId ? vm.sdkId.slice(0, 16) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium">
                          ${Number(vm.earnTotal ?? 0).toFixed(2)}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-medium ${
                          Number(vm.earn24h ?? 0) > 0 ? "text-green-600" : "text-gray-400"
                        }`}>
                          ${Number(vm.earn24h ?? 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-1.5 text-xs font-mono">
                          {vm.proxy ? (
                            <span className="text-blue-600">{vm.proxy.address?.split(":")[0]}</span>
                          ) : (
                            <span className="text-orange-400">No proxy</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {vm.gmail?.email ? (
                            <span className="text-gray-700">{vm.gmail.email.split("@")[0]}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-500">
                          {vm.gmail?.paypal?.code ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-500">
                          {vm.uptime ?? "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
