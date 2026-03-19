import { z } from "zod";
import { router, fundsProcedure, moderatorProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";

export const fundRouter = router({
  list: fundsProcedure
    .input(
      z.object({
        projectId: z.string(),
        paypalId: z.string().optional(),
        serverId: z.string().optional(),
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

      if (input.serverId) where.serverId = input.serverId;

      const [items, total] = await Promise.all([
        ctx.prisma.fundTransaction.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          include: {
            paypal: { select: { code: true, primaryEmail: true } },
            server: { select: { code: true } },
            vm: { select: { code: true } },
          },
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
        transactionId: z.string().optional(),
        confirmed: z.boolean().default(false),
        company: z.string().default("Bright Data Ltd."),
        notes: z.string().optional(),
        paypalId: z.string(),
        serverId: z.string().optional(),
        vmId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Generate unique transactionId if not provided
      const transactionId = input.transactionId || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Verify PayPal belongs to same project
      const pp = await ctx.prisma.payPalAccount.findFirst({
        where: { id: input.paypalId, projectId: input.projectId },
      });
      if (!pp) throw new Error("PayPal account not found in this project");

      // Verify server belongs to project if provided
      if (input.serverId) {
        const srv = await ctx.prisma.server.findFirst({
          where: { id: input.serverId, projectId: input.projectId },
        });
        if (!srv) throw new Error("Server not found in this project");
      }

      // Verify VM belongs to selected server if provided
      if (input.vmId) {
        const vm = await ctx.prisma.virtualMachine.findFirst({
          where: { id: input.vmId, serverId: input.serverId || undefined },
        });
        if (!vm) throw new Error("VM not found on this server");
      }

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
          transactionId,
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
        changes: { amount: input.amount, transactionId, paypalId: input.paypalId },
      });
      return result;
    }),

  update: fundsProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        date: z.string().optional(),
        transactionId: z.string().optional(),
        confirmed: z.boolean().optional(),
        notes: z.string().nullable().optional(),
        amount: z.number().positive().optional(),
        serverId: z.string().nullable().optional(),
        vmId: z.string().nullable().optional(),
        paypalId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, date, ...data } = input;
      await ctx.prisma.fundTransaction.findFirstOrThrow({ where: { id, projectId } });
      const updateData: any = { ...data };
      if (date) updateData.date = new Date(date);
      const result = await ctx.prisma.fundTransaction.update({ where: { id }, data: updateData });
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
        include: {
          paypal: { select: { code: true } },
          server: { select: { code: true } },
          vm: { select: { code: true } },
        },
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
        include: {
          paypal: { select: { code: true } },
          server: { select: { code: true } },
          vm: { select: { code: true } },
        },
        orderBy: { date: "desc" },
      });
    }),

  // Confirmed total all-time
  confirmedTotal: fundsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.prisma.fundTransaction.aggregate({
        where: { projectId: input.projectId, confirmed: true },
        _sum: { amount: true },
        _count: true,
      });
      return {
        amount: result._sum.amount ?? 0,
        count: result._count,
      };
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
        transactionId: z.string().optional(),
        confirmed: z.boolean().default(false),
        company: z.string().default("Bright Data Ltd."),
        notes: z.string().optional(),
        paypalCode: z.string(),
        serverCode: z.string().optional(),
        vmCode: z.string().optional(),
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
          // Auto-generate transactionId if empty
          const txId = item.transactionId || `IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          // Skip if transactionId already exists
          if (item.transactionId) {
            const existing = await ctx.prisma.fundTransaction.findFirst({
              where: { transactionId: item.transactionId, projectId: input.projectId },
            });
            if (existing) {
              skipped++;
              continue;
            }
          }
          let serverId: string | undefined;
          let vmId: string | undefined;
          if (item.serverCode) {
            const srv = await ctx.prisma.server.findFirst({
              where: { code: item.serverCode, projectId: input.projectId },
            });
            if (srv) serverId = srv.id;
          }
          if (item.vmCode && serverId) {
            const vm = await ctx.prisma.virtualMachine.findFirst({
              where: { code: item.vmCode, serverId },
            });
            if (vm) vmId = vm.id;
          }
          await ctx.prisma.fundTransaction.create({
            data: {
              date: new Date(item.date),
              amount: item.amount,
              transactionId: txId,
              confirmed: item.confirmed,
              company: item.company,
              notes: item.notes,
              paypalId: pp.id,
              serverId,
              vmId,
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

  bulkCreate: fundsProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        date: z.string(),
        amount: z.number().positive(),
        transactionId: z.string().optional(),
        confirmed: z.boolean().default(false),
        company: z.string().default("Bright Data Ltd."),
        paypalId: z.string(),
        serverId: z.string().optional(),
        vmId: z.string().optional(),
      })).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      let created = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          const pp = await ctx.prisma.payPalAccount.findFirst({
            where: { id: item.paypalId, projectId: input.projectId },
          });
          if (!pp) { errors.push("PayPal not found"); continue; }

          if (item.serverId) {
            const srv = await ctx.prisma.server.findFirst({
              where: { id: item.serverId, projectId: input.projectId },
            });
            if (!srv) { errors.push("Server not found"); continue; }
          }

          if (item.vmId) {
            const vm = await ctx.prisma.virtualMachine.findFirst({
              where: { id: item.vmId, serverId: item.serverId || undefined },
            });
            if (!vm) { errors.push("VM not found"); continue; }
          }

          const bulkTxId = item.transactionId || `BULK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await ctx.prisma.fundTransaction.create({
            data: {
              date: new Date(item.date),
              amount: item.amount,
              transactionId: bulkTxId,
              confirmed: item.confirmed,
              company: item.company,
              paypalId: item.paypalId,
              serverId: item.serverId || null,
              vmId: item.vmId || null,
              projectId: input.projectId,
            },
          });
          await createAuditLog({
            action: "CREATE",
            entity: "FundTransaction",
            entityId: "bulk",
            userId: ctx.user.id,
            projectId: input.projectId,
            changes: { amount: item.amount, paypalId: item.paypalId },
          });
          created++;
        } catch (e: any) {
          errors.push(e.message);
        }
      }

      return { created, errors };
    }),

  // Confirmed funds grouped by PayPal — for withdrawal/mixing flow
  confirmedByPaypal: fundsProcedure
    .input(z.object({
      projectId: z.string(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: any = {
        projectId: input.projectId,
        confirmed: true,
      };
      if (input.dateFrom || input.dateTo) {
        where.date = {};
        if (input.dateFrom) where.date.gte = new Date(input.dateFrom);
        if (input.dateTo) where.date.lte = new Date(input.dateTo + "T23:59:59");
      }

      const funds = await ctx.prisma.fundTransaction.findMany({
        where,
        include: {
          paypal: { select: { id: true, code: true, primaryEmail: true, role: true, holder: true, vmppCode: true } },
          server: { select: { code: true } },
          vm: { select: { code: true } },
        },
        orderBy: { date: "desc" },
      });

      // Group by paypal
      const grouped: Record<string, {
        paypalId: string;
        paypalCode: string;
        paypalEmail: string;
        paypalRole: string;
        holder: string | null;
        vmppCode: string | null;
        totalAmount: number;
        transactions: typeof funds;
      }> = {};

      for (const f of funds) {
        if (!grouped[f.paypalId]) {
          grouped[f.paypalId] = {
            paypalId: f.paypalId,
            paypalCode: f.paypal.code,
            paypalEmail: f.paypal.primaryEmail,
            paypalRole: f.paypal.role,
            holder: f.paypal.holder,
            vmppCode: f.paypal.vmppCode,
            totalAmount: 0,
            transactions: [],
          };
        }
        grouped[f.paypalId].totalAmount += Number(f.amount);
        grouped[f.paypalId].transactions.push(f);
      }

      return Object.values(grouped).sort((a, b) => b.totalAmount - a.totalAmount);
    }),

  serverTotals: fundsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.prisma.fundTransaction.groupBy({
        by: ["serverId"],
        where: { projectId: input.projectId, confirmed: true },
        _sum: { amount: true },
        _count: true,
      });
      return results
        .filter((r) => r.serverId)
        .map((r) => ({
          serverId: r.serverId!,
          total: Number(r._sum.amount ?? 0),
          count: r._count,
        }));
    }),
});
