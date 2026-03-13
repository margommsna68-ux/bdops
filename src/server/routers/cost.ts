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

  bulkImport: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        date: z.string(),
        serverCost: z.number().optional(),
        ipCost: z.number().optional(),
        extraCost: z.number().optional(),
        total: z.number(),
        isPrepaid: z.boolean().default(false),
        note: z.string().optional(),
        fundingSource: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      const errors: string[] = [];
      for (const item of input.items) {
        try {
          await ctx.prisma.costRecord.create({
            data: {
              projectId: input.projectId,
              date: new Date(item.date),
              serverCost: item.serverCost ?? 0,
              ipCost: item.ipCost ?? 0,
              extraCost: item.extraCost ?? 0,
              total: item.total,
              isPrepaid: item.isPrepaid,
              note: item.note,
              fundingSource: item.fundingSource,
            },
          });
          imported++;
        } catch (e: any) {
          errors.push(`Row ${imported + 1}: ${e.message}`);
        }
      }
      return { imported, errors: errors.slice(0, 10) };
    }),

  // Server billing summary - calculate from active servers
  serverBilling: costsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const servers = await ctx.prisma.server.findMany({
        where: {
          projectId: input.projectId,
          status: { in: ["ACTIVE", "BUILDING", "MAINTENANCE"] },
          monthlyCost: { not: null },
        },
        select: {
          id: true,
          code: true,
          monthlyCost: true,
          billingCycle: true,
          expiryDate: true,
          status: true,
          _count: { select: { vms: true } },
        },
        orderBy: { code: "asc" },
      });

      const totalMonthly = servers.reduce(
        (sum, s) => sum + Number(s.monthlyCost ?? 0),
        0
      );

      // Servers expiring within 7 days
      const now = new Date();
      const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const expiringSoon = servers.filter(
        (s) => s.expiryDate && new Date(s.expiryDate) <= soon
      );

      return {
        servers,
        totalMonthly,
        activeCount: servers.length,
        expiringSoon,
      };
    }),

  // Generate cost record from server billing
  generateFromBilling: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        date: z.string(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const servers = await ctx.prisma.server.findMany({
        where: {
          projectId: input.projectId,
          status: { in: ["ACTIVE", "BUILDING", "MAINTENANCE"] },
          monthlyCost: { not: null },
        },
        select: { code: true, monthlyCost: true },
      });

      const serverCost = servers.reduce(
        (sum, s) => sum + Number(s.monthlyCost ?? 0),
        0
      );

      if (serverCost === 0) {
        throw new Error("No active servers with billing data");
      }

      const serverList = servers
        .map((s) => `${s.code}: $${Number(s.monthlyCost).toFixed(2)}`)
        .join(", ");

      const result = await ctx.prisma.costRecord.create({
        data: {
          projectId: input.projectId,
          date: new Date(input.date),
          serverCost,
          ipCost: 0,
          extraCost: 0,
          total: serverCost,
          isPrepaid: false,
          note: input.note || `Server billing: ${serverList}`,
          fundingSource: "Server Billing",
        },
      });

      await createAuditLog({
        action: "CREATE",
        entity: "CostRecord",
        entityId: result.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { serverCost, source: "generateFromBilling", servers: serverList },
      });

      return result;
    }),
});
