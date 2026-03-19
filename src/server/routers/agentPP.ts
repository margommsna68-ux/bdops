import { z } from "zod";
import { router, agentPPProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";

export const agentPPRouter = router({
  // ═══ Agent's PayPal Emails ═══
  myEmails: agentPPProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.agentPaypalEmail.findMany({
        where: { userId: ctx.user.id, projectId: input.projectId },
        orderBy: { createdAt: "desc" },
      });
    }),

  addEmail: agentPPProcedure
    .input(z.object({
      projectId: z.string(),
      email: z.string().email(),
      label: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.agentPaypalEmail.create({
        data: {
          email: input.email,
          label: input.label,
          userId: ctx.user.id,
          projectId: input.projectId,
        },
      });
      await createAuditLog({
        action: "CREATE",
        entity: "AgentPaypalEmail" as any,
        entityId: result.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { email: input.email },
      });
      return result;
    }),

  removeEmail: agentPPProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Only delete own emails (unless admin)
      const email = await ctx.prisma.agentPaypalEmail.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
      });
      if (email.userId !== ctx.user.id && ctx.role !== "ADMIN") {
        throw new Error("Cannot delete other user's email");
      }
      await ctx.prisma.agentPaypalEmail.delete({ where: { id: input.id } });
      return { success: true };
    }),

  // ═══ Agent's Transactions ═══
  myTransactions: agentPPProcedure
    .input(z.object({
      projectId: z.string(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const isAdmin = ctx.role === "ADMIN" || ctx.role === "MODERATOR";

      // Get this user's agent email IDs
      const myEmails = await ctx.prisma.agentPaypalEmail.findMany({
        where: { userId: ctx.user.id, projectId: input.projectId },
        select: { id: true },
      });
      const myEmailIds = myEmails.map((e) => e.id);

      // If not admin, only show own transactions
      const where: any = {
        projectId: input.projectId,
        type: "EXCHANGE",
        ...(isAdmin ? {} : { agentEmailId: { in: myEmailIds } }),
      };

      const [items, total] = await Promise.all([
        ctx.prisma.withdrawal.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { date: "desc" },
          include: {
            sourcePaypal: { select: { code: true } },
            agentUser: { select: { name: true, username: true } },
            agentEmail: { select: { email: true, label: true } },
            resolvedBy: { select: { name: true, username: true } },
          },
        }),
        ctx.prisma.withdrawal.count({ where }),
      ]);

      return { items, total, page: input.page };
    }),

  // ═══ Agent Balance ═══
  myBalance: agentPPProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const myEmails = await ctx.prisma.agentPaypalEmail.findMany({
        where: { userId: ctx.user.id, projectId: input.projectId },
        select: { id: true, email: true, label: true },
      });
      const myEmailIds = myEmails.map((e) => e.id);

      const [received, sold] = await Promise.all([
        ctx.prisma.withdrawal.aggregate({
          where: {
            projectId: input.projectId,
            type: "EXCHANGE",
            agentEmailId: { in: myEmailIds },
          },
          _sum: { amount: true },
          _count: true,
        }),
        ctx.prisma.agentSale.aggregate({
          where: {
            projectId: input.projectId,
            agentUserId: ctx.user.id,
          },
          _sum: { amount: true },
          _count: true,
        }),
      ]);

      const totalReceived = Number(received._sum.amount ?? 0);
      const totalSold = Number(sold._sum.amount ?? 0);

      return {
        emails: myEmails,
        totalReceived,
        totalSold,
        balance: totalReceived - totalSold,
        transactionCount: received._count,
        saleCount: sold._count,
      };
    }),

  // ═══ Global Balance (Admin/Mod) - tổng hợp tất cả collectors ═══
  globalBalance: agentPPProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const allEmailIds = (await ctx.prisma.agentPaypalEmail.findMany({
        where: { projectId: input.projectId },
        select: { id: true },
      })).map((e) => e.id);

      const [received, sold] = await Promise.all([
        ctx.prisma.withdrawal.aggregate({
          where: {
            projectId: input.projectId,
            type: "EXCHANGE",
            agentEmailId: { in: allEmailIds },
          },
          _sum: { amount: true },
          _count: true,
        }),
        ctx.prisma.agentSale.aggregate({
          where: { projectId: input.projectId },
          _sum: { amount: true },
          _count: true,
        }),
      ]);

      const totalReceived = Number(received._sum.amount ?? 0);
      const totalSold = Number(sold._sum.amount ?? 0);

      return {
        totalReceived,
        totalSold,
        balance: totalReceived - totalSold,
        transactionCount: received._count,
        saleCount: sold._count,
        collectorCount: allEmailIds.length,
      };
    }),

  // ═══ Agent Confirm/Dispute ═══
  confirmReceived: agentPPProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const wd = await ctx.prisma.withdrawal.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
      });
      // Verify this agent owns the email
      if (wd.agentEmailId) {
        const email = await ctx.prisma.agentPaypalEmail.findFirst({
          where: { id: wd.agentEmailId, userId: ctx.user.id },
        });
        if (!email && ctx.role !== "ADMIN") {
          throw new Error("Not your transaction");
        }
      }
      const result = await ctx.prisma.withdrawal.update({
        where: { id: input.id },
        data: { agentConfirmed: true, agentDisputed: false, disputeNote: null },
      });
      await createAuditLog({
        action: "UPDATE",
        entity: "Withdrawal",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { agentConfirmed: true },
      });
      return result;
    }),

  disputeTransaction: agentPPProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      note: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const wd = await ctx.prisma.withdrawal.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
      });
      if (wd.agentEmailId) {
        const email = await ctx.prisma.agentPaypalEmail.findFirst({
          where: { id: wd.agentEmailId, userId: ctx.user.id },
        });
        if (!email && ctx.role !== "ADMIN") {
          throw new Error("Not your transaction");
        }
      }
      const result = await ctx.prisma.withdrawal.update({
        where: { id: input.id },
        data: { agentDisputed: true, agentConfirmed: false, disputeNote: input.note },
      });
      await createAuditLog({
        action: "UPDATE",
        entity: "Withdrawal",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { agentDisputed: true, disputeNote: input.note },
      });
      return result;
    }),

  // ═══ Agent Sales (sell to exchange) ═══
  mySales: agentPPProcedure
    .input(z.object({
      projectId: z.string(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const isAdmin = ctx.role === "ADMIN" || ctx.role === "MODERATOR";
      const where: any = {
        projectId: input.projectId,
        ...(isAdmin ? {} : { agentUserId: ctx.user.id }),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.agentSale.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { date: "desc" },
          include: {
            agentEmail: { select: { email: true, label: true } },
            agentUser: { select: { name: true, username: true } },
          },
        }),
        ctx.prisma.agentSale.count({ where }),
      ]);
      return { items, total, page: input.page };
    }),

  createSale: agentPPProcedure
    .input(z.object({
      projectId: z.string(),
      agentEmailId: z.string(),
      amount: z.number().positive(),
      transactionId: z.string().min(1),
      exchangeEmail: z.string().optional(),
      notes: z.string().optional(),
      date: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify agent owns this email
      const email = await ctx.prisma.agentPaypalEmail.findFirstOrThrow({
        where: { id: input.agentEmailId, userId: ctx.user.id, projectId: input.projectId },
      });

      const result = await ctx.prisma.agentSale.create({
        data: {
          amount: input.amount,
          transactionId: input.transactionId,
          exchangeEmail: input.exchangeEmail || null,
          notes: input.notes || null,
          agentUserId: ctx.user.id,
          agentEmailId: input.agentEmailId,
          projectId: input.projectId,
          date: input.date ? new Date(input.date) : new Date(),
        },
      });
      await createAuditLog({
        action: "CREATE",
        entity: "AgentSale" as any,
        entityId: result.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { amount: input.amount, transactionId: input.transactionId, email: email.email },
      });
      return result;
    }),

  deleteSale: agentPPProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sale = await ctx.prisma.agentSale.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId, agentUserId: ctx.user.id },
      });
      await ctx.prisma.agentSale.delete({ where: { id: input.id } });
      await createAuditLog({
        action: "DELETE",
        entity: "AgentSale" as any,
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { amount: sale.amount, transactionId: sale.transactionId },
      });
      return { success: true };
    }),

  // ═══ Agent Dashboard Stats ═══
  dashboardStats: agentPPProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const myEmails = await ctx.prisma.agentPaypalEmail.findMany({
        where: { userId: ctx.user.id, projectId: input.projectId },
        select: { id: true, email: true, label: true },
      });
      const myEmailIds = myEmails.map((e) => e.id);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const [
        totalReceived, totalSold,
        todayReceived, todaySold,
        pendingCount, disputedCount, confirmedCount,
        recentTransactions, recentSales,
      ] = await Promise.all([
        // Total received
        ctx.prisma.withdrawal.aggregate({
          where: { projectId: input.projectId, type: "EXCHANGE", agentEmailId: { in: myEmailIds } },
          _sum: { amount: true }, _count: true,
        }),
        // Total sold
        ctx.prisma.agentSale.aggregate({
          where: { projectId: input.projectId, agentUserId: ctx.user.id },
          _sum: { amount: true }, _count: true,
        }),
        // Today received
        ctx.prisma.withdrawal.aggregate({
          where: { projectId: input.projectId, type: "EXCHANGE", agentEmailId: { in: myEmailIds }, date: { gte: today, lt: tomorrow } },
          _sum: { amount: true }, _count: true,
        }),
        // Today sold
        ctx.prisma.agentSale.aggregate({
          where: { projectId: input.projectId, agentUserId: ctx.user.id, date: { gte: today, lt: tomorrow } },
          _sum: { amount: true }, _count: true,
        }),
        // Pending (not confirmed, not disputed)
        ctx.prisma.withdrawal.count({
          where: { projectId: input.projectId, type: "EXCHANGE", agentEmailId: { in: myEmailIds }, agentConfirmed: false, agentDisputed: false },
        }),
        // Disputed
        ctx.prisma.withdrawal.count({
          where: { projectId: input.projectId, type: "EXCHANGE", agentEmailId: { in: myEmailIds }, agentDisputed: true },
        }),
        // Confirmed
        ctx.prisma.withdrawal.count({
          where: { projectId: input.projectId, type: "EXCHANGE", agentEmailId: { in: myEmailIds }, agentConfirmed: true },
        }),
        // Recent 5 transactions
        ctx.prisma.withdrawal.findMany({
          where: { projectId: input.projectId, type: "EXCHANGE", agentEmailId: { in: myEmailIds } },
          orderBy: { date: "desc" },
          take: 5,
          include: {
            sourcePaypal: { select: { code: true } },
            agentEmail: { select: { email: true, label: true } },
          },
        }),
        // Recent 5 sales
        ctx.prisma.agentSale.findMany({
          where: { projectId: input.projectId, agentUserId: ctx.user.id },
          orderBy: { date: "desc" },
          take: 5,
          include: {
            agentEmail: { select: { email: true, label: true } },
          },
        }),
      ]);

      const rcvd = Number(totalReceived._sum.amount ?? 0);
      const sold = Number(totalSold._sum.amount ?? 0);

      return {
        emails: myEmails,
        totalReceived: rcvd,
        totalSold: sold,
        balance: rcvd - sold,
        transactionCount: totalReceived._count,
        saleCount: totalSold._count,
        todayReceived: { amount: Number(todayReceived._sum.amount ?? 0), count: todayReceived._count },
        todaySold: { amount: Number(todaySold._sum.amount ?? 0), count: todaySold._count },
        pendingCount,
        disputedCount,
        confirmedCount,
        recentTransactions,
        recentSales,
      };
    }),

  // ═══ Admin: All Agents Overview ═══
  allAgents: agentPPProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Get all agent emails grouped by user
      const emails = await ctx.prisma.agentPaypalEmail.findMany({
        where: { projectId: input.projectId },
        include: {
          user: { select: { id: true, name: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      // Group by user
      const userMap: Record<string, {
        userId: string;
        userName: string;
        emails: typeof emails;
      }> = {};

      for (const e of emails) {
        if (!userMap[e.userId]) {
          userMap[e.userId] = {
            userId: e.userId,
            userName: e.user.name || e.user.username || "Unknown",
            emails: [],
          };
        }
        userMap[e.userId].emails.push(e);
      }

      // Get withdrawal totals per agent email
      const emailIds = emails.map((e) => e.id);
      const wdAggs = await ctx.prisma.withdrawal.groupBy({
        by: ["agentEmailId"],
        where: {
          projectId: input.projectId,
          type: "EXCHANGE",
          agentEmailId: { in: emailIds },
        },
        _sum: { amount: true },
        _count: true,
      });

      const wdMap = new Map(wdAggs.map((w) => [w.agentEmailId, {
        total: Number(w._sum.amount ?? 0),
        count: w._count,
      }]));

      return Object.values(userMap).map((u) => ({
        ...u,
        emails: u.emails.map((e) => ({
          ...e,
          totalReceived: wdMap.get(e.id)?.total ?? 0,
          transactionCount: wdMap.get(e.id)?.count ?? 0,
        })),
        totalReceived: u.emails.reduce((s, e) => s + (wdMap.get(e.id)?.total ?? 0), 0),
      }));
    }),

  // ═══ List agent users with emails (for EXCHANGE dropdown) ═══
  agentList: agentPPProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const emails = await ctx.prisma.agentPaypalEmail.findMany({
        where: { projectId: input.projectId },
        include: {
          user: { select: { id: true, name: true, username: true } },
        },
        orderBy: [{ user: { name: "asc" } }, { email: "asc" }],
      });
      return emails;
    }),
});
