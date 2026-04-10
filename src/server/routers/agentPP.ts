import { z } from "zod";
import { router, agentPPProcedure, moderatorProcedure } from "../trpc";
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

  // Admin: add email for any user
  adminAddEmail: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      userId: z.string(),
      email: z.string().min(1), // email or link
      label: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.agentPaypalEmail.create({
        data: { email: input.email, label: input.label, userId: input.userId, projectId: input.projectId },
      });
      await createAuditLog({ action: "CREATE", entity: "AgentPaypalEmail" as any, entityId: result.id, userId: (ctx.user as any).id, projectId: input.projectId, changes: { email: input.email, forUser: input.userId } });
      return result;
    }),

  // Admin: update email/link
  adminUpdateEmail: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      email: z.string().min(1).optional(),
      label: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      await ctx.prisma.agentPaypalEmail.findFirstOrThrow({ where: { id, projectId } });
      return ctx.prisma.agentPaypalEmail.update({ where: { id }, data });
    }),

  // Admin: remove email for any user
  adminRemoveEmail: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.agentPaypalEmail.delete({ where: { id: input.id } });
      return { success: true };
    }),

  // Admin: list emails for a specific user
  adminListEmails: moderatorProcedure
    .input(z.object({ projectId: z.string(), userId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.agentPaypalEmail.findMany({
        where: { userId: input.userId, projectId: input.projectId },
        orderBy: { createdAt: "desc" },
      });
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

      const [received, sold, salesBreakdown] = await Promise.all([
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
          _sum: { amount: true, agentEarning: true },
          _count: true,
        }),
        // Split net amount by withdrawn flag: withdrawn=true → already paid to team, false → still owed
        ctx.prisma.agentSale.groupBy({
          by: ["withdrawn"],
          where: {
            projectId: input.projectId,
            agentUserId: ctx.user.id,
          },
          _sum: { netAmount: true },
        }),
      ]);

      const totalReceived = Number(received._sum.amount ?? 0);
      const totalSold = Number(sold._sum.amount ?? 0);
      const totalCommission = Number(sold._sum.agentEarning ?? 0);
      const paidToTeam = Number(
        salesBreakdown.find((g) => g.withdrawn === true)?._sum.netAmount ?? 0
      );
      const owedToTeam = Number(
        salesBreakdown.find((g) => g.withdrawn === false)?._sum.netAmount ?? 0
      );

      return {
        emails: myEmails,
        totalReceived,
        totalSold,
        balance: totalReceived - totalSold,
        totalCommission,
        paidToTeam,
        owedToTeam,
        fundRemaining: totalReceived - totalSold,
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
      feePercent: z.number().min(0).max(100).default(3),
      paypalFee: z.number().min(0).default(0),
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

      // Calculate: afterPPFee = gross - paypalFee, agentEarning = afterPPFee * feePercent/100, net = afterPPFee - agentEarning
      const afterPPFee = input.amount - input.paypalFee;
      const agentEarning = afterPPFee * input.feePercent / 100;
      const netAmount = afterPPFee - agentEarning;

      const result = await ctx.prisma.agentSale.create({
        data: {
          amount: input.amount,
          feePercent: input.feePercent,
          paypalFee: input.paypalFee,
          netAmount: Math.max(0, netAmount),
          agentEarning: Math.max(0, agentEarning),
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

  // Agent marks sale as withdrawn
  markWithdrawn: agentPPProcedure
    .input(z.object({ projectId: z.string(), id: z.string(), withdrawn: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const sale = await ctx.prisma.agentSale.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
      });
      // Agent can only mark own sales (unless admin)
      if (sale.agentUserId !== ctx.user.id && ctx.role !== "ADMIN" && ctx.role !== "MODERATOR") {
        throw new Error("Chỉ được đánh dấu giao dịch của mình");
      }
      return ctx.prisma.agentSale.update({
        where: { id: input.id },
        data: { withdrawn: input.withdrawn, withdrawnAt: input.withdrawn ? new Date() : null },
      });
    }),

  // Agent earnings summary
  myEarnings: agentPPProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sales = await ctx.prisma.agentSale.findMany({
        where: { agentUserId: ctx.user.id, projectId: input.projectId },
        select: { agentEarning: true, withdrawn: true, date: true },
      });
      const totalEarning = sales.reduce((s, r) => s + Number(r.agentEarning ?? 0), 0);
      const totalWithdrawn = sales.filter((s) => s.withdrawn).reduce((s, r) => s + Number(r.agentEarning ?? 0), 0);
      const pending = totalEarning - totalWithdrawn;
      // This month
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEarning = sales.filter((s) => new Date(s.date) >= monthStart).reduce((s, r) => s + Number(r.agentEarning ?? 0), 0);
      return { totalEarning, totalWithdrawn, pending, monthEarning, totalSales: sales.length };
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
  allAgents: moderatorProcedure
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

  // Admin: Today's activity summary
  todayActivity: moderatorProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      // Adjust for VN timezone (UTC+7)
      const vnTodayStart = new Date(`${todayStart.toISOString().split("T")[0]}T00:00:00+07:00`);

      // Today's withdrawals (sales to agents)
      const todayWithdrawals = await ctx.prisma.withdrawal.findMany({
        where: {
          projectId: input.projectId,
          type: "EXCHANGE",
          date: { gte: vnTodayStart },
        },
        include: {
          agentEmail: { include: { user: { select: { id: true, name: true, username: true } } } },
          sourcePaypal: { select: { code: true } },
        },
        orderBy: { date: "desc" },
      });

      // Today's agent sales
      const todaySales = await ctx.prisma.agentSale.findMany({
        where: {
          projectId: input.projectId,
          date: { gte: vnTodayStart },
        },
        include: {
          agentUser: { select: { id: true, name: true, username: true } },
          agentEmail: { select: { email: true } },
        },
        orderBy: { date: "desc" },
      });

      const totalWithdrawals = todayWithdrawals.reduce((s, w) => s + Number(w.amount), 0);
      const totalSales = todaySales.reduce((s, s2) => s + Number(s2.amount), 0);

      return {
        todayWithdrawals,
        todaySales,
        totalWithdrawals,
        totalSales,
        countWithdrawals: todayWithdrawals.length,
        countSales: todaySales.length,
      };
    }),
});
