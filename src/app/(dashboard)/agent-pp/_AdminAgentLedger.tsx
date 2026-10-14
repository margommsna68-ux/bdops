"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";
import { useTableSort, SortIcon } from "@/components/tables/useTableSort";

// ─── Sparkline ────────────────────────────────────────────────────────────────

function _Sparkline({
  data,
  color = "#22c55e",
  width = 72,
  height = 24,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const pts = data
    .map(
      (v, i) =>
        `${(i / Math.max(data.length - 1, 1)) * width},${height - (v / max) * height}`
    )
    .join(" ");
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdminAgentLedger({ projectId }: { projectId: string }) {
  const t = useT();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const performanceQuery = trpc.agentPP.agentPerformance.useQuery(
    { projectId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    { enabled: !!projectId }
  );

  const agents = useMemo(() => {
    const raw = performanceQuery?.data;
    if (!raw || !Array.isArray(raw)) return [];
    return raw.map((a: any) => ({
      id: a.userId as string,
      name: (a.userName as string) ?? "Unknown",
      email: (a.email as string) ?? "",
      isOnline: (a.isOnline as boolean) ?? false,
      feePercent: Number(a.feePercent ?? 0),
      totalReceived: Number(a.totalReceived ?? 0),
      totalPPFees: Number(a.totalPPFees ?? 0),
      totalCommission: Number(a.totalCommission ?? 0),
      teamShare: Number(a.teamShare ?? 0),
      totalExpenses: Number(a.totalExpenses ?? 0),
      owedToTeam: Number(a.owedToTeam ?? 0),
      hasDisputes: (a.hasDisputes as boolean) ?? false,
      sparkline: ((a.dailyVolume ?? []) as any[]).map((d: any) =>
        Number(d.amount ?? 0)
      ),
    }));
  }, [performanceQuery?.data]);

  const { sorted, sortKey, sortDir, handleSort } = useTableSort(agents);

  // ─── Totals ─────────────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    let totalReceived = 0;
    let totalPPFees = 0;
    let totalCommission = 0;
    let teamShare = 0;
    let totalExpenses = 0;
    let owedToTeam = 0;
    for (const a of agents) {
      totalReceived += a.totalReceived;
      totalPPFees += a.totalPPFees;
      totalCommission += a.totalCommission;
      teamShare += a.teamShare;
      totalExpenses += a.totalExpenses;
      owedToTeam += a.owedToTeam;
    }
    return { totalReceived, totalPPFees, totalCommission, teamShare, totalExpenses, owedToTeam };
  }, [agents]);

  // ─── Loading ────────────────────────────────────────────────────────────────

  if (performanceQuery.isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-gray-50">
          <div className="h-5 w-40 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="p-4 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse bg-gray-100 h-10 rounded" />
          ))}
        </div>
      </div>
    );
  }

  // ─── Empty ──────────────────────────────────────────────────────────────────

  if (!agents.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-gray-50">
          <span className="text-sm font-semibold text-gray-700">
            {t("agpp_agent_ledger")}
          </span>
        </div>
        <p className="text-center py-12 text-gray-400 text-sm">
          {t("agpp_no_agent_data")}
        </p>
      </div>
    );
  }

  // ─── Column definitions ─────────────────────────────────────────────────────

  const columns: {
    key: string;
    label: string;
    align: "left" | "center" | "right";
    sortable: boolean;
  }[] = [
    { key: "name", label: t("agpp_col_agent"), align: "left", sortable: true },
    { key: "feePercent", label: t("agpp_col_fee_pct"), align: "center", sortable: true },
    { key: "totalReceived", label: t("agpp_col_gross"), align: "right", sortable: true },
    { key: "totalPPFees", label: t("agpp_col_pp_fees"), align: "right", sortable: true },
    { key: "totalCommission", label: t("agpp_col_commission"), align: "right", sortable: true },
    { key: "teamShare", label: t("agpp_col_team_share"), align: "right", sortable: true },
    { key: "totalExpenses", label: t("agpp_col_expenses"), align: "right", sortable: true },
    { key: "owedToTeam", label: `${t("agpp_col_owed_team")} \u25C6`, align: "right", sortable: true },
  ];

  const alignCls = { left: "text-left", center: "text-center", right: "text-right" } as const;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header + Date Filter */}
      <div className="px-5 py-3 border-b bg-gray-50 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700">
            {t("agpp_agent_ledger")}
          </span>
          <span className="text-xs text-gray-400">
            {t("agpp_agents_count", { n: agents.length })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white" />
          <span className="text-gray-400 text-xs">→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-xs text-gray-400 hover:text-red-500 px-1">&times;</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap ${
                    alignCls[col.align]
                  } ${col.sortable ? "cursor-pointer hover:text-gray-800 select-none" : ""}`}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                >
                  {col.label}
                  {col.sortable && (
                    <SortIcon
                      active={sortKey === col.key}
                      direction={sortDir}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent) => (
              <tr key={agent.id} className="border-b border-gray-50 hover:bg-gray-50">
                {/* Agent */}
                <td className="px-3 py-2 text-left">
                  <div className="flex items-center gap-1.5">
                    {agent.isOnline && (
                      <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-800 truncate">
                        {agent.name}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">
                        {agent.email}
                      </div>
                    </div>
                    {agent.hasDisputes && (
                      <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 rounded-full flex-shrink-0">
                        {t("agpp_dispute_badge")}
                      </span>
                    )}
                  </div>
                </td>
                {/* Fee% */}
                <td className="px-3 py-2 text-center font-mono tabular-nums text-purple-700">
                  {agent.feePercent}%
                </td>
                {/* Gross */}
                <td className="px-3 py-2 text-right font-mono tabular-nums text-green-700">
                  {formatCurrency(agent.totalReceived)}
                </td>
                {/* PP Fees */}
                <td className="px-3 py-2 text-right font-mono tabular-nums text-red-600">
                  {formatCurrency(agent.totalPPFees)}
                </td>
                {/* Commission */}
                <td className="px-3 py-2 text-right font-mono tabular-nums text-purple-700">
                  {formatCurrency(agent.totalCommission)}
                </td>
                {/* Team Share */}
                <td className="px-3 py-2 text-right font-mono tabular-nums text-blue-700">
                  {formatCurrency(agent.teamShare)}
                </td>
                {/* Expenses */}
                <td className="px-3 py-2 text-right font-mono tabular-nums text-orange-700">
                  {formatCurrency(agent.totalExpenses)}
                </td>
                {/* Owed Team */}
                <td
                  className={`px-3 py-2 text-right font-mono tabular-nums ${
                    agent.owedToTeam > 10
                      ? "bg-red-50 text-red-700 font-bold"
                      : agent.owedToTeam <= 0
                      ? "bg-emerald-50 text-emerald-700"
                      : ""
                  }`}
                >
                  {formatCurrency(agent.owedToTeam)}
                </td>
              </tr>
            ))}
          </tbody>
          {/* Footer totals */}
          <tfoot>
            <tr className="bg-gray-50 font-semibold border-t-2">
              <td className="px-3 py-2.5 text-left text-gray-700">
                {t("total")}
              </td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-green-700">
                {formatCurrency(totals.totalReceived)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-red-600">
                {formatCurrency(totals.totalPPFees)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-purple-700">
                {formatCurrency(totals.totalCommission)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-blue-700">
                {formatCurrency(totals.teamShare)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-orange-700">
                {formatCurrency(totals.totalExpenses)}
              </td>
              <td
                className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                  totals.owedToTeam > 10
                    ? "bg-red-50 text-red-700 font-bold"
                    : totals.owedToTeam <= 0
                    ? "bg-emerald-50 text-emerald-700"
                    : ""
                }`}
              >
                {formatCurrency(totals.owedToTeam)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
