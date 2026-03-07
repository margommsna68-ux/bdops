"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function ProfitPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [showForm, setShowForm] = useState(false);

  const { data: splits, isLoading, refetch } = trpc.profitSplit.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const createSplit = trpc.profitSplit.create.useMutation({
    onSuccess: () => { refetch(); setShowForm(false); },
  });

  const recalculate = trpc.profitSplit.recalculate.useMutation({
    onSuccess: () => refetch(),
  });

  const settle = trpc.profitSplit.settle.useMutation({
    onSuccess: () => refetch(),
  });

  const markPaid = trpc.profitSplit.markAllocationPaid.useMutation({
    onSuccess: () => refetch(),
  });

  const [form, setForm] = useState({
    periodStart: "",
    periodEnd: "",
    partners: [
      { name: "VietPhe", percentage: 50 },
      { name: "Lucky", percentage: 50 },
    ],
  });

  // Grand totals
  const grandWithdrawal = splits?.reduce((s, sp) => s + Number(sp.totalWithdrawal), 0) ?? 0;
  const grandCost = splits?.reduce((s, sp) => s + Number(sp.totalCost), 0) ?? 0;
  const grandProfit = splits?.reduce((s, sp) => s + Number(sp.netProfit), 0) ?? 0;

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profit Split</h1>
          <p className="text-gray-500">Revenue - Costs = Profit, split by partner config</p>
        </div>
        <Button onClick={() => setShowForm(true)}>+ New Period</Button>
      </div>

      {/* Grand total formula */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center text-center">
          <div>
            <p className="text-sm text-gray-500">Total Exchange</p>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(grandWithdrawal)}</p>
          </div>
          <div className="text-2xl font-bold text-gray-400">-</div>
          <div>
            <p className="text-sm text-gray-500">Total Costs</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(grandCost)}</p>
          </div>
          <div className="text-2xl font-bold text-gray-400">=</div>
          <div>
            <p className="text-sm text-gray-500">Net Profit</p>
            <p className={`text-2xl font-bold ${grandProfit >= 0 ? "text-blue-600" : "text-red-600"}`}>
              {formatCurrency(grandProfit)}
            </p>
          </div>
        </div>
      </div>

      {/* Split periods */}
      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : splits?.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          No profit split periods yet. Create one to get started.
        </div>
      ) : (
        <div className="space-y-4">
          {splits?.map((split) => (
            <div key={split.id} className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-lg">
                    {formatDate(split.periodStart)} — {formatDate(split.periodEnd)}
                  </h3>
                  <Badge className={split.settled ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}>
                    {split.settled ? "Settled" : "Pending"}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => recalculate.mutate({ projectId: projectId!, id: split.id })}
                    disabled={recalculate.isLoading}
                  >
                    Recalculate
                  </Button>
                  {!split.settled && (
                    <Button
                      size="sm"
                      onClick={() => settle.mutate({ projectId: projectId!, id: split.id })}
                      disabled={settle.isLoading}
                    >
                      Mark Settled
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4 text-center">
                <div>
                  <p className="text-sm text-gray-500">Withdrawal</p>
                  <p className="text-lg font-bold text-green-600">{formatCurrency(Number(split.totalWithdrawal))}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Cost</p>
                  <p className="text-lg font-bold text-red-600">{formatCurrency(Number(split.totalCost))}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Net Profit</p>
                  <p className="text-lg font-bold text-blue-600">{formatCurrency(Number(split.netProfit))}</p>
                </div>
              </div>

              {/* Allocations */}
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-gray-500 mb-2">Partner Allocations</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {split.allocations.map((alloc) => (
                    <div key={alloc.id} className="flex items-center justify-between bg-gray-50 rounded-md p-3">
                      <div>
                        <span className="font-medium">{alloc.partnerName}</span>
                        <span className="text-sm text-gray-500 ml-2">({Number(alloc.percentage)}%)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{formatCurrency(Number(alloc.amount))}</span>
                        <button
                          type="button"
                          onClick={() => markPaid.mutate({
                            projectId: projectId!,
                            allocationId: alloc.id,
                            paid: !alloc.paid,
                          })}
                          disabled={markPaid.isLoading}
                        >
                          <Badge className={`cursor-pointer ${alloc.paid ? "bg-green-100 text-green-800 text-xs" : "bg-gray-100 text-gray-600 text-xs"}`}>
                            {alloc.paid ? "Paid" : "Unpaid"}
                          </Badge>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Split Dialog */}
      <Dialog open={showForm} onOpenChange={(v) => !v && setShowForm(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Profit Split Period</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createSplit.mutate({
                projectId: projectId!,
                periodStart: form.periodStart,
                periodEnd: form.periodEnd,
                partners: form.partners,
              });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Period Start</Label>
                <Input
                  type="date"
                  value={form.periodStart}
                  onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Period End</Label>
                <Input
                  type="date"
                  value={form.periodEnd}
                  onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
                  required
                />
              </div>
            </div>

            <div>
              <Label>Partners</Label>
              {form.partners.map((p, i) => (
                <div key={i} className="flex gap-2 mt-2">
                  <Input
                    value={p.name}
                    onChange={(e) => {
                      const partners = [...form.partners];
                      partners[i] = { ...partners[i], name: e.target.value };
                      setForm({ ...form, partners });
                    }}
                    placeholder="Name"
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    value={p.percentage}
                    onChange={(e) => {
                      const partners = [...form.partners];
                      partners[i] = { ...partners[i], percentage: parseFloat(e.target.value) || 0 };
                      setForm({ ...form, partners });
                    }}
                    placeholder="%"
                    className="w-24"
                  />
                  {form.partners.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const partners = form.partners.filter((_, j) => j !== i);
                        setForm({ ...form, partners });
                      }}
                    >
                      X
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() =>
                  setForm({ ...form, partners: [...form.partners, { name: "", percentage: 0 }] })
                }
              >
                + Add Partner
              </Button>
              <p className="text-xs text-gray-500 mt-1">
                Total: {form.partners.reduce((s, p) => s + p.percentage, 0)}% (must be 100%)
              </p>
            </div>

            {createSplit.error && (
              <p className="text-sm text-red-600">{createSplit.error.message}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={createSplit.isLoading}>
                {createSplit.isLoading ? "Creating..." : "Create & Calculate"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
