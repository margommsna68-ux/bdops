import { z } from "zod";
import { router, costsProcedure, moderatorProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";

export const costRouter = router({
  list: costsProcedure
    .input(
      z.object({
        projectId: z.string(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.dateFrom || input.dateTo) {
        where.date = {};
        if (input.dateFrom) where.date.gte = new Date(input.dateFrom);
        if (input.dateTo) where.date.lte = new Date(input.dateTo);
      }

      const [items, total] = await Promise.all([
        ctx.prisma.costRecord.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { date: "desc" },
        }),
        ctx.prisma.costRecord.count({ where }),
      ]);

      return { items, total, page: input.page, limit: input.limit };
    }),

  create: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        date: z.string(),
        serverCost: z.number().optional(),
        ipCost: z.number().optional(),
        extraCost: z.number().optional(),
        total: z.number(),
        isPrepaid: z.boolean().default(false),
        note: z.string().optional(),
        fundingSource: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Auto-calculate total from components
      const calculatedTotal = (input.serverCost ?? 0) + (input.ipCost ?? 0) + (input.extraCost ?? 0);
      const total = calculatedTotal > 0 ? calculatedTotal : input.total;
      const result = await ctx.prisma.costRecord.create({
        data: {
          ...input,
          total,
          date: new Date(input.date),
        },
      });
      await createAuditLog({
        action: "CREATE",
        entity: "CostRecord",
        entityId: result.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { total: input.total, serverCost: input.serverCost, ipCost: input.ipCost, extraCost: input.extraCost },
      });
      return result;
    }),

  update: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        serverCost: z.number().optional(),
        ipCost: z.number().optional(),
        extraCost: z.number().optional(),
        total: z.number().optional(),
        isPrepaid: z.boolean().optional(),
        note: z.string().nullable().optional(),
        fundingSource: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      await ctx.prisma.costRecord.findFirstOrThrow({ where: { id, projectId } });
      const result = await ctx.prisma.costRecord.update({ where: { id }, data });
      await createAuditLog({
        action: "UPDATE",
        entity: "CostRecord",
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
      const existing = await ctx.prisma.costRecord.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      const result = await ctx.prisma.costRecord.delete({ where: { id: input.id } });
      await createAuditLog({
        action: "DELETE",
        entity: "CostRecord",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { total: existing.total },
      });
      return result;
    }),

  monthly: costsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.costRecord.groupBy({
        by: ["date"],
        where: { projectId: input.projectId },
        _sum: { serverCost: true, ipCost: true, extraCost: true, total: true },
        orderBy: { date: "desc" },
      });
    }),

  summary: costsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.prisma.costRecord.aggregate({
        where: { projectId: input.projectId },
        _sum: { serverCost: true, ipCost: true, extraCost: true, total: true },
        _count: true,
      });
      return {
        serverCost: result._sum.serverCost ?? 0,
        ipCost: result._sum.ipCost ?? 0,
        extraCost: result._sum.extraCost ?? 0,
        total: result._sum.total ?? 0,
        count: result._count,
      };
    }),
});
