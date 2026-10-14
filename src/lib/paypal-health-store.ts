/**
 * PayPal Health State Store
 * In-memory store for token health check results and auto-check scheduling.
 * State persists via project settings JSON field in DB.
 */

export interface TokenHealthRecord {
  paypalId: string;
  status: "HEALTHY" | "INVALID" | "ERROR" | "MISSING";
  error?: string;
  checkedAt: string;
}

export interface AutoCheckSummary {
  lastRunAt: string;
  nextRunAt?: string;
  totalChecked: number;
  healthy: number;
  invalid: number;
  errors: number;
  missing: number;
  durationMs: number;
  cronExpression: string;
}

export interface PaypalSchedulerState {
  enabled: boolean;
  cronExpression: string;
  lastRun?: AutoCheckSummary;
  healthRecords: Map<string, TokenHealthRecord>;
  telegramAlertCooldowns: Map<string, number>; // paypalId -> last alert timestamp
}

// In-memory state per project
const projectStates = new Map<string, PaypalSchedulerState>();

export function getPaypalHealthState(projectId: string): PaypalSchedulerState {
  if (!projectStates.has(projectId)) {
    projectStates.set(projectId, {
      enabled: true,
      cronExpression: process.env.PAYPAL_AUTO_CHECK_CRON || "*/30 * * * *",
      healthRecords: new Map(),
      telegramAlertCooldowns: new Map(),
    });
  }
  return projectStates.get(projectId)!;
}

export function updateProjectPaypalHealthState(
  projectId: string,
  summary: AutoCheckSummary,
  records: TokenHealthRecord[]
): void {
  const state = getPaypalHealthState(projectId);
  state.lastRun = summary;
  for (const record of records) {
    state.healthRecords.set(record.paypalId, record);
  }
}

export function getHealthOverview(projectId: string, totalPPs: number): {
  total: number;
  healthy: number;
  invalid: number;
  errors: number;
  missing: number;
  noData: number;
  lastCheckAt: string | null;
  cronExpression: string;
} {
  const state = getPaypalHealthState(projectId);
  const records = Array.from(state.healthRecords.values());

  const healthy = records.filter((r) => r.status === "HEALTHY").length;
  const invalid = records.filter((r) => r.status === "INVALID").length;
  const errors = records.filter((r) => r.status === "ERROR").length;
  const missing = records.filter((r) => r.status === "MISSING").length;
  const noData = totalPPs - records.length;

  return {
    total: totalPPs,
    healthy,
    invalid,
    errors,
    missing,
    noData: Math.max(0, noData),
    lastCheckAt: state.lastRun?.lastRunAt || null,
    cronExpression: state.cronExpression,
  };
}

export function shouldSendTelegramAlert(projectId: string, paypalId: string): boolean {
  const state = getPaypalHealthState(projectId);
  const cooldownMs = (parseInt(process.env.PAYPAL_TELEGRAM_ALERT_COOLDOWN_MINUTES || "180", 10)) * 60 * 1000;
  const lastAlert = state.telegramAlertCooldowns.get(paypalId) || 0;
  return Date.now() - lastAlert > cooldownMs;
}

export function markTelegramAlertSent(projectId: string, paypalId: string): void {
  const state = getPaypalHealthState(projectId);
  state.telegramAlertCooldowns.set(paypalId, Date.now());
}
