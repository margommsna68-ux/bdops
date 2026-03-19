"use client";

import Link from "next/link";
import { StatCard } from "@/components/dashboard/StatCard";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";

const PIE_COLORS = ["#22c55e", "#eab308", "#ef4444", "#6b7280", "#3b82f6", "#8b5cf6", "#f97316"];

export default function DashboardPage() {
  const t = useT();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const currentRole = useProjectStore((s) => s.currentRole);
  const currentModules = useProjectStore((s) => s.currentModules);

  const isAdminOrMod = currentRole === "ADMIN" || currentRole === "MODERATOR";
  const hasModule = (mod: string) => isAdminOrMod || currentModules.includes(mod);

  const showFunds = hasModule("FUNDS");
  const showWithdrawals = hasModule("WITHDRAWALS");
  const showPaypals = hasModule("PAYPALS");
  const showInfra = hasModule("INFRASTRUCTURE");
  const showAgentPP = hasModule("AGENT_PP");
  const showFinance = showFunds || showWithdrawals;

  const { data, isLoading } = trpc.dashboard.overview.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && (showFinance || showPaypals || showInfra) }
  );

  const { data: agentStats, isLoading: agentLoading } = trpc.agentPP.dashboardStats.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && showAgentPP }
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

  const ppChartData = data?.ppHealth?.map((s) => ({ name: s.status, value: s.count })) ?? [];
  const vmChartData = data?.vmStatus?.map((v) => ({ name: v.status, value: v.count })) ?? [];

  const quickActions = [
    ...(showFunds ? [{ href: "/funds", label: t("dash_add_fund"), color: "bg-green-600 hover:bg-green-700" }] : []),
    ...(showWithdrawals ? [{ href: "/withdrawals", label: t("dash_withdrawal"), color: "bg-blue-600 hover:bg-blue-700" }] : []),
    ...(showPaypals ? [{ href: "/paypals", label: t("dash_paypals"), color: "bg-purple-600 hover:bg-purple-700" }] : []),
    ...(showAgentPP ? [{ href: "/agent-pp", label: t("agd_go_agent_pp"), color: "bg-orange-600 hover:bg-orange-700" }] : []),
  ];

  // Agent donut chart data
  const agentTxChartData = agentStats ? [
    { name: t("agd_confirmed"), value: agentStats.confirmedCount, color: "#22c55e" },
    { name: t("agd_pending"), value: agentStats.pendingCount, color: "#eab308" },
    { name: t("agd_disputed"), value: agentStats.disputedCount, color: "#ef4444" },
  ].filter(d => d.value > 0) : [];

  // Money flow data
  const totalReceived = Number(data?.totalFundsReceived ?? 0);
  const unsoldBalance = data?.unsoldBalance ?? 0;
  const masterBalance = data?.masterBalance ?? 0;
  const totalExchanged = Number(data?.totalExchangeWithdrawals ?? 0);

  // 7-day trend
  const fundsLabel = t("dash_funds_label");
  const wdLabel = t("dash_wd_label");
  const trendData = (data?.trend ?? []).map((d) => ({
    date: d.date.slice(5), // "MM-DD"
    funds: d.funds,
    withdrawals: d.withdrawals,
  }));

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{t("dash_title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("dash_subtitle")}</p>
        </div>
        {quickActions.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {quickActions.map((a) => (
              <Link key={a.href} href={a.href} className={`px-4 py-2 ${a.color} text-white rounded-lg text-sm font-medium transition-colors`}>
                {a.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ══════════ ADMIN / OPERATOR DASHBOARD ══════════ */}

      {/* ── Alerts (Agent PP alerts shown here too — always on top) ── */}
      {showAgentPP && agentStats && (agentStats.pendingCount > 0 || agentStats.disputedCount > 0) && (
        <div className="flex flex-col gap-2">
          {agentStats.pendingCount > 0 && (
            <Link href="/agent-pp" className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 hover:bg-yellow-100 transition-colors">
              <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0 animate-pulse" />
              <span className="text-sm font-medium text-yellow-800">{agentStats.pendingCount} {t("agd_transactions")} {t("agd_pending").toLowerCase()}</span>
              <span className="ml-auto text-xs text-yellow-600">{t("dash_view")} &rarr;</span>
            </Link>
          )}
          {agentStats.disputedCount > 0 && (
            <Link href="/agent-pp" className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 hover:bg-red-100 transition-colors">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse" />
              <span className="text-sm font-medium text-red-800">{agentStats.disputedCount} {t("agd_disputed").toLowerCase()}</span>
              <span className="ml-auto text-xs text-red-600">{t("dash_view")} &rarr;</span>
            </Link>
          )}
        </div>
      )}

      {/* ── Alerts ── */}
      {!isLoading && data && (
        <div className="flex flex-col gap-2">
          {showFunds && (data.unconfirmedFunds ?? 0) > 0 && (
            <Link href="/funds" className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 hover:bg-yellow-100 transition-colors">
              <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0 animate-pulse" />
              <span className="text-sm font-medium text-yellow-800">{data.unconfirmedFunds} {t("dash_unconfirmed_alert")}</span>
              <span className="ml-auto text-xs text-yellow-600">{t("dash_view")} &rarr;</span>
            </Link>
          )}
          {showPaypals && data.ppHealth.some((s) => s.status === "LIMITED" && s.count > 0) && (
            <Link href="/paypals" className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 hover:bg-orange-100 transition-colors">
              <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
              <span className="text-sm font-medium text-orange-800">
                {data.ppHealth.find((s) => s.status === "LIMITED")?.count} {t("dash_limited_alert")}
              </span>
              <span className="ml-auto text-xs text-orange-600">{t("dash_view")} &rarr;</span>
            </Link>
          )}
          {showInfra && data.vmStatus.some((v) => v.status === "ERROR" && v.count > 0) && (
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

      {/* ── Money Flow Hero ── */}
      {showFinance && !isLoading && data && (
        <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 rounded-2xl shadow-lg overflow-hidden">
          <div className="px-6 py-5">
            <h2 className="text-blue-100 text-sm font-medium mb-4">{t("dash_money_flow")}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Total Received */}
              {showFunds && (
                <div className="relative">
                  <p className="text-blue-200 text-[11px] font-medium uppercase tracking-wide">{t("dash_received")}</p>
                  <p className="text-2xl font-extrabold text-white mt-1">{formatCurrency(totalReceived)}</p>
                  {/* Arrow connector */}
                  <div className="hidden md:block absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10">
                    <svg className="w-5 h-5 text-white/40" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                  </div>
                </div>
              )}
              {/* Unsold Balance */}
              {showWithdrawals && (
                <div className="relative">
                  <p className="text-blue-200 text-[11px] font-medium uppercase tracking-wide">{t("dash_unsold")}</p>
                  <p className="text-2xl font-extrabold text-white mt-1">{formatCurrency(unsoldBalance)}</p>
                  <div className="hidden md:block absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10">
                    <svg className="w-5 h-5 text-white/40" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                  </div>
                </div>
              )}
              {/* Master PP Balance */}
              {showWithdrawals && (
                <div className="relative">
                  <p className="text-blue-200 text-[11px] font-medium uppercase tracking-wide">{t("dash_master")}</p>
                  <p className="text-2xl font-extrabold text-white mt-1">{formatCurrency(masterBalance)}</p>
                  <div className="hidden md:block absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10">
                    <svg className="w-5 h-5 text-white/40" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                  </div>
                </div>
              )}
              {/* Total Exchanged */}
              {showWithdrawals && (
                <div>
                  <p className="text-blue-200 text-[11px] font-medium uppercase tracking-wide">{t("dash_exchanged")}</p>
                  <p className="text-2xl font-extrabold text-white mt-1">{formatCurrency(totalExchanged)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Today's Activity ── */}
      {showFinance && (
        <div className={`grid grid-cols-1 ${showFunds && showWithdrawals ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-2"} gap-5`}>
          {showFunds && (
            <StatCard
              title={t("dash_today_funds")}
              value={isLoading ? "..." : formatCurrency(Number(data?.todayFunds.amount ?? 0))}
              subtitle={`${data?.todayFunds.count ?? 0} ${t("dash_transactions")}`}
              trend="up"
            />
          )}
          {showWithdrawals && (
            <StatCard
              title={t("dash_today_wd")}
              value={isLoading ? "..." : formatCurrency(Number(data?.todayWithdrawals.amount ?? 0))}
              subtitle={`${data?.todayWithdrawals.count ?? 0} ${t("dash_transactions")}`}
            />
          )}
          {showFunds && (
            <StatCard
              title={t("dash_unconfirmed")}
              value={isLoading ? "..." : String(data?.unconfirmedFunds ?? 0)}
              subtitle={t("dash_needs_review")}
              trend={data?.unconfirmedFunds ? "down" : "neutral"}
            />
          )}
          {showFunds && (
            <StatCard
              title={t("dash_total_funds")}
              value={isLoading ? "..." : formatCurrency(totalReceived)}
              subtitle={t("all_time")}
            />
          )}
        </div>
      )}

      {/* ── 7-Day Trend Chart ── */}
      {showFinance && trendData.length > 0 && trendData.some((d) => d.funds > 0 || d.withdrawals > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-md p-6">
          <h2 className="text-base font-medium text-gray-900 mb-5">{t("dash_7day_trend")}</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={trendData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: "#fff", borderColor: "#e5e7eb", borderRadius: 8 }}
                formatter={(value) => [`$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {showFunds && <Bar name={fundsLabel} dataKey="funds" fill="#22c55e" radius={[4, 4, 0, 0]} />}
              {showWithdrawals && <Bar name={wdLabel} dataKey="withdrawals" fill="#3b82f6" radius={[4, 4, 0, 0]} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Status Charts ── */}
      {(showPaypals || showInfra) && (
        <div className={`grid grid-cols-1 ${showPaypals && showInfra ? "lg:grid-cols-2" : ""} gap-6`}>
          {showPaypals && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-md p-6">
              <h2 className="text-base font-medium text-gray-900 mb-5">{t("dash_pp_health")}</h2>
              {ppChartData.length > 0 ? (
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width="50%" height={200}>
                    <PieChart>
                      <Pie data={ppChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ value }) => `${value}`}>
                        {ppChartData.map((_entry, idx) => (<Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-2">
                    {data?.ppHealth.map((s) => (
                      <Badge key={s.status} variant="outline" className={`text-sm px-3 py-1.5 ${ppStatusColor[s.status] ?? ""}`}>{s.status}: {s.count}</Badge>
                    ))}
                  </div>
                </div>
              ) : (<p className="text-sm text-gray-500">{t("dash_no_pp")}</p>)}
            </div>
          )}
          {showInfra && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-md p-6">
              <h2 className="text-base font-medium text-gray-900 mb-5">{t("dash_infra")}</h2>
              {vmChartData.length > 0 ? (
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width="50%" height={200}>
                    <PieChart>
                      <Pie data={vmChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ value }) => `${value}`}>
                        {vmChartData.map((_entry, idx) => (<Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-2">
                    {data?.vmStatus.map((v) => (
                      <Badge key={v.status} variant="outline" className={`text-sm px-3 py-1.5 ${vmStatusColor[v.status] ?? ""}`}>{v.status}: {v.count}</Badge>
                    ))}
                  </div>
                </div>
              ) : (<p className="text-sm text-gray-500">{t("dash_no_vm")}</p>)}
            </div>
          )}
        </div>
      )}

      {/* ══════════ AGENT PP DASHBOARD — only if has data ══════════ */}
      {showAgentPP && agentStats && (agentStats.transactionCount > 0 || agentStats.emails.length > 0 || agentStats.balance > 0) && (
        <>
          {/* Agent Hero Balance */}
          <div className="bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl shadow-lg overflow-hidden">
            <div className="px-6 py-5 flex flex-col md:flex-row md:items-center gap-6">
              <div className="flex-1 text-center md:text-left">
                <p className="text-orange-100 text-sm font-medium">{t("agd_balance")}</p>
                <p className="text-4xl font-extrabold text-white mt-1">
                  {formatCurrency(agentStats.balance)}
                </p>
                <div className="flex items-center gap-4 mt-2 justify-center md:justify-start">
                  <span className="text-orange-100 text-xs">
                    {agentStats.emails.length} email{agentStats.emails.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-orange-200">|</span>
                  <span className="text-orange-100 text-xs">
                    {agentStats.transactionCount} {t("agd_transactions")}
                  </span>
                </div>
              </div>
              <div className="flex gap-4 md:gap-6">
                <div className="bg-white/15 backdrop-blur rounded-xl px-5 py-3 text-center min-w-[120px]">
                  <p className="text-orange-100 text-[11px] font-medium uppercase tracking-wide">{t("agd_total_received")}</p>
                  <p className="text-2xl font-bold text-white mt-0.5">{formatCurrency(agentStats.totalReceived)}</p>
                  <p className="text-orange-200 text-[10px] mt-0.5">{agentStats.transactionCount} GD</p>
                </div>
                <div className="bg-white/15 backdrop-blur rounded-xl px-5 py-3 text-center min-w-[120px]">
                  <p className="text-orange-100 text-[11px] font-medium uppercase tracking-wide">{t("agd_total_sold")}</p>
                  <p className="text-2xl font-bold text-white mt-0.5">{formatCurrency(agentStats.totalSold)}</p>
                  <p className="text-orange-200 text-[10px] mt-0.5">{agentStats.saleCount} GD</p>
                </div>
              </div>
            </div>
          </div>

          {/* Agent Today + Status row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <StatCard
              title={t("agd_today_received")}
              value={formatCurrency(agentStats.todayReceived.amount)}
              subtitle={`${agentStats.todayReceived.count} ${t("agd_transactions")}`}
              trend={agentStats.todayReceived.count > 0 ? "up" : "neutral"}
            />
            <StatCard
              title={t("agd_today_sold")}
              value={formatCurrency(agentStats.todaySold.amount)}
              subtitle={`${agentStats.todaySold.count} ${t("agd_transactions")}`}
            />
            <StatCard
              title={t("agd_pending")}
              value={String(agentStats.pendingCount)}
              subtitle={t("agd_transactions")}
              trend={agentStats.pendingCount > 0 ? "down" : "neutral"}
            />
            <StatCard
              title={t("agd_confirmed")}
              value={String(agentStats.confirmedCount)}
              subtitle={t("agd_transactions")}
            />
          </div>

          {/* Agent Charts + Emails row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Transaction Health Donut */}
            {agentTxChartData.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-md p-6">
                <h2 className="text-base font-medium text-gray-900 mb-4">{t("agd_tx_health")}</h2>
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width="50%" height={180}>
                    <PieChart>
                      <Pie data={agentTxChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} label={({ value }) => `${value}`}>
                        {agentTxChartData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-2">
                    {agentTxChartData.map((d) => (
                      <div key={d.name} className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="text-sm text-gray-700">{d.name}</span>
                        <span className="text-sm font-bold text-gray-900 ml-auto">{d.value}</span>
                      </div>
                    ))}
                    <div className="border-t pt-2 mt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">{t("total")}</span>
                        <span className="text-sm font-bold text-gray-900 ml-auto">{agentStats.transactionCount}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Your PayPal Emails */}
            {agentStats.emails.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-md p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-medium text-gray-900">{t("agd_your_emails")}</h2>
                  <Link href="/agent-pp" className="text-xs text-orange-600 hover:text-orange-700 font-medium">
                    {t("edit")} &rarr;
                  </Link>
                </div>
                <div className="space-y-2">
                  {agentStats.emails.map((em: any) => (
                    <div key={em.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
                      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                        <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{em.email}</p>
                        {em.label && <p className="text-[11px] text-gray-500">{em.label}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Recent Transactions + Recent Sales */}
          {(agentStats.recentTransactions.length > 0 || agentStats.recentSales.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {agentStats.recentTransactions.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-md overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-900">{t("agd_recent_tx")}</h2>
                    <Link href="/agent-pp" className="text-xs text-orange-600 hover:text-orange-700 font-medium">
                      {t("dash_view")} &rarr;
                    </Link>
                  </div>
                  <div className="divide-y">
                    {agentStats.recentTransactions.map((tx: any) => (
                      <div key={tx.id} className="px-5 py-3 flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${
                          tx.agentConfirmed ? "bg-green-500" : tx.agentDisputed ? "bg-red-500" : "bg-yellow-500 animate-pulse"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{formatCurrency(tx.amount)}</span>
                            <span className="text-[10px] text-gray-400">{tx.sourcePaypal?.code}</span>
                          </div>
                          <p className="text-[11px] text-gray-500 truncate">
                            {tx.agentEmail?.email} &middot; {formatDate(tx.date)}
                          </p>
                        </div>
                        <Badge className={`text-[10px] ${
                          tx.agentConfirmed ? "bg-green-100 text-green-700" :
                          tx.agentDisputed ? "bg-red-100 text-red-700" :
                          "bg-yellow-100 text-yellow-700"
                        }`}>
                          {tx.agentConfirmed ? "OK" : tx.agentDisputed ? "!" : "?"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {agentStats.recentSales.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-md overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-900">{t("agd_recent_sales")}</h2>
                    <Link href="/agent-pp" className="text-xs text-orange-600 hover:text-orange-700 font-medium">
                      {t("dash_view")} &rarr;
                    </Link>
                  </div>
                  <div className="divide-y">
                    {agentStats.recentSales.map((sale: any) => (
                      <div key={sale.id} className="px-5 py-3 flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full shrink-0 bg-orange-500" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{formatCurrency(sale.amount)}</span>
                            {sale.exchangeEmail && <span className="text-[10px] text-gray-400 truncate">{sale.exchangeEmail}</span>}
                          </div>
                          <p className="text-[11px] text-gray-500 truncate">
                            {sale.agentEmail?.email} &middot; {formatDate(sale.date)}
                          </p>
                        </div>
                        {sale.transactionId && (
                          <span className="text-[10px] font-mono text-gray-400 max-w-[80px] truncate">{sale.transactionId}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── No modules fallback ── */}
      {!showFinance && !showPaypals && !showInfra && !showAgentPP && !isLoading && !agentLoading && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500 text-sm">{t("dash_subtitle")}</p>
        </div>
      )}
    </div>
  );
}
