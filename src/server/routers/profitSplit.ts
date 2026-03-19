import { z } from "zod";
import { router, profitProcedure, moderatorProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";

export const profitSplitRouter = router({
  list: profitProcedure
    .input(z.object({
      projectId: z.string(),
      year: z.number().optional(),
      month: z.number().optional(),
      viewMode: z.enum(["month", "quarter", "year"]).optional(),
      status: z.enum(["all", "pending", "settled"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };

      if (input.status === "pending") where.settled = false;
      if (input.status === "settled") where.settled = true;

      if (input.year) {
        const mode = input.viewMode ?? "month";
        let startDate: Date;
        let endDate: Date;

        if (mode === "year") {
          startDate = new Date(input.year, 0, 1);
          endDate = new Date(input.year, 11, 31, 23, 59, 59);
        } else if (mode === "quarter" && input.month) {
          const qStart = Math.floor((input.month - 1) / 3) * 3;
          startDate = new Date(input.year, qStart, 1);
          endDate = new Date(input.year, qStart + 3, 0, 23, 59, 59);
        } else if (input.month) {
          startDate = new Date(input.year, input.month - 1, 1);
          endDate = new Date(input.year, input.month, 0, 23, 59, 59);
        } else {
          startDate = new Date(input.year, 0, 1);
          endDate = new Date(input.year, 11, 31, 23, 59, 59);
        }

        where.periodStart = { gte: startDate, lte: endDate };
      }

      return ctx.prisma.profitSplit.findMany({
        where,
        include: { allocations: true },
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
    .input(z.object({
      projectId: z.string(),
      periodStart: z.string(),
      periodEnd: z.string(),
      usdtRate: z.number().optional(),
      partners: z.array(z.object({
        name: z.string(),
        percentage: z.number().min(0).max(100),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const totalPct = input.partners.reduce((s, p) => s + p.percentage, 0);
      if (Math.abs(totalPct - 100) > 0.01) {
        throw new Error("Partner percentages must sum to 100%");
      }

      const periodStart = new Date(input.periodStart);
      const periodEnd = new Date(input.periodEnd);

      // Check duplicate period
      const existing = await ctx.prisma.profitSplit.findFirst({
        where: {
          projectId: input.projectId,
          periodStart: { gte: periodStart },
          periodEnd: { lte: periodEnd },
        },
      });
      if (existing) {
        throw new Error("A profit split already exists for this period");
      }

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

      const usdtRate = input.usdtRate ?? null;
      const netProfitUsdt = usdtRate ? Math.round(netProfit * usdtRate * 100) / 100 : null;

      const result = await ctx.prisma.profitSplit.create({
        data: {
          periodStart,
          periodEnd,
          totalWithdrawal: withdrawal,
          totalCost: cost,
          netProfit,
          usdtRate,
          netProfitUsdt,
          projectId: input.projectId,
          allocations: {
            create: input.partners.map((p) => ({
              partnerName: p.name,
              percentage: p.percentage,
              amount: Math.round((netProfit * p.percentage) / 100 * 100) / 100,
              amountUsdt: netProfitUsdt
                ? Math.round((netProfitUsdt * p.percentage) / 100 * 100) / 100
                : null,
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
        changes: { periodStart: input.periodStart, periodEnd: input.periodEnd, netProfit, usdtRate, netProfitUsdt, partners: input.partners },
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

      const usdtRate = split.usdtRate ? Number(split.usdtRate) : null;
      const netProfitUsdt = usdtRate ? Math.round(netProfit * usdtRate * 100) / 100 : null;

      await ctx.prisma.profitSplit.update({
        where: { id: input.id },
        data: { totalWithdrawal: withdrawal, totalCost: cost, netProfit, netProfitUsdt },
      });

      for (const alloc of split.allocations) {
        const pct = typeof alloc.percentage === 'object' && 'toNumber' in alloc.percentage
          ? (alloc.percentage as any).toNumber()
          : Number(alloc.percentage);
        const amount = Math.round((netProfit * pct) / 100 * 100) / 100;
        const amountUsdt = netProfitUsdt
          ? Math.round((netProfitUsdt * pct) / 100 * 100) / 100
          : null;
        await ctx.prisma.splitAllocation.update({
          where: { id: alloc.id },
          data: { amount, amountUsdt },
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
        changes: { totalWithdrawal: withdrawal, totalCost: cost, netProfit, netProfitUsdt },
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

  updateSplit: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      usdtRate: z.number().optional(),
      notes: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const split = await ctx.prisma.profitSplit.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        include: { allocations: true },
      });
      if (split.settled) throw new Error("Cannot update a settled split");

      const data: any = {};
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.usdtRate !== undefined) {
        data.usdtRate = input.usdtRate;
        const netProfit = Number(split.netProfit);
        data.netProfitUsdt = Math.round(netProfit * input.usdtRate * 100) / 100;

        // Update allocations USDT
        for (const alloc of split.allocations) {
          const pct = Number(alloc.percentage);
          await ctx.prisma.splitAllocation.update({
            where: { id: alloc.id },
            data: { amountUsdt: Math.round((data.netProfitUsdt * pct) / 100 * 100) / 100 },
          });
        }
      }

      const result = await ctx.prisma.profitSplit.update({
        where: { id: input.id },
        data,
        include: { allocations: true },
      });
      await createAuditLog({
        action: "UPDATE",
        entity: "ProfitSplit",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: data,
      });
      return result;
    }),

  deleteSplit: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const split = await ctx.prisma.profitSplit.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
      });
      if (split.settled) throw new Error("Cannot delete a settled split");
      await ctx.prisma.profitSplit.delete({ where: { id: input.id } });
      await createAuditLog({
        action: "DELETE",
        entity: "ProfitSplit",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: {},
      });
      return { success: true };
    }),

  updateAllocation: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      allocationId: z.string(),
      note: z.string().nullable().optional(),
      paid: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.splitAllocation.findFirstOrThrow({
        where: { id: input.allocationId, split: { projectId: input.projectId } },
      });
      const data: any = {};
      if (input.note !== undefined) data.note = input.note;
      if (input.paid !== undefined) data.paid = input.paid;
      const result = await ctx.prisma.splitAllocation.update({
        where: { id: input.allocationId },
        data,
      });
      await createAuditLog({
        action: "UPDATE",
        entity: "SplitAllocation",
        entityId: input.allocationId,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: data,
      });
      return result;
    }),

  fetchUsdtRate: profitProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async () => {
      try {
        const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=USDTDAI");
        // Binance doesn't have USDT/VND directly - use P2P average or a known rate
        // For now, fetch USDT price vs DAI (≈1:1) as placeholder
        // The actual USDT rate will be manually entered by user
        const data = await res.json();
        return { rate: parseFloat(data.price) || 1, source: "binance" };
      } catch {
        return { rate: 1, source: "fallback" };
      }
    }),
});
