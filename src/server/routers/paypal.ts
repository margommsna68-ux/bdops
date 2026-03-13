import { z } from "zod";
import { router, paypalsProcedure, moderatorProcedure } from "../trpc";
import { encrypt, decrypt } from "@/lib/encryption";
import { createAuditLog } from "@/lib/audit";

export const paypalRouter = router({
  list: paypalsProcedure
    .input(
      z.object({
        projectId: z.string(),
        status: z.enum(["ACTIVE", "LIMITED", "SUSPENDED", "CLOSED", "PENDING_VERIFY"]).optional(),
        role: z.enum(["NORMAL", "MASTER", "USDT"]).optional(),
        search: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(500).default(50),
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

      const [items, total, fundAggs, withdrawalAggs] = await Promise.all([
        ctx.prisma.payPalAccount.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { createdAt: "desc" },
          include: {
            gmails: {
              select: {
                id: true,
                email: true,
                status: true,
                vms: { select: { id: true, code: true }, take: 1 },
              },
            },
            emails: {
              select: { id: true, email: true, isPrimary: true },
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            },
            _count: {
              select: { fundsReceived: true, withdrawalsFrom: true, gmails: true, emails: true },
            },
          },
        }),
        ctx.prisma.payPalAccount.count({ where }),
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

      const enrichedItems = items.map((pp) => ({
        ...pp,
        totalReceived: fundMap.get(pp.id) ?? 0,
        totalWithdrawn: withdrawMap.get(pp.id) ?? 0,
        balance: (fundMap.get(pp.id) ?? 0) - (withdrawMap.get(pp.id) ?? 0),
      }));

      return { items: enrichedItems, total, page: input.page, limit: input.limit };
    }),

  getById: paypalsProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const pp = await ctx.prisma.payPalAccount.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        include: {
          gmails: true,
          emails: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
          fundsReceived: {
            orderBy: { date: "desc" }, take: 50,
            include: {
              server: { select: { id: true, code: true } },
              vm: { select: { id: true, code: true, gmail: { select: { id: true, email: true } } } },
            },
          },
          withdrawalsFrom: {
            orderBy: { date: "desc" },
            take: 50,
            include: { destPaypal: { select: { code: true } } },
          },
          withdrawalsTo: { orderBy: { date: "desc" }, take: 50 },
        },
      });

      // Auto-migrate: if PP has primaryEmail but no PayPalEmail records, create one
      if (pp.primaryEmail && pp.emails.length === 0) {
        const migrated = await ctx.prisma.payPalEmail.create({
          data: {
            email: pp.primaryEmail,
            password: pp.password,
            twoFa: pp.twoFa,
            hotmailToken: pp.hotmailToken,
            isPrimary: true,
            paypalId: pp.id,
            projectId: input.projectId,
          },
        });
        pp.emails.push(migrated);
      }

      // Compute balances
      const totalReceived = await ctx.prisma.fundTransaction.aggregate({
        where: { paypalId: input.id },
        _sum: { amount: true },
      });
      const totalWithdrawn = await ctx.prisma.withdrawal.aggregate({
        where: { sourcePaypalId: input.id },
        _sum: { amount: true },
      });

      // EarnApp usage: aggregate which VMs/Gmails sent funds to this PP
      const earnAppUsage: Record<string, { vmCode: string; gmailEmail: string; serverCode: string; txCount: number; totalAmount: number }> = {};
      for (const f of pp.fundsReceived) {
        const vm = (f as any).vm;
        const server = (f as any).server;
        if (vm) {
          const key = vm.id;
          if (!earnAppUsage[key]) {
            earnAppUsage[key] = {
              vmCode: vm.code,
              gmailEmail: vm.gmail?.email || "—",
              serverCode: server?.code || "—",
              txCount: 0,
              totalAmount: 0,
            };
          }
          earnAppUsage[key].txCount++;
          earnAppUsage[key].totalAmount += Number(f.amount);
        }
      }

      return {
        ...pp,
        totalReceived: totalReceived._sum.amount ?? 0,
        totalWithdrawn: totalWithdrawn._sum.amount ?? 0,
        currentBalance:
          Number(totalReceived._sum.amount ?? 0) -
          Number(totalWithdrawn._sum.amount ?? 0),
        earnAppUsage: Object.values(earnAppUsage),
      };
    }),

  // Get next auto-generated PP code based on project code prefix
  nextCode: paypalsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({ where: { id: input.projectId }, select: { code: true } });
      const prefix = project?.code || "PP";
      const count = await ctx.prisma.payPalAccount.count({ where: { projectId: input.projectId } });
      return { nextCode: `${prefix}-${String(count + 1).padStart(3, "0")}`, prefix };
    }),

  create: paypalsProcedure
    .input(
      z.object({
        projectId: z.string(),
        code: z.string().optional(),
        primaryEmail: z.string().email(),
        secondaryEmail: z.string().email().optional(),
        password: z.string().optional(),
        twoFa: z.string().optional(),
        bankCode: z.string().optional(),
        hotmailToken: z.string().optional(),
        holder: z.string().optional(),
        vmppCode: z.string().optional(),
        status: z.enum(["ACTIVE", "LIMITED", "SUSPENDED", "CLOSED", "PENDING_VERIFY"]).default("ACTIVE"),
        role: z.enum(["NORMAL", "MASTER", "USDT"]).default("NORMAL"),
        limitNote: z.string().optional(),
        company: z.string().default("Bright Data Ltd."),
        serverAssignment: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { password, twoFa, hotmailToken, ...rest } = input;
      // Auto-generate code if not provided, using project code prefix
      if (!rest.code) {
        const project = await ctx.prisma.project.findUnique({ where: { id: input.projectId }, select: { code: true } });
        const prefix = project?.code || "PP";
        const count = await ctx.prisma.payPalAccount.count({ where: { projectId: input.projectId } });
        rest.code = `${prefix}-${String(count + 1).padStart(3, "0")}`;
      }
      const data: any = { ...rest };
      if (password) data.password = encrypt(password);
      if (twoFa) data.twoFa = encrypt(twoFa);
      if (hotmailToken) data.hotmailToken = encrypt(hotmailToken);
      const result = await ctx.prisma.payPalAccount.create({ data });
      await createAuditLog({
        action: "CREATE",
        entity: "PayPalAccount",
        entityId: result.id,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { code: result.code, primaryEmail: input.primaryEmail, status: input.status },
      });
      return result;
    }),

  update: paypalsProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        code: z.string().optional(),
        primaryEmail: z.string().email().optional(),
        secondaryEmail: z.string().email().nullable().optional(),
        password: z.string().nullable().optional(),
        twoFa: z.string().nullable().optional(),
        bankCode: z.string().nullable().optional(),
        hotmailToken: z.string().nullable().optional(),
        holder: z.string().nullable().optional(),
        vmppCode: z.string().nullable().optional(),
        status: z.enum(["ACTIVE", "LIMITED", "SUSPENDED", "CLOSED", "PENDING_VERIFY"]).optional(),
        role: z.enum(["NORMAL", "MASTER", "USDT"]).optional(),
        limitNote: z.string().nullable().optional(),
        company: z.string().optional(),
        serverAssignment: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        holderName: z.string().nullable().optional(),
        dateOfBirth: z.string().nullable().optional(),
        idNumber: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        docsLink: z.string().nullable().optional(),
        suspendedAt: z.string().nullable().optional(),
        limitedAt: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, password, twoFa, hotmailToken, suspendedAt, limitedAt, ...rest } = input;
      const existing = await ctx.prisma.payPalAccount.findFirstOrThrow({ where: { id, projectId } });
      const data: any = { ...rest };
      if (password !== undefined) data.password = password ? encrypt(password) : null;
      if (twoFa !== undefined) data.twoFa = twoFa ? encrypt(twoFa) : null;
      if (hotmailToken !== undefined) data.hotmailToken = hotmailToken ? encrypt(hotmailToken) : null;

      // Auto-set suspendedAt/limitedAt when status changes
      if (rest.status === "SUSPENDED" && existing.status !== "SUSPENDED" && !existing.suspendedAt) {
        data.suspendedAt = new Date();
      }
      if (rest.status === "LIMITED" && existing.status !== "LIMITED" && !existing.limitedAt) {
        data.limitedAt = new Date();
      }
      // Clear dates when status goes back to ACTIVE
      if (rest.status === "ACTIVE") {
        data.suspendedAt = null;
        data.limitedAt = null;
      }
      // Manual override dates
      if (suspendedAt !== undefined) data.suspendedAt = suspendedAt ? new Date(suspendedAt) : null;
      if (limitedAt !== undefined) data.limitedAt = limitedAt ? new Date(limitedAt) : null;

      const result = await ctx.prisma.payPalAccount.update({ where: { id }, data });
      await createAuditLog({
        action: "UPDATE",
        entity: "PayPalAccount",
        entityId: id,
        userId: (ctx.user as any).id,
        projectId,
        changes: rest,
      });
      return result;
    }),

  delete: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.payPalAccount.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      await createAuditLog({
        action: "DELETE",
        entity: "PayPalAccount",
        entityId: input.id,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { code: existing.code, primaryEmail: existing.primaryEmail },
      });
      return ctx.prisma.payPalAccount.delete({ where: { id: input.id } });
    }),

  getCredentials: paypalsProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const pp = await ctx.prisma.payPalAccount.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        select: { password: true, twoFa: true, hotmailToken: true },
      });
      return {
        password: pp.password ? decrypt(pp.password) : null,
        twoFa: pp.twoFa ? decrypt(pp.twoFa) : null,
        hotmailToken: pp.hotmailToken ? decrypt(pp.hotmailToken) : null,
      };
    }),

  bulkUpdateStatus: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      ids: z.array(z.string()).min(1),
      status: z.enum(["ACTIVE", "LIMITED", "SUSPENDED", "CLOSED", "PENDING_VERIFY"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const data: any = { status: input.status };
      if (input.status === "SUSPENDED") data.suspendedAt = new Date();
      if (input.status === "LIMITED") data.limitedAt = new Date();
      if (input.status === "ACTIVE") { data.suspendedAt = null; data.limitedAt = null; }
      const result = await ctx.prisma.payPalAccount.updateMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
        data,
      });
      await createAuditLog({
        action: "BULK_UPDATE",
        entity: "PayPalAccount",
        entityId: input.ids.join(","),
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { count: result.count, newStatus: input.status },
      });
      return { updated: result.count };
    }),

  bulkUpdateHolder: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      ids: z.array(z.string()).min(1),
      holder: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.payPalAccount.updateMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
        data: { holder: input.holder || null },
      });
      await createAuditLog({
        action: "BULK_UPDATE",
        entity: "PayPalAccount",
        entityId: input.ids.join(","),
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { count: result.count, holder: input.holder || null },
      });
      return { updated: result.count };
    }),

  bulkDelete: moderatorProcedure
    .input(z.object({ projectId: z.string(), ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await createAuditLog({
        action: "BULK_DELETE",
        entity: "PayPalAccount",
        entityId: input.ids.join(","),
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { count: input.ids.length },
      });
      const result = await ctx.prisma.payPalAccount.deleteMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
      });
      return { deleted: result.count };
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
      await createAuditLog({
        action: "IMPORT",
        entity: "PayPalAccount",
        entityId: input.projectId,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { imported, skipped, totalItems: input.items.length },
      });
      return { imported, skipped, errors: errors.slice(0, 10) };
    }),

  addCaseNote: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      type: z.enum(["limit", "suspend", "resolve", "updocs", "note"]),
      note: z.string().min(1),
      docsLink: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const pp = await ctx.prisma.payPalAccount.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        select: { caseHistory: true },
      });
      const history = Array.isArray(pp.caseHistory) ? [...(pp.caseHistory as any[])] : [];
      history.push({
        date: new Date().toISOString(),
        type: input.type,
        note: input.note,
        docsLink: input.docsLink || null,
      });
      const result = await ctx.prisma.payPalAccount.update({
        where: { id: input.id },
        data: { caseHistory: history },
      });
      await createAuditLog({
        action: "ADD_NOTE",
        entity: "PayPalAccount",
        entityId: input.id,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { type: input.type, note: input.note },
      });
      return result;
    }),

  deleteCaseNote: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      noteIndex: z.number().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const pp = await ctx.prisma.payPalAccount.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        select: { caseHistory: true },
      });
      const history = Array.isArray(pp.caseHistory) ? [...(pp.caseHistory as any[])] : [];
      const deletedNote = history[input.noteIndex] || null;
      history.splice(input.noteIndex, 1);
      const result = await ctx.prisma.payPalAccount.update({
        where: { id: input.id },
        data: { caseHistory: history },
      });
      await createAuditLog({
        action: "DELETE_NOTE",
        entity: "PayPalAccount",
        entityId: input.id,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { noteIndex: input.noteIndex, deletedNote },
      });
      return result;
    }),
});
