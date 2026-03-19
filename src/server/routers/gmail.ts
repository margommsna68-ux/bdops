import { z } from "zod";
import { router, infrastructureProcedure, moderatorProcedure } from "../trpc";
import { encrypt, decrypt } from "@/lib/encryption";
import { createAuditLog } from "@/lib/audit";

export const gmailRouter = router({
  list: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        status: z.string().optional(),
        unassigned: z.boolean().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(500).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.status) where.status = input.status;

      const [items, total] = await Promise.all([
        ctx.prisma.gmailAccount.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { email: "asc" },
          include: {
            vms: { select: { id: true, code: true, server: { select: { code: true } } } },
            paypal: { select: { code: true, status: true } },
            _count: { select: { vms: true } },
          },
        }),
        ctx.prisma.gmailAccount.count({ where }),
      ]);

      return { items, total, page: input.page, limit: input.limit };
    }),

  create: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        email: z.string().email(),
        password: z.string().optional(),
        twoFaCurrent: z.string().optional(),
        twoFaOld: z.string().optional(),
        recoveryEmail: z.string().optional(),
        token: z.string().optional(),
        status: z.enum(["ACTIVE", "SUSPENDED", "NEEDS_RECOVERY", "NEEDS_2FA_UPDATE", "BLOCKED", "DISABLED"]).default("ACTIVE"),
        paypalId: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, ...data } = input;
      if (data.password) data.password = encrypt(data.password);
      if (data.twoFaCurrent) data.twoFaCurrent = encrypt(data.twoFaCurrent);
      if (data.twoFaOld) data.twoFaOld = encrypt(data.twoFaOld);
      if (data.token) data.token = encrypt(data.token);

      const created = await ctx.prisma.gmailAccount.create({ data: { ...data, projectId } });
      await createAuditLog({
        action: "CREATE",
        entity: "GmailAccount",
        entityId: created.id,
        userId: (ctx.user as any).id,
        projectId,
        changes: { email: input.email, status: input.status },
      });
      return created;
    }),

  update: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        email: z.string().email().optional(),
        password: z.string().optional(),
        status: z.enum(["ACTIVE", "SUSPENDED", "NEEDS_RECOVERY", "NEEDS_2FA_UPDATE", "BLOCKED", "DISABLED"]).optional(),
        twoFaCurrent: z.string().optional(),
        recoveryEmail: z.string().nullable().optional(),
        token: z.string().nullable().optional(),
        paypalId: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      await ctx.prisma.gmailAccount.findFirstOrThrow({
        where: { id, projectId },
      });
      if (data.password) data.password = encrypt(data.password);
      if (data.token) data.token = encrypt(data.token);
      if (data.twoFaCurrent) {
        const existing = await ctx.prisma.gmailAccount.findUniqueOrThrow({
          where: { id },
          select: { twoFaCurrent: true },
        });
        (data as any).twoFaOld = existing.twoFaCurrent;
        data.twoFaCurrent = encrypt(data.twoFaCurrent);
      }
      const updated = await ctx.prisma.gmailAccount.update({ where: { id }, data });
      await createAuditLog({
        action: "UPDATE",
        entity: "GmailAccount",
        entityId: id,
        userId: (ctx.user as any).id,
        projectId,
        changes: data,
      });
      return updated;
    }),

  needsAction: infrastructureProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.gmailAccount.findMany({
        where: {
          projectId: input.projectId,
          status: { in: ["NEEDS_RECOVERY", "NEEDS_2FA_UPDATE"] },
        },
        include: {
          vms: { select: { code: true } },
          paypal: { select: { code: true } },
        },
        orderBy: { email: "asc" },
      });
    }),

  bulkImport: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        gmails: z.array(
          z.object({
            email: z.string().email(),
            password: z.string().optional(),
            recoveryEmail: z.string().optional(),
            twoFaCurrent: z.string().optional(),
            token: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      for (const g of input.gmails) {
        try {
          await ctx.prisma.gmailAccount.create({
            data: {
              email: g.email,
              password: g.password ? encrypt(g.password) : null,
              twoFaCurrent: g.twoFaCurrent ? encrypt(g.twoFaCurrent) : null,
              token: g.token ? encrypt(g.token) : null,
              recoveryEmail: g.recoveryEmail,
              projectId: input.projectId,
              status: "ACTIVE",
            },
          });
          imported++;
        } catch {
          // Skip duplicates
        }
      }
      await createAuditLog({
        action: "IMPORT",
        entity: "GmailAccount",
        entityId: input.projectId,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { imported, total: input.gmails.length },
      });
      return { imported, total: input.gmails.length };
    }),

  getCredentials: infrastructureProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const gmail = await ctx.prisma.gmailAccount.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        select: { password: true, twoFaCurrent: true, token: true },
      });
      let password = gmail.password;
      let twoFaCurrent = gmail.twoFaCurrent;
      let token = gmail.token;
      if (password) { try { password = decrypt(password); } catch {} }
      if (twoFaCurrent) { try { twoFaCurrent = decrypt(twoFaCurrent); } catch {} }
      if (token) { try { token = decrypt(token); } catch {} }
      return { password, twoFaCurrent, token };
    }),

  delete: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const gmail = await ctx.prisma.gmailAccount.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      await createAuditLog({
        action: "DELETE",
        entity: "GmailAccount",
        entityId: input.id,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { email: gmail.email },
      });
      // Unassign from VMs first
      await ctx.prisma.virtualMachine.updateMany({ where: { gmailId: input.id }, data: { gmailId: null } });
      return ctx.prisma.gmailAccount.delete({ where: { id: input.id } });
    }),

  bulkDelete: moderatorProcedure
    .input(z.object({ projectId: z.string(), ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await createAuditLog({
        action: "BULK_DELETE",
        entity: "GmailAccount",
        entityId: input.ids.join(","),
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { count: input.ids.length, ids: input.ids },
      });
      await ctx.prisma.virtualMachine.updateMany({ where: { gmailId: { in: input.ids } }, data: { gmailId: null } });
      const result = await ctx.prisma.gmailAccount.deleteMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
      });
      return { deleted: result.count };
    }),
});
