import { z } from "zod";
import { router, withdrawalsProcedure, moderatorProcedure, adminProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";

export const withdrawalRouter = router({
  list: withdrawalsProcedure
    .input(
      z.object({
        projectId: z.string(),
        type: z.enum(["MIXING", "EXCHANGE"]).optional(),
        agent: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.type) where.type = input.type;
      if (input.agent) where.agent = input.agent;
      if (input.dateFrom || input.dateTo) {
        where.date = {};
        if (input.dateFrom) where.date.gte = new Date(input.dateFrom);
        if (input.dateTo) where.date.lte = new Date(input.dateTo);
      }

      const [items, total] = await Promise.all([
        ctx.prisma.withdrawal.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { date: "desc" },
          include: {
            sourcePaypal: { select: { code: true, holder: true, primaryEmail: true, emails: { select: { id: true, email: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } } },
            destPaypal: { select: { code: true, primaryEmail: true, emails: { select: { id: true, email: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } } },
            agentEmail: { select: { email: true, label: true } },
          },
        }),
        ctx.prisma.withdrawal.count({ where }),
      ]);

      return { items, total, page: input.page, limit: input.limit };
    }),

  create: withdrawalsProcedure
    .input(
      z.object({
        projectId: z.string(),
        date: z.string(),
        amount: z.number().positive(),
        transactionId: z.string().optional(),
        type: z.enum(["MIXING", "EXCHANGE"]),
        agent: z.string().optional(),
        withdrawCode: z.string().optional(),
        ppReceived: z.string().optional(),
        mailConfirmed: z.boolean().default(false),
        notes: z.string().optional(),
        sourcePaypalId: z.string(),
        destPaypalId: z.string().optional(),
        agentUserId: z.string().optional(),
        agentEmailId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.payPalAccount.findFirstOrThrow({
        where: { id: input.sourcePaypalId, projectId: input.projectId },
      });
      if (input.destPaypalId) {
        await ctx.prisma.payPalAccount.findFirstOrThrow({
          where: { id: input.destPaypalId, projectId: input.projectId },
        });
      }
      const result = await ctx.prisma.withdrawal.create({
        data: {
          ...input,
          date: new Date(input.date),
        },
      });
      await createAuditLog({
        action: "CREATE",
        entity: "Withdrawal",
        entityId: result.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { amount: input.amount, type: input.type, agent: input.agent, sourcePaypalId: input.sourcePaypalId },
      });
      return result;
    }),

  update: withdrawalsProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        mailConfirmed: z.boolean().optional(),
        notes: z.string().nullable().optional(),
        amount: z.number().positive().optional(),
        agent: z.string().optional(),
        withdrawCode: z.string().nullable().optional(),
        transactionId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      await ctx.prisma.withdrawal.findFirstOrThrow({ where: { id, projectId } });
      const result = await ctx.prisma.withdrawal.update({ where: { id }, data });
      await createAuditLog({
        action: "UPDATE",
        entity: "Withdrawal",
        entityId: id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: data,
      });
      return result;
    }),

  delete: adminProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.withdrawal.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      const result = await ctx.prisma.withdrawal.delete({ where: { id: input.id } });
      await createAuditLog({
        action: "DELETE",
        entity: "Withdrawal",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { amount: existing.amount, type: existing.type, agent: existing.agent },
      });
      return result;
    }),

  // ═══ Dispute Management (Admin/Moderator) ═══
  disputes: moderatorProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.withdrawal.findMany({
        where: {
          projectId: input.projectId,
          agentDisputed: true,
        },
        include: {
          sourcePaypal: { select: { code: true } },
          agentUser: { select: { name: true, username: true } },
          agentEmail: { select: { email: true, label: true } },
          resolvedBy: { select: { name: true, username: true } },
        },
        orderBy: { updatedAt: "desc" },
      });
    }),

  resolveDispute: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      action: z.enum(["OVERRIDE", "VOID"]),
      adminNote: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const wd = await ctx.prisma.withdrawal.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId, agentDisputed: true },
      });

      if (input.action === "OVERRIDE") {
        // Admin confirms it was sent — override dispute
        const result = await ctx.prisma.withdrawal.update({
          where: { id: input.id },
          data: {
            disputeResolved: true,
            disputeAction: "OVERRIDE",
            adminResolveNote: input.adminNote || null,
            agentConfirmed: true,
            agentDisputed: false,
            resolvedAt: new Date(),
            resolvedById: ctx.user.id,
          },
        });
        await createAuditLog({
          action: "UPDATE",
          entity: "Withdrawal",
          entityId: input.id,
          userId: ctx.user.id,
          projectId: input.projectId,
          changes: { disputeAction: "OVERRIDE", adminNote: input.adminNote },
        });
        return result;
      }

      if (input.action === "VOID") {
        // Admin voids the transaction — delete it, money returns to source PP balance
        await ctx.prisma.withdrawal.update({
          where: { id: input.id },
          data: {
            disputeResolved: true,
            disputeAction: "VOID",
            adminResolveNote: input.adminNote || null,
            resolvedAt: new Date(),
            resolvedById: ctx.user.id,
          },
        });
        // Delete the withdrawal so balance recalculates
        const result = await ctx.prisma.withdrawal.delete({ where: { id: input.id } });
        await createAuditLog({
          action: "DELETE",
          entity: "Withdrawal",
          entityId: input.id,
          userId: ctx.user.id,
          projectId: input.projectId,
          changes: { disputeAction: "VOID", amount: wd.amount, agent: wd.agent, adminNote: input.adminNote },
        });
        return result;
      }
    }),

  todaySummary: withdrawalsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const withdrawals = await ctx.prisma.withdrawal.findMany({
        where: {
          projectId: input.projectId,
          date: { gte: today, lt: tomorrow },
        },
        include: {
          sourcePaypal: { select: { code: true } },
          destPaypal: { select: { code: true } },
        },
        orderBy: { date: "desc" },
      });

      const total = await ctx.prisma.withdrawal.aggregate({
        where: {
          projectId: input.projectId,
          date: { gte: today, lt: tomorrow },
        },
        _sum: { amount: true },
        _count: true,
      });

      return {
        withdrawals,
        totalAmount: total._sum.amount ?? 0,
        count: total._count,
      };
    }),

  byAgent: withdrawalsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.withdrawal.groupBy({
        by: ["agent"],
        where: { projectId: input.projectId, type: "EXCHANGE" },
        _sum: { amount: true },
        _count: true,
      });
    }),

  mixingStatus: withdrawalsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [accounts, fundAggs, outAggs, inAggs] = await Promise.all([
        // ALL PPs (not just NORMAL) so master/dest PPs also show
        ctx.prisma.payPalAccount.findMany({
          where: { projectId: input.projectId },
          select: { id: true, code: true, holder: true, vmppCode: true, role: true, primaryEmail: true },
        }),
        // Confirmed funds received per PP
        ctx.prisma.fundTransaction.groupBy({
          by: ["paypalId"],
          where: { projectId: input.projectId, confirmed: true },
          _sum: { amount: true },
        }),
        // All outgoing withdrawals (MIXING + EXCHANGE) per source PP
        ctx.prisma.withdrawal.groupBy({
          by: ["sourcePaypalId"],
          where: { projectId: input.projectId },
          _sum: { amount: true },
        }),
        // Incoming mixing per dest PP (money received from other PPs)
        ctx.prisma.withdrawal.groupBy({
          by: ["destPaypalId"],
          where: { projectId: input.projectId, type: "MIXING" },
          _sum: { amount: true },
        }),
      ]);

      const fundMap = new Map(fundAggs.map((f) => [f.paypalId, Number(f._sum.amount ?? 0)]));
      const outMap = new Map(outAggs.map((m) => [m.sourcePaypalId, Number(m._sum.amount ?? 0)]));
      const inMap = new Map(inAggs.map((m) => [m.destPaypalId!, Number(m._sum.amount ?? 0)]));

      const results = accounts.map((pp) => {
        const totalFunds = fundMap.get(pp.id) ?? 0;
        const totalIncoming = inMap.get(pp.id) ?? 0;
        const totalOutgoing = outMap.get(pp.id) ?? 0;
        const balance = totalFunds + totalIncoming - totalOutgoing;
        return {
          ...pp,
          totalFunds,
          totalIncoming,
          totalOutgoing,
          balance,
          // For backward compat
          totalReceived: totalFunds,
          unmixedBalance: balance,
        };
      });

      const withBalance = results.filter((r) => r.balance > 0.01);
      const noBalance = results.filter((r) => r.balance <= 0.01);

      return {
        // PPs with fund balance that need to be mixed (NORMAL PPs)
        unmixed: withBalance.filter((r) => r.role === "NORMAL" && r.totalIncoming === 0),
        // PPs that accumulated balance (received mixing OR master with balance)
        accumulated: withBalance.filter((r) => r.role === "MASTER" || r.totalIncoming > 0),
        mixed: noBalance,
        totalUnmixed: withBalance.reduce((sum, r) => sum + r.balance, 0),
      };
    }),

  // ═══ Merge Target (mail gộp) per holder ═══
  getMergeTargets: withdrawalsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const targets = await ctx.prisma.holderMergeTarget.findMany({
        where: { projectId: input.projectId },
        include: { paypal: { select: { id: true, code: true, primaryEmail: true, vmppCode: true } } },
      });
      // Return as Record<holder, {paypalId, code, email, vmppCode}>
      const result: Record<string, { paypalId: string; code: string; email: string; vmppCode: string | null }> = {};
      for (const t of targets) {
        result[t.holder] = {
          paypalId: t.paypal.id,
          code: t.paypal.code,
          email: t.paypal.primaryEmail,
          vmppCode: t.paypal.vmppCode ?? null,
        };
      }
      return result;
    }),

  setMergeTarget: withdrawalsProcedure
    .input(z.object({
      projectId: z.string(),
      holder: z.string(),
      paypalId: z.string().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const holderKey = input.holder.toLowerCase().trim();
      if (!input.paypalId) {
        // Remove merge target
        await ctx.prisma.holderMergeTarget.deleteMany({
          where: { holder: holderKey, projectId: input.projectId },
        });
        return { ok: true, removed: true };
      }
      // Verify PP exists in project
      const pp = await ctx.prisma.payPalAccount.findFirstOrThrow({
        where: { id: input.paypalId, projectId: input.projectId },
      });
      await ctx.prisma.holderMergeTarget.upsert({
        where: { holder_projectId: { holder: holderKey, projectId: input.projectId } },
        update: { paypalId: input.paypalId },
        create: { holder: holderKey, paypalId: input.paypalId, projectId: input.projectId },
      });
      return { ok: true, email: pp.primaryEmail };
    }),

  bulkMix: withdrawalsProcedure
    .input(z.object({
      projectId: z.string(),
      date: z.string(),
      destPaypalId: z.string(),
      withdrawCode: z.string().optional(),
      sources: z.array(z.object({
        sourcePaypalId: z.string(),
        amount: z.number().positive(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.payPalAccount.findFirstOrThrow({
        where: { id: input.destPaypalId, projectId: input.projectId },
      });
      let created = 0;
      for (const src of input.sources) {
        await ctx.prisma.payPalAccount.findFirstOrThrow({
          where: { id: src.sourcePaypalId, projectId: input.projectId },
        });
        const result = await ctx.prisma.withdrawal.create({
          data: {
            date: new Date(input.date),
            amount: src.amount,
            type: "MIXING",
            sourcePaypalId: src.sourcePaypalId,
            destPaypalId: input.destPaypalId,
            withdrawCode: input.withdrawCode || undefined,
            projectId: input.projectId,
            mailConfirmed: true,
          },
        });
        await createAuditLog({
          action: "CREATE",
          entity: "Withdrawal",
          entityId: result.id,
          userId: ctx.user.id,
          projectId: input.projectId,
          changes: { amount: src.amount, type: "MIXING", sourcePaypalId: src.sourcePaypalId, destPaypalId: input.destPaypalId },
        });
        created++;
      }
      return { created };
    }),

  agentDetail: withdrawalsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const exchanges = await ctx.prisma.withdrawal.findMany({
        where: { projectId: input.projectId, type: "EXCHANGE" },
        include: {
          sourcePaypal: { select: { code: true } },
        },
        orderBy: { date: "desc" },
      });

      // Group by agent
      const agentMap: Record<string, {
        agent: string;
        totalAmount: number;
        count: number;
        sourcePPs: Set<string>;
        lastDate: Date;
      }> = {};

      for (const ex of exchanges) {
        const agent = ex.agent || "Unknown";
        if (!agentMap[agent]) {
          agentMap[agent] = { agent, totalAmount: 0, count: 0, sourcePPs: new Set(), lastDate: ex.date };
        }
        agentMap[agent].totalAmount += Number(ex.amount);
        agentMap[agent].count++;
        if (ex.sourcePaypal?.code) agentMap[agent].sourcePPs.add(ex.sourcePaypal.code);
        if (ex.date > agentMap[agent].lastDate) agentMap[agent].lastDate = ex.date;
      }

      return Object.values(agentMap).map((a) => ({
        agent: a.agent,
        totalAmount: a.totalAmount,
        count: a.count,
        sourcePPs: Array.from(a.sourcePPs),
        lastDate: a.lastDate,
      })).sort((a, b) => b.totalAmount - a.totalAmount);
    }),

  bulkImport: withdrawalsProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        date: z.string(),
        amount: z.number().positive(),
        type: z.enum(["MIXING", "EXCHANGE"]),
        agent: z.string().optional(),
        withdrawCode: z.string().optional(),
        mailConfirmed: z.boolean().default(false),
        sourcePaypalCode: z.string(),
        destPaypalCode: z.string().optional(),
        notes: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          const sourcePP = await ctx.prisma.payPalAccount.findFirst({
            where: { code: item.sourcePaypalCode, projectId: input.projectId },
          });
          if (!sourcePP) {
            errors.push(`Source PP ${item.sourcePaypalCode} not found`);
            skipped++;
            continue;
          }
          let destPaypalId: string | null = null;
          if (item.destPaypalCode) {
            const destPP = await ctx.prisma.payPalAccount.findFirst({
              where: { code: item.destPaypalCode, projectId: input.projectId },
            });
            destPaypalId = destPP?.id ?? null;
          }
          await ctx.prisma.withdrawal.create({
            data: {
              date: new Date(item.date),
              amount: item.amount,
              type: item.type,
              agent: item.agent,
              withdrawCode: item.withdrawCode,
              mailConfirmed: item.mailConfirmed,
              notes: item.notes,
              sourcePaypalId: sourcePP.id,
              destPaypalId,
              projectId: input.projectId,
            },
          });
          imported++;
        } catch (e: any) {
          errors.push(`Row: ${e.message}`);
          skipped++;
        }
      }
      return { imported, skipped, errors: errors.slice(0, 10) };
    }),
});
