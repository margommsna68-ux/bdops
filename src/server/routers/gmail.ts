import { z } from "zod";
import { router, infrastructureProcedure } from "../trpc";
import { encrypt } from "@/lib/encryption";

export const gmailRouter = router({
  list: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        search: z.string().optional(),
        status: z.string().optional(),
        unassigned: z.boolean().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.search) {
        where.email = { contains: input.search, mode: "insensitive" };
      }
      if (input.status) where.status = input.status;
      if (input.unassigned) {
        where.vmId = null;
      }

      const [items, total, unassignedCount] = await Promise.all([
        ctx.prisma.gmailAccount.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { createdAt: "desc" },
          include: {
            vm: { select: { id: true, code: true, server: { select: { code: true } } } },
            paypal: { select: { code: true, status: true } },
          },
        }),
        ctx.prisma.gmailAccount.count({ where }),
        ctx.prisma.gmailAccount.count({ where: { projectId: input.projectId, vmId: null } }),
      ]);

      return { items, total, unassignedCount, page: input.page, limit: input.limit };
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
        status: z.enum(["ACTIVE", "SUSPENDED", "NEEDS_RECOVERY", "NEEDS_2FA_UPDATE", "BLOCKED", "DISABLED"]).default("ACTIVE"),
        vmId: z.string().optional(),
        paypalId: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify VM belongs to project if provided
      if (input.vmId) {
        await ctx.prisma.virtualMachine.findFirstOrThrow({ where: { id: input.vmId, server: { projectId: input.projectId } } });
      }
      const { projectId, ...data } = input;
      // Encrypt sensitive fields
      if (data.password) data.password = encrypt(data.password);
      if (data.twoFaCurrent) data.twoFaCurrent = encrypt(data.twoFaCurrent);
      if (data.twoFaOld) data.twoFaOld = encrypt(data.twoFaOld);

      return ctx.prisma.gmailAccount.create({ data: { ...data, projectId } });
    }),

  update: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        status: z.enum(["ACTIVE", "SUSPENDED", "NEEDS_RECOVERY", "NEEDS_2FA_UPDATE", "BLOCKED", "DISABLED"]).optional(),
        twoFaCurrent: z.string().optional(),
        recoveryEmail: z.string().nullable().optional(),
        paypalId: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      // Verify gmail belongs to project
      await ctx.prisma.gmailAccount.findFirstOrThrow({
        where: { id, projectId },
      });
      if (data.twoFaCurrent) {
        // Move current to old, encrypt new
        const existing = await ctx.prisma.gmailAccount.findUniqueOrThrow({
          where: { id },
          select: { twoFaCurrent: true },
        });
        (data as any).twoFaOld = existing.twoFaCurrent;
        data.twoFaCurrent = encrypt(data.twoFaCurrent);
      }
      return ctx.prisma.gmailAccount.update({ where: { id }, data });
    }),

  assignToVm: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        gmailId: z.string(),
        vmId: z.string().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify gmail belongs to project
      await ctx.prisma.gmailAccount.findFirstOrThrow({
        where: { id: input.gmailId, projectId: input.projectId },
      });
      // If assigning (not unassigning), verify VM belongs to project and has no gmail
      if (input.vmId) {
        await ctx.prisma.virtualMachine.findFirstOrThrow({
          where: { id: input.vmId, server: { projectId: input.projectId } },
        });
        // Check VM doesn't already have a Gmail
        const existing = await ctx.prisma.gmailAccount.findUnique({
          where: { vmId: input.vmId },
        });
        if (existing && existing.id !== input.gmailId) {
          throw new Error("This VM already has a Gmail assigned");
        }
      }
      return ctx.prisma.gmailAccount.update({
        where: { id: input.gmailId },
        data: { vmId: input.vmId },
      });
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
          vm: { select: { code: true } },
          paypal: { select: { code: true } },
        },
        orderBy: { email: "asc" },
      });
    }),

  bulkImport: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        gmails: z.array(
          z.object({
            email: z.string().email(),
            password: z.string().optional(),
            twoFaCurrent: z.string().optional(),
            recoveryEmail: z.string().optional(),
            vmId: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      const skipped: { email: string; reason: string }[] = [];

      for (const g of input.gmails) {
        // Check if email already exists in this project
        const existing = await ctx.prisma.gmailAccount.findFirst({
          where: { email: g.email, projectId: input.projectId },
        });
        if (existing) {
          skipped.push({ email: g.email, reason: "Email đã tồn tại" });
          continue;
        }

        try {
          await ctx.prisma.gmailAccount.create({
            data: {
              email: g.email,
              password: g.password ? encrypt(g.password) : null,
              twoFaCurrent: g.twoFaCurrent ? encrypt(g.twoFaCurrent) : null,
              recoveryEmail: g.recoveryEmail,
              vmId: g.vmId || null,
              projectId: input.projectId,
              status: "ACTIVE",
            },
          });
          imported++;
        } catch (err: any) {
          skipped.push({ email: g.email, reason: err.message?.includes("Unique") ? "Email đã tồn tại" : "Lỗi không xác định" });
        }
      }
      return { imported, total: input.gmails.length, skipped };
    }),
});
