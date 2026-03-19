import { z } from "zod";
import { router, memberProcedure } from "../trpc";

export const notificationRouter = router({
  // Compute real-time alerts — filtered by user's role & modules
  alerts: memberProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { projectId } = input;
      const now = new Date();
      const role = ctx.role;
      const isAdminOrMod = role === "ADMIN" || role === "MODERATOR";
      const allowedModules: string[] = ctx.membership.allowedModules || [];

      // Helper: check if user has access to a module (admin = all, moderator/user = allowedModules)
      const hasModule = (mod: string) => role === "ADMIN" || allowedModules.includes(mod);

      const alerts: {
        id: string;
        type: string;
        severity: "info" | "warning" | "error";
        title: string;
        message: string;
        link?: string;
        createdAt: Date;
      }[] = [];

      // 1. Servers with payment due within 5 days — INFRASTRUCTURE module
      if (hasModule("INFRASTRUCTURE")) {
        const fiveDaysFromNow = new Date(now);
        fiveDaysFromNow.setDate(fiveDaysFromNow.getDate() + 5);
        const serversExpiring = await ctx.prisma.server.findMany({
          where: {
            projectId,
            status: { in: ["ACTIVE", "BUILDING", "MAINTENANCE"] },
            expiryDate: { lte: fiveDaysFromNow },
          },
          select: { id: true, code: true, expiryDate: true, monthlyCost: true },
          orderBy: { expiryDate: "asc" },
        });
        for (const s of serversExpiring) {
          const isOverdue = s.expiryDate && s.expiryDate < now;
          alerts.push({
            id: `srv-pay-${s.id}`,
            type: "SERVER_PAYMENT",
            severity: isOverdue ? "error" : "warning",
            title: isOverdue ? `${s.code} quá hạn thanh toán` : `${s.code} sắp đến hạn`,
            message: `$${Number(s.monthlyCost ?? 0)}/tháng`,
            link: "/infrastructure/servers",
            createdAt: s.expiryDate ?? now,
          });
        }
      }

      // 2. Delete requests pending — admin/moderator only
      if (isAdminOrMod) {
        const pendingDeletes = await ctx.prisma.deleteRequest.count({
          where: { projectId, status: "PENDING" },
        });
        if (pendingDeletes > 0) {
          alerts.push({
            id: "del-req-pending",
            type: "DELETE_REQUEST",
            severity: "warning",
            title: `${pendingDeletes} yêu cầu xóa chờ duyệt`,
            message: "Cần xem xét và phê duyệt",
            link: "/admin/delete-requests",
            createdAt: now,
          });
        }
      }

      // 3. PayPal accounts LIMITED — PAYPALS module
      if (hasModule("PAYPALS")) {
        const limitedPPs = await ctx.prisma.payPalAccount.count({
          where: { projectId, status: "LIMITED" },
        });
        if (limitedPPs > 0) {
          alerts.push({
            id: "pp-limited",
            type: "PP_LIMITED",
            severity: "error",
            title: `${limitedPPs} PayPal bị LIMITED`,
            message: "Cần xử lý updocs",
            link: "/paypals",
            createdAt: now,
          });
        }
      }

      // 4. VMs in ERROR state — INFRASTRUCTURE module
      if (hasModule("INFRASTRUCTURE")) {
        const errorVMs = await ctx.prisma.virtualMachine.count({
          where: {
            server: { projectId },
            status: "ERROR",
          },
        });
        if (errorVMs > 0) {
          alerts.push({
            id: "vm-error",
            type: "VM_ERROR",
            severity: "error",
            title: `${errorVMs} VM đang lỗi`,
            message: "Cần kiểm tra và khắc phục",
            link: "/infrastructure/vms",
            createdAt: now,
          });
        }
      }

      // 5. Unconfirmed fund transactions — FUNDS module
      if (hasModule("FUNDS")) {
        const unconfirmedFunds = await ctx.prisma.fundTransaction.count({
          where: { projectId, confirmed: false },
        });
        if (unconfirmedFunds > 0) {
          alerts.push({
            id: "fund-unconfirmed",
            type: "FUND_UNCONFIRMED",
            severity: "info",
            title: `${unconfirmedFunds} giao dịch chưa xác nhận`,
            message: "Cần kiểm tra và xác nhận",
            link: "/funds",
            createdAt: now,
          });
        }
      }

      // 6. Overdue VM tasks — INFRASTRUCTURE module
      if (hasModule("INFRASTRUCTURE")) {
        const overdueTasks = await ctx.prisma.vMTask.count({
          where: {
            vm: { server: { projectId } },
            status: { in: ["PENDING", "IN_PROGRESS"] },
            scheduledAt: { lt: now },
          },
        });
        if (overdueTasks > 0) {
          alerts.push({
            id: "vmtask-overdue",
            type: "TASK_OVERDUE",
            severity: "warning",
            title: `${overdueTasks} tác vụ quá hạn`,
            message: "Cần xử lý",
            link: "/infrastructure/vms",
            createdAt: now,
          });
        }
      }

      // 7. Disputed agent transactions — AGENT_PP module
      if (hasModule("AGENT_PP")) {
        const disputedCount = await ctx.prisma.withdrawal.count({
          where: {
            projectId,
            agentDisputed: true,
            disputeResolved: false,
          },
        });
        if (disputedCount > 0) {
          alerts.push({
            id: "agent-disputed",
            type: "AGENT_DISPUTE",
            severity: "error",
            title: `${disputedCount} giao dịch đại lý khiếu nại`,
            message: "Cần giải quyết",
            link: "/agent-pp",
            createdAt: now,
          });
        }
      }

      return alerts;
    }),
});
