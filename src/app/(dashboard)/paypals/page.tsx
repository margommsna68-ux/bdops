"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { PayPalForm } from "@/components/forms/PayPalForm";
import { ImportExcelDialog } from "@/components/forms/ImportExcelDialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { exportToExcel } from "@/lib/excel-export";

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  LIMITED: "bg-yellow-100 text-yellow-800",
  SUSPENDED: "bg-red-100 text-red-800",
  CLOSED: "bg-gray-100 text-gray-800",
  PENDING_VERIFY: "bg-blue-100 text-blue-800",
};

const roleColors: Record<string, string> = {
  NORMAL: "bg-gray-100 text-gray-700",
  MASTER: "bg-purple-100 text-purple-800",
  USDT: "bg-orange-100 text-orange-800",
};

export default function PayPalsPage() {
  const router = useRouter();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading, refetch } = trpc.paypal.list.useQuery(
    {
      projectId: projectId!,
      page,
      search: search || undefined,
      status: (status || undefined) as any,
      role: (role || undefined) as any,
    },
    { enabled: !!projectId }
  );

  const bulkImport = trpc.paypal.bulkImport.useMutation();

  const columns: Column<any>[] = [
    { key: "code", header: "Code", render: (item) => <span className="font-medium">{item.code}</span> },
    { key: "primaryEmail", header: "Email" },
    {
      key: "status",
      header: "Status",
      render: (item) => (
        <Badge className={statusColors[item.status] ?? ""}>{item.status}</Badge>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (item) => (
        <Badge variant="outline" className={roleColors[item.role] ?? ""}>{item.role}</Badge>
      ),
    },
    {
      key: "funds",
      header: "Txns",
      render: (item) => item._count?.fundsReceived ?? 0,
    },
    { key: "company", header: "Company" },
  ];

  if (!projectId) {
    return <p className="text-gray-500 p-8">Select a project first.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PayPal Accounts</h1>
          <p className="text-gray-500">Manage all PayPal accounts</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)}>
            Import Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!data?.items?.length) return;
              exportToExcel(
                data.items.map((pp: any) => ({
                  Code: pp.code,
                  Email: pp.primaryEmail,
                  Status: pp.status,
                  Role: pp.role,
                  Company: pp.company,
                  "Limit Note": pp.limitNote ?? "",
                  "Server Assignment": pp.serverAssignment ?? "",
                })),
                "paypals-export",
                "PayPals"
              );
            }}
            disabled={!data?.items?.length}
          >
            Export Excel
          </Button>
          <Button onClick={() => setShowForm(true)}>+ Add PayPal</Button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4">
          <Input
            placeholder="Search by code or email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="flex-1 min-w-[200px]"
          />
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All Status</option>
            {["ACTIVE", "LIMITED", "SUSPENDED", "CLOSED", "PENDING_VERIFY"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={role}
            onChange={(e) => { setRole(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All Roles</option>
            {["NORMAL", "MASTER", "USDT"].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={page}
        limit={50}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No PayPal accounts yet."
        onRowClick={(item) => router.push(`/paypals/${item.id}`)}
      />

      <PayPalForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSuccess={() => refetch()}
      />

      <ImportExcelDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import PayPal Accounts"
        description="Required columns: Code, Email. Optional: Status, Role, Company, Bank Code, Secondary Email, Server"
        onImport={async (rows) => {
          const items = rows.map((r: any) => ({
            code: String(r["Code"] || r["code"] || ""),
            primaryEmail: String(r["Email"] || r["email"] || r["Primary Email"] || ""),
            secondaryEmail: r["Secondary Email"] ? String(r["Secondary Email"]) : undefined,
            bankCode: r["Bank Code"] ? String(r["Bank Code"]) : undefined,
            status: (String(r["Status"] || "ACTIVE").toUpperCase()) as any,
            role: (String(r["Role"] || "NORMAL").toUpperCase()) as any,
            company: String(r["Company"] || "Bright Data Ltd."),
            serverAssignment: r["Server"] ? String(r["Server"]) : undefined,
          }));
          const result = await bulkImport.mutateAsync({ projectId: projectId!, items });
          alert(`Imported: ${result.imported}, Skipped: ${result.skipped}${result.errors.length ? '\nErrors: ' + result.errors.join(', ') : ''}`);
          refetch();
        }}
      />
    </div>
  );
}
