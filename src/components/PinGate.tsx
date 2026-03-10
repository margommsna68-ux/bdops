"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * PinGate - Shows full-screen overlay after login.
 * - If user has no PIN → forces them to create one
 * - If user has PIN → requires PIN entry to access site
 * - Stores verification in sessionStorage (cleared on tab close)
 */
export function PinGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"loading" | "verify" | "setup">("loading");

  const { data: pinStatus, isLoading } = trpc.user.hasPin.useQuery(undefined, {
    retry: false,
  });
  const verifyPin = trpc.user.verifyPin.useMutation();
  const setupPin = trpc.user.setPin.useMutation();

  useEffect(() => {
    // Check sessionStorage
    if (typeof window !== "undefined" && sessionStorage.getItem("bdops-pin-ok") === "1") {
      setUnlocked(true);
      return;
    }
    if (!isLoading && pinStatus) {
      setMode(pinStatus.hasPin ? "verify" : "setup");
    }
  }, [isLoading, pinStatus]);

  // Heartbeat for online tracking
  const heartbeat = trpc.user.heartbeat.useMutation();
  useEffect(() => {
    if (!unlocked) return;
    // Send heartbeat immediately and every 2 minutes
    heartbeat.mutate();
    const interval = setInterval(() => heartbeat.mutate(), 2 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  if (unlocked) return <>{children}</>;
  if (isLoading || mode === "loading") {
    return (
      <div className="fixed inset-0 z-[100] bg-gray-900 flex items-center justify-center">
        <p className="text-white">Loading...</p>
      </div>
    );
  }

  const handleVerify = async () => {
    setError("");
    try {
      await verifyPin.mutateAsync({ pin });
      sessionStorage.setItem("bdops-pin-ok", "1");
      setUnlocked(true);
    } catch (e: any) {
      setError(e.message || "Incorrect PIN");
      setPin("");
    }
  };

  const handleSetup = async () => {
    setError("");
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs do not match");
      return;
    }
    try {
      await setupPin.mutateAsync({ pin });
      sessionStorage.setItem("bdops-pin-ok", "1");
      setUnlocked(true);
    } catch (e: any) {
      setError(e.message || "Failed to set PIN");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-gray-900 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-sm mx-4">
        {mode === "verify" ? (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900">Enter PIN</h2>
              <p className="text-sm text-gray-500 mt-1">Enter your PIN to access BDOps</p>
            </div>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="Enter PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              className="text-center text-2xl tracking-[0.5em] mb-4"
              autoFocus
            />
            {error && <p className="text-sm text-red-600 text-center mb-3">{error}</p>}
            <Button className="w-full" onClick={handleVerify} disabled={pin.length < 4 || verifyPin.isLoading}>
              {verifyPin.isLoading ? "Verifying..." : "Unlock"}
            </Button>
          </>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900">Setup PIN</h2>
              <p className="text-sm text-gray-500 mt-1">Create a 4-6 digit PIN to secure your account</p>
            </div>
            <div className="space-y-3 mb-4">
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="New PIN (4-6 digits)"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="text-center text-2xl tracking-[0.5em]"
                autoFocus
              />
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="Confirm PIN"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && handleSetup()}
                className="text-center text-2xl tracking-[0.5em]"
              />
            </div>
            {error && <p className="text-sm text-red-600 text-center mb-3">{error}</p>}
            <Button className="w-full" onClick={handleSetup} disabled={pin.length < 4 || setupPin.isLoading}>
              {setupPin.isLoading ? "Setting up..." : "Set PIN & Continue"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
