"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { WithdrawalForm } from "@/components/forms/WithdrawalForm";
import { ImportExcelDialog } from "@/components/forms/ImportExcelDialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import { exportToExcel } from "@/lib/excel-export";
import toast from "react-hot-toast";

export default function WithdrawalsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<"MIXING" | "EXCHANGE" | "">("");
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showUnsold, setShowUnsold] = useState(false);
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch } = trpc.withdrawal.list.useQuery(
    {
      projectId: projectId!,
      page,
      type: (typeFilter || undefined) as any,
    },
    { enabled: !!projectId }
  );

  const bulkImport = trpc.withdrawal.bulkImport.useMutation();

  const { data: mixingStatus } = trpc.withdrawal.mixingStatus.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const columns: Column<any>[] = [
    {
      key: "date",
      header: "Date",
      render: (item) => formatDate(item.date),
      sortFn: (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    },
    {
      key: "type",
      header: "Type",
      render: (item) => (
        <Badge variant="outline" className={
          item.type === "MIXING" ? "border-blue-500 text-blue-700" : "border-green-500 text-green-700"
        }>
          {item.type}
        </Badge>
      ),
    },
    {
      key: "source",
      header: "Source PP",
      render: (item) => <span className="font-medium">{item.sourcePaypal?.code ?? "—"}</span>,
      sortFn: (a, b) => (a.sourcePaypal?.code ?? "").localeCompare(b.sourcePaypal?.code ?? ""),
    },
    {
      key: "dest",
      header: "Dest / Agent",
      render: (item) =>
        item.type === "MIXING"
          ? item.destPaypal?.code ?? "—"
          : item.agent ?? "—",
      sortable: false,
    },
    {
      key: "amount",
      header: "Amount",
      render: (item) => <span className="font-semibold">{formatCurrency(item.amount)}</span>,
      sortFn: (a, b) => Number(a.amount) - Number(b.amount),
    },
    { key: "withdrawCode", header: "Code" },
    {
      key: "mailConfirmed",
      header: "Confirmed",
      render: (item) =>
        item.mailConfirmed ? (
          <Badge className="bg-green-100 text-green-800 text-xs">Yes</Badge>
        ) : (
          <Badge variant="outline" className="text-xs">No</Badge>
        ),
      sortFn: (a, b) => Number(a.mailConfirmed) - Number(b.mailConfirmed),
    },
  ];

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Withdrawals</h1>
          <p className="text-gray-500">MIXING (consolidation) and EXCHANGE (sale) tracking</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()} className="hidden sm:inline-flex">
            Print / PDF
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            Import Excel
          </Button>
          <Button variant="outline" onClick={() => setShowUnsold(!showUnsold)}>
            {showUnsold ? "Hide" : "Show"} Unsold Balance
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!data?.items?.length) return;
              exportToExcel(
                data.items.map((w: any) => ({
                  Date: formatDate(w.date),
                  Type: w.type,
                  "Source PP": w.sourcePaypal?.code ?? "",
                  "Dest / Agent": w.type === "MIXING" ? w.destPaypal?.code ?? "" : w.agent ?? "",
                  Amount: Number(w.amount),
                  Code: w.withdrawCode ?? "",
                  Confirmed: w.mailConfirmed ? "Yes" : "No",
                })),
                "withdrawals-export",
                "Withdrawals"
              );
            }}
            disabled={!data?.items?.length}
          >
            Export Excel
          </Button>
          <Button onClick={() => setShowForm(true)}>+ Add Withdrawal</Button>
        </div>
      </div>

      {/* Unsold PP Balance summary */}
      {showUnsold && mixingStatus && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-amber-900">Unsold PP Balance</h3>
              <span className="text-lg font-bold text-amber-800">
                {formatCurrency(mixingStatus.totalUnmixed)}
              </span>
            </div>
            <div className="flex gap-4 text-sm text-amber-700">
              <span>{mixingStatus.unmixed.length} PPs with unsold balance</span>
              <span>{mixingStatus.mixed.length} PPs fully mixed</span>
            </div>
          </div>

          {mixingStatus.unmixed.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">PP Code</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Received</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Mixed</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Unsold</th>
                  </tr>
                </thead>
                <tbody>
                  {mixingStatus.unmixed.map((pp) => (
                    <tr key={pp.id} className="border-t border-gray-100">
                      <td className="px-4 py-2 font-medium">{pp.code}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(pp.totalReceived)}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(pp.totalMixed)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-amber-700">
                        {formatCurrency(pp.unmixedBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2">
          {(["", "MIXING", "EXCHANGE"] as const).map((t) => (
            <Button
              key={t}
              variant={typeFilter === t ? "default" : "outline"}
              size="sm"
              onClick={() => { setTypeFilter(t); setPage(1); }}
            >
              {t || "All"}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 border rounded text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="Search PP code, agent, code, amount..."
          />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">&times;</button>}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={search.trim() ? (data?.items ?? []).filter((w: any) => {
          const q = search.toLowerCase();
          return (w.sourcePaypal?.code ?? "").toLowerCase().includes(q) || (w.destPaypal?.code ?? "").toLowerCase().includes(q) || (w.agent ?? "").toLowerCase().includes(q) || (w.withdrawCode ?? "").toLowerCase().includes(q) || String(w.amount).includes(q) || (w.type ?? "").toLowerCase().includes(q);
        }) : data?.items ?? []}
        total={data?.total ?? 0}
        page={page}
        limit={50}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No withdrawals yet."
      />

      <WithdrawalForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSuccess={() => refetch()}
      />

      <ImportExcelDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import Withdrawals"
        description="Required columns: Date, Amount, Type (MIXING/EXCHANGE), Source PP. Optional: Agent, Code, Confirmed, Dest PP, Notes"
        onImport={async (rows) => {
          const items = rows.map((r: any) => ({
            date: String(r["Date"] || r["date"] || ""),
            amount: Number(r["Amount"] || r["amount"] || 0),
            type: (String(r["Type"] || r["type"] || "").toUpperCase() === "EXCHANGE" ? "EXCHANGE" : "MIXING") as "MIXING" | "EXCHANGE",
            agent: r["Agent"] || r["agent"] ? String(r["Agent"] || r["agent"]) : undefined,
            withdrawCode: r["Code"] || r["code"] ? String(r["Code"] || r["code"]) : undefined,
            mailConfirmed: String(r["Confirmed"] || "").toLowerCase() === "yes",
            sourcePaypalCode: String(r["Source PP"] || r["source"] || ""),
            destPaypalCode: r["Dest PP"] || r["dest"] ? String(r["Dest PP"] || r["dest"]) : undefined,
            notes: r["Notes"] ? String(r["Notes"]) : undefined,
          }));
          const result = await bulkImport.mutateAsync({ projectId: projectId!, items });
          toast.success(`Imported: ${result.imported}, Skipped: ${result.skipped}${result.errors.length ? ' | Errors: ' + result.errors.join(', ') : ''}`);
          refetch();
        }}
      />
    </div>
  );
}
