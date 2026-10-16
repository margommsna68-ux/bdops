"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n";
import { BrandMark, BRAND_NAME, BRAND_SLOGAN } from "@/components/BrandMark";

// Only allow same-origin relative paths to prevent open redirect
function sanitizeCallbackUrl(raw: string | null): string {
  if (!raw) return "/";
  // Reject protocol-relative URLs (//evil.com) and absolute URLs
  if (raw.startsWith("//") || /^[a-z]+:/i.test(raw)) return "/";
  if (!raw.startsWith("/")) return "/";
  return raw;
}

function LoginForm() {
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const callbackUrl = sanitizeCallbackUrl(searchParams.get("callbackUrl"));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await signIn("credentials", {
      username,
      password,
      redirect: false,
      callbackUrl,
    });

    if (res?.error) {
      // Extract server error message (e.g. ACCOUNT_LOCKED, INVALID_CREDENTIALS)
      const raw = res.error || "";
      if (raw.startsWith("ACCOUNT_LOCKED:")) {
        setError(raw.replace("ACCOUNT_LOCKED: ", ""));
      } else if (raw.startsWith("INVALID_CREDENTIALS:")) {
        setError(raw.replace("INVALID_CREDENTIALS: ", ""));
      } else {
        setError(t("login_invalid_credentials"));
      }
      setLoading(false);
    } else if (res?.url) {
      // Only follow same-origin URLs
      try {
        const u = new URL(res.url, window.location.origin);
        if (u.origin === window.location.origin) {
          window.location.href = u.pathname + u.search + u.hash;
        } else {
          window.location.href = "/";
        }
      } catch {
        window.location.href = "/";
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("login_username_label")}
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="username"
          autoComplete="username"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("login_password_label")}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="********"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 text-center">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 px-4 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/25 disabled:opacity-50 transition-all duration-200"
      >
        {loading ? t("login_authenticating") : t("login_submit")}
      </button>
    </form>
  );
}

function LoginPageInner() {
  const t = useT();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900">
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-2xl shadow-2xl border border-gray-100 animate-fade-in">
        <div className="text-center">
          <div className="flex justify-center mb-4"><BrandMark size={56} /></div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{BRAND_NAME}</h1>
          <p className="mt-1.5 text-sm text-gray-500 tracking-wide">{BRAND_SLOGAN}</p>
        </div>

        <Suspense fallback={<div className="text-center text-gray-400">{t("loading_dots")}</div>}>
          <LoginForm />
        </Suspense>

        <p className="text-xs text-center text-gray-500">
          {t("login_contact_admin")}
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginPageInner />;
}
