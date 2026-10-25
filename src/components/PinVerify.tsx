"use client";

import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import {normalizeSecondFactor,validSecondFactor} from './second-factor';
import { Button } from "@/components/ui/button";
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
  required?: boolean; // If true, cannot close without verifying PIN
}

export function PinVerifyDialog({
  open,
  onClose,
  onVerified,
  title = "Xác nhận bằng mã 2FA / PIN",
  description = "Dùng mã Google Authenticator của bạn (hoặc PIN của bạn nếu chưa bật 2FA) để tiếp tục",
  required = false,
}: PinVerifyDialogProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const verifyPin = trpc.user.verifyPin.useMutation();
  const security=trpc.user.securityStatus.useQuery(undefined,{retry:false,enabled:open});
  const alreadyUnlocked=!!security.data?.unlocked,valid=!!security.data&&validSecondFactor(pin,security.data.totpEnabled);

  // Always reset pin and error when dialog opens
  useEffect(() => {
    if (open) { setPin(""); setError(""); }
  }, [open]);

  const handleVerify = async () => {
    if(verifyPin.isLoading||!security.data||!alreadyUnlocked&&!valid)return;
    setError("");
    try {
      if(!alreadyUnlocked)await verifyPin.mutateAsync({ pin:normalizeSecondFactor(pin) });
      setPin("");
      onVerified();
      onClose();
    } catch (e: any) {
      setError((e.message || "Mã chưa đúng").replace(/^PIN_LOCKED:\s*/, ""));
      setPin("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !required) { setPin(""); setError(""); onClose(); } }}>
      <DialogContent className="sm:max-w-sm" onPointerDownOutside={required ? (e) => e.preventDefault() : undefined} onEscapeKeyDown={required ? (e) => e.preventDefault() : undefined} hideCloseButton={required}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {alreadyUnlocked?<p className="text-sm">Phiên đăng nhập của bạn đã được mở khoá.</p>:<input
            type="password"
            inputMode="text"
            maxLength={32}
            placeholder="Mã 2FA / PIN"
            value={pin}
            onChange={(e) => setPin(normalizeSecondFactor(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 text-center text-2xl tracking-[0.5em]"
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore
            data-form-type="other"
            autoFocus
          />}
          {security.error&&<p role="alert" className="text-sm text-red-600">{security.error.message}</p>}
          {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          <div className="flex gap-2">
            {!required && (
              <Button variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button className="flex-1" onClick={handleVerify} disabled={!alreadyUnlocked&&!valid || verifyPin.isLoading}>
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
 * Reuses only a server-confirmed session unlock. A retired PIN never bypasses TOTP.
 */
export function usePinAction() {
  const [showDialog, setShowDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [dialogTitle, setDialogTitle] = useState("Xác nhận bằng mã 2FA / PIN");
  const [dialogDesc, setDialogDesc] = useState("Nhập mã Google Authenticator hoặc PIN của bạn để tiếp tục");

  const { data: pinStatus } = trpc.user.securityStatus.useQuery(undefined, { retry: false });

  const requirePin = useCallback(
    (action: () => void, title?: string, desc?: string) => {
      if (pinStatus?.unlocked) {
        // The server, not the presence of a legacy PIN, decides whether this session is unlocked.
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
