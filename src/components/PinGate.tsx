"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TotpSetup } from "@/components/TotpSetup";

/**
 * PinGate - Shows full-screen overlay after login.
 * 23/10/2026 (2FA, owner decision): the state comes from user.securityStatus and is decided by the SERVER:
 * - totpRequired && !totpEnabled → forced 2FA setup (cannot be skipped);
 * - totpEnabled && !unlocked      → Google Authenticator code (or a backup code) → user.verifyPin;
 * - otherwise                     → the legacy PIN flow (verify / set) with a link "Bật 2FA (khuyên dùng)".
 * Nothing is kept in the browser; any call refused with PIN_REQUIRED (window event mth:pin-required) locks again.
 */
export function PinGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [optIn, setOptIn] = useState(false); // "Bật 2FA (khuyên dùng)" from the PIN screen

  const utils = trpc.useUtils();
  const { data: status, isLoading, refetch } = trpc.user.securityStatus.useQuery(undefined, { retry: false });
  const verifyPin = trpc.user.verifyPin.useMutation();
  const setupPin = trpc.user.setPin.useMutation();
  const setOwnPassword = trpc.user.setOwnPassword.useMutation();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") sessionStorage.removeItem("bdops-pin-ok"); // the old client flag proves nothing
    if (!isLoading && status) setUnlocked(!!status.unlocked);
  }, [isLoading, status]);
  useEffect(() => {
    const relock = () => { setUnlocked(false); setCode(""); setPin(""); void refetch(); };
    window.addEventListener("mth:pin-required", relock);
    return () => window.removeEventListener("mth:pin-required", relock);
  }, [refetch]);

  // Heartbeat for online tracking
  const heartbeat = trpc.user.heartbeat.useMutation();
  useEffect(() => {
    if (!unlocked) return;
    heartbeat.mutate();
    const interval = setInterval(() => heartbeat.mutate(), 2 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  if (unlocked) return <>{children}</>;
  if (isLoading || !status) {
    return (
      <div className="mth-pin-backdrop fixed inset-0 z-[100] bg-gray-900 flex items-center justify-center">
        <p className="text-white">Loading...</p>
      </div>
    );
  }

  const finishUnlock = async () => {
    await refetch();
    setUnlocked(true);
    void utils.invalidate();
  };
  const handleCode = async () => {
    const value = code.trim();
    if (value.length < 6) return;
    setError("");
    try {
      await verifyPin.mutateAsync({ pin: value });
      setCode("");
      await finishUnlock();
    } catch (e: any) {
      setError(String(e?.message || "Mã chưa đúng").replace(/^PIN_LOCKED:\s*/, ""));
      setCode("");
    }
  };
  const handleVerify = async () => {
    setError("");
    try {
      await verifyPin.mutateAsync({ pin });
      setPin("");
      await finishUnlock();
    } catch (e: any) {
      setError(String(e?.message || "Incorrect PIN").replace(/^PIN_LOCKED:\s*/, ""));
      setPin("");
    }
  };
  const handleSetup = async () => {
    setError("");
    if (pin.length < 4) { setError("PIN must be at least 4 digits"); return; }
    if (pin !== confirmPin) { setError("PINs do not match"); return; }
    try {
      await setupPin.mutateAsync({ pin });
      setPin(""); setConfirmPin("");
      await finishUnlock();
    } catch (e: any) {
      setError(e.message || "Failed to set PIN");
    }
  };

  const forcedSetup = status.totpRequired && !status.totpEnabled;
  const codeMode = status.totpEnabled && !status.unlocked;
  const mode: "password" | "setup2fa" | "code" | "verify" | "setup" = status.passwordResetRequired ? "password" : forcedSetup || (optIn && !status.totpEnabled) ? "setup2fa" : codeMode ? "code" : status.hasPin ? "verify" : "setup";
  const handlePassword = async () => {
    setError("");
    if (newPassword.length < 8) { setError("Mật khẩu mới ít nhất 8 ký tự"); return; }
    if (newPassword !== confirmPassword) { setError("Hai lần nhập chưa khớp"); return; }
    try { await setOwnPassword.mutateAsync({ newPassword }); setNewPassword(""); setConfirmPassword(""); await refetch(); }
    catch (e: any) { setError(e?.message || "Không đặt được mật khẩu"); }
  };

  return (
    <div className="mth-pin-backdrop fixed inset-0 z-[100] bg-gray-900 flex items-center justify-center overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-sm mx-4 my-6" data-testid={"pin-gate-" + mode}>
        {mode === "password" ? (
          <div data-testid="password-reset-form">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">Đặt mật khẩu của bạn</h2>
              <p className="text-sm text-gray-500 mt-1">ADMIN đã đặt lại mật khẩu tạm. Hãy chọn mật khẩu riêng (ít nhất 8 ký tự) để tiếp tục.</p>
            </div>
            <div className="space-y-3 mb-4">
              <Input type="password" placeholder="Mật khẩu mới" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" autoFocus />
              <Input type="password" placeholder="Nhập lại mật khẩu mới" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handlePassword()} autoComplete="new-password" />
            </div>
            {error && <p className="text-sm text-red-600 text-center mb-3">{error}</p>}
            <Button className="w-full" onClick={handlePassword} disabled={newPassword.length < 8 || setOwnPassword.isLoading}>{setOwnPassword.isLoading ? "Đang lưu..." : "Lưu mật khẩu và tiếp tục"}</Button>
          </div>
        ) : mode === "setup2fa" ? (
          <TotpSetup forced={forcedSetup} onDone={() => { setOptIn(false); void finishUnlock(); }} onCancel={forcedSetup ? undefined : () => setOptIn(false)} />
        ) : mode === "code" ? (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900">Nhập mã Google Authenticator</h2>
              <p className="text-sm text-gray-500 mt-1">6 số trong ứng dụng, hoặc một mã dự phòng (xxxxx-xxxxx)</p>
            </div>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={11}
              aria-label="Mã Google Authenticator"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9a-zA-Z-]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && handleCode()}
              className="text-center text-2xl tracking-[0.3em] mb-4"
              autoFocus
            />
            {error && <p role="alert" className="text-sm text-red-600 text-center mb-3">{error}</p>}
            <Button className="w-full" onClick={handleCode} disabled={code.trim().length < 6 || verifyPin.isLoading}>
              {verifyPin.isLoading ? "Đang kiểm tra…" : "Mở khoá"}
            </Button>
            {status.backupCodesLeft === 0 && <p className="text-xs text-amber-700 text-center mt-3">Bạn không còn mã dự phòng. Mất điện thoại thì nhờ ADMIN đặt lại 2FA.</p>}
          </>
        ) : mode === "verify" ? (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900">Enter PIN</h2>
              <p className="text-sm text-gray-500 mt-1">Nhập PIN để vào MoneyToHome</p>
            </div>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="Enter PIN"
              aria-label="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              className="text-center text-2xl tracking-[0.5em] mb-4"
              autoFocus
            />
            {error && <p role="alert" className="text-sm text-red-600 text-center mb-3">{error}</p>}
            <Button className="w-full" onClick={handleVerify} disabled={pin.length < 4 || verifyPin.isLoading}>
              {verifyPin.isLoading ? "Verifying..." : "Unlock"}
            </Button>
            <button type="button" className="block mx-auto mt-4 text-xs text-blue-600 hover:underline" onClick={() => { setError(""); setOptIn(true); }}>Bật 2FA (khuyên dùng)</button>
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
                aria-label="PIN mới"
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
                aria-label="Xác nhận PIN"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && handleSetup()}
                className="text-center text-2xl tracking-[0.5em]"
              />
            </div>
            {error && <p role="alert" className="text-sm text-red-600 text-center mb-3">{error}</p>}
            <Button className="w-full" onClick={handleSetup} disabled={pin.length < 4 || setupPin.isLoading}>
              {setupPin.isLoading ? "Setting up..." : "Set PIN & Continue"}
            </Button>
            <button type="button" className="block mx-auto mt-4 text-xs text-blue-600 hover:underline" onClick={() => { setError(""); setOptIn(true); }}>Bật 2FA (khuyên dùng)</button>
          </>
        )}
      </div>
    </div>
  );
}
