/**
 * Shared agent fee calculation utility.
 * Single source of truth — used by walletBalance, agentPerformance, adminDashboard, myTransactions.
 * Matches walletBalance logic EXACTLY: confirmed only, project-specific fee → fallback → 0.
 */

import { type PrismaClient } from "@prisma/client";

export interface FeeByProject {
  byProject: Map<string, number>;
  fallback: number;
}

/**
 * Load agentFeePercent for a set of user IDs.
 * Returns Map<userId, FeeByProject> with per-project fee and fallback.
 */
export async function loadAgentFees(
  prisma: PrismaClient,
  userIds: string[]
): Promise<Map<string, FeeByProject>> {
  if (userIds.length === 0) return new Map();

  const rows = await prisma.projectMember.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, projectId: true, agentFeePercent: true },
  });

  const result = new Map<string, FeeByProject>();
  for (const uid of userIds) {
    result.set(uid, { byProject: new Map(), fallback: 0 });
  }

  for (const m of rows) {
    if (m.agentFeePercent == null) continue;
    const pct = Number(m.agentFeePercent.toString());
    const entry = result.get(m.userId);
    if (!entry) continue;
    entry.byProject.set(m.projectId, pct);
    if (entry.fallback === 0 && pct > 0) entry.fallback = pct;
  }

  return result;
}

/**
 * Get fee% for a user in a specific project.
 * Exact project match → fallback (any project) → 0
 */
export function getFeePercent(fees: FeeByProject, projectId: string): number {
  return fees.byProject.get(projectId) ?? fees.fallback;
}

/**
 * Calculate financial totals from withdrawals (confirmed only — paypalFee != null).
 */
export function calcFinancials(
  withdrawals: Array<{ amount: any; paypalFee: any; projectId: string; paidToTeam?: boolean }>,
  fees: FeeByProject
) {
  let gross = 0, totalFees = 0, commission = 0, totalAfterFee = 0, unpaidTAF = 0;
  for (const w of withdrawals) {
    if (w.paypalFee == null) continue;
    const g = Number(w.amount);
    const f = Number(w.paypalFee);
    const net = g - f;
    const pct = getFeePercent(fees, w.projectId);
    const comm = net * pct / 100;
    const taf = net - comm;
    gross += g;
    totalFees += f;
    commission += comm;
    totalAfterFee += taf;
    if (!w.paidToTeam) unpaidTAF += taf;
  }
  return { gross, fees: totalFees, net: gross - totalFees, commission, totalAfterFee, unpaidTAF };
}
