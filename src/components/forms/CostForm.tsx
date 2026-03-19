"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import toast from "react-hot-toast";

const CATEGORIES = [
  { value: "SERVER", vi: "Server", color: "bg-blue-100 text-blue-800" },
  { value: "IP_PROXY", vi: "IP/Proxy", color: "bg-purple-100 text-purple-800" },
  { value: "GMAIL", vi: "Gmail", color: "bg-red-100 text-red-800" },
  { value: "PAYPAL", vi: "PayPal", color: "bg-indigo-100 text-indigo-800" },
  { value: "OTHER", vi: "Khác", color: "bg-gray-200 text-gray-800" },
] as const;

interface CostFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CostForm({ open, onClose, onSuccess }: CostFormProps) {
  const t = useT();
  const projectId = useProjectStore((s) => s.currentProjectId);

  const createCost = trpc.cost.create.useMutation({
    onSuccess: () => {
      onSuccess();
      onClose();
      setForm(emptyForm());
      toast.success(t("saved"));
    },
    onError: (e) => toast.error(e.message),
  });

  const emptyForm = () => ({
    date: todayStr(),
    category: "SERVER" as string,
    amount: "",
    note: "",
    isPrepaid: false,
  });

  const [form, setForm] = useState(emptyForm());

  useEffect(() => {
    if (open) setForm(emptyForm());
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !form.amount) return;
    createCost.mutate({
      projectId,
      date: new Date(`${form.date}T12:00:00`).toISOString(),
      category: form.category as any,
      amount: parseFloat(form.amount),
      note: form.note || undefined,
      isPrepaid: form.isPrepaid,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("cost_form_title_add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="mb-1.5 block">{t("cost_category")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c.value} type="button" onClick={() => setForm({ ...form, category: c.value })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${form.category === c.value ? `${c.color} ring-2 ring-offset-1 ring-gray-400 scale-105` : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                  {c.vi}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>{t("cost_date")}</Label>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </div>

          <div>
            <Label>{t("cost_amount")} ($)</Label>
            <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00" required autoFocus />
          </div>

          <div>
            <Label>{t("cost_note")}</Label>
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder={t("cost_note_placeholder")} />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="isPrepaid" checked={form.isPrepaid} onChange={(e) => setForm({ ...form, isPrepaid: e.target.checked })} className="rounded" />
            <Label htmlFor="isPrepaid">{t("cost_form_prepaid_label")}</Label>
          </div>

          {createCost.error && <p className="text-sm text-red-600">{createCost.error.message}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" disabled={createCost.isLoading || !form.amount}>
              {createCost.isLoading ? "..." : t("cost_add")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
