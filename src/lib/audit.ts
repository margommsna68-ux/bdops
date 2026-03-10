import { prisma } from "./prisma";
import { type Prisma } from "@prisma/client";

export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "DELETE_APPROVED" | "SETTLE" | "RECALCULATE";
export type AuditEntity = "FundTransaction" | "Withdrawal" | "CostRecord" | "ProfitSplit" | "SplitAllocation" | "PayPalAccount" | "Server" | "VirtualMachine" | "ProxyIP" | "GmailAccount" | "VMTask";

export async function createAuditLog(params: {
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  userId: string;
  projectId?: string;
  changes?: Record<string, unknown>;
}) {
  try {
    return await prisma.auditLog.create({
      data: {
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        userId: params.userId,
        projectId: params.projectId,
        changes: params.changes ? (params.changes as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch {
    // Audit logging should never fail the main operation
    console.error("Failed to create audit log", params);
  }
}
