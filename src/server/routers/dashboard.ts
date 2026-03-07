import { z } from "zod";
import { router, protectedProcedure } from "../trpc";

export const dashboardRouter = router({
  overview: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { projectId } = input;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

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
        totalMixingOut,
        totalExchangeOut,
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
        // Unsold PP balance: funds received by NORMAL PPs
        ctx.prisma.fundTransaction.aggregate({
          where: { projectId, paypal: { role: "NORMAL" } },
          _sum: { amount: true },
        }),
        // Total MIXING out
        ctx.prisma.withdrawal.aggregate({
          where: { projectId, type: "MIXING" },
          _sum: { amount: true },
        }),
        // Master PP EXCHANGE out
        ctx.prisma.withdrawal.aggregate({
          where: { projectId, type: "EXCHANGE", sourcePaypal: { role: "MASTER" } },
          _sum: { amount: true },
        }),
      ]);

      const unsoldBalance = Number(totalFundsNormal._sum.amount ?? 0) - Number(totalMixingOut._sum.amount ?? 0);
      const masterBalance = Number(totalMixingToMaster._sum.amount ?? 0) - Number(totalExchangeOut._sum.amount ?? 0);

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
      };
    }),
});
