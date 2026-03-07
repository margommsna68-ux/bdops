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

interface ProxyAssignDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ProxyAssignDialog({ open, onClose, onSuccess }: ProxyAssignDialogProps) {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [proxyId, setProxyId] = useState("");
  const [vmId, setVmId] = useState("");

  const { data: availableProxies } = trpc.proxy.list.useQuery(
    { projectId: projectId!, status: "AVAILABLE", limit: 200 },
    { enabled: !!projectId }
  );

  const { data: vmsNoProxy } = trpc.vm.withoutProxy.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const assign = trpc.proxy.assign.useMutation({
    onSuccess: () => {
      onSuccess();
      onClose();
      setProxyId("");
      setVmId("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Proxy to VM</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Available Proxy ({availableProxies?.total ?? 0})</Label>
            <Select value={proxyId} onValueChange={setProxyId}>
              <SelectTrigger><SelectValue placeholder="Select proxy..." /></SelectTrigger>
              <SelectContent>
                {availableProxies?.items.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.host}:{p.port} ({p.subnet})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>VM without Proxy ({vmsNoProxy?.length ?? 0})</Label>
            <Select value={vmId} onValueChange={setVmId}>
              <SelectTrigger><SelectValue placeholder="Select VM..." /></SelectTrigger>
              <SelectContent>
                {vmsNoProxy?.map((vm) => (
                  <SelectItem key={vm.id} value={vm.id}>
                    {vm.code} ({vm.server?.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {assign.error && (
            <p className="text-sm text-red-600">{assign.error.message}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => {
                if (projectId && proxyId && vmId) {
                  assign.mutate({ projectId, proxyId, vmId });
                }
              }}
              disabled={!proxyId || !vmId || assign.isLoading}
            >
              {assign.isLoading ? "Assigning..." : "Assign Proxy"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
