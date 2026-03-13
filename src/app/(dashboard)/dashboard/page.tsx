"use client";

import Link from "next/link";
import { StatCard } from "@/components/dashboard/StatCard";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

const PIE_COLORS = ["#22c55e", "#eab308", "#ef4444", "#6b7280", "#3b82f6", "#8b5cf6", "#f97316"];

export default function DashboardPage() {
  const t = useT();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data, isLoading } = trpc.dashboard.overview.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">{t("dash_select_project")}</p>
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

  const ppChartData = data?.ppHealth?.map((s) => ({
    name: s.status,
    value: s.count,
  })) ?? [];

  const vmChartData = data?.vmStatus?.map((v) => ({
    name: v.status,
    value: v.count,
  })) ?? [];

  const financialData = data ? [
    { name: t("dash_total_funds"), value: Number(data.totalFundsReceived ?? 0) },
    { name: t("dash_total_exchanged"), value: Number(data.totalExchangeWithdrawals ?? 0) },
    { name: t("dash_unsold_pp"), value: data.unsoldBalance ?? 0 },
    { name: t("dash_master_pp"), value: data.masterBalance ?? 0 },
  ] : [];

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{t("dash_title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("dash_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/funds" className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
            {t("dash_add_fund")}
          </Link>
          <Link href="/withdrawals" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            {t("dash_withdrawal")}
          </Link>
          <Link href="/paypals" className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors">
            {t("dash_paypals")}
          </Link>
        </div>
      </div>

      {/* ── Alerts ── */}
      {!isLoading && data && (
        <div className="flex flex-col gap-2">
          {(data.unconfirmedFunds ?? 0) > 0 && (
            <Link href="/funds" className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 hover:bg-yellow-100 transition-colors">
              <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0 animate-pulse" />
              <span className="text-sm font-medium text-yellow-800">{data.unconfirmedFunds} {t("dash_unconfirmed_alert")}</span>
              <span className="ml-auto text-xs text-yellow-600">{t("dash_view")} &rarr;</span>
            </Link>
          )}
          {data.ppHealth.some((s) => s.status === "LIMITED" && s.count > 0) && (
            <Link href="/paypals" className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 hover:bg-orange-100 transition-colors">
              <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
              <span className="text-sm font-medium text-orange-800">
                {data.ppHealth.find((s) => s.status === "LIMITED")?.count} {t("dash_limited_alert")}
              </span>
              <span className="ml-auto text-xs text-orange-600">{t("dash_view")} &rarr;</span>
            </Link>
          )}
          {data.vmStatus.some((v) => v.status === "ERROR" && v.count > 0) && (
            <Link href="/infrastructure/vms" className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 hover:bg-red-100 transition-colors">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <span className="text-sm font-medium text-red-800">
                {data.vmStatus.find((v) => v.status === "ERROR")?.count} {t("dash_error_alert")}
              </span>
              <span className="ml-auto text-xs text-red-600">{t("dash_view")} &rarr;</span>
            </Link>
          )}
        </div>
      )}

      {/* ── Key Metrics ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          title={t("dash_today_funds")}
          value={isLoading ? "..." : formatCurrency(Number(data?.todayFunds.amount ?? 0))}
          subtitle={`${data?.todayFunds.count ?? 0} ${t("dash_transactions")}`}
          trend="up"
        />
        <StatCard
          title={t("dash_today_wd")}
          value={isLoading ? "..." : formatCurrency(Number(data?.todayWithdrawals.amount ?? 0))}
          subtitle={`${data?.todayWithdrawals.count ?? 0} ${t("dash_transactions")}`}
        />
        <StatCard
          title={t("dash_total_funds")}
          value={isLoading ? "..." : formatCurrency(Number(data?.totalFundsReceived ?? 0))}
          subtitle={t("all_time")}
        />
        <StatCard
          title={t("dash_unconfirmed")}
          value={isLoading ? "..." : String(data?.unconfirmedFunds ?? 0)}
          subtitle={t("dash_needs_review")}
          trend={data?.unconfirmedFunds ? "down" : "neutral"}
        />
      </div>

      {/* ── Financial Balance ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <StatCard
          title={t("dash_unsold_pp")}
          value={isLoading ? "..." : formatCurrency(data?.unsoldBalance ?? 0)}
          subtitle={t("dash_not_mixed")}
        />
        <StatCard
          title={t("dash_master_pp")}
          value={isLoading ? "..." : formatCurrency(data?.masterBalance ?? 0)}
          subtitle={t("dash_not_exchanged")}
        />
        <StatCard
          title={t("dash_total_exchanged")}
          value={isLoading ? "..." : formatCurrency(Number(data?.totalExchangeWithdrawals ?? 0))}
          subtitle={t("dash_sold_agents")}
        />
      </div>

      {/* ── Financial Chart ── */}
      {financialData.some(d => d.value > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-md p-6">
          <h2 className="text-base font-medium text-gray-900 mb-5">{t("dash_financial")}</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={financialData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--ds-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--ds-text-secondary)" }} axisLine={{ stroke: "var(--ds-border)" }} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "var(--ds-text-secondary)" }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} axisLine={{ stroke: "var(--ds-border)" }} tickLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: "var(--ds-card)", borderColor: "var(--ds-border)", borderRadius: 8, color: "var(--ds-text-primary)" }}
                labelStyle={{ color: "var(--ds-text-secondary)" }}
                formatter={(value) => [`$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "Amount"]}
              />
              <Bar dataKey="value" fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Status Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PayPal Health */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-md p-6">
          <h2 className="text-base font-medium text-gray-900 mb-5">{t("dash_pp_health")}</h2>
          {ppChartData.length > 0 ? (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={ppChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ value }) => `${value}`}>
                    {ppChartData.map((_entry, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "var(--ds-card)", borderColor: "var(--ds-border)", borderRadius: 8, color: "var(--ds-text-primary)" }} />
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
            <p className="text-sm text-gray-500">{t("dash_no_pp")}</p>
          )}
        </div>

        {/* VM Status */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-md p-6">
          <h2 className="text-base font-medium text-gray-900 mb-5">{t("dash_infra")}</h2>
          {vmChartData.length > 0 ? (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={vmChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ value }) => `${value}`}>
                    {vmChartData.map((_entry, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "var(--ds-card)", borderColor: "var(--ds-border)", borderRadius: 8, color: "var(--ds-text-primary)" }} />
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
            <p className="text-sm text-gray-500">{t("dash_no_vm")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
