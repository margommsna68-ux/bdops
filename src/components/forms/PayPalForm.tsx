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

interface PayPalFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editData?: any;
}

export function PayPalForm({ open, onClose, onSuccess, editData }: PayPalFormProps) {
  const projectId = useProjectStore((s) => s.currentProjectId);

  const createPP = trpc.paypal.create.useMutation({
    onSuccess: () => { onSuccess(); onClose(); resetForm(); },
  });
  const updatePP = trpc.paypal.update.useMutation({
    onSuccess: () => { onSuccess(); onClose(); },
  });

  const [form, setForm] = useState({
    code: editData?.code ?? "",
    primaryEmail: editData?.primaryEmail ?? "",
    secondaryEmail: editData?.secondaryEmail ?? "",
    bankCode: editData?.bankCode ?? "",
    status: editData?.status ?? "ACTIVE",
    role: editData?.role ?? "NORMAL",
    limitNote: editData?.limitNote ?? "",
    company: editData?.company ?? "Bright Data Ltd.",
    serverAssignment: editData?.serverAssignment ?? "",
    notes: editData?.notes ?? "",
  });

  const resetForm = () =>
    setForm({
      code: "", primaryEmail: "", secondaryEmail: "", bankCode: "",
      status: "ACTIVE", role: "NORMAL", limitNote: "",
      company: "Bright Data Ltd.", serverAssignment: "", notes: "",
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;

    if (editData) {
      updatePP.mutate({ projectId, id: editData.id, ...form });
    } else {
      createPP.mutate({ projectId, ...form });
    }
  };

  const isLoading = createPP.isLoading || updatePP.isLoading;
  const error = createPP.error || updatePP.error;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editData ? "Edit" : "Add"} PayPal Account</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Code</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="AE-001"
                required
              />
            </div>
            <div>
              <Label>Bank Code</Label>
              <Input
                value={form.bankCode}
                onChange={(e) => setForm({ ...form, bankCode: e.target.value })}
                placeholder="PP-VN161"
              />
            </div>
          </div>

          <div>
            <Label>Primary Email</Label>
            <Input
              type="email"
              value={form.primaryEmail}
              onChange={(e) => setForm({ ...form, primaryEmail: e.target.value })}
              required
            />
          </div>

          <div>
            <Label>Secondary Email</Label>
            <Input
              type="email"
              value={form.secondaryEmail}
              onChange={(e) => setForm({ ...form, secondaryEmail: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["ACTIVE", "LIMITED", "SUSPENDED", "CLOSED", "PENDING_VERIFY"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["NORMAL", "MASTER", "USDT"].map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Company</Label>
            <Input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </div>

          <div>
            <Label>Limit Note</Label>
            <Input
              value={form.limitNote}
              onChange={(e) => setForm({ ...form, limitNote: e.target.value })}
              placeholder="limit (20/1) - ~$150 - 180 days"
            />
          </div>

          <div>
            <Label>Server Assignment</Label>
            <Textarea
              value={form.serverAssignment}
              onChange={(e) => setForm({ ...form, serverAssignment: e.target.value })}
              placeholder="Server2&#10;Server11"
              rows={2}
            />
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error.message}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : editData ? "Update" : "Add PayPal"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
