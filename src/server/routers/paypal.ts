import { z } from "zod";
import { router, paypalsProcedure, moderatorProcedure } from "../trpc";

export const paypalRouter = router({
  list: paypalsProcedure
    .input(
      z.object({
        projectId: z.string(),
        status: z.enum(["ACTIVE", "LIMITED", "SUSPENDED", "CLOSED", "PENDING_VERIFY"]).optional(),
        role: z.enum(["NORMAL", "MASTER", "USDT"]).optional(),
        search: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.status) where.status = input.status;
      if (input.role) where.role = input.role;
      if (input.search) {
        where.OR = [
          { code: { contains: input.search, mode: "insensitive" } },
          { primaryEmail: { contains: input.search, mode: "insensitive" } },
        ];
      }

      const [items, total] = await Promise.all([
        ctx.prisma.payPalAccount.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { code: "asc" },
          include: {
            _count: {
              select: { fundsReceived: true, withdrawalsFrom: true },
            },
          },
        }),
        ctx.prisma.payPalAccount.count({ where }),
      ]);

      return { items, total, page: input.page, limit: input.limit };
    }),

  getById: paypalsProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const pp = await ctx.prisma.payPalAccount.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        include: {
          gmails: true,
          fundsReceived: { orderBy: { date: "desc" }, take: 50 },
          withdrawalsFrom: {
            orderBy: { date: "desc" },
            take: 50,
            include: { destPaypal: { select: { code: true } } },
          },
          withdrawalsTo: { orderBy: { date: "desc" }, take: 50 },
        },
      });

      // Compute balances
      const totalReceived = await ctx.prisma.fundTransaction.aggregate({
        where: { paypalId: input.id },
        _sum: { amount: true },
      });
      const totalWithdrawn = await ctx.prisma.withdrawal.aggregate({
        where: { sourcePaypalId: input.id },
        _sum: { amount: true },
      });

      return {
        ...pp,
        totalReceived: totalReceived._sum.amount ?? 0,
        totalWithdrawn: totalWithdrawn._sum.amount ?? 0,
        currentBalance:
          Number(totalReceived._sum.amount ?? 0) -
          Number(totalWithdrawn._sum.amount ?? 0),
      };
    }),

  create: paypalsProcedure
    .input(
      z.object({
        projectId: z.string(),
        code: z.string().min(1),
        primaryEmail: z.string().email(),
        secondaryEmail: z.string().email().optional(),
        bankCode: z.string().optional(),
        status: z.enum(["ACTIVE", "LIMITED", "SUSPENDED", "CLOSED", "PENDING_VERIFY"]).default("ACTIVE"),
        role: z.enum(["NORMAL", "MASTER", "USDT"]).default("NORMAL"),
        limitNote: z.string().optional(),
        company: z.string().default("Bright Data Ltd."),
        serverAssignment: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.payPalAccount.create({ data: input });
    }),

  update: paypalsProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        code: z.string().optional(),
        primaryEmail: z.string().email().optional(),
        secondaryEmail: z.string().email().nullable().optional(),
        bankCode: z.string().nullable().optional(),
        status: z.enum(["ACTIVE", "LIMITED", "SUSPENDED", "CLOSED", "PENDING_VERIFY"]).optional(),
        role: z.enum(["NORMAL", "MASTER", "USDT"]).optional(),
        limitNote: z.string().nullable().optional(),
        company: z.string().optional(),
        serverAssignment: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      // Verify ownership
      await ctx.prisma.payPalAccount.findFirstOrThrow({ where: { id, projectId } });
      return ctx.prisma.payPalAccount.update({ where: { id }, data });
    }),

  delete: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.payPalAccount.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      return ctx.prisma.payPalAccount.delete({ where: { id: input.id } });
    }),

  masters: paypalsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.payPalAccount.findMany({
        where: { projectId: input.projectId, role: "MASTER" },
        orderBy: { code: "asc" },
      });
    }),

  withBalance: paypalsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Use raw query for performance with 500+ accounts
      const accounts = await ctx.prisma.payPalAccount.findMany({
        where: { projectId: input.projectId, status: "ACTIVE" },
        select: { id: true, code: true, primaryEmail: true, role: true, status: true },
      });

      // Batch aggregate all funds and withdrawals at once
      const [fundAggs, withdrawalAggs] = await Promise.all([
        ctx.prisma.fundTransaction.groupBy({
          by: ["paypalId"],
          where: { projectId: input.projectId },
          _sum: { amount: true },
        }),
        ctx.prisma.withdrawal.groupBy({
          by: ["sourcePaypalId"],
          where: { projectId: input.projectId },
          _sum: { amount: true },
        }),
      ]);

      const fundMap = new Map(fundAggs.map((f) => [f.paypalId, Number(f._sum.amount ?? 0)]));
      const withdrawMap = new Map(withdrawalAggs.map((w) => [w.sourcePaypalId, Number(w._sum.amount ?? 0)]));

      return accounts
        .map((pp) => ({
          ...pp,
          balance: (fundMap.get(pp.id) ?? 0) - (withdrawMap.get(pp.id) ?? 0),
        }))
        .filter((r) => r.balance > 0);
    }),

  bulkImport: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        code: z.string().min(1),
        primaryEmail: z.string().email(),
        secondaryEmail: z.string().optional(),
        bankCode: z.string().optional(),
        status: z.enum(["ACTIVE", "LIMITED", "SUSPENDED", "CLOSED", "PENDING_VERIFY"]).default("ACTIVE"),
        role: z.enum(["NORMAL", "MASTER", "USDT"]).default("NORMAL"),
        limitNote: z.string().optional(),
        company: z.string().default("Bright Data Ltd."),
        serverAssignment: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          const existing = await ctx.prisma.payPalAccount.findFirst({
            where: { code: item.code, projectId: input.projectId },
          });
          if (existing) {
            skipped++;
            continue;
          }
          await ctx.prisma.payPalAccount.create({
            data: { ...item, projectId: input.projectId },
          });
          imported++;
        } catch (e: any) {
          errors.push(`${item.code}: ${e.message}`);
          skipped++;
        }
      }
      return { imported, skipped, errors: errors.slice(0, 10) };
    }),
});
