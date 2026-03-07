"use client";

import { StatCard } from "@/components/dashboard/StatCard";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";

export default function DashboardPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data, isLoading } = trpc.dashboard.overview.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Select a project to view dashboard.</p>
      </div>
    );
  }

  const ppStatusColor: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-800",
    LIMITED: "bg-yellow-100 text-yellow-800",
    SUSPENDED: "bg-red-100 text-red-800",
    CLOSED: "bg-gray-100 text-gray-800",
    PENDING_VERIFY: "bg-blue-100 text-blue-800",
  };

  const vmStatusColor: Record<string, string> = {
    OK: "bg-green-100 text-green-800",
    ERROR: "bg-red-100 text-red-800",
    SUSPENDED: "bg-yellow-100 text-yellow-800",
    NEW: "bg-blue-100 text-blue-800",
    NOT_CONNECTED: "bg-orange-100 text-orange-800",
    NOT_AVC: "bg-purple-100 text-purple-800",
    BLOCKED: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500">Overview of operations</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Today's Funds Received"
          value={isLoading ? "..." : formatCurrency(Number(data?.todayFunds.amount ?? 0))}
          subtitle={`${data?.todayFunds.count ?? 0} transactions`}
        />
        <StatCard
          title="Today's Withdrawals"
          value={isLoading ? "..." : formatCurrency(Number(data?.todayWithdrawals.amount ?? 0))}
          subtitle={`${data?.todayWithdrawals.count ?? 0} transactions`}
        />
        <StatCard
          title="Total Funds Received"
          value={isLoading ? "..." : formatCurrency(Number(data?.totalFundsReceived ?? 0))}
          subtitle="All time"
        />
        <StatCard
          title="Unconfirmed Funds"
          value={isLoading ? "..." : String(data?.unconfirmedFunds ?? 0)}
          subtitle="Needs review"
          trend={data?.unconfirmedFunds ? "down" : "neutral"}
        />
      </div>

      {/* Financial Balance */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Unsold PP Balance"
          value={isLoading ? "..." : formatCurrency(data?.unsoldBalance ?? 0)}
          subtitle="Funds not yet mixed"
        />
        <StatCard
          title="Master PP Balance"
          value={isLoading ? "..." : formatCurrency(data?.masterBalance ?? 0)}
          subtitle="Mixed but not exchanged"
        />
        <StatCard
          title="Total Exchanged"
          value={isLoading ? "..." : formatCurrency(Number(data?.totalExchangeWithdrawals ?? 0))}
          subtitle="Sold to agents"
        />
      </div>

      {/* PayPal Health */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          PayPal Account Health
        </h2>
        <div className="flex flex-wrap gap-3">
          {data?.ppHealth.length ? (
            data.ppHealth.map((s) => (
              <Badge key={s.status} variant="outline" className={`text-base px-4 py-2 ${ppStatusColor[s.status] ?? ""}`}>
                {s.status}: {s.count}
              </Badge>
            ))
          ) : (
            <p className="text-sm text-gray-500">No PayPal accounts yet.</p>
          )}
        </div>
      </div>

      {/* VM Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Infrastructure Status
        </h2>
        <div className="flex flex-wrap gap-3">
          {data?.vmStatus.length ? (
            data.vmStatus.map((v) => (
              <Badge key={v.status} variant="outline" className={`text-base px-4 py-2 ${vmStatusColor[v.status] ?? ""}`}>
                {v.status}: {v.count}
              </Badge>
            ))
          ) : (
            <p className="text-sm text-gray-500">No VMs yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
