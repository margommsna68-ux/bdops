"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
};

export default function DeleteRequestsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const t = useT();
  const [statusFilter, setStatusFilter] = useState<"PENDING" | "APPROVED" | "REJECTED" | undefined>(
    "PENDING"
  );

  const { data: requests, isLoading, refetch } = trpc.deleteRequest.list.useQuery(
    {
      projectId: projectId!,
      status: statusFilter,
    },
    { enabled: !!projectId }
  );

  const approve = trpc.deleteRequest.approve.useMutation({
    onSuccess: () => refetch(),
  });

  const reject = trpc.deleteRequest.reject.useMutation({
    onSuccess: () => refetch(),
  });

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("dr_title")}</h1>
          <p className="text-gray-500">{t("dr_subtitle")}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex gap-2">
          {(["PENDING", "APPROVED", "REJECTED"] as const).map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </Button>
          ))}
          <Button
            variant={statusFilter === undefined ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(undefined)}
          >
            {t("all")}
          </Button>
        </div>
      </div>

      {/* Requests List */}
      <div className="bg-white rounded-lg border border-gray-200">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">{t("loading")}</div>
        ) : !requests?.length ? (
          <div className="p-8 text-center text-gray-500">
            {t("dr_no_requests")}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {requests.map((req: any) => (
              <div key={req.id} className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-mono">
                        {req.entity}
                      </Badge>
                      <Badge className={`${statusColors[req.status] ?? ""} text-xs`}>
                        {req.status}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium text-gray-900">
                      {req.entityLabel || req.entityId}
                    </p>
                    {req.reason && (
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">{t("dr_reason")}</span> {req.reason}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>
                        {t("dr_requested_by")}{" "}
                        <span className="font-medium">
                          {req.requestedBy?.name || req.requestedBy?.email || "Unknown"}
                        </span>
                      </span>
                      <span>{t("dr_date")} {formatDate(req.createdAt)}</span>
                      {req.reviewedBy && (
                        <span>
                          {t("dr_reviewed_by")}{" "}
                          <span className="font-medium">
                            {req.reviewedBy.name || req.reviewedBy.email}
                          </span>
                        </span>
                      )}
                      {req.reviewNote && (
                        <span>{t("dr_note")} {req.reviewNote}</span>
                      )}
                    </div>
                  </div>

                  {req.status === "PENDING" && (
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => {
                          if (!window.confirm(t("dr_approve_confirm"))) return;
                          approve.mutate({ projectId: projectId!, id: req.id });
                        }}
                        disabled={approve.isLoading}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {approve.isLoading ? "..." : t("approve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => {
                          const note = window.prompt(t("dr_reject_note"));
                          reject.mutate({
                            projectId: projectId!,
                            id: req.id,
                            reviewNote: note || undefined,
                          });
                        }}
                        disabled={reject.isLoading}
                      >
                        {reject.isLoading ? "..." : t("reject")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {approve.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-600">{approve.error.message}</p>
        </div>
      )}
      {reject.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-600">{reject.error.message}</p>
        </div>
      )}
    </div>
  );
}
