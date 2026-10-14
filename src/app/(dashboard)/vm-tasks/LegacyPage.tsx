"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VMTaskForm } from "@/components/forms/VMTaskForm";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-800",
};

const typeColors: Record<string, string> = {
  CHANGE_PROXY: "border-purple-500 text-purple-700",
  RESTART: "border-orange-500 text-orange-700",
  UPDATE_SDK: "border-blue-500 text-blue-700",
  CHECK_EARN: "border-green-500 text-green-700",
  CUSTOM: "border-gray-500 text-gray-700",
};

type StatusFilter = "ALL" | "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type SortKey = "scheduledAt" | "title" | "type" | "status" | "vm";
type SortDir = "asc" | "desc";

export default function VMTasksPage() {
  const t = useT();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("scheduledAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: tasks, isLoading, refetch } = trpc.vmTask.list.useQuery(
    {
      projectId: projectId!,
      status: statusFilter === "ALL" ? undefined : statusFilter as any,
    },
    { enabled: !!projectId }
  );

  const { data: overdueTasks } = trpc.vmTask.overdue.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const updateStatus = trpc.vmTask.updateStatus.useMutation({
    onSuccess: () => { refetch(); setMutatingId(null); },
    onError: () => setMutatingId(null),
  });

  const handleStatusChange = (taskId: string, newStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED") => {
    if (!projectId) return;
    setMutatingId(taskId);
    updateStatus.mutate({ projectId, id: taskId, status: newStatus });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIcon = (key: SortKey) => (
    <span className="ml-1 text-gray-400 text-[10px]">
      {sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
    </span>
  );

  // Search + Sort
  const filteredTasks = useMemo(() => {
    let items = tasks ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((tk: any) =>
        (tk.title ?? "").toLowerCase().includes(q) ||
        (tk.description ?? "").toLowerCase().includes(q) ||
        (tk.type ?? "").toLowerCase().includes(q) ||
        (tk.vm?.code ?? "").toLowerCase().includes(q) ||
        (tk.vm?.server?.code ?? "").toLowerCase().includes(q)
      );
    }
    return [...items].sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortKey) {
        case "scheduledAt":
          cmp = new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
          break;
        case "title":
          cmp = (a.title ?? "").localeCompare(b.title ?? "");
          break;
        case "type":
          cmp = (a.type ?? "").localeCompare(b.type ?? "");
          break;
        case "status":
          cmp = (a.status ?? "").localeCompare(b.status ?? "");
          break;
        case "vm":
          cmp = (a.vm?.code ?? "").localeCompare(b.vm?.code ?? "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [tasks, search, sortKey, sortDir]);

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  const overdueCount = overdueTasks?.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("vmt_title")}</h1>
          <p className="text-gray-500">{t("vmt_subtitle")}</p>
        </div>
        <Button onClick={() => setShowForm(true)}>{t("vmt_new")}</Button>
      </div>

      {/* Overdue alert */}
      {overdueCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-medium text-red-800">
            {overdueCount} {t("vmt_overdue_alert")}
          </p>
        </div>
      )}

      {/* Status filter */}
      <div className="flex gap-2">
        {(["ALL", "PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s === "ALL" ? t("all") : s.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-8 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          placeholder={t("vmt_search")}
        />
        {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">&times;</button>}
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>{t("vmt_sort_by")}</span>
        {([
          ["scheduledAt", t("vmt_schedule")],
          ["title", t("vmt_title_col")],
          ["type", t("type")],
          ["status", t("col_status")],
          ["vm", t("col_vm")],
        ] as [SortKey, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => handleSort(key)}
            className={`px-2 py-1 rounded hover:bg-gray-100 ${sortKey === key ? "font-medium text-gray-900" : ""}`}
          >
            {label}{sortIcon(key)}
          </button>
        ))}
      </div>

      {/* Task list */}
      {isLoading ? (
        <p className="text-gray-400 py-8 text-center">{t("loading")}</p>
      ) : !filteredTasks?.length ? (
        <p className="text-gray-400 py-8 text-center">{t("vmt_no_tasks")}</p>
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((task: any) => {
            const isOverdue =
              task.status === "PENDING" && new Date(task.scheduledAt) < new Date();
            return (
              <div
                key={task.id}
                className={`bg-white rounded-lg border p-4 ${
                  isOverdue ? "border-red-300 bg-red-50" : "border-gray-200"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={typeColors[task.type] ?? typeColors.CUSTOM}>
                        {task.type}
                      </Badge>
                      <Badge className={statusColors[task.status]}>
                        {task.status}
                      </Badge>
                      {isOverdue && (
                        <Badge className="bg-red-100 text-red-800 text-xs">{t("overdue").toUpperCase()}</Badge>
                      )}
                    </div>
                    <h3 className="font-medium text-gray-900">{task.title}</h3>
                    {task.description && (
                      <p className="text-sm text-gray-500 mt-1">{task.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span>{t("vmt_vm")} <span className="font-mono">{task.vm?.code}</span> ({task.vm?.server?.code})</span>
                      <span>{t("vmt_scheduled")} {formatDate(task.scheduledAt)}</span>
                      {task.assignedTo && <span>{t("vmt_assigned")} {task.assignedTo.name ?? task.assignedTo.email}</span>}
                      {task.completedAt && <span>{t("vmt_completed")} {formatDate(task.completedAt)}</span>}
                    </div>
                  </div>

                  {/* Quick actions */}
                  {task.status === "PENDING" && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() => handleStatusChange(task.id, "IN_PROGRESS")}
                        disabled={mutatingId === task.id}
                      >
                        {t("start")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs text-red-600"
                        onClick={() => handleStatusChange(task.id, "CANCELLED")}
                        disabled={mutatingId === task.id}
                      >
                        {t("cancel")}
                      </Button>
                    </div>
                  )}
                  {task.status === "IN_PROGRESS" && (
                    <Button
                      size="sm"
                      className="text-xs bg-green-600 hover:bg-green-700"
                      onClick={() => handleStatusChange(task.id, "COMPLETED")}
                      disabled={mutatingId === task.id}
                    >
                      {t("complete")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <VMTaskForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSuccess={() => refetch()}
      />
    </div>
  );
}
