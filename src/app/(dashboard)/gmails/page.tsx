"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { GmailAssignDialog } from "@/components/forms/GmailAssignDialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  NEEDS_RECOVERY: "bg-orange-100 text-orange-800",
  NEEDS_2FA_UPDATE: "bg-purple-100 text-purple-800",
  BLOCKED: "bg-red-100 text-red-800",
  DISABLED: "bg-gray-100 text-gray-800",
};

export default function GmailsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);

  const { data, isLoading, refetch } = trpc.gmail.list.useQuery(
    {
      projectId: projectId!,
      page,
      status: statusFilter || undefined,
      unassigned: showUnassigned || undefined,
    },
    { enabled: !!projectId }
  );

  const columns: Column<any>[] = [
    { key: "email", header: "Email", render: (item) => <span className="font-medium">{item.email}</span> },
    {
      key: "status",
      header: "Status",
      render: (item) => <Badge className={`text-xs ${statusColors[item.status] ?? ""}`}>{item.status}</Badge>,
    },
    {
      key: "vm",
      header: "VM",
      render: (item) => item.vm?.code ? (
        <span className="font-mono text-sm">{item.vm.code}</span>
      ) : (
        <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">Unassigned</Badge>
      ),
    },
    {
      key: "server",
      header: "Server",
      render: (item) => item.vm?.server?.code ?? "—",
    },
    {
      key: "paypal",
      header: "PayPal",
      render: (item) =>
        item.paypal ? (
          <Badge variant="outline" className="text-xs">
            {item.paypal.code} ({item.paypal.status})
          </Badge>
        ) : (
          "—"
        ),
    },
    { key: "recoveryEmail", header: "Recovery", render: (item) => item.recoveryEmail ?? "—" },
  ];

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gmail Accounts</h1>
          <p className="text-gray-500">Manage Gmail accounts linked to VMs and PayPal</p>
        </div>
        <Button onClick={() => setShowAssignDialog(true)}>Assign Gmail to VM</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={statusFilter === "" && !showUnassigned ? "default" : "outline"}
          size="sm"
          onClick={() => { setStatusFilter(""); setShowUnassigned(false); setPage(1); }}
        >
          All
        </Button>
        <Button
          variant={showUnassigned ? "default" : "outline"}
          size="sm"
          onClick={() => { setShowUnassigned(!showUnassigned); setStatusFilter(""); setPage(1); }}
          className={showUnassigned ? "bg-orange-600 hover:bg-orange-700" : ""}
        >
          Unassigned
        </Button>
        {Object.keys(statusColors).map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => { setStatusFilter(s); setShowUnassigned(false); setPage(1); }}
          >
            {s.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={page}
        limit={50}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage={showUnassigned ? "No unassigned Gmail accounts." : "No Gmail accounts yet."}
      />

      <GmailAssignDialog
        open={showAssignDialog}
        onClose={() => setShowAssignDialog(false)}
        onSuccess={() => refetch()}
      />
    </div>
  );
}
