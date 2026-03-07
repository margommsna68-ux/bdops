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

interface WithdrawalFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function WithdrawalForm({ open, onClose, onSuccess }: WithdrawalFormProps) {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data: paypals } = trpc.paypal.list.useQuery(
    { projectId: projectId!, limit: 100 },
    { enabled: !!projectId }
  );
  const { data: masters } = trpc.paypal.masters.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const createWithdrawal = trpc.withdrawal.create.useMutation({
    onSuccess: () => { onSuccess(); onClose(); resetForm(); },
  });

  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    amount: "",
    transactionId: "",
    type: "MIXING" as "MIXING" | "EXCHANGE",
    agent: "",
    withdrawCode: "",
    sourcePaypalId: "",
    destPaypalId: "",
    mailConfirmed: false,
    notes: "",
  });

  const resetForm = () =>
    setForm({
      date: new Date().toISOString().split("T")[0],
      amount: "", transactionId: "", type: "MIXING",
      agent: "", withdrawCode: "", sourcePaypalId: "",
      destPaypalId: "", mailConfirmed: false, notes: "",
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    createWithdrawal.mutate({
      projectId,
      date: form.date,
      amount: parseFloat(form.amount),
      transactionId: form.transactionId || undefined,
      type: form.type,
      agent: form.type === "EXCHANGE" ? form.agent : undefined,
      withdrawCode: form.withdrawCode || undefined,
      sourcePaypalId: form.sourcePaypalId,
      destPaypalId: form.type === "MIXING" ? form.destPaypalId : undefined,
      mailConfirmed: form.mailConfirmed,
      notes: form.notes || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Withdrawal</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type selector */}
          <div className="flex gap-2">
            {(["MIXING", "EXCHANGE"] as const).map((t) => (
              <Button
                key={t}
                type="button"
                variant={form.type === t ? "default" : "outline"}
                size="sm"
                onClick={() => setForm({ ...form, type: t })}
              >
                {t}
              </Button>
            ))}
          </div>

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
                required
              />
            </div>
          </div>

          <div>
            <Label>Source PayPal</Label>
            <Select
              value={form.sourcePaypalId}
              onValueChange={(v) => setForm({ ...form, sourcePaypalId: v })}
            >
              <SelectTrigger><SelectValue placeholder="Select source PP..." /></SelectTrigger>
              <SelectContent>
                {paypals?.items.map((pp) => (
                  <SelectItem key={pp.id} value={pp.id}>{pp.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {form.type === "MIXING" && (
            <div>
              <Label>Destination Master PP</Label>
              <Select
                value={form.destPaypalId}
                onValueChange={(v) => setForm({ ...form, destPaypalId: v })}
              >
                <SelectTrigger><SelectValue placeholder="Select master PP..." /></SelectTrigger>
                <SelectContent>
                  {masters?.map((pp) => (
                    <SelectItem key={pp.id} value={pp.id}>{pp.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {form.type === "EXCHANGE" && (
            <div>
              <Label>Agent</Label>
              <Input
                value={form.agent}
                onChange={(e) => setForm({ ...form, agent: e.target.value })}
                placeholder="PP_VP, ACE, Marua, Direct..."
                required={form.type === "EXCHANGE"}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Withdraw Code</Label>
              <Input
                value={form.withdrawCode}
                onChange={(e) => setForm({ ...form, withdrawCode: e.target.value })}
                placeholder="MIXING-083203U"
              />
            </div>
            <div>
              <Label>TX ID</Label>
              <Input
                value={form.transactionId}
                onChange={(e) => setForm({ ...form, transactionId: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mailConfirmed"
              checked={form.mailConfirmed}
              onChange={(e) => setForm({ ...form, mailConfirmed: e.target.checked })}
              className="rounded"
            />
            <Label htmlFor="mailConfirmed">Mail Confirmed</Label>
          </div>

          {createWithdrawal.error && (
            <p className="text-sm text-red-600">{createWithdrawal.error.message}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createWithdrawal.isLoading}>
              {createWithdrawal.isLoading ? "Saving..." : "Add Withdrawal"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
