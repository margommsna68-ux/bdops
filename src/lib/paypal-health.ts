/**
 * PayPal Token Health Check System
 * Validates refresh tokens by attempting to get access tokens.
 * Does NOT scan emails — just checks if token is still valid.
 */

import { parseTokenField } from "./pp-checker";

const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const DEFAULT_CLIENT_ID = "9e5f94bc-e8a4-4e73-b8be-63364c29d753";
const BATCH_SIZE = 10;
const RATE_LIMIT_DELAY = 200; // ms between batches

export type TokenHealthStatus = "HEALTHY" | "INVALID" | "ERROR" | "MISSING";

export interface TokenHealthResult {
  paypalId: string;
  paypalCode: string;
  email: string;
  status: TokenHealthStatus;
  error?: string;
  checkedAt: string;
}

export interface TokenHealthSummary {
  total: number;
  healthy: number;
  invalid: number;
  errors: number;
  missing: number;
  results: TokenHealthResult[];
  durationMs: number;
}

// ─── Resolve tokens from PP + emails ───

export interface PayPalTokenInfo {
  paypalId: string;
  paypalCode: string;
  email: string;
  rawToken: string;
}

/**
 * Check if a single token is valid by trying to refresh it.
 * For Outlook: attempt token refresh via Microsoft API.
 * For Gmail: attempt IMAP connection test (just login/logout).
 */
async function checkTokenHealth(rawToken: string): Promise<{ status: TokenHealthStatus; error?: string }> {
  try {
    const parsed = parseTokenField(rawToken);
    if (!parsed) return { status: "INVALID", error: "Cannot parse token format" };

    if (parsed.type === "outlook") {
      // Try to refresh the access token
      const params = new URLSearchParams({
        client_id: parsed.clientId || DEFAULT_CLIENT_ID,
        refresh_token: parsed.refreshToken,
        grant_type: "refresh_token",
        scope: "https://graph.microsoft.com/Mail.Read offline_access",
      });
      const resp = await fetch(MICROSOFT_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.access_token) return { status: "HEALTHY" };
        return { status: "ERROR", error: "No access_token in response" };
      }

      const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
      return inferStatusFromError(resp.status, errText);
    } else {
      // Gmail: verify by attempting IMAP login — proxy REQUIRED
      if (!parsed.email || !parsed.appPassword) {
        return { status: "INVALID", error: "Missing Gmail credentials" };
      }
      if (!parsed.proxy) {
        return { status: "ERROR", error: "Gmail thiếu proxy — format: email|appPassword|host:port:user:pass" };
      }
      try {
        const { ImapFlow } = await import("imapflow");
        const imapConfig: any = {
          host: "imap.gmail.com",
          port: 993,
          secure: true,
          auth: { user: parsed.email, pass: parsed.appPassword },
          logger: false,
        };
        // Add proxy if present in token
        if (parsed.proxy) {
          const proxyParts = parsed.proxy.split(":");
          if (proxyParts.length >= 2) {
            const proxyHost = proxyParts[0];
            const proxyPort = parseInt(proxyParts[1], 10);
            const proxyUser = proxyParts[2] || undefined;
            const proxyPass = proxyParts.slice(3).join(":") || undefined;
            const auth = proxyUser && proxyPass
              ? `${encodeURIComponent(proxyUser)}:${encodeURIComponent(proxyPass)}@`
              : "";
            imapConfig.proxy = `socks5://${auth}${proxyHost}:${proxyPort}`;
          }
        }
        const client = new ImapFlow(imapConfig);
        await client.connect();
        await client.logout();
        return { status: "HEALTHY" };
      } catch (err: any) {
        const msg = err.message || "";
        if (msg.includes("Invalid credentials") || msg.includes("AUTHENTICATIONFAILED")) {
          return { status: "INVALID", error: "Gmail app password invalid" };
        }
        return { status: "ERROR", error: msg.slice(0, 200) };
      }
    }
  } catch (err: any) {
    return { status: "ERROR", error: err.message?.slice(0, 200) || "Unknown error" };
  }
}

/**
 * Analyze error response to determine health status
 */
export function inferStatusFromError(httpStatus: number, errorText: string): { status: TokenHealthStatus; error: string } {
  const lower = errorText.toLowerCase();

  // Token revoked or invalid
  if (httpStatus === 400 && (lower.includes("invalid_grant") || lower.includes("token has been revoked"))) {
    return { status: "INVALID", error: "Token revoked or expired" };
  }

  // Unauthorized
  if (httpStatus === 401) {
    return { status: "INVALID", error: "Token unauthorized" };
  }

  // Rate limited
  if (httpStatus === 429) {
    return { status: "ERROR", error: "Rate limited — try again later" };
  }

  // Server error
  if (httpStatus >= 500) {
    return { status: "ERROR", error: `Server error (${httpStatus})` };
  }

  return { status: "ERROR", error: errorText.slice(0, 200) };
}

/**
 * Run batch token health check with parallel execution and rate limiting
 */
export async function runPayPalTokenHealthCheck(
  tokens: PayPalTokenInfo[]
): Promise<TokenHealthSummary> {
  const start = Date.now();
  const results: TokenHealthResult[] = [];

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (t) => {
        const health = await checkTokenHealth(t.rawToken);
        return {
          paypalId: t.paypalId,
          paypalCode: t.paypalCode,
          email: t.email,
          status: health.status,
          error: health.error,
          checkedAt: new Date().toISOString(),
        } satisfies TokenHealthResult;
      })
    );

    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        results.push({
          paypalId: batch[j].paypalId,
          paypalCode: batch[j].paypalCode,
          email: batch[j].email,
          status: "ERROR",
          error: r.reason?.message || "Unknown",
          checkedAt: new Date().toISOString(),
        });
      }
    }

    // Rate limit delay between batches
    if (i + BATCH_SIZE < tokens.length) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY));
    }
  }

  return {
    total: tokens.length,
    healthy: results.filter((r) => r.status === "HEALTHY").length,
    invalid: results.filter((r) => r.status === "INVALID").length,
    errors: results.filter((r) => r.status === "ERROR").length,
    missing: results.filter((r) => r.status === "MISSING").length,
    results,
    durationMs: Date.now() - start,
  };
}
