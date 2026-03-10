import { z } from "zod";
import { router, fundsProcedure, moderatorProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";

export const fundRouter = router({
  list: fundsProcedure
    .input(
      z.object({
        projectId: z.string(),
        paypalId: z.string().optional(),
        confirmed: z.boolean().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        search: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.paypalId) where.paypalId = input.paypalId;
      if (input.confirmed !== undefined) where.confirmed = input.confirmed;
      if (input.dateFrom || input.dateTo) {
        where.date = {};
        if (input.dateFrom) where.date.gte = new Date(input.dateFrom);
        if (input.dateTo) where.date.lte = new Date(input.dateTo);
      }
      if (input.search) {
        where.OR = [
          { transactionId: { contains: input.search, mode: "insensitive" } },
          { paypal: { code: { contains: input.search, mode: "insensitive" } } },
        ];
      }

      const [items, total] = await Promise.all([
        ctx.prisma.fundTransaction.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { date: "desc" },
          include: { paypal: { select: { code: true, primaryEmail: true } } },
        }),
        ctx.prisma.fundTransaction.count({ where }),
      ]);

      return { items, total, page: input.page, limit: input.limit };
    }),

  create: fundsProcedure
    .input(
      z.object({
        projectId: z.string(),
        date: z.string().refine((d) => new Date(d) <= new Date(), {
          message: "Date cannot be in the future",
        }),
        amount: z.number().positive(),
        transactionId: z.string().min(1),
        confirmed: z.boolean().default(false),
        company: z.string().default("Bright Data Ltd."),
        notes: z.string().optional(),
        paypalId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify PayPal belongs to same project
      const pp = await ctx.prisma.payPalAccount.findFirst({
        where: { id: input.paypalId, projectId: input.projectId },
      });
      if (!pp) throw new Error("PayPal account not found in this project");

      // Check for potential duplicate (same amount + date + paypal)
      const inputDate = new Date(input.date);
      const dayStart = new Date(inputDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(inputDate);
      dayEnd.setHours(23, 59, 59, 999);
      const duplicate = await ctx.prisma.fundTransaction.findFirst({
        where: {
          projectId: input.projectId,
          paypalId: input.paypalId,
          amount: input.amount,
          date: { gte: dayStart, lte: dayEnd },
        },
      });
      if (duplicate) {
        throw new Error(`Potential duplicate: TX ${duplicate.transactionId} has same amount ($${input.amount}) on same day for same PayPal`);
      }

      const result = await ctx.prisma.fundTransaction.create({
        data: {
          ...input,
          date: new Date(input.date),
          amount: input.amount,
        },
      });
      await createAuditLog({
        action: "CREATE",
        entity: "FundTransaction",
        entityId: result.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { amount: input.amount, transactionId: input.transactionId, paypalId: input.paypalId },
      });
      return result;
    }),

  update: fundsProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        confirmed: z.boolean().optional(),
        notes: z.string().nullable().optional(),
        amount: z.number().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      await ctx.prisma.fundTransaction.findFirstOrThrow({ where: { id, projectId } });
      const result = await ctx.prisma.fundTransaction.update({ where: { id }, data });
      await createAuditLog({
        action: "UPDATE",
        entity: "FundTransaction",
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
      const existing = await ctx.prisma.fundTransaction.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      const result = await ctx.prisma.fundTransaction.delete({ where: { id: input.id } });
      await createAuditLog({
        action: "DELETE",
        entity: "FundTransaction",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { amount: existing.amount, transactionId: existing.transactionId },
      });
      return result;
    }),

  todaySummary: fundsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const funds = await ctx.prisma.fundTransaction.findMany({
        where: {
          projectId: input.projectId,
          date: { gte: today, lt: tomorrow },
        },
        include: { paypal: { select: { code: true } } },
        orderBy: { date: "desc" },
      });

      const total = await ctx.prisma.fundTransaction.aggregate({
        where: {
          projectId: input.projectId,
          date: { gte: today, lt: tomorrow },
        },
        _sum: { amount: true },
        _count: true,
      });

      return {
        funds,
        totalAmount: total._sum.amount ?? 0,
        count: total._count,
      };
    }),

  unconfirmed: fundsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.fundTransaction.findMany({
        where: { projectId: input.projectId, confirmed: false },
        include: { paypal: { select: { code: true } } },
        orderBy: { date: "desc" },
      });
    }),

  dailySummary: fundsProcedure
    .input(
      z.object({
        projectId: z.string(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.dateFrom || input.dateTo) {
        where.date = {};
        if (input.dateFrom) where.date.gte = new Date(input.dateFrom);
        if (input.dateTo) where.date.lte = new Date(input.dateTo);
      }

      return ctx.prisma.fundTransaction.groupBy({
        by: ["date"],
        where,
        _sum: { amount: true },
        _count: true,
        orderBy: { date: "desc" },
      });
    }),

  bulkConfirm: fundsProcedure
    .input(z.object({
      projectId: z.string(),
      ids: z.array(z.string()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify all belong to project
      const count = await ctx.prisma.fundTransaction.count({
        where: { id: { in: input.ids }, projectId: input.projectId },
      });
      if (count !== input.ids.length) {
        throw new Error("Some transactions not found in this project");
      }
      const result = await ctx.prisma.fundTransaction.updateMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
        data: { confirmed: true },
      });
      await createAuditLog({
        action: "UPDATE",
        entity: "FundTransaction",
        entityId: input.ids.join(","),
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { bulkConfirm: true, count: result.count },
      });
      return { confirmed: result.count };
    }),

  bulkImport: fundsProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        date: z.string(),
        amount: z.number().positive(),
        transactionId: z.string().min(1),
        confirmed: z.boolean().default(false),
        company: z.string().default("Bright Data Ltd."),
        notes: z.string().optional(),
        paypalCode: z.string(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          const pp = await ctx.prisma.payPalAccount.findFirst({
            where: { code: item.paypalCode, projectId: input.projectId },
          });
          if (!pp) {
            errors.push(`PP ${item.paypalCode} not found`);
            skipped++;
            continue;
          }
          // Skip if transactionId already exists
          const existing = await ctx.prisma.fundTransaction.findFirst({
            where: { transactionId: item.transactionId, projectId: input.projectId },
          });
          if (existing) {
            skipped++;
            continue;
          }
          await ctx.prisma.fundTransaction.create({
            data: {
              date: new Date(item.date),
              amount: item.amount,
              transactionId: item.transactionId,
              confirmed: item.confirmed,
              company: item.company,
              notes: item.notes,
              paypalId: pp.id,
              projectId: input.projectId,
            },
          });
          imported++;
        } catch (e: any) {
          errors.push(`Row ${item.transactionId}: ${e.message}`);
          skipped++;
        }
      }
      return { imported, skipped, errors: errors.slice(0, 10) };
    }),
});
