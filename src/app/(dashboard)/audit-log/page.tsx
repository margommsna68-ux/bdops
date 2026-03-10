"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { StatCard } from "@/components/dashboard/StatCard";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800",
  UPDATE: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
  SETTLE: "bg-purple-100 text-purple-800",
  RECALCULATE: "bg-orange-100 text-orange-800",
};

const ENTITY_LABELS: Record<string, string> = {
  FundTransaction: "Fund",
  Withdrawal: "Withdrawal",
  CostRecord: "Cost",
  ProfitSplit: "Profit Split",
  SplitAllocation: "Allocation",
};

export default function AuditLogPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [filterEntity, setFilterEntity] = useState<string>("");
  const [filterAction, setFilterAction] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data, isLoading } = trpc.auditLog.list.useQuery(
    {
      projectId: projectId!,
      page,
      entity: filterEntity || undefined,
      action: filterAction || undefined,
    },
    { enabled: !!projectId }
  );

  const { data: stats } = trpc.auditLog.stats.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const columns: Column<any>[] = [
    {
      key: "createdAt",
      header: "Time",
      render: (item) => (
        <span className="text-sm text-gray-600">{formatDateTime(item.createdAt)}</span>
      ),
      sortFn: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
    {
      key: "user",
      header: "User",
      render: (item) => (
        <div className="flex items-center gap-2">
          {item.user?.image && (
            <img src={item.user.image} alt="" className="w-6 h-6 rounded-full" />
          )}
          <span className="text-sm">{item.user?.name || item.user?.email || "—"}</span>
        </div>
      ),
      sortFn: (a, b) => (a.user?.name || a.user?.email || "").localeCompare(b.user?.name || b.user?.email || ""),
    },
    {
      key: "action",
      header: "Action",
      render: (item) => (
        <Badge className={`text-xs ${ACTION_COLORS[item.action] || "bg-gray-100 text-gray-800"}`}>
          {item.action}
        </Badge>
      ),
    },
    {
      key: "entity",
      header: "Entity",
      render: (item) => (
        <span className="text-sm font-medium">
          {ENTITY_LABELS[item.entity] || item.entity}
        </span>
      ),
    },
    {
      key: "entityId",
      header: "Entity ID",
      render: (item) => (
        <span className="text-xs font-mono text-gray-500">{item.entityId.slice(0, 12)}...</span>
      ),
    },
    {
      key: "changes",
      header: "Changes",
      sortable: false,
      render: (item) => {
        if (!item.changes) return <span className="text-gray-400">—</span>;
        const changes = item.changes as Record<string, unknown>;
        const entries = Object.entries(changes).slice(0, 3);
        return (
          <div className="text-xs text-gray-600 space-y-0.5">
            {entries.map(([key, val]) => (
              <div key={key}>
                <span className="font-medium">{key}:</span>{" "}
                {typeof val === "object" ? JSON.stringify(val) : String(val)}
              </div>
            ))}
            {Object.keys(changes).length > 3 && (
              <span className="text-gray-400">+{Object.keys(changes).length - 3} more</span>
            )}
          </div>
        );
      },
    },
  ];

  // Client-side search
  const filteredData = search.trim()
    ? (data?.items ?? []).filter((item: any) => {
        const q = search.toLowerCase();
        return (
          (item.user?.name ?? "").toLowerCase().includes(q) ||
          (item.user?.email ?? "").toLowerCase().includes(q) ||
          (item.action ?? "").toLowerCase().includes(q) ||
          (item.entity ?? "").toLowerCase().includes(q) ||
          (item.entityId ?? "").toLowerCase().includes(q)
        );
      })
    : data?.items ?? [];

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <p className="text-gray-500">Track all financial data changes (admin only)</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard
          title="Total Logs"
          value={String(stats?.totalLogs ?? 0)}
          subtitle="All time"
        />
        <StatCard
          title="Today's Activity"
          value={String(stats?.todayLogs ?? 0)}
          subtitle="Changes today"
        />
      </div>

      {/* Search + Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="Search user, action, entity..."
          />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">&times;</button>}
        </div>
        <select
          className="px-3 py-2 border rounded-md text-sm bg-white"
          value={filterEntity}
          onChange={(e) => { setFilterEntity(e.target.value); setPage(1); }}
        >
          <option value="">All Entities</option>
          <option value="FundTransaction">Fund</option>
          <option value="Withdrawal">Withdrawal</option>
          <option value="CostRecord">Cost</option>
          <option value="ProfitSplit">Profit Split</option>
          <option value="SplitAllocation">Allocation</option>
        </select>
        <select
          className="px-3 py-2 border rounded-md text-sm bg-white"
          value={filterAction}
          onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
        >
          <option value="">All Actions</option>
          <option value="CREATE">Create</option>
          <option value="UPDATE">Update</option>
          <option value="DELETE">Delete</option>
          <option value="SETTLE">Settle</option>
          <option value="RECALCULATE">Recalculate</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={filteredData}
        total={data?.total ?? 0}
        page={page}
        limit={50}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No audit logs yet."
      />
    </div>
  );
}
