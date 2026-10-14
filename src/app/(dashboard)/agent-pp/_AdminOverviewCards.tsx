"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

type Period = "today" | "week" | "month" | "quarter" | "all";

// ─── Skeleton ────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 animate-pulse">
      <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
      <div className="h-8 w-32 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-16 bg-gray-200 rounded" />
    </div>
  );
}

// ─── Change Badge ────────────────────────────────────────────────────────────

function ChangeBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const positive = value >= 0;
  return (
    <span
      className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
        positive
          ? "bg-green-100 text-green-700"
          : "bg-red-100 text-red-600"
      }`}
    >
      {positive ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function AdminOverviewCards({ projectId }: { projectId: string }) {
  const t = useT();
  const [period, setPeriod] = useState<Period>("all");

  const { data, isLoading, isError } = trpc.agentPP.adminDashboard.useQuery(
    { projectId, period },
    { enabled: !!projectId, refetchInterval: 60_000 },
  );

  const periods: { key: Period; label: string }[] = [
    { key: "today", label: t("today") },
    { key: "week", label: t("week") },
    { key: "month", label: t("month") },
    { key: "quarter", label: t("agpp_quarter") },
    { key: "all", label: t("all") },
  ];

  const cur = data?.current;
  const changes = data?.changes;

  const cards: {
    label: string;
    value: number;
    accent: string;
    change: number | null | undefined;
    gradient?: boolean;
  }[] = cur
    ? [
        { label: t("agpp_gross_received"), value: cur.grossReceived, accent: "text-green-700", change: changes?.grossChange },
        { label: t("agpp_pp_fees_label"), value: cur.totalFees, accent: "text-red-600", change: null },
        { label: t("agpp_net_revenue"), value: cur.netReceived, accent: "text-emerald-700", change: changes?.revenueChange },
        { label: t("agpp_commission_label"), value: cur.totalCommission, accent: "text-purple-700", change: null },
        { label: t("agpp_team_revenue"), value: cur.teamRevenue, accent: "text-blue-700", change: changes?.revenueChange },
        { label: t("agpp_wallet_balance_label"), value: cur.walletBalance, accent: "text-teal-700", change: null, gradient: true },
      ]
    : [];

  const alerts: { text: string; color: string }[] = [];
  if (cur?.unconfirmedCount && cur.unconfirmedCount > 0) {
    alerts.push({ text: t("agpp_alert_unconfirmed", { n: cur.unconfirmedCount }), color: "border-red-200 bg-red-50 text-red-700" });
  }
  if (cur?.pendingFeeCount && cur.pendingFeeCount > 0) {
    alerts.push({ text: t("agpp_alert_pending_fee", { n: cur.pendingFeeCount }), color: "border-amber-200 bg-amber-50 text-amber-700" });
  }
  if (cur?.disputeCount && cur.disputeCount > 0) {
    alerts.push({ text: t("agpp_alert_disputes", { n: cur.disputeCount }), color: "border-red-200 bg-red-50 text-red-700" });
  }

  return (
    <div className="space-y-4">
      {/* Header + Period Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{t("agpp_financial_overview")}</h2>
          <p className="text-xs text-gray-400">{t("agpp_auto_refresh")}</p>
        </div>
        <div className="inline-flex items-center rounded-lg bg-gray-100 border border-gray-200 p-0.5 gap-0.5">
          {periods.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                period === key
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {t("save_failed")}
        </div>
      )}

      {/* Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
          : cards.map((card) => (
              <div
                key={card.label}
                className={`rounded-xl border shadow-sm p-5 ${
                  card.gradient
                    ? "bg-gradient-to-br from-teal-50 to-white border-teal-200"
                    : "bg-white border-gray-200"
                }`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
                  {card.label}
                </p>
                <p className={`text-2xl font-extrabold font-mono tabular-nums ${card.accent}`}>
                  {formatCurrency(card.value)}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <ChangeBadge value={card.change} />
                  {card.gradient && (
                    <span className="text-[9px] text-teal-500 font-medium">{t("agpp_cross_project")}</span>
                  )}
                </div>
              </div>
            ))}
      </div>

      {/* Alert Badges */}
      {alerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {alerts.map((a) => (
            <span
              key={a.text}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${a.color}`}
            >
              {a.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
