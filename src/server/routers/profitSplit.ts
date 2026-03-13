import { z } from "zod";
import { router, profitProcedure, moderatorProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";

export const profitSplitRouter = router({
  list: profitProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.profitSplit.findMany({
        where: { projectId: input.projectId },
        include: {
          allocations: true,
        },
        orderBy: { periodStart: "desc" },
      });
    }),

  getById: profitProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.profitSplit.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        include: { allocations: true },
      });
    }),

  create: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        periodStart: z.string(),
        periodEnd: z.string(),
        partners: z.array(
          z.object({
            name: z.string(),
            percentage: z.number().min(0).max(100),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Validate percentages sum to 100
      const totalPct = input.partners.reduce((s, p) => s + p.percentage, 0);
      if (Math.abs(totalPct - 100) > 0.01) {
        throw new Error("Partner percentages must sum to 100%");
      }

      // Calculate totals for the period
      const periodStart = new Date(input.periodStart);
      const periodEnd = new Date(input.periodEnd);

      const totalWithdrawal = await ctx.prisma.withdrawal.aggregate({
        where: {
          projectId: input.projectId,
          type: "EXCHANGE",
          date: { gte: periodStart, lte: periodEnd },
        },
        _sum: { amount: true },
      });

      const totalCost = await ctx.prisma.costRecord.aggregate({
        where: {
          projectId: input.projectId,
          date: { gte: periodStart, lte: periodEnd },
        },
        _sum: { total: true },
      });

      const withdrawal = totalWithdrawal._sum.amount?.toNumber() ?? 0;
      const cost = totalCost._sum.total?.toNumber() ?? 0;
      const netProfit = Math.round((withdrawal - cost) * 100) / 100;

      const result = await ctx.prisma.profitSplit.create({
        data: {
          periodStart,
          periodEnd,
          totalWithdrawal: withdrawal,
          totalCost: cost,
          netProfit,
          projectId: input.projectId,
          allocations: {
            create: input.partners.map((p) => ({
              partnerName: p.name,
              percentage: p.percentage,
              amount: Math.round((netProfit * p.percentage) / 100 * 100) / 100,
            })),
          },
        },
        include: { allocations: true },
      });
      await createAuditLog({
        action: "CREATE",
        entity: "ProfitSplit",
        entityId: result.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { periodStart: input.periodStart, periodEnd: input.periodEnd, netProfit, partners: input.partners },
      });
      return result;
    }),

  recalculate: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const split = await ctx.prisma.profitSplit.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        include: { allocations: true },
      });
      if (split.settled) {
        throw new Error("Cannot recalculate a settled profit split");
      }

      const totalWithdrawal = await ctx.prisma.withdrawal.aggregate({
        where: {
          projectId: input.projectId,
          type: "EXCHANGE",
          date: { gte: split.periodStart, lte: split.periodEnd },
        },
        _sum: { amount: true },
      });

      const totalCost = await ctx.prisma.costRecord.aggregate({
        where: {
          projectId: input.projectId,
          date: { gte: split.periodStart, lte: split.periodEnd },
        },
        _sum: { total: true },
      });

      const withdrawal = totalWithdrawal._sum.amount?.toNumber() ?? 0;
      const cost = totalCost._sum.total?.toNumber() ?? 0;
      const netProfit = Math.round((withdrawal - cost) * 100) / 100;

      // Update split and recalculate allocations
      await ctx.prisma.profitSplit.update({
        where: { id: input.id },
        data: { totalWithdrawal: withdrawal, totalCost: cost, netProfit },
      });

      for (const alloc of split.allocations) {
        const pct = typeof alloc.percentage === 'object' && 'toNumber' in alloc.percentage
          ? (alloc.percentage as any).toNumber()
          : Number(alloc.percentage);
        await ctx.prisma.splitAllocation.update({
          where: { id: alloc.id },
          data: {
            amount: Math.round((netProfit * pct) / 100 * 100) / 100,
          },
        });
      }

      const updated = await ctx.prisma.profitSplit.findUniqueOrThrow({
        where: { id: input.id },
        include: { allocations: true },
      });
      await createAuditLog({
        action: "RECALCULATE",
        entity: "ProfitSplit",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { totalWithdrawal: withdrawal, totalCost: cost, netProfit },
      });
      return updated;
    }),

  settle: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.profitSplit.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      if (existing.settled) throw new Error("Already settled");
      const result = await ctx.prisma.profitSplit.update({
        where: { id: input.id },
        data: { settled: true },
      });
      await createAuditLog({
        action: "SETTLE",
        entity: "ProfitSplit",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { settled: true },
      });
      return result;
    }),

  markAllocationPaid: moderatorProcedure
    .input(z.object({ projectId: z.string(), allocationId: z.string(), paid: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // Verify allocation belongs to project
      await ctx.prisma.splitAllocation.findFirstOrThrow({
        where: { id: input.allocationId, split: { projectId: input.projectId } },
      });
      const result = await ctx.prisma.splitAllocation.update({
        where: { id: input.allocationId },
        data: { paid: input.paid },
      });
      await createAuditLog({
        action: "UPDATE",
        entity: "SplitAllocation",
        entityId: input.allocationId,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { paid: input.paid },
      });
      return result;
    }),
});
