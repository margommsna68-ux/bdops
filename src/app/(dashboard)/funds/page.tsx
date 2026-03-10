"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { FundForm } from "@/components/forms/FundForm";
import { ImportExcelDialog } from "@/components/forms/ImportExcelDialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import { exportToExcel } from "@/lib/excel-export";
import toast from "react-hot-toast";

export default function FundsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [confirmed, setConfirmed] = useState<boolean | undefined>(undefined);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading, refetch } = trpc.fund.list.useQuery(
    {
      projectId: projectId!,
      page,
      search: search || undefined,
      confirmed,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    { enabled: !!projectId }
  );

  const bulkImport = trpc.fund.bulkImport.useMutation();
  const bulkConfirm = trpc.fund.bulkConfirm.useMutation();

  const { data: unconfirmedData } = trpc.fund.unconfirmed.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const unconfirmedCount = unconfirmedData?.length ?? 0;

  const columns: Column<any>[] = [
    {
      key: "date",
      header: "Date",
      render: (item) => formatDate(item.date),
      sortFn: (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    },
    {
      key: "paypal",
      header: "PayPal",
      render: (item) => (
        <span className="font-medium">{item.paypal?.code ?? "—"}</span>
      ),
      sortFn: (a, b) => (a.paypal?.code ?? "").localeCompare(b.paypal?.code ?? ""),
    },
    {
      key: "amount",
      header: "Amount",
      render: (item) => (
        <span className="font-semibold text-green-700">
          {formatCurrency(item.amount)}
        </span>
      ),
      sortFn: (a, b) => Number(a.amount) - Number(b.amount),
    },
    { key: "transactionId", header: "TX ID" },
    {
      key: "confirmed",
      header: "Status",
      render: (item) =>
        item.confirmed ? (
          <Badge className="bg-green-100 text-green-800">Confirmed</Badge>
        ) : (
          <Badge variant="outline" className="border-yellow-500 text-yellow-700">
            Unconfirmed
          </Badge>
        ),
      sortFn: (a, b) => Number(a.confirmed) - Number(b.confirmed),
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
          <h1 className="text-2xl font-bold text-gray-900">Fund Tracking</h1>
          <p className="text-gray-500">Track all payments from Bright Data</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()} className="hidden sm:inline-flex">
            Print / PDF
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            Import Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!data?.items?.length) return;
              exportToExcel(
                data.items.map((f: any) => ({
                  Date: formatDate(f.date),
                  PayPal: f.paypal?.code ?? "",
                  Amount: Number(f.amount),
                  "TX ID": f.transactionId,
                  Confirmed: f.confirmed ? "Yes" : "No",
                  Company: f.company,
                  Notes: f.notes ?? "",
                })),
                "funds-export",
                "Funds"
              );
            }}
            disabled={!data?.items?.length}
          >
            Export Excel
          </Button>
          <Button onClick={() => setShowForm(true)}>+ Add Fund</Button>
        </div>
      </div>

      {/* Unconfirmed alert */}
      {unconfirmedCount > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="font-medium text-yellow-900">
              {unconfirmedCount} unconfirmed transaction{unconfirmedCount > 1 ? "s" : ""}
            </p>
            <p className="text-sm text-yellow-700">Review and confirm to ensure zero fund leakage</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-yellow-500 text-yellow-700 hover:bg-yellow-100"
            disabled={bulkConfirm.isLoading}
            onClick={async () => {
              if (!unconfirmedData?.length) return;
              if (!window.confirm(`Confirm all ${unconfirmedCount} unconfirmed transactions?`)) return;
              const ids = unconfirmedData.map((f: any) => f.id);
              const result = await bulkConfirm.mutateAsync({ projectId: projectId!, ids });
              toast.success(`${result.confirmed} transactions confirmed`);
              refetch();
            }}
          >
            Confirm All ({unconfirmedCount})
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <Input
              placeholder="Search TX ID, PP code, amount..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-8 pr-8"
            />
            {search && <button onClick={() => { setSearch(""); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">&times;</button>}
          </div>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="w-40"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="w-40"
          />
          <div className="flex items-center gap-1">
            {[
              { label: "Today", fn: () => { const d = new Date().toISOString().slice(0, 10); setDateFrom(d); setDateTo(d); setPage(1); } },
              { label: "7 days", fn: () => { const d = new Date(); d.setDate(d.getDate() - 7); setDateFrom(d.toISOString().slice(0, 10)); setDateTo(new Date().toISOString().slice(0, 10)); setPage(1); } },
              { label: "This month", fn: () => { const d = new Date(); setDateFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`); setDateTo(d.toISOString().slice(0, 10)); setPage(1); } },
              { label: "Last month", fn: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const last = new Date(y, d.getMonth() + 1, 0).getDate(); setDateFrom(`${y}-${m}-01`); setDateTo(`${y}-${m}-${last}`); setPage(1); } },
              { label: "Clear", fn: () => { setDateFrom(""); setDateTo(""); setPage(1); } },
            ].map((p) => (
              <button
                key={p.label}
                onClick={p.fn}
                className="px-2 py-1.5 text-xs rounded border bg-gray-50 hover:bg-gray-100 text-gray-600 whitespace-nowrap"
              >
                {p.label}
              </button>
            ))}
          </div>
          <select
            value={confirmed === undefined ? "" : String(confirmed)}
            onChange={(e) => {
              setConfirmed(e.target.value === "" ? undefined : e.target.value === "true");
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All Status</option>
            <option value="true">Confirmed</option>
            <option value="false">Unconfirmed</option>
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
        emptyMessage="No fund transactions yet."
      />

      <FundForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSuccess={() => refetch()}
      />

      <ImportExcelDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import Fund Transactions"
        description="Required columns: Date, Amount, TX ID, PayPal (PP code). Optional: Confirmed, Company, Notes"
        onImport={async (rows) => {
          const items = rows.map((r: any) => ({
            date: String(r["Date"] || r["date"] || ""),
            amount: Number(r["Amount"] || r["amount"] || 0),
            transactionId: String(r["TX ID"] || r["transactionId"] || r["Transaction ID"] || ""),
            confirmed: String(r["Confirmed"] || r["confirmed"] || "").toLowerCase() === "yes",
            company: String(r["Company"] || r["company"] || "Bright Data Ltd."),
            notes: r["Notes"] || r["notes"] ? String(r["Notes"] || r["notes"]) : undefined,
            paypalCode: String(r["PayPal"] || r["paypal"] || r["PP Code"] || r["PP"] || ""),
          }));
          const result = await bulkImport.mutateAsync({ projectId: projectId!, items });
          toast.success(`Imported: ${result.imported}, Skipped: ${result.skipped}${result.errors.length ? ' | Errors: ' + result.errors.join(', ') : ''}`);
          refetch();
        }}
      />
    </div>
  );
}
