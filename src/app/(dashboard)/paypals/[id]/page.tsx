"use client";

import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/StatCard";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function PayPalDetailPage() {
  const params = useParams();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data: pp, isLoading } = trpc.paypal.getById.useQuery(
    { projectId: projectId!, id: params.id as string },
    { enabled: !!projectId && !!params.id }
  );

  if (!projectId) return <p className="text-gray-500 p-8">Select a project.</p>;
  if (isLoading) return <p className="p-8">Loading...</p>;
  if (!pp) return <p className="p-8">PayPal account not found.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{pp.code}</h1>
        <p className="text-gray-500">{pp.primaryEmail}</p>
      </div>

      {/* Status badges */}
      <div className="flex gap-2">
        <Badge className="bg-green-100 text-green-800">{pp.status}</Badge>
        <Badge variant="outline">{pp.role}</Badge>
        <Badge variant="outline">{pp.company}</Badge>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Total Received" value={formatCurrency(Number(pp.totalReceived))} />
        <StatCard title="Total Withdrawn" value={formatCurrency(Number(pp.totalWithdrawn))} />
        <StatCard
          title="Current Balance"
          value={formatCurrency(pp.currentBalance)}
          trend={pp.currentBalance > 0 ? "up" : "neutral"}
        />
      </div>

      {/* Detail info */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Account Details</h2>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-gray-500">Secondary Email</dt><dd>{pp.secondaryEmail || "—"}</dd></div>
          <div><dt className="text-gray-500">Bank Code</dt><dd>{pp.bankCode || "—"}</dd></div>
          <div><dt className="text-gray-500">Server Assignment</dt><dd className="whitespace-pre-line">{pp.serverAssignment || "—"}</dd></div>
          <div><dt className="text-gray-500">Limit Note</dt><dd>{pp.limitNote || "—"}</dd></div>
          <div><dt className="text-gray-500">Notes</dt><dd>{pp.notes || "—"}</dd></div>
        </dl>
      </div>

      {/* Linked Gmails */}
      {pp.gmails.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Linked Gmail Accounts ({pp.gmails.length})</h2>
          <div className="space-y-2">
            {pp.gmails.map((g) => (
              <div key={g.id} className="flex items-center gap-3 text-sm">
                <Badge variant="outline">{g.status}</Badge>
                <span>{g.email}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Funds */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Fund Transactions</h2>
        {pp.fundsReceived.length === 0 ? (
          <p className="text-sm text-gray-500">No fund transactions.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pb-2">Date</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">TX ID</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pp.fundsReceived.map((f) => (
                <tr key={f.id}>
                  <td className="py-2">{formatDate(f.date)}</td>
                  <td className="py-2 font-medium text-green-700">{formatCurrency(Number(f.amount))}</td>
                  <td className="py-2 text-gray-600">{f.transactionId}</td>
                  <td className="py-2">
                    {f.confirmed ? (
                      <Badge className="bg-green-100 text-green-800 text-xs">Confirmed</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-700">Pending</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent Withdrawals */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Withdrawals (from this PP)</h2>
        {pp.withdrawalsFrom.length === 0 ? (
          <p className="text-sm text-gray-500">No withdrawals.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pb-2">Date</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">Agent/Dest</th>
                <th className="pb-2">Code</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pp.withdrawalsFrom.map((w) => (
                <tr key={w.id}>
                  <td className="py-2">{formatDate(w.date)}</td>
                  <td className="py-2"><Badge variant="outline" className="text-xs">{w.type}</Badge></td>
                  <td className="py-2 font-medium">{formatCurrency(Number(w.amount))}</td>
                  <td className="py-2">{w.agent || (w as any).destPaypal?.code || "—"}</td>
                  <td className="py-2 text-gray-600">{w.withdrawCode || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
