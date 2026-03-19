import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, paypalsProcedure, moderatorProcedure } from "../trpc";
import { encrypt, decrypt } from "@/lib/encryption";
import { createAuditLog } from "@/lib/audit";
import { checkBatchPP, checkSinglePP, readMailbox, readEmailContent } from "@/lib/pp-checker";
import { fetchSheetData, fetchSheetTabs } from "@/lib/sheet-import";

// ─── Helpers ───
function isValidEmail(v: string | null | undefined): boolean {
  return !!v && v.includes("@") && v.includes(".") && v.length > 5;
}

// ─── Global Uniqueness Check ───
// PP Code, Email, VMPP Code must be unique across ALL projects
async function checkGlobalUnique(
  prisma: any,
  opts: { code?: string; vmppCode?: string; emails?: string[]; excludePPId?: string }
) {
  const errors: string[] = [];

  if (opts.code) {
    const dup = await prisma.payPalAccount.findFirst({
      where: { code: opts.code, ...(opts.excludePPId ? { id: { not: opts.excludePPId } } : {}) },
      select: { id: true, code: true, project: { select: { code: true } } },
    });
    if (dup) errors.push(`Mã PP "${opts.code}" đã tồn tại trong project ${dup.project.code}`);
  }

  if (opts.vmppCode) {
    const dup = await prisma.payPalAccount.findFirst({
      where: { vmppCode: opts.vmppCode, ...(opts.excludePPId ? { id: { not: opts.excludePPId } } : {}) },
      select: { id: true, vmppCode: true, project: { select: { code: true } } },
    });
    if (dup) errors.push(`VMPP Code "${opts.vmppCode}" đã tồn tại trong project ${dup.project.code}`);
  }

  if (opts.emails && opts.emails.length > 0) {
    for (const email of opts.emails) {
      if (!email) continue;
      const dup = await prisma.payPalEmail.findFirst({
        where: {
          email,
          ...(opts.excludePPId ? { paypalId: { not: opts.excludePPId } } : {}),
        },
        select: { id: true, email: true, paypal: { select: { code: true, project: { select: { code: true } } } } },
      });
      if (dup) errors.push(`Email "${email}" đã tồn tại trong PP ${dup.paypal.code} (${dup.paypal.project.code})`);
    }
  }

  return errors;
}

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

      const [items, total, fundAggs, withdrawalAggs, lastFundDates] = await Promise.all([
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
        // Last fund transaction date per PP
        ctx.prisma.fundTransaction.groupBy({
          by: ["paypalId"],
          where: { projectId: input.projectId },
          _max: { date: true },
        }),
      ]);

      const fundMap = new Map(fundAggs.map((f) => [f.paypalId, Number(f._sum.amount ?? 0)]));
      const withdrawMap = new Map(withdrawalAggs.map((w) => [w.sourcePaypalId, Number(w._sum.amount ?? 0)]));
      const lastFundMap = new Map(lastFundDates.map((f) => [f.paypalId, f._max.date]));

      const enrichedItems = items.map((pp) => ({
        ...pp,
        totalReceived: fundMap.get(pp.id) ?? 0,
        totalWithdrawn: withdrawMap.get(pp.id) ?? 0,
        balance: (fundMap.get(pp.id) ?? 0) - (withdrawMap.get(pp.id) ?? 0),
        lastFundDate: lastFundMap.get(pp.id) ?? null,
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
      // Global uniqueness check
      const dupErrors = await checkGlobalUnique(ctx.prisma, {
        code: rest.code,
        vmppCode: input.vmppCode,
        emails: [input.primaryEmail, input.secondaryEmail].filter(Boolean) as string[],
      });
      if (dupErrors.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: dupErrors.join("; ") });
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

  // ─── Check PP Status via Email Scan ───

  // Check all PPs with hotmailToken (batch)
  checkStatus: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      paypalIds: z.array(z.string()).optional(), // if empty, check all with token
    }))
    .mutation(async ({ ctx, input }) => {
      // Get PPs with hotmailToken available (from PayPalEmail records)
      const where: any = { projectId: input.projectId };
      if (input.paypalIds && input.paypalIds.length > 0) {
        where.id = { in: input.paypalIds };
      }

      const pps = await ctx.prisma.payPalAccount.findMany({
        where,
        select: {
          id: true,
          code: true,
          primaryEmail: true,
          status: true,
          emails: {
            where: { hotmailToken: { not: null } },
            select: { id: true, email: true, hotmailToken: true },
            take: 1,
          },
        },
      });

      // Also check legacy hotmailToken on PayPalAccount itself
      const accounts: Array<{
        paypalId: string;
        paypalCode: string;
        email: string;
        refreshToken: string;
      }> = [];

      for (const pp of pps) {
        let token: string | null = null;
        let email = pp.primaryEmail;

        // Try PayPalEmail first
        if (pp.emails.length > 0 && pp.emails[0].hotmailToken) {
          try {
            token = decrypt(pp.emails[0].hotmailToken);
            email = pp.emails[0].email;
          } catch { /* skip */ }
        }

        if (!token) {
          // Try legacy field on PayPalAccount
          const ppFull = await ctx.prisma.payPalAccount.findUnique({
            where: { id: pp.id },
            select: { hotmailToken: true },
          });
          if (ppFull?.hotmailToken) {
            try { token = decrypt(ppFull.hotmailToken); } catch { /* skip */ }
          }
        }

        if (token) {
          accounts.push({
            paypalId: pp.id,
            paypalCode: pp.code,
            email,
            refreshToken: token,
          });
        }
      }

      if (accounts.length === 0) {
        return {
          total: 0, checked: 0, suspended: 0, limited: 0, clean: 0, errors: 0,
          results: [], durationMs: 0,
          message: "Không có PP nào có hotmail token để check",
        };
      }

      // Run batch check
      const summary = await checkBatchPP(accounts);

      // Auto-update status for detected PPs
      let updated = 0;
      for (const r of summary.results) {
        if (r.newStatus && !r.error) {
          // Only update if current status is ACTIVE (don't downgrade SUSPENDED to LIMITED)
          const currentPP = pps.find((p) => p.id === r.paypalId);
          if (!currentPP) continue;

          const shouldUpdate =
            (r.newStatus === "SUSPENDED" && currentPP.status !== "SUSPENDED") ||
            (r.newStatus === "LIMITED" && currentPP.status === "ACTIVE");

          if (shouldUpdate) {
            const data: any = { status: r.newStatus };
            if (r.newStatus === "SUSPENDED") data.suspendedAt = r.alertDate ? new Date(r.alertDate) : new Date();
            if (r.newStatus === "LIMITED") data.limitedAt = r.alertDate ? new Date(r.alertDate) : new Date();

            await ctx.prisma.payPalAccount.update({
              where: { id: r.paypalId },
              data,
            });

            // Add case note
            const pp = await ctx.prisma.payPalAccount.findUnique({
              where: { id: r.paypalId },
              select: { caseHistory: true },
            });
            const history = Array.isArray(pp?.caseHistory) ? [...(pp!.caseHistory as any[])] : [];
            history.push({
              date: new Date().toISOString(),
              type: r.newStatus === "SUSPENDED" ? "suspend" : "limit",
              note: `[Auto-check] ${r.alertSubject || r.alertType}`,
              docsLink: null,
            });
            await ctx.prisma.payPalAccount.update({
              where: { id: r.paypalId },
              data: { caseHistory: history },
            });

            updated++;
          }
        }
      }

      await createAuditLog({
        action: "CHECK_PP_STATUS",
        entity: "PayPalAccount",
        entityId: input.projectId,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: {
          totalChecked: summary.checked,
          suspended: summary.suspended,
          limited: summary.limited,
          errors: summary.errors,
          updated,
        },
      });

      return { ...summary, updated };
    }),

  // Check single PP
  checkSingleStatus: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      paypalId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const pp = await ctx.prisma.payPalAccount.findFirstOrThrow({
        where: { id: input.paypalId, projectId: input.projectId },
        select: {
          id: true,
          code: true,
          primaryEmail: true,
          status: true,
          hotmailToken: true,
          emails: {
            where: { hotmailToken: { not: null } },
            select: { email: true, hotmailToken: true },
            take: 1,
          },
        },
      });

      let token: string | null = null;
      let email = pp.primaryEmail;

      if (pp.emails.length > 0 && pp.emails[0].hotmailToken) {
        try { token = decrypt(pp.emails[0].hotmailToken); email = pp.emails[0].email; } catch {}
      }
      if (!token && pp.hotmailToken) {
        try { token = decrypt(pp.hotmailToken); } catch {}
      }

      if (!token) {
        return { error: "PP này chưa có hotmail token" };
      }

      const result = await checkSinglePP(token, pp.id, pp.code, email);

      // Auto-update if needed
      if (result.newStatus && !result.error) {
        const shouldUpdate =
          (result.newStatus === "SUSPENDED" && pp.status !== "SUSPENDED") ||
          (result.newStatus === "LIMITED" && pp.status === "ACTIVE");

        if (shouldUpdate) {
          const data: any = { status: result.newStatus };
          if (result.newStatus === "SUSPENDED") data.suspendedAt = result.alertDate ? new Date(result.alertDate) : new Date();
          if (result.newStatus === "LIMITED") data.limitedAt = result.alertDate ? new Date(result.alertDate) : new Date();
          await ctx.prisma.payPalAccount.update({ where: { id: pp.id }, data });

          // Add case note
          const ppNote = await ctx.prisma.payPalAccount.findUnique({ where: { id: pp.id }, select: { caseHistory: true } });
          const history = Array.isArray(ppNote?.caseHistory) ? [...(ppNote!.caseHistory as any[])] : [];
          history.push({
            date: new Date().toISOString(),
            type: result.newStatus === "SUSPENDED" ? "suspend" : "limit",
            note: `[Auto-check] ${result.alertSubject || result.alertType}`,
            docsLink: null,
          });
          await ctx.prisma.payPalAccount.update({ where: { id: pp.id }, data: { caseHistory: history } });
        }
      }

      return result;
    }),

  // Read mailbox for a PP email (open mailbox)
  readMailbox: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      paypalId: z.string(),
      emailId: z.string().optional(), // specific PayPalEmail to use
      count: z.number().min(1).max(50).default(30),
    }))
    .mutation(async ({ ctx, input }) => {
      let token: string | null = null;
      let emailAddr = "";

      // If specific emailId provided, use that
      if (input.emailId) {
        const emailRec = await ctx.prisma.payPalEmail.findFirstOrThrow({
          where: { id: input.emailId, projectId: input.projectId },
          select: { email: true, hotmailToken: true },
        });
        if (emailRec.hotmailToken) {
          try { token = decrypt(emailRec.hotmailToken); emailAddr = emailRec.email; } catch {}
        }
      }

      // Fallback: find first email with token for this PP
      if (!token) {
        const pp = await ctx.prisma.payPalAccount.findFirstOrThrow({
          where: { id: input.paypalId, projectId: input.projectId },
          select: {
            hotmailToken: true,
            primaryEmail: true,
            emails: {
              where: { hotmailToken: { not: null } },
              select: { email: true, hotmailToken: true },
              take: 1,
            },
          },
        });

        if (pp.emails.length > 0 && pp.emails[0].hotmailToken) {
          try { token = decrypt(pp.emails[0].hotmailToken); emailAddr = pp.emails[0].email; } catch {}
        }
        if (!token && pp.hotmailToken) {
          try { token = decrypt(pp.hotmailToken); emailAddr = pp.primaryEmail; } catch {}
        }
      }

      if (!token) {
        return { emails: [], emailAddr: "", error: "PP này chưa có hotmail token" };
      }

      const result = await readMailbox(token, input.count);
      return { ...result, emailAddr };
    }),

  // Read single email content
  readEmailDetail: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      paypalId: z.string(),
      emailId: z.string().optional(), // PayPalEmail ID to use for token
      messageId: z.string(), // Graph API message ID
    }))
    .mutation(async ({ ctx, input }) => {
      let token: string | null = null;

      if (input.emailId) {
        const emailRec = await ctx.prisma.payPalEmail.findFirst({
          where: { id: input.emailId, projectId: input.projectId },
          select: { hotmailToken: true },
        });
        if (emailRec?.hotmailToken) {
          try { token = decrypt(emailRec.hotmailToken); } catch {}
        }
      }

      if (!token) {
        const pp = await ctx.prisma.payPalAccount.findFirstOrThrow({
          where: { id: input.paypalId, projectId: input.projectId },
          select: {
            hotmailToken: true,
            emails: {
              where: { hotmailToken: { not: null } },
              select: { hotmailToken: true },
              take: 1,
            },
          },
        });
        if (pp.emails.length > 0 && pp.emails[0].hotmailToken) {
          try { token = decrypt(pp.emails[0].hotmailToken); } catch {}
        }
        if (!token && pp.hotmailToken) {
          try { token = decrypt(pp.hotmailToken); } catch {}
        }
      }

      if (!token) return { subject: "", sender: "", senderName: "", receivedAt: "", body: "", error: "Không có token" };

      return readEmailContent(token, input.messageId);
    }),

  // Import PP from Google Sheet by PP codes
  // Get sheet tabs from Google Spreadsheet
  getSheetTabs: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      sheetUrl: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      return fetchSheetTabs(input.sheetUrl);
    }),

  // Import PP from Google Sheet by "ma paypal" (column A)
  importFromSheet: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      sheetUrl: z.string().url(),
      gid: z.string().optional(), // specific sheet tab gid
      ppCodes: z.array(z.string().min(1)), // "ma paypal" values
    }))
    .mutation(async ({ ctx, input }) => {
      // Build URL with specific gid if provided
      let url = input.sheetUrl;
      if (input.gid) {
        // Replace gid in URL or append it
        const sheetId = url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
        if (sheetId) {
          url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?gid=${input.gid}#gid=${input.gid}`;
        }
      }
      const allRows = await fetchSheetData(url);

      // Build lookup by maPaypal (column A) — primary key for import
      const rowMap = new Map<string, typeof allRows[0]>();
      for (const r of allRows) {
        if (r.maPaypal) rowMap.set(r.maPaypal.toUpperCase(), r);
      }

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      const results: Array<{ ppcode: string; status: "created" | "skipped" | "error"; message?: string }> = [];

      for (const code of input.ppCodes) {
        const trimmed = code.trim();
        if (!trimmed) continue;

        const row = rowMap.get(trimmed.toUpperCase());
        if (!row) {
          errors.push(`${trimmed}: không tìm thấy trong sheet`);
          results.push({ ppcode: trimmed, status: "error", message: "Không tìm thấy trong sheet" });
          continue;
        }

        // Use maPaypal as the PP code in BDOps
        const ppCode = row.maPaypal || row.ppcode || trimmed;

        // Check if PP exists — prefer CURRENT project first, then global
        let existing = await ctx.prisma.payPalAccount.findFirst({
          where: {
            projectId: input.projectId,
            OR: [
              { code: ppCode },
              ...(row.ppcode ? [{ code: row.ppcode }] : []),
            ],
          },
        });
        // If not in current project, check globally (for uniqueness enforcement)
        if (!existing) {
          existing = await ctx.prisma.payPalAccount.findFirst({
            where: {
              OR: [
                { code: ppCode },
                ...(row.ppcode ? [{ code: row.ppcode }] : []),
              ],
            },
          });
        }
        if (existing) {
          // PP exists → always sync data from sheet (sheet = source of truth)
          try {
            const updateData: any = {};
            if (row.userwin) updateData.holder = row.userwin.toUpperCase();
            if (row.ppcode) updateData.vmppCode = row.ppcode;
            if (row.passPaypal) updateData.password = encrypt(row.passPaypal);
            if (row.twoFa) updateData.twoFa = encrypt(row.twoFa);
            if (isValidEmail(row.email1)) updateData.primaryEmail = row.email1;

            if (Object.keys(updateData).length > 0) {
              await ctx.prisma.payPalAccount.update({ where: { id: existing.id }, data: updateData });
            }

            // Add missing emails
            const emailEntries = [
              { email: row.email1, pass: row.passEmail1, token: row.tokenEmail1 },
              { email: row.email2, pass: row.passEmail2, token: row.tokenEmail2 },
              { email: row.email3, pass: row.passEmail3, token: row.tokenEmail3 },
            ];
            let emailsAdded = 0;
            for (const entry of emailEntries) {
              if (!isValidEmail(entry.email)) continue;
              // Check email globally — not just within this PP
              const exists = await ctx.prisma.payPalEmail.findFirst({
                where: { email: entry.email },
              });
              if (!exists) {
                const emailData: any = {
                  email: entry.email,
                  isPrimary: false,
                  paypalId: existing.id,
                  projectId: input.projectId,
                };
                if (entry.pass) emailData.password = encrypt(entry.pass);
                if (entry.token) emailData.hotmailToken = encrypt(entry.token);
                try { await ctx.prisma.payPalEmail.create({ data: emailData }); emailsAdded++; } catch {}
              }
            }

            const changes = Object.keys(updateData).length + emailsAdded;
            if (changes > 0) {
              imported++;
              results.push({ ppcode: ppCode, status: "created", message: `Updated: ${Object.keys(updateData).join(",")}${emailsAdded > 0 ? ` +${emailsAdded} emails` : ""}` });
            } else {
              skipped++;
              results.push({ ppcode: ppCode, status: "skipped", message: "Đã đầy đủ" });
            }
          } catch (e: any) {
            errors.push(`${ppCode}: ${e.message}`);
            results.push({ ppcode: ppCode, status: "error", message: e.message });
          }
          continue;
        }

        try {
          // Global uniqueness check for new PP
          const allEmails = [row.email1, row.email2, row.email3].filter(isValidEmail);
          const dupErrors = await checkGlobalUnique(ctx.prisma, {
            code: ppCode,
            vmppCode: row.ppcode || undefined,
            emails: allEmails,
          });
          if (dupErrors.length > 0) {
            errors.push(`${ppCode}: ${dupErrors.join("; ")}`);
            results.push({ ppcode: ppCode, status: "error", message: dupErrors.join("; ") });
            continue;
          }

          const primaryEmail = (isValidEmail(row.email1) ? row.email1 : null) || (isValidEmail(row.email2) ? row.email2 : null) || (isValidEmail(row.email3) ? row.email3 : null) || `${ppCode}@unknown.com`;

          const ppData: any = {
            code: ppCode,
            primaryEmail,
            holder: row.userwin ? row.userwin.toUpperCase() : null,
            vmppCode: row.ppcode || null,
            status: "ACTIVE",
            role: "NORMAL",
            company: "Bright Data Ltd.",
            projectId: input.projectId,
          };
          if (row.passPaypal) ppData.password = encrypt(row.passPaypal);
          if (row.twoFa) ppData.twoFa = encrypt(row.twoFa);

          const pp = await ctx.prisma.payPalAccount.create({ data: ppData });

          // Create emails (up to 3)
          const emailEntries = [
            { email: row.email1, pass: row.passEmail1, token: row.tokenEmail1 },
            { email: row.email2, pass: row.passEmail2, token: row.tokenEmail2 },
            { email: row.email3, pass: row.passEmail3, token: row.tokenEmail3 },
          ];

          let primarySet = false;
          for (const entry of emailEntries) {
            if (!isValidEmail(entry.email)) continue;
            const emailData: any = {
              email: entry.email,
              isPrimary: !primarySet,
              paypalId: pp.id,
              projectId: input.projectId,
            };
            if (entry.pass) emailData.password = encrypt(entry.pass);
            if (entry.token) emailData.hotmailToken = encrypt(entry.token);
            try {
              await ctx.prisma.payPalEmail.create({ data: emailData });
              primarySet = true;
            } catch { /* skip duplicate email */ }
          }

          imported++;
          results.push({
            ppcode: ppCode,
            status: "created",
            message: `holder=${row.userwin || "—"}, emails=${[row.email1, row.email2, row.email3].filter(Boolean).length}`,
          });
        } catch (e: any) {
          errors.push(`${ppCode}: ${e.message}`);
          results.push({ ppcode: ppCode, status: "error", message: e.message });
        }
      }

      await createAuditLog({
        action: "IMPORT",
        entity: "PayPalAccount",
        entityId: input.projectId,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { source: "google_sheet", imported, skipped, errors: errors.length, codes: input.ppCodes },
      });

      return { imported, skipped, errors: errors.slice(0, 20), results, totalInSheet: allRows.length };
    }),
});
