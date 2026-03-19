import { z } from "zod";
import { router, memberProcedure } from "../trpc";

export const dashboardRouter = router({
  overview: memberProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { projectId } = input;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // 7-day range for trend
      const day7ago = new Date(today);
      day7ago.setDate(day7ago.getDate() - 6); // 6 days back + today = 7 days

      const [
        todayFunds,
        todayWithdrawals,
        ppByStatus,
        totalFunds,
        totalExchange,
        totalMixingToMaster,
        unconfirmedCount,
        vmCounts,
        totalFundsNormal,
        totalWithdrawalsFromNormal,
        totalExchangeOut,
        // 7-day trend raw data
        trendFunds,
        trendWithdrawals,
      ] = await Promise.all([
        // Today's funds
        ctx.prisma.fundTransaction.aggregate({
          where: { projectId, date: { gte: today, lt: tomorrow } },
          _sum: { amount: true },
          _count: true,
        }),
        // Today's withdrawals
        ctx.prisma.withdrawal.aggregate({
          where: { projectId, date: { gte: today, lt: tomorrow } },
          _sum: { amount: true },
          _count: true,
        }),
        // PP by status
        ctx.prisma.payPalAccount.groupBy({
          by: ["status"],
          where: { projectId },
          _count: true,
        }),
        // All-time funds
        ctx.prisma.fundTransaction.aggregate({
          where: { projectId },
          _sum: { amount: true },
        }),
        // All-time exchange withdrawals
        ctx.prisma.withdrawal.aggregate({
          where: { projectId, type: "EXCHANGE" },
          _sum: { amount: true },
        }),
        // Total mixing received by master PPs
        ctx.prisma.withdrawal.aggregate({
          where: {
            projectId,
            type: "MIXING",
            destPaypal: { role: "MASTER" },
          },
          _sum: { amount: true },
        }),
        // Unconfirmed funds
        ctx.prisma.fundTransaction.count({
          where: { projectId, confirmed: false },
        }),
        // VM status counts
        ctx.prisma.virtualMachine.groupBy({
          by: ["status"],
          where: { server: { projectId } },
          _count: true,
        }),
        // Funds received by NORMAL PPs
        ctx.prisma.fundTransaction.aggregate({
          where: { projectId, paypal: { role: "NORMAL" } },
          _sum: { amount: true },
        }),
        // FIX: ALL withdrawals FROM normal PPs (both MIXING + EXCHANGE)
        ctx.prisma.withdrawal.aggregate({
          where: { projectId, sourcePaypal: { role: "NORMAL" } },
          _sum: { amount: true },
        }),
        // Master PP EXCHANGE out
        ctx.prisma.withdrawal.aggregate({
          where: { projectId, type: "EXCHANGE", sourcePaypal: { role: "MASTER" } },
          _sum: { amount: true },
        }),
        // 7-day fund transactions
        ctx.prisma.fundTransaction.findMany({
          where: { projectId, date: { gte: day7ago, lt: tomorrow } },
          select: { date: true, amount: true },
        }),
        // 7-day withdrawals
        ctx.prisma.withdrawal.findMany({
          where: { projectId, date: { gte: day7ago, lt: tomorrow } },
          select: { date: true, amount: true },
        }),
      ]);

      // FIX: unsoldBalance = funds to NORMAL PPs - ALL withdrawals from NORMAL PPs
      const unsoldBalance = Number(totalFundsNormal._sum.amount ?? 0) - Number(totalWithdrawalsFromNormal._sum.amount ?? 0);
      const masterBalance = Number(totalMixingToMaster._sum.amount ?? 0) - Number(totalExchangeOut._sum.amount ?? 0);

      // Build 7-day trend
      const trend: { date: string; funds: number; withdrawals: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const nextD = new Date(d);
        nextD.setDate(nextD.getDate() + 1);

        const dayFunds = trendFunds
          .filter((f) => f.date >= d && f.date < nextD)
          .reduce((sum, f) => sum + Number(f.amount), 0);
        const dayWd = trendWithdrawals
          .filter((w) => w.date >= d && w.date < nextD)
          .reduce((sum, w) => sum + Number(w.amount), 0);

        trend.push({ date: dateStr, funds: dayFunds, withdrawals: dayWd });
      }

      return {
        todayFunds: {
          amount: todayFunds._sum.amount ?? 0,
          count: todayFunds._count,
        },
        todayWithdrawals: {
          amount: todayWithdrawals._sum.amount ?? 0,
          count: todayWithdrawals._count,
        },
        ppHealth: ppByStatus.map((s) => ({
          status: s.status,
          count: s._count,
        })),
        totalFundsReceived: totalFunds._sum.amount ?? 0,
        totalExchangeWithdrawals: totalExchange._sum.amount ?? 0,
        unconfirmedFunds: unconfirmedCount,
        vmStatus: vmCounts.map((v) => ({
          status: v.status,
          count: v._count,
        })),
        unsoldBalance,
        masterBalance,
        trend,
      };
    }),
});
