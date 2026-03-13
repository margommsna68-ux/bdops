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
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

interface CostFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function dateToISO(dateStr: string): string {
  const now = new Date();
  const timePart = now.toTimeString().slice(0, 8);
  return new Date(`${dateStr}T${timePart}`).toISOString();
}

export function CostForm({ open, onClose, onSuccess }: CostFormProps) {
  const projectId = useProjectStore((s) => s.currentProjectId);

  const createCost = trpc.cost.create.useMutation({
    onSuccess: () => { onSuccess(); onClose(); resetForm(); },
  });

  const [form, setForm] = useState({
    date: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })(),
    serverCost: "",
    ipCost: "",
    extraCost: "",
    isPrepaid: false,
    note: "",
    fundingSource: "",
  });

  const resetForm = () =>
    setForm({
      date: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })(),
      serverCost: "", ipCost: "", extraCost: "",
      isPrepaid: false, note: "", fundingSource: "",
    });

  const total =
    (parseFloat(form.serverCost) || 0) +
    (parseFloat(form.ipCost) || 0) +
    (parseFloat(form.extraCost) || 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    createCost.mutate({
      projectId,
      date: dateToISO(form.date),
      serverCost: form.serverCost ? parseFloat(form.serverCost) : undefined,
      ipCost: form.ipCost ? parseFloat(form.ipCost) : undefined,
      extraCost: form.extraCost ? parseFloat(form.extraCost) : undefined,
      total,
      isPrepaid: form.isPrepaid,
      note: form.note || undefined,
      fundingSource: form.fundingSource || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Cost Record</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Date</Label>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Server Cost ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.serverCost}
                onChange={(e) => setForm({ ...form, serverCost: e.target.value })}
                placeholder="2470"
              />
            </div>
            <div>
              <Label>IP Cost ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.ipCost}
                onChange={(e) => setForm({ ...form, ipCost: e.target.value })}
                placeholder="1250"
              />
            </div>
            <div>
              <Label>Extra ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.extraCost}
                onChange={(e) => setForm({ ...form, extraCost: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>

          <div className="bg-gray-50 rounded-md p-3 text-center">
            <span className="text-sm text-gray-500">Total: </span>
            <span className="text-lg font-bold">${total.toFixed(2)}</span>
          </div>

          <div>
            <Label>Funding Source</Label>
            <Input
              value={form.fundingSource}
              onChange={(e) => setForm({ ...form, fundingSource: e.target.value })}
              placeholder="Marua withdrawal, Viet chi..."
            />
          </div>

          <div>
            <Label>Note</Label>
            <Textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPrepaid"
              checked={form.isPrepaid}
              onChange={(e) => setForm({ ...form, isPrepaid: e.target.checked })}
              className="rounded"
            />
            <Label htmlFor="isPrepaid">Prepaid (for next month)</Label>
          </div>

          {createCost.error && (
            <p className="text-sm text-red-600">{createCost.error.message}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createCost.isLoading}>
              {createCost.isLoading ? "Saving..." : "Add Cost"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
