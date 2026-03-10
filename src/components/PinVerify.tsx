"use client";

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface PinVerifyDialogProps {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
  title?: string;
  description?: string;
}

export function PinVerifyDialog({
  open,
  onClose,
  onVerified,
  title = "PIN Required",
  description = "Enter your PIN to continue",
}: PinVerifyDialogProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const verifyPin = trpc.user.verifyPin.useMutation();

  const handleVerify = async () => {
    setError("");
    try {
      await verifyPin.mutateAsync({ pin });
      setPin("");
      onVerified();
      onClose();
    } catch (e: any) {
      setError(e.message || "Incorrect PIN");
      setPin("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setPin(""); setError(""); onClose(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <Input
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="Enter PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && pin.length >= 4 && handleVerify()}
            className="text-center text-2xl tracking-[0.5em]"
            autoFocus
          />
          {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleVerify} disabled={pin.length < 4 || verifyPin.isLoading}>
              {verifyPin.isLoading ? "..." : "Verify"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook: usePinAction
 * Wraps an action that requires PIN verification.
 * If user has no PIN, action executes directly.
 * If user has PIN, shows dialog first.
 */
export function usePinAction() {
  const [showDialog, setShowDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [dialogTitle, setDialogTitle] = useState("PIN Required");
  const [dialogDesc, setDialogDesc] = useState("Enter your PIN to continue");

  const { data: pinStatus } = trpc.user.hasPin.useQuery(undefined, { retry: false });

  const requirePin = useCallback(
    (action: () => void, title?: string, desc?: string) => {
      if (!pinStatus?.hasPin) {
        // No PIN set → execute directly
        action();
        return;
      }
      // Has PIN → show verify dialog
      setPendingAction(() => action);
      if (title) setDialogTitle(title);
      if (desc) setDialogDesc(desc);
      setShowDialog(true);
    },
    [pinStatus]
  );

  const dialog = (
    <PinVerifyDialog
      open={showDialog}
      onClose={() => { setShowDialog(false); setPendingAction(null); }}
      onVerified={() => {
        pendingAction?.();
        setPendingAction(null);
      }}
      title={dialogTitle}
      description={dialogDesc}
    />
  );

  return { requirePin, PinDialog: dialog };
}
