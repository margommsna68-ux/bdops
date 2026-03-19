import { z } from "zod";
import { router, costsProcedure, moderatorProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";

const CATEGORIES = ["SERVER", "IP_PROXY", "GMAIL", "PAYPAL", "OTHER"] as const;

// Auto-generate code: CP-{MM}-{NNN}
async function generateCode(prisma: any, projectId: string, date: Date): Promise<string> {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
  const count = await prisma.costRecord.count({
    where: { projectId, date: { gte: startOfMonth, lte: endOfMonth } },
  });
  return `CP-${mm}-${String(count + 1).padStart(3, "0")}`;
}

export const costRouter = router({
  // List costs for a specific month
  list: costsProcedure
    .input(
      z.object({
        projectId: z.string(),
        year: z.number().optional(),
        month: z.number().min(1).max(12).optional(),
        showAll: z.boolean().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(500).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const year = input.year ?? now.getFullYear();
      const month = input.month ?? (now.getMonth() + 1);

      const where: any = { projectId: input.projectId };
      if (!input.showAll) {
        const startOfMonth = new Date(year, month - 1, 1);
        const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
        where.date = { gte: startOfMonth, lte: endOfMonth };
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

      return { items, total, year, month };
    }),

  // Monthly summary (for a specific month) - grouped by category
  monthlySummary: costsProcedure
    .input(z.object({
      projectId: z.string(),
      year: z.number(),
      month: z.number().min(1).max(12),
    }))
    .query(async ({ ctx, input }) => {
      const startOfMonth = new Date(input.year, input.month - 1, 1);
      const endOfMonth = new Date(input.year, input.month, 0, 23, 59, 59, 999);

      const records = await ctx.prisma.costRecord.findMany({
        where: {
          projectId: input.projectId,
          date: { gte: startOfMonth, lte: endOfMonth },
        },
        select: { category: true, amount: true, total: true },
      });

      const byCategory: Record<string, number> = {};
      let grandTotal = 0;
      for (const r of records) {
        const amt = Number(r.amount) || Number(r.total) || 0;
        byCategory[r.category] = (byCategory[r.category] ?? 0) + amt;
        grandTotal += amt;
      }

      return { byCategory, total: grandTotal, count: records.length };
    }),

  // Compare two months
  compare: costsProcedure
    .input(z.object({
      projectId: z.string(),
      year: z.number(),
      month: z.number().min(1).max(12),
    }))
    .query(async ({ ctx, input }) => {
      const getSummary = async (y: number, m: number) => {
        const start = new Date(y, m - 1, 1);
        const end = new Date(y, m, 0, 23, 59, 59, 999);
        const records = await ctx.prisma.costRecord.findMany({
          where: { projectId: input.projectId, date: { gte: start, lte: end } },
          select: { category: true, amount: true, total: true },
        });
        const byCategory: Record<string, number> = {};
        let total = 0;
        for (const r of records) {
          const amt = Number(r.amount) || Number(r.total) || 0;
          byCategory[r.category] = (byCategory[r.category] ?? 0) + amt;
          total += amt;
        }
        return { byCategory, total };
      };

      // Previous month
      const prevMonth = input.month === 1 ? 12 : input.month - 1;
      const prevYear = input.month === 1 ? input.year - 1 : input.year;

      const [current, previous] = await Promise.all([
        getSummary(input.year, input.month),
        getSummary(prevYear, prevMonth),
      ]);

      return { current, previous, prevYear, prevMonth };
    }),

  create: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        date: z.string(),
        category: z.enum(CATEGORIES),
        amount: z.number().min(0),
        note: z.string().optional(),
        isPrepaid: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const dateObj = new Date(input.date);
      const code = await generateCode(ctx.prisma, input.projectId, dateObj);

      const result = await ctx.prisma.costRecord.create({
        data: {
          projectId: input.projectId,
          code,
          date: dateObj,
          category: input.category,
          amount: input.amount,
          total: input.amount,
          isPrepaid: input.isPrepaid,
          note: input.note,
        },
      });
      await createAuditLog({
        action: "CREATE",
        entity: "CostRecord",
        entityId: result.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { code, category: input.category, amount: input.amount },
      });
      return result;
    }),

  update: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        category: z.enum(CATEGORIES).optional(),
        amount: z.number().min(0).optional(),
        note: z.string().nullable().optional(),
        isPrepaid: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      await ctx.prisma.costRecord.findFirstOrThrow({ where: { id, projectId } });
      // Sync total with amount
      const updateData: any = { ...data };
      if (data.amount !== undefined) updateData.total = data.amount;
      const result = await ctx.prisma.costRecord.update({ where: { id }, data: updateData });
      await createAuditLog({
        action: "UPDATE",
        entity: "CostRecord",
        entityId: id,
        userId: ctx.user.id,
        projectId,
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
        changes: { code: existing.code, amount: existing.amount, category: existing.category },
      });
      return result;
    }),

  bulkImport: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        date: z.string(),
        category: z.enum(CATEGORIES).default("OTHER"),
        amount: z.number().min(0),
        note: z.string().optional(),
        isPrepaid: z.boolean().default(false),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      const errors: string[] = [];
      for (const item of input.items) {
        try {
          const dateObj = new Date(item.date);
          const code = await generateCode(ctx.prisma, input.projectId, dateObj);
          await ctx.prisma.costRecord.create({
            data: {
              projectId: input.projectId,
              code,
              date: dateObj,
              category: item.category,
              amount: item.amount,
              total: item.amount,
              isPrepaid: item.isPrepaid,
              note: item.note,
            },
          });
          imported++;
        } catch (e: any) {
          errors.push(`Row ${imported + 1}: ${e.message}`);
        }
      }
      return { imported, errors: errors.slice(0, 10) };
    }),

  bulkDelete: moderatorProcedure
    .input(z.object({ projectId: z.string(), ids: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.costRecord.deleteMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
      });
      return { deleted: input.ids.length };
    }),

  // Server billing reminder (read-only, no auto-create)
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
          expiryDate: true,
          status: true,
          _count: { select: { vms: true } },
        },
        orderBy: { expiryDate: "asc" },
      });

      const totalMonthly = servers.reduce((sum, s) => sum + Number(s.monthlyCost ?? 0), 0);

      // Due within 7 days
      const now = new Date();
      const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const dueSoon = servers.filter((s) => s.expiryDate && new Date(s.expiryDate) <= soon);
      const overdue = servers.filter((s) => s.expiryDate && new Date(s.expiryDate) < now);

      return { servers, totalMonthly, activeCount: servers.length, dueSoon, overdue };
    }),
});
