"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/StatCard";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatDateTime } from "@/lib/utils";
import { useT } from "@/lib/i18n";

function useTimeAgo() {
  const t = useT();
  return (date: Date | string): string => {
    const d = typeof date === "string" ? new Date(date) : date;
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("time_just_now");
    if (mins < 60) return `${mins} ${t("time_mins_ago")}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ${t("time_hours_ago")}`;
    const days = Math.floor(hours / 24);
    return `${days} ${t("time_days_ago")}`;
  };
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800",
  UPDATE: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
  BULK_UPDATE: "bg-blue-100 text-blue-800",
  BULK_DELETE: "bg-red-100 text-red-800",
  IMPORT: "bg-purple-100 text-purple-800",
  ASSIGN: "bg-indigo-100 text-indigo-800",
  UNASSIGN: "bg-orange-100 text-orange-800",
  ADD_NOTE: "bg-teal-100 text-teal-800",
  DELETE_NOTE: "bg-red-100 text-red-800",
  SETTLE: "bg-purple-100 text-purple-800",
  RECALCULATE: "bg-orange-100 text-orange-800",
  RESET_PIN: "bg-yellow-100 text-yellow-800",
  RESET_PASSWORD: "bg-yellow-100 text-yellow-800",
  STATUS_CHANGE: "bg-amber-100 text-amber-800",
  DELETE_APPROVED: "bg-red-100 text-red-800",
};

const ACTION_KEYS: Record<string, string> = {
  CREATE: "audit_action_create",
  UPDATE: "audit_action_update",
  DELETE: "audit_action_delete",
  BULK_UPDATE: "audit_action_bulk_update",
  BULK_DELETE: "audit_action_bulk_delete",
  IMPORT: "audit_action_import",
  ASSIGN: "audit_action_assign",
  UNASSIGN: "audit_action_unassign",
  ADD_NOTE: "audit_action_add_note",
  DELETE_NOTE: "audit_action_delete_note",
  SETTLE: "audit_action_settle",
  RECALCULATE: "audit_action_recalculate",
  RESET_PIN: "audit_action_reset_pin",
  RESET_PASSWORD: "audit_action_reset_password",
  STATUS_CHANGE: "audit_action_status_change",
  DELETE_APPROVED: "audit_action_delete_approved",
  UNLOCK_ACCOUNT: "audit_action_unlock_account",
};

const ENTITY_KEYS: Record<string, string> = {
  FundTransaction: "audit_entity_fund",
  Withdrawal: "audit_entity_withdrawal",
  CostRecord: "audit_entity_cost",
  ProfitSplit: "audit_entity_profit",
  SplitAllocation: "audit_entity_allocation",
  PayPalAccount: "audit_entity_paypal",
  PayPalEmail: "audit_entity_paypal_email",
  Server: "audit_entity_server",
  VirtualMachine: "audit_entity_vm",
  ProxyIP: "audit_entity_proxy",
  GmailAccount: "audit_entity_gmail",
  User: "audit_entity_user",
};

const ENTITY_ICONS: Record<string, string> = {
  FundTransaction: "$",
  Withdrawal: "W",
  CostRecord: "C",
  ProfitSplit: "%",
  SplitAllocation: "%",
  PayPalAccount: "P",
  PayPalEmail: "P",
  Server: "S",
  VirtualMachine: "V",
  ProxyIP: "I",
  GmailAccount: "G",
  VMTask: "T",
  User: "U",
  ProjectMember: "U",
  Project: "D",
};

const ENTITY_ICON_COLORS: Record<string, string> = {
  FundTransaction: "bg-green-600",
  Withdrawal: "bg-green-700",
  CostRecord: "bg-orange-600",
  ProfitSplit: "bg-purple-600",
  SplitAllocation: "bg-purple-500",
  PayPalAccount: "bg-blue-600",
  PayPalEmail: "bg-blue-500",
  Server: "bg-gray-700",
  VirtualMachine: "bg-gray-600",
  ProxyIP: "bg-indigo-600",
  GmailAccount: "bg-red-600",
  VMTask: "bg-amber-600",
  User: "bg-teal-600",
  ProjectMember: "bg-teal-500",
  Project: "bg-gray-800",
};

export default function AuditLogPage() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [filterEntity, setFilterEntity] = useState<string>("");
  const [filterAction, setFilterAction] = useState<string>("");
  const [filterUser, setFilterUser] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data, isLoading } = trpc.auditLog.list.useQuery(
    {
      projectId: projectId!,
      page,
      limit: 50,
      entity: filterEntity || undefined,
      action: filterAction || undefined,
      userId: filterUser || undefined,
    },
    { enabled: !!projectId, staleTime: 30000 }
  );

  const { data: stats } = trpc.auditLog.stats.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  // Get online users for user filter
  const { data: onlineData } = trpc.user.onlineUsers.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const items = useMemo(() => data?.items ?? [], [data?.items]);

  // Client-side search filter
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((item: any) =>
      (item.user?.name ?? "").toLowerCase().includes(q) ||
      (item.user?.username ?? "").toLowerCase().includes(q) ||
      (item.action ?? "").toLowerCase().includes(q) ||
      (item.entity ?? "").toLowerCase().includes(q) ||
      JSON.stringify(item.changes ?? "").toLowerCase().includes(q)
    );
  }, [items, search]);

  // Unique entities for filter
  const allEntities = [
    "Server", "VirtualMachine", "ProxyIP", "GmailAccount",
    "PayPalAccount", "PayPalEmail",
    "FundTransaction", "Withdrawal", "CostRecord", "ProfitSplit",
    "User", "ProjectMember", "Project",
  ];

  const allActions = [
    "CREATE", "UPDATE", "DELETE",
    "BULK_UPDATE", "BULK_DELETE", "IMPORT",
    "ASSIGN", "UNASSIGN",
    "ADD_NOTE", "DELETE_NOTE",
    "SETTLE", "RECALCULATE",
    "RESET_PIN", "RESET_PASSWORD",
    "STATUS_CHANGE", "DELETE_APPROVED",
  ];

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  const totalPages = Math.ceil((data?.total ?? 0) / 50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nhật ký Hoạt Động</h1>
        <p className="text-gray-500">Theo dõi tất cả hoạt động của thành viên trong dự án</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Tổng hoạt động" value={String(stats?.totalLogs ?? 0)} subtitle="tất cả" />
        <StatCard title="Hôm nay" value={String(stats?.todayLogs ?? 0)} subtitle="hoạt động" />
        <StatCard title="Đang online" value={String(onlineData?.filter((u) => u.isOnline).length ?? 0)} subtitle="thành viên" />
        <StatCard title="Thành viên" value={String(onlineData?.length ?? 0)} subtitle="trong dự án" />
      </div>

      {/* Online Users Bar */}
      {onlineData && onlineData.filter((u) => u.isOnline).length > 0 && (
        <div className="bg-white rounded-lg border p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 mr-1">Online:</span>
            {onlineData.filter((u) => u.isOnline).map((u) => (
              <button
                key={u.userId}
                onClick={() => setFilterUser(filterUser === u.userId ? "" : u.userId)}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                  filterUser === u.userId
                    ? "bg-green-600 text-white"
                    : "bg-green-50 text-green-700 hover:bg-green-100"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {u.name || u.username || u.email}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="Tìm theo tên, hành động, nội dung..."
          />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">&times;</button>}
        </div>
        <select
          className="px-3 py-2 border rounded-md text-sm bg-white"
          value={filterUser}
          onChange={(e) => { setFilterUser(e.target.value); setPage(1); }}
        >
          <option value="">Tất cả người dùng</option>
          {onlineData?.map((u) => (
            <option key={u.userId} value={u.userId}>
              {u.name || u.username || u.email}
            </option>
          ))}
        </select>
        <select
          className="px-3 py-2 border rounded-md text-sm bg-white"
          value={filterEntity}
          onChange={(e) => { setFilterEntity(e.target.value); setPage(1); }}
        >
          <option value="">Tất cả đối tượng</option>
          {allEntities.map((e) => (
            <option key={e} value={e}>{t(ENTITY_KEYS[e] || e)}</option>
          ))}
        </select>
        <select
          className="px-3 py-2 border rounded-md text-sm bg-white"
          value={filterAction}
          onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
        >
          <option value="">Tất cả hành động</option>
          {allActions.map((a) => (
            <option key={a} value={a}>{t(ACTION_KEYS[a] || a)}</option>
          ))}
        </select>
      </div>

      {/* Activity Timeline */}
      <div className="bg-white rounded-lg border">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Đang tải...</div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Chưa có hoạt động nào</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filteredItems.map((item: any) => {
              const changes = item.changes as Record<string, unknown> | null;
              const changesStr = changes
                ? Object.entries(changes)
                    .slice(0, 4)
                    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                    .join(", ")
                : null;
              const moreCount = changes ? Math.max(0, Object.keys(changes).length - 4) : 0;

              return (
                <div key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                  {/* Entity Icon */}
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-mono shrink-0 mt-0.5 ${ENTITY_ICON_COLORS[item.entity] || "bg-gray-500"}`}>
                    {ENTITY_ICONS[item.entity] || "?"}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-900">
                        {item.user?.name || item.user?.username || item.user?.email || "—"}
                      </span>
                      <Badge className={`text-[10px] ${ACTION_COLORS[item.action] || "bg-gray-100 text-gray-800"}`}>
                        {t(ACTION_KEYS[item.action] || item.action)}
                      </Badge>
                      <span className="text-sm text-gray-600">
                        {t(ENTITY_KEYS[item.entity] || item.entity)}
                      </span>
                    </div>
                    {changesStr && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {changesStr}
                        {moreCount > 0 && <span className="text-gray-400"> +{moreCount}</span>}
                      </p>
                    )}
                  </div>

                  {/* Time */}
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400">{timeAgo(item.createdAt)}</p>
                    <p className="text-[10px] text-gray-300">{formatDateTime(item.createdAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-xs text-gray-500">
              Trang {page} / {totalPages} ({data?.total ?? 0} hoạt động)
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-40"
              >
                Trước
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-40"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
