/**
 * PP Status Checker - Scan emails for PayPal suspend/limit notifications
 * Supports: Outlook/Hotmail (Graph API) + Gmail (IMAP)
 * Built for BDOps, optimized for speed and accuracy
 */

import { ImapFlow } from "imapflow";

const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_API_URL = "https://graph.microsoft.com/v1.0";
const DEFAULT_CLIENT_ID = "9e5f94bc-e8a4-4e73-b8be-63364c29d753";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

// ═══════════════════════════════════════
// TOKEN PARSING
// ═══════════════════════════════════════

// Outlook: email|password|refreshToken|clientId
// Gmail:   email|appPassword|proxy

export type TokenType = "outlook" | "gmail";

export interface ParsedOutlookToken {
  type: "outlook";
  email?: string;
  refreshToken: string;
  clientId: string;
}

export interface ParsedGmailToken {
  type: "gmail";
  email: string;
  appPassword: string;
  proxy?: string; // host:port:user:pass
}

export type ParsedToken = ParsedOutlookToken | ParsedGmailToken;

function isGmailEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain ? GMAIL_DOMAINS.has(domain) : false;
}

export function parseTokenField(raw: string): ParsedToken | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  const parts = trimmed.split("|").map((p) => p.trim());

  // Detect Gmail: first part is gmail address
  if (parts.length >= 2 && parts[0].includes("@") && isGmailEmail(parts[0])) {
    return {
      type: "gmail",
      email: parts[0],
      appPassword: parts[1],
      proxy: parts[2] || undefined,
    };
  }

  // Detect Outlook: first part is outlook/hotmail email OR token starts with M.
  if (parts.length === 1) {
    return { type: "outlook", refreshToken: parts[0], clientId: DEFAULT_CLIENT_ID };
  }

  let refreshToken = "";
  let clientId = DEFAULT_CLIENT_ID;
  let email: string | undefined;

  for (const p of parts) {
    if (!p) continue;
    if (UUID_RE.test(p)) {
      clientId = p;
    } else if (p.startsWith("M.") || p.startsWith("0.") || p.length > 100) {
      refreshToken = p;
    } else if (p.includes("@")) {
      email = p;
    }
  }

  if (!refreshToken) {
    const candidates = parts.filter((p) => p && !UUID_RE.test(p) && !p.includes("@"));
    if (candidates.length > 0) {
      refreshToken = candidates.reduce((a, b) => (a.length > b.length ? a : b));
    }
  }

  if (!refreshToken) return null;
  return { type: "outlook", email, refreshToken, clientId };
}

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

export type PPAlertType = "permanently_deactivated" | "features_paused" | "account_limited" | "none";

export interface PPCheckResult {
  paypalId: string;
  paypalCode: string;
  emailChecked: string;
  alertType: PPAlertType;
  alertSubject?: string;
  alertDate?: string;
  newStatus?: "SUSPENDED" | "LIMITED";
  error?: string;
}

export interface PPCheckSummary {
  total: number;
  checked: number;
  suspended: number;
  limited: number;
  clean: number;
  errors: number;
  results: PPCheckResult[];
  durationMs: number;
}

export interface MailboxEmail {
  id: string;
  subject: string;
  sender: string;
  senderName: string;
  receivedAt: string;
  preview: string;
  isRead: boolean;
}

// ═══════════════════════════════════════
// OUTLOOK (Microsoft Graph API)
// ═══════════════════════════════════════

const SCOPES = [
  "https://graph.microsoft.com/Mail.Read offline_access",
  "https://outlook.office.com/mail.read offline_access",
];

async function refreshAccessToken(refreshToken: string, clientId: string = DEFAULT_CLIENT_ID): Promise<string> {
  let lastError = "";
  for (const scope of SCOPES) {
    const params = new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope,
    });
    const resp = await fetch(MICROSOFT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.access_token) return data.access_token;
    }
    lastError = await resp.text().catch(() => `HTTP ${resp.status}`);
  }
  throw new Error(`Token refresh failed: ${lastError.slice(0, 200)}`);
}

async function outlookFetchPayPalEmails(accessToken: string): Promise<MailboxEmail[]> {
  const filter = encodeURIComponent(
    "(from/emailAddress/address eq 'service@paypal.com' or " +
    "from/emailAddress/address eq 'service@intl.paypal.com' or " +
    "from/emailAddress/address eq 'paypal@mail.paypal.com')"
  );
  const select = "id,subject,from,receivedDateTime,bodyPreview,isRead";
  const url = `${GRAPH_API_URL}/me/messages?$filter=${filter}&$select=${select}&$top=200&$orderby=receivedDateTime desc`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) throw new Error(`Graph API (${resp.status})`);
  const data = await resp.json();
  return (data.value || []).map((msg: any) => ({
    id: msg.id,
    subject: msg.subject || "(No Subject)",
    sender: msg.from?.emailAddress?.address || "",
    senderName: msg.from?.emailAddress?.name || "",
    receivedAt: msg.receivedDateTime,
    preview: msg.bodyPreview || "",
    isRead: msg.isRead ?? true,
  }));
}

async function outlookReadMailbox(accessToken: string, count: number): Promise<MailboxEmail[]> {
  const select = "id,subject,from,receivedDateTime,bodyPreview,isRead";
  const url = `${GRAPH_API_URL}/me/messages?$select=${select}&$top=${count}&$orderby=receivedDateTime desc`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) throw new Error(`Graph API (${resp.status})`);
  const data = await resp.json();
  return (data.value || []).map((msg: any) => ({
    id: msg.id,
    subject: msg.subject || "(No Subject)",
    sender: msg.from?.emailAddress?.address || "",
    senderName: msg.from?.emailAddress?.name || "",
    receivedAt: msg.receivedDateTime,
    preview: msg.bodyPreview || "",
    isRead: msg.isRead ?? true,
  }));
}

async function outlookReadEmailContent(accessToken: string, messageId: string) {
  const url = `${GRAPH_API_URL}/me/messages/${messageId}?$select=subject,from,receivedDateTime,body`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.body-content-type="html"',
    },
  });
  if (!resp.ok) throw new Error(`Graph API (${resp.status})`);
  const msg = await resp.json();
  return {
    subject: msg.subject || "",
    sender: msg.from?.emailAddress?.address || "",
    senderName: msg.from?.emailAddress?.name || "",
    receivedAt: msg.receivedDateTime || "",
    body: msg.body?.content || "",
  };
}

// ═══════════════════════════════════════
// GMAIL (IMAP)
// ═══════════════════════════════════════

function parseProxy(proxyStr: string): { host: string; port: number; username?: string; password?: string } | null {
  const parts = proxyStr.split(":");
  if (parts.length < 2) return null;
  return {
    host: parts[0],
    port: parseInt(parts[1], 10),
    username: parts[2] || undefined,
    password: parts.slice(3).join(":") || undefined,
  };
}

function buildProxyUrl(proxy: { host: string; port: number; username?: string; password?: string }): string {
  const auth = proxy.username && proxy.password
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : "";
  return `socks5://${auth}${proxy.host}:${proxy.port}`;
}

async function gmailFetchEmails(
  email: string,
  appPassword: string,
  proxyStr?: string,
  options?: { paypalOnly?: boolean; maxEmails?: number; lookbackDays?: number }
): Promise<MailboxEmail[]> {
  const maxEmails = options?.maxEmails ?? 30;
  const lookbackDays = options?.lookbackDays ?? 365;
  const paypalSenders = ["service@paypal.com", "service@intl.paypal.com", "paypal@mail.paypal.com"];

  const imapConfig: any = {
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
  };

  if (proxyStr) {
    const proxy = parseProxy(proxyStr);
    if (proxy) imapConfig.proxy = buildProxyUrl(proxy);
  }

  const client = new ImapFlow(imapConfig);
  await client.connect();

  try {
    await client.mailboxOpen("INBOX");
    const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    let uids: number[] | Uint32Array;
    if (options?.paypalOnly) {
      const allUids = new Set<number>();
      for (const sender of paypalSenders) {
        const senderUids = await client.search({ since: sinceDate, from: sender }) as number[] | false;
        if (senderUids && Array.isArray(senderUids)) {
          for (const uid of senderUids) allUids.add(uid);
        }
      }
      uids = Array.from(allUids);
    } else {
      const searchResult = await client.search({ since: sinceDate });
      uids = searchResult ? (Array.isArray(searchResult) ? searchResult : Array.from(searchResult)) : [];
    }

    if (uids.length === 0) return [];

    const selectedUids = Array.from(uids).slice(-maxEmails);
    const emails: MailboxEmail[] = [];

    for await (const message of client.fetch(selectedUids, {
      uid: true,
      envelope: true,
      source: true,
      flags: true,
      internalDate: true,
    })) {
      const env = message.envelope;
      const from = env?.from?.[0];

      let bodyContent = "";
      if (message.source) {
        const raw = Buffer.from(message.source).toString("utf8");
        const bodyParts = raw.split(/\r?\n\r?\n/);
        if (bodyParts.length > 1) {
          bodyContent = bodyParts.slice(1).join("\n\n")
            .replace(/=\r?\n/g, "")
            .replace(/=([A-F0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }
      }

      const receivedDate = message.internalDate ? new Date(message.internalDate) : new Date();

      emails.push({
        id: String(message.uid || `${receivedDate.getTime()}-${emails.length}`),
        subject: env?.subject || "(No Subject)",
        sender: from?.address || "",
        senderName: from?.name || "",
        receivedAt: receivedDate.toISOString(),
        preview: bodyContent.slice(0, 250),
        isRead: message.flags?.has("\\Seen") ?? false,
      });
    }

    emails.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
    return emails;
  } finally {
    try { await client.logout(); } catch {}
  }
}

// ═══════════════════════════════════════
// PATTERN MATCHING
// ═══════════════════════════════════════

const SUSPEND_PATTERNS = [
  /permanently deactivated/i,
  /vô hiệu hóa vĩnh viễn/i,
  /account has been permanently/i,
  /tài khoản.*đã bị.*vô hiệu/i,
];

const LIMIT_PATTERNS = [
  /paused some of your account features/i,
  /tạm dừng một số tính năng/i,
  /tạm dừng các tính năng/i,
  /account limitation/i,
  /account.*limited/i,
  /hạn chế tài khoản/i,
  /we've limited your account/i,
  /we need you to resolve/i,
  /action required.*account/i,
];

function detectAlertType(subject: string, bodyPreview: string): PPAlertType {
  const text = `${subject} ${bodyPreview}`.toLowerCase();
  for (const pat of SUSPEND_PATTERNS) {
    if (pat.test(text)) return "permanently_deactivated";
  }
  for (const pat of LIMIT_PATTERNS) {
    if (pat.test(text)) return "features_paused";
  }
  return "none";
}

// ═══════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════

export async function checkSinglePP(
  rawToken: string,
  paypalId: string,
  paypalCode: string,
  email: string,
): Promise<PPCheckResult> {
  try {
    const parsed = parseTokenField(rawToken);
    if (!parsed) {
      return { paypalId, paypalCode, emailChecked: email, alertType: "none", error: "Token không hợp lệ" };
    }

    let emails: MailboxEmail[];

    if (parsed.type === "gmail") {
      emails = await gmailFetchEmails(parsed.email, parsed.appPassword, parsed.proxy, { paypalOnly: true, maxEmails: 200 });
    } else {
      const accessToken = await refreshAccessToken(parsed.refreshToken, parsed.clientId);
      emails = await outlookFetchPayPalEmails(accessToken);
    }

    for (const msg of emails) {
      const alertType = detectAlertType(msg.subject, msg.preview);
      if (alertType !== "none") {
        return {
          paypalId,
          paypalCode,
          emailChecked: email,
          alertType,
          alertSubject: msg.subject,
          alertDate: msg.receivedAt,
          newStatus: alertType === "permanently_deactivated" ? "SUSPENDED" : "LIMITED",
        };
      }
    }

    return { paypalId, paypalCode, emailChecked: email, alertType: "none" };
  } catch (err: any) {
    return { paypalId, paypalCode, emailChecked: email, alertType: "none", error: err.message || "Unknown error" };
  }
}

export async function readMailbox(
  rawToken: string,
  count: number = 30,
): Promise<{ emails: MailboxEmail[]; error?: string }> {
  try {
    const parsed = parseTokenField(rawToken);
    if (!parsed) return { emails: [], error: "Token không hợp lệ" };

    if (parsed.type === "gmail") {
      const emails = await gmailFetchEmails(parsed.email, parsed.appPassword, parsed.proxy, { maxEmails: count, lookbackDays: 30 });
      return { emails };
    } else {
      const accessToken = await refreshAccessToken(parsed.refreshToken, parsed.clientId);
      const emails = await outlookReadMailbox(accessToken, count);
      return { emails };
    }
  } catch (err: any) {
    return { emails: [], error: err.message || "Unknown error" };
  }
}

export async function readEmailContent(
  rawToken: string,
  messageId: string,
): Promise<{ subject: string; sender: string; senderName: string; receivedAt: string; body: string; error?: string }> {
  try {
    const parsed = parseTokenField(rawToken);
    if (!parsed) return { subject: "", sender: "", senderName: "", receivedAt: "", body: "", error: "Token không hợp lệ" };

    if (parsed.type === "gmail") {
      // Gmail IMAP: re-fetch specific message by UID
      const imapConfig: any = {
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: { user: parsed.email, pass: parsed.appPassword },
        logger: false,
      };
      if (parsed.proxy) {
        const proxy = parseProxy(parsed.proxy);
        if (proxy) imapConfig.proxy = buildProxyUrl(proxy);
      }

      const client = new ImapFlow(imapConfig);
      await client.connect();
      try {
        await client.mailboxOpen("INBOX");
        const uid = parseInt(messageId, 10);
        if (isNaN(uid)) throw new Error("Invalid message ID");

        let result = { subject: "", sender: "", senderName: "", receivedAt: "", body: "" };

        for await (const message of client.fetch([uid], {
          uid: true,
          envelope: true,
          source: true,
          internalDate: true,
        })) {
          const env = message.envelope;
          const from = env?.from?.[0];
          let bodyHtml = "";
          if (message.source) {
            const raw = Buffer.from(message.source).toString("utf8");
            const bodyParts = raw.split(/\r?\n\r?\n/);
            if (bodyParts.length > 1) {
              bodyHtml = bodyParts.slice(1).join("\n\n")
                .replace(/=\r?\n/g, "")
                .replace(/=([A-F0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
            }
          }
          result = {
            subject: env?.subject || "",
            sender: from?.address || "",
            senderName: from?.name || "",
            receivedAt: (message.internalDate ? new Date(message.internalDate) : new Date()).toISOString(),
            body: bodyHtml,
          };
        }

        return result;
      } finally {
        try { await client.logout(); } catch {}
      }
    } else {
      const accessToken = await refreshAccessToken(parsed.refreshToken, parsed.clientId);
      return outlookReadEmailContent(accessToken, messageId);
    }
  } catch (err: any) {
    return { subject: "", sender: "", senderName: "", receivedAt: "", body: "", error: err.message || "Unknown error" };
  }
}

// ─── Batch Check ───

const BATCH_SIZE = 5;

export async function checkBatchPP(
  accounts: Array<{
    paypalId: string;
    paypalCode: string;
    email: string;
    refreshToken: string;
  }>
): Promise<PPCheckSummary> {
  const start = Date.now();
  const results: PPCheckResult[] = [];

  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    const batch = accounts.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((acc) => checkSinglePP(acc.refreshToken, acc.paypalId, acc.paypalCode, acc.email))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        results.push({
          paypalId: batch[j]?.paypalId || "",
          paypalCode: batch[j]?.paypalCode || "",
          emailChecked: batch[j]?.email || "",
          alertType: "none",
          error: r.reason?.message || "Unknown error",
        });
      }
    }
  }

  return {
    total: accounts.length,
    checked: results.filter((r) => !r.error).length,
    suspended: results.filter((r) => r.newStatus === "SUSPENDED").length,
    limited: results.filter((r) => r.newStatus === "LIMITED").length,
    clean: results.filter((r) => !r.error && r.alertType === "none").length,
    errors: results.filter((r) => !!r.error).length,
    results,
    durationMs: Date.now() - start,
  };
}
