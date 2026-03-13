"use client";

import { useState, useEffect } from "react";
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
import { Combobox } from "@/components/ui/combobox";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

interface FundFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editData?: any;
}

const defaultForm = {
  date: new Date().toISOString().split("T")[0],
  serverId: "",
  vmId: "",
  paypalId: "",
  amount: "",
  transactionId: "",
  confirmed: false,
  company: "Bright Data Ltd.",
  notes: "",
};

export function FundForm({ open, onClose, onSuccess, editData }: FundFormProps) {
  const projectId = useProjectStore((s) => s.currentProjectId);

  const { data: servers } = trpc.server.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && open }
  );

  const [form, setForm] = useState({ ...defaultForm });

  // Reset form when editData changes (key prop handles this for different edits)
  useEffect(() => {
    if (open) {
      if (editData) {
        setForm({
          date: editData.date ? new Date(editData.date).toISOString().split("T")[0] : defaultForm.date,
          serverId: editData.serverId ?? "",
          vmId: editData.vmId ?? "",
          paypalId: editData.paypalId ?? "",
          amount: editData.amount ? String(editData.amount) : "",
          transactionId: editData.transactionId ?? "",
          confirmed: editData.confirmed ?? false,
          company: editData.company ?? "Bright Data Ltd.",
          notes: editData.notes ?? "",
        });
      } else {
        setForm({ ...defaultForm, date: new Date().toISOString().split("T")[0] });
      }
    }
  }, [open, editData]);

  // Fetch VMs for selected server
  const { data: vmsData } = trpc.vm.list.useQuery(
    { projectId: projectId!, serverId: form.serverId, limit: 200 },
    { enabled: !!projectId && !!form.serverId && open }
  );

  const { data: paypals } = trpc.paypal.list.useQuery(
    { projectId: projectId!, limit: 500 },
    { enabled: !!projectId && open }
  );

  const createFund = trpc.fund.create.useMutation({
    onSuccess: () => { onSuccess(); onClose(); },
  });

  const updateFund = trpc.fund.update.useMutation({
    onSuccess: () => { onSuccess(); onClose(); },
  });

  const serverOptions = (servers ?? []).map((s: any) => ({
    value: s.id,
    label: s.code,
    sub: s.ipAddress ?? "",
  }));

  const vmOptions = (vmsData?.items ?? []).map((vm: any) => ({
    value: vm.id,
    label: vm.code,
    sub: vm.status,
  }));

  // PayPal: show code as main label (e.g. "AE-001")
  const ppOptions = (paypals?.items ?? []).map((pp: any) => ({
    value: pp.id,
    label: pp.code,
    sub: pp.primaryEmail,
  }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !form.paypalId) return;
    if (form.confirmed && !form.transactionId.trim()) return;

    if (editData) {
      updateFund.mutate({
        projectId,
        id: editData.id,
        date: form.date,
        amount: parseFloat(form.amount),
        confirmed: form.confirmed,
        notes: form.notes || null,
        serverId: form.serverId || null,
        vmId: form.vmId || null,
        paypalId: form.paypalId,
      });
    } else {
      createFund.mutate({
        projectId,
        date: form.date,
        amount: parseFloat(form.amount),
        transactionId: form.transactionId,
        paypalId: form.paypalId,
        serverId: form.serverId || undefined,
        vmId: form.vmId || undefined,
        confirmed: form.confirmed,
        company: form.company,
        notes: form.notes || undefined,
      });
    }
  };

  const saving = createFund.isLoading || updateFund.isLoading;
  const error = createFund.error || updateFund.error;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editData ? "Edit Transaction" : "Add Fund Transaction"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Server + VM */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Server</Label>
              <Combobox
                options={serverOptions}
                value={form.serverId}
                onChange={(v) => setForm({ ...form, serverId: v, vmId: "" })}
                placeholder="Select Server..."
              />
            </div>
            <div>
              <Label className="text-xs">VM</Label>
              <Combobox
                options={vmOptions}
                value={form.vmId}
                onChange={(v) => setForm({ ...form, vmId: v })}
                placeholder={form.serverId ? "Select VM..." : "Select server first"}
                disabled={!form.serverId}
              />
            </div>
          </div>

          {/* PayPal + Amount */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">PayPal *</Label>
              <Combobox
                options={ppOptions}
                value={form.paypalId}
                onChange={(v) => setForm({ ...form, paypalId: v })}
                placeholder="Select PP code..."
              />
            </div>
            <div>
              <Label className="text-xs">Amount ($) *</Label>
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

          {/* TX ID + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Transaction ID</Label>
              <Input
                value={form.transactionId}
                onChange={(e) => setForm({ ...form, transactionId: e.target.value })}
                placeholder="PayPal TX ID"
              />
            </div>
            <div>
              <Label className="text-xs">Date *</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </div>
          </div>

          {/* Company + Confirmed */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Company</Label>
              <Input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.confirmed}
                  onChange={(e) => setForm({ ...form, confirmed: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">Confirmed</span>
              </label>
            </div>
          </div>

          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional..."
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error.message}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={saving || !form.paypalId || !form.amount}>
              {saving ? "Saving..." : editData ? "Update" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
