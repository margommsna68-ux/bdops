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

const TASK_TYPES = [
  { value: "CHANGE_PROXY", label: "Change Proxy" },
  { value: "RESTART", label: "Restart VM" },
  { value: "UPDATE_SDK", label: "Update SDK" },
  { value: "CHECK_EARN", label: "Check Earn" },
  { value: "CUSTOM", label: "Custom" },
];

interface VMTaskFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedVmId?: string;
}

export function VMTaskForm({ open, onClose, onSuccess, preselectedVmId }: VMTaskFormProps) {
  const projectId = useProjectStore((s) => s.currentProjectId);

  const { data: vms } = trpc.vm.list.useQuery(
    { projectId: projectId!, limit: 200 },
    { enabled: !!projectId }
  );

  const createTask = trpc.vmTask.create.useMutation({
    onSuccess: () => { onSuccess(); onClose(); resetForm(); },
  });

  const [form, setForm] = useState({
    vmId: preselectedVmId ?? "",
    type: "CHANGE_PROXY",
    title: "",
    description: "",
    scheduledAt: new Date().toISOString().split("T")[0],
  });

  const resetForm = () =>
    setForm({
      vmId: preselectedVmId ?? "",
      type: "CHANGE_PROXY",
      title: "",
      description: "",
      scheduledAt: new Date().toISOString().split("T")[0],
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    createTask.mutate({
      projectId,
      vmId: form.vmId,
      type: form.type,
      title: form.title || TASK_TYPES.find((t) => t.value === form.type)?.label || form.type,
      description: form.description || undefined,
      scheduledAt: form.scheduledAt,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create VM Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>VM</Label>
            <Select value={form.vmId} onValueChange={(v) => setForm({ ...form, vmId: v })}>
              <SelectTrigger><SelectValue placeholder="Select VM..." /></SelectTrigger>
              <SelectContent>
                {vms?.items.map((vm) => (
                  <SelectItem key={vm.id} value={vm.id}>
                    {vm.code} ({vm.server?.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Task Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TASK_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={TASK_TYPES.find((t) => t.value === form.type)?.label}
            />
          </div>

          <div>
            <Label>Scheduled Date</Label>
            <Input
              type="date"
              value={form.scheduledAt}
              onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
              required
            />
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="Optional details..."
            />
          </div>

          {createTask.error && (
            <p className="text-sm text-red-600">{createTask.error.message}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createTask.isLoading}>
              {createTask.isLoading ? "Creating..." : "Create Task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
