import { z } from "zod";
import {TRPCError} from '@trpc/server';
import { router, agentPPProcedure, moderatorProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";
import { loadAgentFees, getFeePercent } from "@/lib/agent-fee";

// Capitalize first letter of each word: "marua" → "Marua", "john doe" → "John Doe"
function capitalName(name: string | null | undefined): string {
  if (!name) return "Unknown";
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

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
      email: z.string().min(1), // email OR link (paypal.me, bank URL)
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
      limit: z.number().min(1).max(1000).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const isAdmin = ctx.role === "ADMIN" || ctx.role === "MODERATOR";

      // Non-admin: fetch ALL user's agent emails across ALL projects (cross-project visibility)
      const myEmails = isAdmin
        ? []
        : await ctx.prisma.agentPaypalEmail.findMany({
            where: { userId: ctx.user.id },
            select: { id: true },
          });
      const myEmailIds = myEmails.map((e) => e.id);

      // Admin: still scoped to current project.
      // Collector: cross-project — match BY agent email OR BY agentUserId (safer fallback
      // if email record was deleted but withdrawal still points to user).
      const where: any = isAdmin
        ? { projectId: input.projectId, type: "EXCHANGE" }
        : {
            type: "EXCHANGE",
            OR: [
              { agentEmailId: { in: myEmailIds } },
              { agentUserId: ctx.user.id },
            ],
          };

      const [items, total] = await Promise.all([
        ctx.prisma.withdrawal.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          // Stable sort: primary by date desc, secondary by createdAt desc, tertiary by id
          // Without secondary/tertiary, rows with identical date jump around between refetches
          orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          include: {
            sourcePaypal: { select: { code: true } },
            agentUser: { select: { name: true, username: true } },
            agentEmail: {
              select: {
                email: true,
                label: true,
                user: { select: { id: true, name: true, username: true } },
              },
            },
            resolvedBy: { select: { name: true, username: true } },
            project: { select: { id: true, code: true, name: true } },
          },
        }),
        ctx.prisma.withdrawal.count({ where }),
      ]);

      // Enrich: attach matching AgentSale (paypalFee) and collector's agentFeePercent
      // - Match sale by (transactionId, agentEmailId) to find paypalFee for each row
      // - Look up ProjectMember.agentFeePercent for the user who owns the agentEmail
      const saleKeys = items
        .filter((w) => w.transactionId && w.agentEmailId)
        .map((w) => ({ transactionId: w.transactionId!, agentEmailId: w.agentEmailId! }));

      const matchingSales =
        saleKeys.length === 0
          ? []
          : await ctx.prisma.agentSale.findMany({
              where: { OR: saleKeys },
              select: { transactionId: true, agentEmailId: true, paypalFee: true, feePercent: true },
            });
      const saleMap = new Map(
        matchingSales.map((s) => [`${s.transactionId}:${s.agentEmailId}`, s])
      );

      // Build map: userId → { byProject: Map<projectId, fee>, any: first non-null fee }
      // We look up by exact (userId, projectId) first; if not set in that project,
      // fall back to ANY project where this user has a % set.
      const userIds = new Set<string>();
      for (const w of items) {
        const uid = (w as any).agentEmail?.user?.id || (w as any).agentUserId;
        if (uid) userIds.add(uid);
      }
      const memberRows =
        userIds.size === 0
          ? []
          : await ctx.prisma.projectMember.findMany({
              where: { userId: { in: Array.from(userIds) } },
              select: { userId: true, projectId: true, agentFeePercent: true },
            });
      // userFees[userId] = { byProject: Map, fallback: Decimal | null }
      const userFees = new Map<string, { byProject: Map<string, any>; fallback: any }>();
      for (const m of memberRows) {
        let entry = userFees.get(m.userId);
        if (!entry) {
          entry = { byProject: new Map(), fallback: null };
          userFees.set(m.userId, entry);
        }
        entry.byProject.set(m.projectId, m.agentFeePercent);
        if (entry.fallback == null && m.agentFeePercent != null) {
          entry.fallback = m.agentFeePercent;
        }
      }

      const enrichedItems = items.map((w) => {
        const sale = w.transactionId && w.agentEmailId
          ? saleMap.get(`${w.transactionId}:${w.agentEmailId}`)
          : undefined;
        const uid = (w as any).agentEmail?.user?.id || (w as any).agentUserId;
        // Lookup %: exact project match → user's fallback (any project) → sale → 0
        let memberFeePercent: any = null;
        if (uid) {
          const userEntry = userFees.get(uid);
          if (userEntry) {
            memberFeePercent =
              userEntry.byProject.get(w.projectId) ?? userEntry.fallback ?? null;
          }
        }
        const collectorName = capitalName(
          (w as any).agentEmail?.user?.name ||
          (w as any).agentEmail?.user?.username ||
          (w as any).agentUser?.name ||
          (w as any).agentUser?.username ||
          null
        );
        // Detect if agent destination is a PayPal link (vs bank link / plain email)
        const emailVal = (w as any).agentEmail?.email ?? "";
        const isPaypalLink =
          emailVal.toLowerCase().includes("paypal.me") ||
          emailVal.toLowerCase().includes("paypal.com");
        // Fee Paypal: prefer directly-noted paypalFee on Withdrawal, fallback to matching sale
        const paypalFeeValue = (w as any).paypalFee ?? sale?.paypalFee ?? null;
        // Explicit Decimal → number conversion
        const feePercentNum =
          memberFeePercent != null
            ? Number(memberFeePercent.toString())
            : sale?.feePercent != null
              ? Number(sale.feePercent.toString())
              : 0;
        return {
          ...w,
          matchedPaypalFee: paypalFeeValue,
          isPaypalLink,
          collectorFeePercent: feePercentNum,
          collectorName,
        };
      });

      return { items: enrichedItems, total, page: input.page };
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
          where: { businessManaged: false, 
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
          where: { businessManaged: false, 
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
  // ═══ Update collector meta (paypalFee, collectorNote) on an incoming Withdrawal ═══
  // PP fee has a 24-hour edit lock for collectors after first entry.
  // Admin/Moderator can always edit (bypass the lock).
  updatePaypalFee: agentPPProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      paypalFee: z.number().nullable().optional(),
      collectorNote: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const wd = await ctx.prisma.withdrawal.findFirstOrThrow({
        where: { businessManaged: false,  id: input.id, projectId: input.projectId },
      });
      const isAdminOrMod = ctx.role === "ADMIN" || ctx.role === "MODERATOR";

      // Ownership check for non-admin: must own the agent email
      if (!isAdminOrMod && wd.agentEmailId) {
        const email = await ctx.prisma.agentPaypalEmail.findFirst({
          where: { id: wd.agentEmailId, userId: ctx.user.id },
        });
        if (!email) throw new Error("Not your transaction");
      }

      // 24h edit lock for PP fee (non-admin only)
      if (input.paypalFee !== undefined && !isAdminOrMod && wd.paypalFeeSetAt) {
        const age = Date.now() - new Date(wd.paypalFeeSetAt).getTime();
        const LOCK_MS = 24 * 60 * 60 * 1000;
        if (age > LOCK_MS) {
          throw new Error("PP fee is locked after 24 hours. Contact admin to modify.");
        }
      }

      const data: any = {};
      if (input.paypalFee !== undefined) {
        data.paypalFee = input.paypalFee;
        // Stamp the first-set timestamp so the 24h clock starts here
        if (!wd.paypalFeeSetAt && input.paypalFee !== null) {
          data.paypalFeeSetAt = new Date();
        }
      }
      if (input.collectorNote !== undefined) data.collectorNote = input.collectorNote;
      const result = await ctx.prisma.withdrawal.update({
        where: { businessManaged: false,  id: input.id },
        data,
      });
      await createAuditLog({
        action: "UPDATE",
        entity: "Withdrawal",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: data,
      });
      return result;
    }),

  confirmReceived: agentPPProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const wd = await ctx.prisma.withdrawal.findFirstOrThrow({
        where: { businessManaged: false,  id: input.id, projectId: input.projectId },
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
        where: { businessManaged: false,  id: input.id },
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
        where: { businessManaged: false,  id: input.id, projectId: input.projectId },
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
        where: { businessManaged: false,  id: input.id },
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
      // Admin sees ALL sales cross-project; user sees only own sales in this project
      const where: any = isAdmin
        ? {}
        : { projectId: input.projectId, agentUserId: ctx.user.id };
      const [items, total] = await Promise.all([
        ctx.prisma.agentSale.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { date: "desc" },
          include: {
            agentEmail: { select: { email: true, label: true } },
            agentUser: { select: { name: true, username: true } },
            project: { select: { code: true } },
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
      const isAdmin = ctx.role === "ADMIN" || ctx.role === "MODERATOR";

      // Non-admin collector: pull emails cross-project (so dashboard matches /agent-pp wallet view)
      // Admin/Moderator: scope to current project
      const myEmails = await ctx.prisma.agentPaypalEmail.findMany({
        where: isAdmin
          ? { userId: ctx.user.id, projectId: input.projectId }
          : { userId: ctx.user.id },
        select: { id: true, email: true, label: true, projectId: true },
      });
      const myEmailIds = myEmails.map((e) => e.id);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Base where (cross-project for non-admin, scoped for admin).
      // Match by email OR directly by user id for robustness (handles orphaned withdrawals).
      const baseWhere: any = isAdmin
        ? {
            projectId: input.projectId,
            type: "EXCHANGE" as const,
            OR: [
              { agentEmailId: { in: myEmailIds } },
              { agentUserId: ctx.user.id },
            ],
          }
        : {
            type: "EXCHANGE" as const,
            OR: [
              { agentEmailId: { in: myEmailIds } },
              { agentUserId: ctx.user.id },
            ],
          };

      const expenseWhere: any = isAdmin
        ? { projectId: input.projectId, collectorId: ctx.user.id }
        : { collectorId: ctx.user.id };

      const [
        allExpenses,
        todayReceived,
        pendingCount, disputedCount, confirmedCount,
        recentTransactions,
        recentSales,
      ] = await Promise.all([
        // All expenses
        ctx.prisma.collectorExpense.findMany({
          where: expenseWhere,
          select: { amount: true },
        }),
        // Today received (gross sum)
        ctx.prisma.withdrawal.aggregate({
          where: { businessManaged: false,  ...baseWhere, date: { gte: today, lt: tomorrow } },
          _sum: { amount: true }, _count: true,
        }),
        // Pending (not confirmed, not disputed)
        ctx.prisma.withdrawal.count({
          where: { businessManaged: false,  ...baseWhere, agentConfirmed: false, agentDisputed: false },
        }),
        // Disputed
        ctx.prisma.withdrawal.count({
          where: { businessManaged: false,  ...baseWhere, agentDisputed: true },
        }),
        // Confirmed
        ctx.prisma.withdrawal.count({
          where: { businessManaged: false,  ...baseWhere, agentConfirmed: true },
        }),
        // Recent 5 transactions
        ctx.prisma.withdrawal.findMany({
          where: baseWhere,
          orderBy: { date: "desc" },
          take: 5,
          include: {
            sourcePaypal: { select: { code: true } },
            agentEmail: { select: { email: true, label: true } },
          },
        }),
        // Recent 5 expenses (replaces "sales")
        ctx.prisma.collectorExpense.findMany({
          where: expenseWhere,
          orderBy: { date: "desc" },
          take: 5,
        }),
      ]);

      // Fetch per-project fee % for wallet math (cross-project)
      // Only insert into map if agentFeePercent is non-null, so lookup can fall back properly.
      const memberRows = await ctx.prisma.projectMember.findMany({
        where: isAdmin ? { userId: ctx.user.id, projectId: input.projectId } : { userId: ctx.user.id },
        select: { projectId: true, agentFeePercent: true },
      });
      const feeByProject = new Map<string, number>();
      let fallbackPct = 0;
      for (const m of memberRows) {
        if (m.agentFeePercent == null) continue;
        const pct = Number(m.agentFeePercent.toString());
        feeByProject.set(m.projectId, pct);
        if (fallbackPct === 0 && pct > 0) fallbackPct = pct;
      }

      // Compute totals with per-row fee % (match /agent-pp wallet math)
      // Only CONFIRMED rows (paypalFee != null) contribute to net/commission/totalAfterFee
      const withdrawalsFull = await ctx.prisma.withdrawal.findMany({
        where: baseWhere,
        select: { amount: true, paypalFee: true, projectId: true },
      });
      let grossReceived = 0;
      let grossConfirmed = 0;
      let totalFees = 0;
      let totalCommission = 0;
      let totalAfterFee = 0;
      for (const w of withdrawalsFull) {
        const gross = Number(w.amount);
        grossReceived += gross;
        if (w.paypalFee == null) continue;
        const fee = Number(w.paypalFee);
        const net = gross - fee;
        const pct = feeByProject.has(w.projectId)
          ? (feeByProject.get(w.projectId) as number)
          : fallbackPct;
        const commission = net * (pct / 100);
        const taf = net - commission;
        grossConfirmed += gross;
        totalFees += fee;
        totalCommission += commission;
        totalAfterFee += taf;
      }
      const netReceived = grossConfirmed - totalFees;
      const totalExpenses = allExpenses.reduce((s, e) => s + Number(e.amount), 0);
      const walletBalance = totalAfterFee - totalExpenses;

      return {
        emails: myEmails,
        totalReceived: netReceived,            // display: net received (gross - fee)
        totalSold: totalExpenses,              // legacy name, now = total expenses
        balance: walletBalance,                // = totalAfterFee − expenses (team's money)
        transactionCount: withdrawalsFull.length,
        saleCount: allExpenses.length,         // legacy name, now = expenses count
        grossReceived,
        netReceived,
        totalFees,
        totalCommission,
        totalAfterFee,
        totalExpenses,
        walletBalance,
        todayReceived: { amount: Number(todayReceived._sum.amount ?? 0), count: todayReceived._count },
        todaySold: { amount: 0, count: 0 },    // legacy field kept for compatibility
        pendingCount,
        disputedCount,
        confirmedCount,
        recentTransactions,
        recentSales,                           // actually expenses now, kept name for UI compat
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
            userName: capitalName(e.user.name || e.user.username),
            emails: [],
          };
        }
        userMap[e.userId].emails.push(e);
      }

      // Get withdrawal totals per agent email
      const emailIds = emails.map((e) => e.id);
      const wdAggs = await ctx.prisma.withdrawal.groupBy({
        by: ["agentEmailId"],
        where: { businessManaged: false, 
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
        where: { businessManaged: false, 
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

  // ═══════════════════════════════════════════════════════════════
  // COLLECTOR WALLET + EXPENSES
  // ═══════════════════════════════════════════════════════════════

  // Wallet balance: TotalAfterFee (team's share) − all expenses
  // Note: Commission is collector's own money, NOT part of wallet (wallet = money owed to team).
  walletBalance: agentPPProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx }) => {
      const userId = ctx.user.id;
      // All my agent emails across all projects
      const myEmails = await ctx.prisma.agentPaypalEmail.findMany({
        where: { userId },
        select: { id: true },
      });
      const myEmailIds = myEmails.map((e) => e.id);

      // Auto-heal: backfill agentUserId on withdrawals that have our agent email but null user id
      if (myEmailIds.length > 0) {
        await ctx.prisma.withdrawal.updateMany({
          where: { businessManaged: false, 
            type: "EXCHANGE",
            agentEmailId: { in: myEmailIds },
            agentUserId: null,
          },
          data: { agentUserId: userId },
        });
      }

      // All incoming withdrawals (cross-project) — match by email OR directly by user id
      const withdrawals = await ctx.prisma.withdrawal.findMany({
        where: { businessManaged: false, 
          type: "EXCHANGE",
          OR: [
            { agentEmailId: { in: myEmailIds } },
            { agentUserId: userId },
          ],
        },
        select: { amount: true, paypalFee: true, projectId: true },
      });

      // Fetch user's ProjectMember rows for agentFeePercent lookup (cross-project)
      // Only insert into map if agentFeePercent is non-null, so lookup can fall back properly.
      const memberRows = await ctx.prisma.projectMember.findMany({
        where: { userId },
        select: { projectId: true, agentFeePercent: true },
      });
      const feeByProject = new Map<string, number>();
      let fallbackPct = 0;
      for (const m of memberRows) {
        if (m.agentFeePercent == null) continue;
        const pct = Number(m.agentFeePercent.toString());
        feeByProject.set(m.projectId, pct);
        if (fallbackPct === 0 && pct > 0) fallbackPct = pct;
      }

      // Compute per-row totals
      // Only CONFIRMED rows (paypalFee != null) contribute to net/commission/totalAfterFee.
      // Unconfirmed rows count toward grossReceived but NOT toward wallet calculations —
      // this matches the table display (unconfirmed cells show "—" for net/commission/TAF).
      let grossReceived = 0;
      let grossConfirmed = 0;
      let totalFees = 0;
      let totalCommission = 0;
      let totalAfterFee = 0;
      for (const w of withdrawals) {
        const gross = Number(w.amount);
        grossReceived += gross;
        if (w.paypalFee == null) continue; // skip unconfirmed
        const fee = Number(w.paypalFee);
        const net = gross - fee;
        // Match myTransactions: exact project match → fallback (any project) → 0
        const pct = feeByProject.has(w.projectId)
          ? (feeByProject.get(w.projectId) as number)
          : fallbackPct;
        const commission = net * (pct / 100);
        const taf = net - commission;
        grossConfirmed += gross;
        totalFees += fee;
        totalCommission += commission;
        totalAfterFee += taf;
      }
      const netReceived = grossConfirmed - totalFees;

      // All my expenses (cross-project) — EXCLUDE COMMISSION_WITHDRAW from wallet calc
      const expenses = await ctx.prisma.collectorExpense.findMany({
        where: { collectorId: userId },
        select: { amount: true, type: true },
      });
      // Only team-related expenses affect wallet (not commission withdrawals)
      const teamExpenses = expenses.filter((e) => e.type !== "COMMISSION_WITHDRAW");
      const totalExpenses = teamExpenses.reduce((s, e) => s + Number(e.amount), 0);
      const breakdown = { TEAM_PAYMENT: 0, BILL: 0, OTHER: 0 } as Record<string, number>;
      for (const e of teamExpenses) {
        breakdown[e.type] = (breakdown[e.type] ?? 0) + Number(e.amount);
      }

      // Wallet = team's share (totalAfterFee) − team expenses (NOT commission withdrawals)
      const walletBalance = totalAfterFee - totalExpenses;

      return {
        grossReceived,
        totalFees,
        netReceived,
        totalCommission,
        totalAfterFee,
        totalExpenses,
        walletBalance,
        breakdown,
      };
    }),

  // List collector's expenses (cross-project for collector-only users)
  listExpenses: agentPPProcedure
    .input(z.object({ projectId: z.string(), limit: z.number().min(1).max(500).default(100) }))
    .query(async ({ ctx, input }) => {
      const isAdmin = ctx.role === "ADMIN" || ctx.role === "MODERATOR";
      // Admin sees ALL expenses cross-project; user sees only own
      const where: any = isAdmin ? {} : { collectorId: ctx.user.id };
      const items = await ctx.prisma.collectorExpense.findMany({
        where,
        orderBy: { date: "desc" },
        take: input.limit,
        include: {
          project: { select: { id: true, code: true, name: true } },
          collector: { select: { id: true, name: true, username: true } },
          withdrawals: { select: { id: true, transactionId: true, amount: true, sourcePaypal: { select: { code: true } } } },
        },
      });
      return items;
    }),

  // Commission balance: earned - withdrawn
  myCommissionBalance: agentPPProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx }) => {
      const userId = ctx.user.id;
      // Total commission earned (from walletBalance logic)
      const wallet = await ctx.prisma.agentPaypalEmail.findMany({ where: { userId }, select: { id: true } });
      const emailIds = wallet.map((e) => e.id);
      const withdrawals = await ctx.prisma.withdrawal.findMany({
        where: { businessManaged: false,  type: "EXCHANGE", OR: [...(emailIds.length > 0 ? [{ agentEmailId: { in: emailIds } }] : []), { agentUserId: userId }] },
        select: { amount: true, paypalFee: true, projectId: true },
      });
      const fees = await loadAgentFees(ctx.prisma, [userId]);
      const userFee = fees.get(userId);
      let totalEarned = 0;
      for (const w of withdrawals) {
        if (w.paypalFee == null) continue;
        const net = Number(w.amount) - Number(w.paypalFee);
        const pct = userFee ? getFeePercent(userFee, w.projectId) : 0;
        totalEarned += net * pct / 100;
      }
      // Total withdrawn (COMMISSION_WITHDRAW expenses)
      const cwExpenses = await ctx.prisma.collectorExpense.findMany({
        where: { collectorId: userId, type: "COMMISSION_WITHDRAW" },
        select: { id: true, amount: true, date: true, referenceId: true, note: true },
        orderBy: { date: "desc" },
      });
      const totalWithdrawn = cwExpenses.reduce((s, e) => s + Number(e.amount), 0);
      return {
        totalEarned,
        totalWithdrawn,
        available: totalEarned - totalWithdrawn,
        history: cwExpenses,
      };
    }),

  // Create a new expense (optionally links withdrawals)
  createExpense: agentPPProcedure
    .input(z.object({
      projectId: z.string(),
      type: z.enum(["TEAM_PAYMENT", "BILL", "OTHER", "COMMISSION_WITHDRAW"]),
      amount: z.number().positive(),
      referenceId: z.string().min(1),
      note: z.string().optional(),
      linkedWithdrawalIds: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify linked withdrawals belong to this collector (via agentEmail ownership)
      if (input.linkedWithdrawalIds.length > 0) {
        const wds = await ctx.prisma.withdrawal.findMany({
          where: { id: { in: input.linkedWithdrawalIds },projectId:input.projectId,businessManaged:false },
          select: { id: true, agentEmailId: true, agentEmail: { select: { userId: true } } },
        });
        if(wds.length!==new Set(input.linkedWithdrawalIds).size)throw new TRPCError({code:'BAD_REQUEST',message:'Giao dịch không thuộc dự án hoặc đang quản lý trong business mới'});
        const owned = wds.every((w) => w.agentEmail && w.agentEmail.userId === ctx.user.id);
        if (!owned && ctx.role !== "ADMIN" && ctx.role !== "MODERATOR") {
          throw new Error("Some withdrawals don't belong to you");
        }
      }

      const now = new Date();
      const expense = await ctx.prisma.collectorExpense.create({
        data: {
          date: now,
          type: input.type,
          amount: input.amount,
          referenceId: input.referenceId,
          note: input.note || null,
          collectorId: ctx.user.id,
          projectId: input.projectId,
          withdrawals: input.linkedWithdrawalIds.length > 0
            ? { connect: input.linkedWithdrawalIds.map((id) => ({ id })) }
            : undefined,
        },
      });

      // Mark linked withdrawals as paid
      if (input.linkedWithdrawalIds.length > 0) {
        await ctx.prisma.withdrawal.updateMany({
          where: { id: { in: input.linkedWithdrawalIds },projectId:input.projectId,businessManaged:false },
          data: { paidToTeam: true, paidAt: now, expenseId: expense.id },
        });
      }

      await createAuditLog({
        action: "CREATE",
        entity: "CollectorExpense",
        entityId: expense.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { type: input.type, amount: input.amount, linkedCount: input.linkedWithdrawalIds.length },
      });

      return expense;
    }),

  // Delete expense (unlinks linked withdrawals)
  // 24h lock for collectors. Admin/Moderator can always delete.
  deleteExpense: agentPPProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const exp = await ctx.prisma.collectorExpense.findFirst({
        where: { id: input.id,projectId:input.projectId },
      });
      if(!exp)throw new TRPCError({code:'NOT_FOUND',message:'Không tìm thấy khoản chi trong dự án'});
      if(await ctx.prisma.withdrawal.findFirst({where:{expenseId:input.id,OR:[{projectId:{not:input.projectId}},{businessManaged:true}]},select:{id:true}}))throw new TRPCError({code:'PRECONDITION_FAILED',message:'Có giao dịch business/khác dự án liên kết; kiểm tra trước khi điều chỉnh'});
      const isAdminOrMod = ctx.role === "ADMIN" || ctx.role === "MODERATOR";

      // Ownership check: collector or admin
      if (exp.collectorId !== ctx.user.id && !isAdminOrMod) {
        throw new Error("Not your expense");
      }

      // 24h edit lock (non-admin only)
      if (!isAdminOrMod) {
        const age = Date.now() - new Date(exp.createdAt).getTime();
        const LOCK_MS = 24 * 60 * 60 * 1000;
        if (age > LOCK_MS) {
          throw new Error("Expense is locked after 24 hours. Contact admin to modify.");
        }
      }
      // Unlink withdrawals (revert paid flag)
      await ctx.prisma.withdrawal.updateMany({
        where: { expenseId: input.id,projectId:input.projectId,businessManaged:false },
        data: { paidToTeam: false, paidAt: null, expenseId: null },
      });
      await ctx.prisma.collectorExpense.delete({ where: { id: input.id } });
      await createAuditLog({
        action: "DELETE",
        entity: "CollectorExpense",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: {},
      });
      return { deleted: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  // ADMIN DASHBOARD + AGENT PERFORMANCE
  // ═══════════════════════════════════════════════════════════════


  adminDashboard: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      period: z.enum(["today", "week", "month", "quarter", "all"]),
    }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // Period date ranges
      let currentStart: Date | null = null;
      let previousStart: Date | null = null;
      let previousEnd: Date | null = null;
      switch (input.period) {
        case "today": { currentStart = startOfToday; previousStart = new Date(startOfToday); previousStart.setDate(previousStart.getDate() - 1); previousEnd = startOfToday; break; }
        case "week": { currentStart = new Date(startOfToday); currentStart.setDate(currentStart.getDate() - 7); previousStart = new Date(currentStart); previousStart.setDate(previousStart.getDate() - 7); previousEnd = new Date(currentStart); break; }
        case "month": { currentStart = new Date(startOfToday); currentStart.setDate(currentStart.getDate() - 30); previousStart = new Date(currentStart); previousStart.setDate(previousStart.getDate() - 30); previousEnd = new Date(currentStart); break; }
        case "quarter": { currentStart = new Date(startOfToday); currentStart.setDate(currentStart.getDate() - 90); previousStart = new Date(currentStart); previousStart.setDate(previousStart.getDate() - 90); previousEnd = new Date(currentStart); break; }
        case "all": { break; }
      }
      const currentDateFilter: any = currentStart ? { gte: currentStart, lte: now } : undefined;
      const previousDateFilter: any = previousStart && previousEnd ? { gte: previousStart, lt: previousEnd } : undefined;

      // Find all EXCHANGE withdrawals (cross-project, same as agentPerformance)
      const allW = await ctx.prisma.withdrawal.findMany({
        where: { businessManaged: false, 
          type: "EXCHANGE",
          OR: [{ agentEmailId: { not: null } }, { agentUserId: { not: null } }],
          ...(currentDateFilter ? { date: currentDateFilter } : {}),
        },
        select: { amount: true, paypalFee: true, projectId: true, agentConfirmed: true,
          agentDisputed: true, disputeResolved: true, agentEmailId: true, agentUserId: true },
      });

      // Collect user IDs
      const emailIds = new Set<string>();
      const userIdSet = new Set<string>();
      for (const w of allW) { if (w.agentEmailId) emailIds.add(w.agentEmailId); if (w.agentUserId) userIdSet.add(w.agentUserId); }
      const agentEmails = emailIds.size > 0
        ? await ctx.prisma.agentPaypalEmail.findMany({ where: { id: { in: Array.from(emailIds) } }, select: { id: true, userId: true } })
        : [];
      const emailToUser = new Map<string, string>();
      for (const ae of agentEmails) { emailToUser.set(ae.id, ae.userId); userIdSet.add(ae.userId); }
      const userIds = Array.from(userIdSet);

      // Fee lookup via shared utility
      const agentFees = await loadAgentFees(ctx.prisma, userIds);

      // Current period stats
      let grossReceived = 0, totalFees = 0, totalCommission = 0;
      const transactionCount = allW.length;
      let confirmedCount = 0, unconfirmedCount = 0, disputeCount = 0, pendingFeeCount = 0;

      for (const w of allW) {
        if (w.agentConfirmed) confirmedCount++;
        else if (w.agentDisputed && !w.disputeResolved) disputeCount++;
        else unconfirmedCount++;
        if (w.paypalFee == null) { pendingFeeCount++; continue; }
        const gross = Number(w.amount);
        grossReceived += gross;
        const fee = Number(w.paypalFee);
        totalFees += fee;
        const net = gross - fee;
        const uid = (w.agentEmailId ? emailToUser.get(w.agentEmailId) : null) || w.agentUserId;
        const userFee = uid ? agentFees.get(uid) : undefined;
        const pct = userFee ? getFeePercent(userFee, w.projectId) : 0;
        totalCommission += net * pct / 100;
      }
      const netReceived = grossReceived - totalFees;
      const teamRevenue = netReceived - totalCommission;

      // Expenses — cross-project, EXCLUDE COMMISSION_WITHDRAW
      const expenses = userIds.length > 0
        ? await ctx.prisma.collectorExpense.findMany({ where: { collectorId: { in: userIds }, type: { not: "COMMISSION_WITHDRAW" } }, select: { amount: true } })
        : [];
      const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
      const walletBalance = teamRevenue - totalExpenses;

      // Previous period
      let previous = { grossReceived: 0, netReceived: 0, teamRevenue: 0, transactionCount: 0 };
      if (previousDateFilter) {
        const prevW = await ctx.prisma.withdrawal.findMany({
          where: { businessManaged: false,  type: "EXCHANGE", date: previousDateFilter,
            OR: [{ agentEmailId: { not: null } }, { agentUserId: { not: null } }] },
          select: { amount: true, paypalFee: true, projectId: true, agentEmailId: true, agentUserId: true },
        });
        let pg = 0, pf = 0, pc = 0;
        for (const w of prevW) {
          if (w.paypalFee == null) continue;
          const g = Number(w.amount), f = Number(w.paypalFee), n = g - f;
          const uid = (w.agentEmailId ? emailToUser.get(w.agentEmailId) : null) || w.agentUserId;
          const uf = uid ? agentFees.get(uid) : undefined;
          const p = uf ? getFeePercent(uf, w.projectId) : 0;
          pg += g; pf += f; pc += n * p / 100;
        }
        previous = { grossReceived: pg, netReceived: pg - pf, teamRevenue: (pg - pf) - pc, transactionCount: prevW.length };
      }

      const calcChange = (cur: number, prev: number): number | null => {
        if (input.period === "all") return null;
        if (prev === 0) return cur > 0 ? 100 : null;
        return ((cur - prev) / prev) * 100;
      };

      return {
        current: { grossReceived, totalFees, netReceived, totalCommission, teamRevenue,
          transactionCount, confirmedCount, unconfirmedCount, disputeCount, pendingFeeCount, totalExpenses, walletBalance },
        previous,
        changes: { grossChange: calcChange(grossReceived, previous.grossReceived),
          revenueChange: calcChange(teamRevenue, previous.teamRevenue),
          txCountChange: calcChange(transactionCount, previous.transactionCount) },
      };
    }),

  agentPerformance: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Date filter (optional)
      const dateFilter: any = {};
      if (input.dateFrom) dateFilter.gte = new Date(input.dateFrom);
      if (input.dateTo) { const d = new Date(input.dateTo); d.setDate(d.getDate() + 1); dateFilter.lt = d; }
      const hasDateFilter = Object.keys(dateFilter).length > 0;

      // ═══ STEP 1: Find ALL agents who have EXCHANGE withdrawals in this project ═══
      const projectWithdrawals = await ctx.prisma.withdrawal.findMany({
        where: { businessManaged: false, 
          projectId: input.projectId,
          type: "EXCHANGE",
          OR: [
            { agentEmailId: { not: null } },
            { agentUserId: { not: null } },
          ],
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
        select: {
          amount: true,
          paypalFee: true,
          paidToTeam: true,
          date: true,
          agentEmailId: true,
          agentUserId: true,
          agentDisputed: true,
          disputeResolved: true,
        },
      });
      if (projectWithdrawals.length === 0) return [];

      // Collect unique agent user IDs
      const emailIdSet = new Set<string>();
      const userIdSet = new Set<string>();
      for (const w of projectWithdrawals) {
        if (w.agentEmailId) emailIdSet.add(w.agentEmailId);
        if (w.agentUserId) userIdSet.add(w.agentUserId);
      }

      // ═══ STEP 2: Fetch agent email details + auto-heal missing agentUserId ═══
      const allEmailIds = Array.from(emailIdSet);
      const agentEmails = allEmailIds.length > 0
        ? await ctx.prisma.agentPaypalEmail.findMany({
            where: { id: { in: allEmailIds } },
            select: { id: true, email: true, userId: true,
              user: { select: { id: true, name: true, username: true, email: true, lastActiveAt: true } } },
          })
        : [];

      // Auto-heal: backfill agentUserId (mirrors walletBalance logic)
      for (const ae of agentEmails) {
        userIdSet.add(ae.userId);
        await ctx.prisma.withdrawal.updateMany({
          where: { businessManaged: false,  agentEmailId: ae.id, agentUserId: null, type: "EXCHANGE" },
          data: { agentUserId: ae.userId },
        });
      }

      // Build lookups
      const emailToUser = new Map<string, string>();
      const userEmailMap = new Map<string, typeof agentEmails>();
      for (const ae of agentEmails) {
        emailToUser.set(ae.id, ae.userId);
        const arr = userEmailMap.get(ae.userId) || [];
        arr.push(ae);
        userEmailMap.set(ae.userId, arr);
      }

      // For users found via agentUserId but without emails, fetch user info
      const missingUserIds = Array.from(userIdSet).filter((uid) => !userEmailMap.has(uid));
      if (missingUserIds.length > 0) {
        const users = await ctx.prisma.user.findMany({
          where: { id: { in: missingUserIds } },
          select: { id: true, name: true, username: true, email: true, lastActiveAt: true },
        });
        for (const u of users) {
          userEmailMap.set(u.id, [{ id: "", email: u.email, userId: u.id, user: u } as any]);
        }
      }

      const userIds = Array.from(userEmailMap.keys());
      if (userIds.length === 0) return [];

      // ═══ STEP 3+4: BATCHED cross-project aggregation using shared utility (no N+1) ═══
      // One query: ALL emails for ALL agents
      const allUserEmails = await ctx.prisma.agentPaypalEmail.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, userId: true },
      });
      const allUserEmailIds = allUserEmails.map((e) => e.id);
      const emailUserLookup = new Map<string, string>();
      for (const e of allUserEmails) emailUserLookup.set(e.id, e.userId);

      // One query: ALL withdrawals for ALL agents (cross-project, with optional date filter)
      const allCrossW = await ctx.prisma.withdrawal.findMany({
        where: { businessManaged: false, 
          type: "EXCHANGE",
          OR: [
            ...(allUserEmailIds.length > 0 ? [{ agentEmailId: { in: allUserEmailIds } }] : []),
            { agentUserId: { in: userIds } },
          ],
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
        select: { amount: true, paypalFee: true, paidToTeam: true, date: true, projectId: true,
          agentEmailId: true, agentUserId: true, agentDisputed: true, disputeResolved: true },
      });

      // Load fees using shared utility
      const agentFees = await loadAgentFees(ctx.prisma, userIds);

      // Build 14-day sparkline labels
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const fourteenDaysAgo = new Date(startOfToday);
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
      const dayLabels: string[] = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date(fourteenDaysAgo);
        d.setDate(d.getDate() + i);
        dayLabels.push(d.toISOString().split("T")[0]);
      }

      // Group withdrawals by userId and aggregate in memory
      const userStats = new Map<string, {
        grossConfirmed: number; totalFees: number; totalCommission: number;
        totalAfterFee: number; unpaidTeamShare: number;
        hasDisputes: boolean; dailyMap: Map<string, number>;
      }>();
      for (const uid of userIds) {
        userStats.set(uid, {
          grossConfirmed: 0, totalFees: 0, totalCommission: 0,
          totalAfterFee: 0, unpaidTeamShare: 0,
          hasDisputes: false, dailyMap: new Map(dayLabels.map((d) => [d, 0])),
        });
      }

      for (const w of allCrossW) {
        const uid = (w.agentEmailId ? emailUserLookup.get(w.agentEmailId) : null) || w.agentUserId;
        if (!uid || !userStats.has(uid)) continue;
        const stats = userStats.get(uid)!;
        const gross = Number(w.amount);
        const fees = agentFees.get(uid);

        if (w.paypalFee != null && fees) {
          const fee = Number(w.paypalFee);
          const net = gross - fee;
          const pct = getFeePercent(fees, w.projectId);
          const comm = net * pct / 100;
          const taf = net - comm;
          stats.grossConfirmed += gross;
          stats.totalFees += fee;
          stats.totalCommission += comm;
          stats.totalAfterFee += taf;
          if (!w.paidToTeam) stats.unpaidTeamShare += taf;
        }
        if (w.agentDisputed && !w.disputeResolved) stats.hasDisputes = true;
        const dayKey = new Date(w.date).toISOString().split("T")[0];
        if (stats.dailyMap.has(dayKey)) stats.dailyMap.set(dayKey, stats.dailyMap.get(dayKey)! + gross);
      }

      // ═══ STEP 5: Expenses — cross-project, EXCLUDE COMMISSION_WITHDRAW ═══
      const allExpenses = await ctx.prisma.collectorExpense.findMany({
        where: { collectorId: { in: userIds } },
        select: { collectorId: true, amount: true, type: true },
      });
      const expenseByUser = new Map<string, number>();
      const teamPaymentByUser = new Map<string, number>();
      for (const e of allExpenses) {
        if (e.type === "COMMISSION_WITHDRAW") continue; // skip — doesn't affect team wallet
        expenseByUser.set(e.collectorId, (expenseByUser.get(e.collectorId) ?? 0) + Number(e.amount));
        if (e.type === "TEAM_PAYMENT") {
          teamPaymentByUser.set(e.collectorId, (teamPaymentByUser.get(e.collectorId) ?? 0) + Number(e.amount));
        }
      }

      // ═══ STEP 6: Build result (stats already cross-project from STEP 4) ═══
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const result = userIds.map((uid) => {
        const emails = userEmailMap.get(uid)!;
        const user = emails[0].user;
        const stats = userStats.get(uid)!;
        const userFee = agentFees.get(uid);
        const pct = userFee ? getFeePercent(userFee, input.projectId) : 0;
        const dailyVolume = dayLabels.map((date) => ({ date, amount: stats.dailyMap.get(date) ?? 0 }));
        const totalExpenses = expenseByUser.get(uid) ?? 0;
        const totalTeamPayments = teamPaymentByUser.get(uid) ?? 0;
        // owedToTeam = totalAfterFee - expenses (all cross-project, matches walletBalance)
        const walletBalance = stats.totalAfterFee - totalExpenses;

        return {
          userId: uid,
          userName: capitalName(user.name || user.username),
          email: emails[0].email,
          // Per-project metrics (this project only)
          totalReceived: stats.grossConfirmed,
          totalPPFees: stats.totalFees,
          netReceived: stats.grossConfirmed - stats.totalFees,
          totalCommission: stats.totalCommission,
          feePercent: pct,
          teamShare: stats.totalAfterFee,
          // Cross-project financial position
          totalExpenses,
          totalTeamPayments,
          owedToTeam: walletBalance, // THE key number — matches walletBalance endpoint
          isOnline: user.lastActiveAt ? new Date(user.lastActiveAt) > fiveMinAgo : false,
          hasDisputes: stats.hasDisputes,
          unpaidCommission: stats.unpaidTeamShare,
          dailyVolume,
        };
      });

      // Sort by totalReceived descending
      result.sort((a, b) => b.totalReceived - a.totalReceived);

      return result;
    }),
});
