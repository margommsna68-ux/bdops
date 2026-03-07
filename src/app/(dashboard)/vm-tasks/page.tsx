"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VMTaskForm } from "@/components/forms/VMTaskForm";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatDate } from "@/lib/utils";

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

export default function VMTasksPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [showForm, setShowForm] = useState(false);

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

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  const overdueCount = overdueTasks?.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">VM Tasks</h1>
          <p className="text-gray-500">Scheduled tasks for virtual machines</p>
        </div>
        <Button onClick={() => setShowForm(true)}>+ New Task</Button>
      </div>

      {/* Overdue alert */}
      {overdueCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-medium text-red-800">
            {overdueCount} overdue task{overdueCount > 1 ? "s" : ""} need attention
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
            {s === "ALL" ? "All" : s.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      {/* Task list */}
      {isLoading ? (
        <p className="text-gray-400 py-8 text-center">Loading...</p>
      ) : !tasks?.length ? (
        <p className="text-gray-400 py-8 text-center">No tasks found.</p>
      ) : (
        <div className="space-y-3">
          {tasks.map((task: any) => {
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
                        <Badge className="bg-red-100 text-red-800 text-xs">OVERDUE</Badge>
                      )}
                    </div>
                    <h3 className="font-medium text-gray-900">{task.title}</h3>
                    {task.description && (
                      <p className="text-sm text-gray-500 mt-1">{task.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span>VM: <span className="font-mono">{task.vm?.code}</span> ({task.vm?.server?.code})</span>
                      <span>Scheduled: {formatDate(task.scheduledAt)}</span>
                      {task.assignedTo && <span>Assigned: {task.assignedTo.name ?? task.assignedTo.email}</span>}
                      {task.completedAt && <span>Completed: {formatDate(task.completedAt)}</span>}
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
                        Start
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs text-red-600"
                        onClick={() => handleStatusChange(task.id, "CANCELLED")}
                        disabled={mutatingId === task.id}
                      >
                        Cancel
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
                      Complete
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
