import { z } from "zod";
import { router, withdrawalsProcedure, moderatorProcedure } from "../trpc";
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
            sourcePaypal: { select: { code: true } },
            destPaypal: { select: { code: true } },
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify source PayPal belongs to same project
      await ctx.prisma.payPalAccount.findFirstOrThrow({
        where: { id: input.sourcePaypalId, projectId: input.projectId },
      });
      // Verify dest PayPal if provided
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

  delete: moderatorProcedure
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
      // Batch queries instead of N+1
      const [accounts, fundAggs, mixingAggs] = await Promise.all([
        ctx.prisma.payPalAccount.findMany({
          where: { projectId: input.projectId, role: "NORMAL" },
          select: { id: true, code: true },
        }),
        ctx.prisma.fundTransaction.groupBy({
          by: ["paypalId"],
          where: { projectId: input.projectId },
          _sum: { amount: true },
        }),
        ctx.prisma.withdrawal.groupBy({
          by: ["sourcePaypalId"],
          where: { projectId: input.projectId, type: "MIXING" },
          _sum: { amount: true },
        }),
      ]);

      const fundMap = new Map(fundAggs.map((f) => [f.paypalId, Number(f._sum.amount ?? 0)]));
      const mixingMap = new Map(mixingAggs.map((m) => [m.sourcePaypalId, Number(m._sum.amount ?? 0)]));

      const results = accounts.map((pp) => {
        const totalReceived = fundMap.get(pp.id) ?? 0;
        const totalMixed = mixingMap.get(pp.id) ?? 0;
        const unmixedBalance = totalReceived - totalMixed;
        return {
          ...pp,
          totalReceived,
          totalMixed,
          unmixedBalance,
          isMixed: unmixedBalance <= 0,
        };
      });

      return {
        mixed: results.filter((r) => r.isMixed),
        unmixed: results.filter((r) => !r.isMixed),
        totalUnmixed: results.reduce((sum, r) => sum + r.unmixedBalance, 0),
      };
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
