"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

interface FundFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function FundForm({ open, onClose, onSuccess }: FundFormProps) {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data: paypals } = trpc.paypal.list.useQuery(
    { projectId: projectId!, limit: 100 },
    { enabled: !!projectId }
  );

  const createFund = trpc.fund.create.useMutation({
    onSuccess: () => {
      onSuccess();
      onClose();
      resetForm();
    },
  });

  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    amount: "",
    transactionId: "",
    paypalId: "",
    confirmed: false,
    company: "Bright Data Ltd.",
    notes: "",
  });

  const resetForm = () =>
    setForm({
      date: new Date().toISOString().split("T")[0],
      amount: "",
      transactionId: "",
      paypalId: "",
      confirmed: false,
      company: "Bright Data Ltd.",
      notes: "",
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    createFund.mutate({
      projectId,
      date: form.date,
      amount: parseFloat(form.amount),
      transactionId: form.transactionId,
      paypalId: form.paypalId,
      confirmed: form.confirmed,
      company: form.company,
      notes: form.notes || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Fund Transaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="25.00"
                required
              />
            </div>
          </div>

          <div>
            <Label>Transaction ID</Label>
            <Input
              value={form.transactionId}
              onChange={(e) => setForm({ ...form, transactionId: e.target.value })}
              placeholder="PayPal TX ID"
              required
            />
          </div>

          <div>
            <Label>PayPal Account</Label>
            <Select
              value={form.paypalId}
              onValueChange={(v) => setForm({ ...form, paypalId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select PayPal..." />
              </SelectTrigger>
              <SelectContent>
                {paypals?.items.map((pp) => (
                  <SelectItem key={pp.id} value={pp.id}>
                    {pp.code} — {pp.primaryEmail}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Company</Label>
            <Input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional notes..."
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="confirmed"
              checked={form.confirmed}
              onChange={(e) => setForm({ ...form, confirmed: e.target.checked })}
              className="rounded"
            />
            <Label htmlFor="confirmed">Confirmed</Label>
          </div>

          {createFund.error && (
            <p className="text-sm text-red-600">
              {createFund.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createFund.isLoading}>
              {createFund.isLoading ? "Saving..." : "Add Fund"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
