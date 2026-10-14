// PayPal Health Auto-Check Scheduler
// Runs periodic token health checks and sends Telegram alerts.
//
// Env vars:
// - PAYPAL_AUTO_CHECK_CRON: Cron expression (default every 30 min)
// - PAYPAL_TELEGRAM_BOT_TOKEN: Telegram bot token for alerts
// - PAYPAL_TELEGRAM_CHAT_ID: Telegram chat ID for alerts
// - PAYPAL_TELEGRAM_ALERT_COOLDOWN_MINUTES: Min minutes between alerts per PP (default 180)

import { PrismaClient } from "@prisma/client";
import { decrypt } from "./encryption";
import { runPayPalTokenHealthCheck, type PayPalTokenInfo } from "./paypal-health";
import {
  updateProjectPaypalHealthState,
  shouldSendTelegramAlert,
  markTelegramAlertSent,
  type AutoCheckSummary,
  type TokenHealthRecord,
} from "./paypal-health-store";

// Per-project scheduler state (Bug #1 fix: was global singleton)
interface SchedulerEntry {
  timer: ReturnType<typeof setInterval> | null;
  isRunning: boolean;
}
const schedulers = new Map<string, SchedulerEntry>();

// ─── Telegram Alert ───

async function sendTelegramAlert(message: string): Promise<void> {
  const botToken = process.env.PAYPAL_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.PAYPAL_TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.error("[PayPal Scheduler] Telegram alert failed:", err);
  }
}

// ─── Resolve tokens from DB ───

async function resolvePayPalTokens(prisma: PrismaClient, projectId: string): Promise<PayPalTokenInfo[]> {
  const pps = await prisma.payPalAccount.findMany({
    where: { projectId },
    select: {
      id: true,
      code: true,
      primaryEmail: true,
      hotmailToken: true,
      emails: {
        where: { hotmailToken: { not: null } },
        select: { email: true, hotmailToken: true },
        take: 1,
      },
    },
  });

  const tokens: PayPalTokenInfo[] = [];

  for (const pp of pps) {
    let token: string | null = null;
    let email = pp.primaryEmail;

    if (pp.emails.length > 0 && pp.emails[0].hotmailToken) {
      try {
        token = decrypt(pp.emails[0].hotmailToken);
        email = pp.emails[0].email;
      } catch { /* skip */ }
    }

    if (!token && pp.hotmailToken) {
      try { token = decrypt(pp.hotmailToken); } catch { /* skip */ }
    }

    if (token) {
      tokens.push({ paypalId: pp.id, paypalCode: pp.code, email, rawToken: token });
    }
  }

  return tokens;
}

// ─── Run Check for a project ───

async function runAutoCheck(prisma: PrismaClient, projectId: string): Promise<void> {
  const entry = schedulers.get(projectId);
  if (entry?.isRunning) return;
  if (entry) entry.isRunning = true;

  try {
    const tokens = await resolvePayPalTokens(prisma, projectId);
    if (tokens.length === 0) return;

    const summary = await runPayPalTokenHealthCheck(tokens);

    const records: TokenHealthRecord[] = summary.results.map((r) => ({
      paypalId: r.paypalId,
      status: r.status,
      error: r.error,
      checkedAt: r.checkedAt,
    }));

    const autoSummary: AutoCheckSummary = {
      lastRunAt: new Date().toISOString(),
      totalChecked: summary.total,
      healthy: summary.healthy,
      invalid: summary.invalid,
      errors: summary.errors,
      missing: summary.missing,
      durationMs: summary.durationMs,
      cronExpression: process.env.PAYPAL_AUTO_CHECK_CRON || "*/30 * * * *",
    };

    updateProjectPaypalHealthState(projectId, autoSummary, records);

    // Batch update DB health fields (Bug #6 fix: was N+1 serial loop)
    const statusGroups: Record<string, string[]> = {};
    for (const r of summary.results) {
      const key = `${r.status}|||${r.error || ""}`;
      if (!statusGroups[key]) statusGroups[key] = [];
      statusGroups[key].push(r.paypalId);
    }
    for (const key of Object.keys(statusGroups)) {
      const [status, error] = key.split("|||");
      try {
        await prisma.payPalAccount.updateMany({
          where: { id: { in: statusGroups[key] } },
          data: {
            tokenHealthStatus: status,
            tokenHealthCheckedAt: new Date(),
            tokenHealthError: error || null,
          },
        });
      } catch { /* skip */ }
    }

    // Telegram alerts for INVALID tokens
    const invalidTokens = summary.results.filter((r) => r.status === "INVALID");
    for (const inv of invalidTokens) {
      if (shouldSendTelegramAlert(projectId, inv.paypalId)) {
        await sendTelegramAlert(
          `⚠️ <b>PayPal Token INVALID</b>\n` +
          `PP: <code>${inv.paypalCode}</code>\n` +
          `Email: ${inv.email}\n` +
          `Error: ${inv.error || "Token expired/revoked"}\n` +
          `Time: ${new Date().toLocaleString("vi-VN")}`
        );
        markTelegramAlertSent(projectId, inv.paypalId);
      }
    }

    console.log(
      `[PayPal Scheduler] [${projectId}] Auto-check done: ${summary.healthy} healthy, ${summary.invalid} invalid, ${summary.errors} errors (${summary.durationMs}ms)`
    );
  } catch (err) {
    console.error(`[PayPal Scheduler] [${projectId}] Auto-check failed:`, err);
  } finally {
    const entry = schedulers.get(projectId);
    if (entry) entry.isRunning = false;
  }
}

// ─── Scheduler Control ───

function parseCronIntervalMs(cron: string): number {
  const match = cron.match(/^\*\/(\d+)\s/);
  if (match) return parseInt(match[1], 10) * 60 * 1000;
  return 30 * 60 * 1000;
}

export function startPaypalScheduler(prisma: PrismaClient, projectId: string): void {
  if (schedulers.get(projectId)?.timer) return;

  const cronExpr = process.env.PAYPAL_AUTO_CHECK_CRON || "*/30 * * * *";
  const intervalMs = parseCronIntervalMs(cronExpr);

  console.log(`[PayPal Scheduler] Starting for project ${projectId} (interval ${intervalMs / 60000}min)`);

  setTimeout(() => runAutoCheck(prisma, projectId), 60_000);
  const timer = setInterval(() => runAutoCheck(prisma, projectId), intervalMs);
  schedulers.set(projectId, { timer, isRunning: false });
}

export function stopPaypalScheduler(projectId?: string): void {
  if (projectId) {
    const entry = schedulers.get(projectId);
    if (entry?.timer) {
      clearInterval(entry.timer);
      schedulers.delete(projectId);
      console.log(`[PayPal Scheduler] Stopped for project ${projectId}`);
    }
  } else {
    schedulers.forEach((entry, pid) => {
      if (entry.timer) clearInterval(entry.timer);
      console.log(`[PayPal Scheduler] Stopped for project ${pid}`);
    });
    schedulers.clear();
  }
}

export { resolvePayPalTokens };
