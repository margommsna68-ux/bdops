"use client";

import Link from "next/link";
import { StatCard } from "@/components/dashboard/StatCard";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

const PIE_COLORS = ["#22c55e", "#eab308", "#ef4444", "#6b7280", "#3b82f6", "#8b5cf6", "#f97316"];

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

  // Prepare chart data
  const ppChartData = data?.ppHealth?.map((s) => ({
    name: s.status,
    value: s.count,
  })) ?? [];

  const vmChartData = data?.vmStatus?.map((v) => ({
    name: v.status,
    value: v.count,
  })) ?? [];

  const financialData = data ? [
    { name: "Funds Received", value: Number(data.totalFundsReceived ?? 0) },
    { name: "Exchanged", value: Number(data.totalExchangeWithdrawals ?? 0) },
    { name: "Unsold PP", value: data.unsoldBalance ?? 0 },
    { name: "Master PP", value: data.masterBalance ?? 0 },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500">Overview of operations</p>
        </div>
        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          <Link href="/funds" className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors">
            + Add Fund
          </Link>
          <Link href="/withdrawals" className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors">
            + Withdrawal
          </Link>
          <Link href="/paypals" className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 transition-colors">
            PayPals
          </Link>
        </div>
      </div>

      {/* Alerts */}
      {!isLoading && data && (
        <div className="flex flex-col gap-2">
          {(data.unconfirmedFunds ?? 0) > 0 && (
            <Link href="/funds" className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 hover:bg-yellow-100 transition-colors">
              <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0 animate-pulse" />
              <span className="text-sm font-medium text-yellow-800">{data.unconfirmedFunds} unconfirmed fund transactions need review</span>
              <span className="ml-auto text-xs text-yellow-600">View &rarr;</span>
            </Link>
          )}
          {data.ppHealth.some((s) => s.status === "LIMITED" && s.count > 0) && (
            <Link href="/paypals" className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 hover:bg-orange-100 transition-colors">
              <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
              <span className="text-sm font-medium text-orange-800">
                {data.ppHealth.find((s) => s.status === "LIMITED")?.count} PayPal accounts LIMITED
              </span>
              <span className="ml-auto text-xs text-orange-600">View &rarr;</span>
            </Link>
          )}
          {data.vmStatus.some((v) => v.status === "ERROR" && v.count > 0) && (
            <Link href="/infrastructure/vms" className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 hover:bg-red-100 transition-colors">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <span className="text-sm font-medium text-red-800">
                {data.vmStatus.find((v) => v.status === "ERROR")?.count} VMs in ERROR state
              </span>
              <span className="ml-auto text-xs text-red-600">View &rarr;</span>
            </Link>
          )}
        </div>
      )}

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

      {/* Financial Overview Chart */}
      {financialData.some(d => d.value > 0) && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Financial Overview</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={financialData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value) => [`$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "Amount"]} />
              <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PayPal Health Chart */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            PayPal Account Health
          </h2>
          {ppChartData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={ppChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ value }) => `${value}`}>
                    {ppChartData.map((_entry, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2">
                {data?.ppHealth.map((s) => (
                  <Badge key={s.status} variant="outline" className={`text-sm px-3 py-1.5 ${ppStatusColor[s.status] ?? ""}`}>
                    {s.status}: {s.count}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No PayPal accounts yet.</p>
          )}
        </div>

        {/* VM Status Chart */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Infrastructure Status
          </h2>
          {vmChartData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={vmChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ value }) => `${value}`}>
                    {vmChartData.map((_entry, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2">
                {data?.vmStatus.map((v) => (
                  <Badge key={v.status} variant="outline" className={`text-sm px-3 py-1.5 ${vmStatusColor[v.status] ?? ""}`}>
                    {v.status}: {v.count}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No VMs yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
