"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

interface GmailAssignDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function GmailAssignDialog({ open, onClose, onSuccess }: GmailAssignDialogProps) {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [gmailId, setGmailId] = useState("");
  const [vmId, setVmId] = useState("");

  const { data: vms } = trpc.vm.list.useQuery(
    { projectId: projectId!, limit: 200 },
    { enabled: !!projectId && open }
  );

  const { data: gmails } = trpc.gmail.list.useQuery(
    { projectId: projectId!, unassigned: true, limit: 200 },
    { enabled: !!projectId && open }
  );

  const assignMutation = trpc.gmail.assignToVm.useMutation({
    onSuccess: () => {
      onSuccess();
      onClose();
      setGmailId("");
      setVmId("");
    },
  });

  // Filter VMs that don't have a gmail assigned
  const availableVMs = vms?.items.filter((vm: any) => !vm.gmail) ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !gmailId || !vmId) return;
    assignMutation.mutate({
      projectId,
      gmailId,
      vmId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Gmail to VM</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-500">
            Select an unassigned Gmail and a VM without Gmail to link them.
          </p>

          <div>
            <Label>Gmail Account (unassigned)</Label>
            <Select value={gmailId} onValueChange={setGmailId}>
              <SelectTrigger><SelectValue placeholder="Select Gmail..." /></SelectTrigger>
              <SelectContent>
                {gmails?.items.map((g: any) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Target VM (without Gmail)</Label>
            <Select value={vmId} onValueChange={setVmId}>
              <SelectTrigger><SelectValue placeholder="Select VM..." /></SelectTrigger>
              <SelectContent>
                {availableVMs.map((vm: any) => (
                  <SelectItem key={vm.id} value={vm.id}>
                    {vm.code} ({vm.server?.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {assignMutation.error && (
            <p className="text-sm text-red-600">{assignMutation.error.message}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={!gmailId || !vmId || assignMutation.isLoading}
            >
              {assignMutation.isLoading ? "Assigning..." : "Assign"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
