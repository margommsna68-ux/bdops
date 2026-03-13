import { z } from "zod";
import { router, infrastructureProcedure, moderatorProcedure } from "../trpc";
import { encrypt, decrypt } from "@/lib/encryption";
import { createAuditLog } from "@/lib/audit";

export const serverRouter = router({
  list: infrastructureProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.server.findMany({
        where: { projectId: input.projectId },
        include: {
          _count: { select: { vms: true } },
        },
        orderBy: { code: "asc" },
      });
    }),

  getById: infrastructureProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.server.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        include: {
          vms: {
            include: {
              proxy: true,
              gmail: {
                select: { id: true, email: true, password: true, twoFaCurrent: true, recoveryEmail: true, status: true, paypal: { select: { id: true, code: true, status: true, primaryEmail: true } } },
              },
            },
            orderBy: { code: "asc" },
          },
        },
      });
    }),

  create: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        code: z.string().min(1),
        ipAddress: z.string().optional(),
        netmask: z.string().optional(),
        gateway: z.string().optional(),
        allocation: z.string().optional(),
        provider: z.string().optional(),
        cpu: z.string().optional(),
        ram: z.string().optional(),
        status: z.enum(["BUILDING", "ACTIVE", "SUSPENDED", "EXPIRED", "MAINTENANCE"]).default("BUILDING"),
        credentials: z.any().optional(),
        inventoryId: z.string().optional(),
        notes: z.string().optional(),
        gmailGroup: z.number().int().min(1).max(2).default(1),
        monthlyCost: z.number().optional(),
        billingCycle: z.number().int().min(1).optional(),
        createdDate: z.string().optional(),
        expiryDate: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { createdDate, expiryDate, credentials, ...rest } = input;
      const data: any = { ...rest };
      if (credentials) {
        data.credentials = encrypt(JSON.stringify(credentials));
      }
      if (createdDate) data.createdDate = new Date(createdDate);
      if (expiryDate) data.expiryDate = new Date(expiryDate);
      const result = await ctx.prisma.server.create({ data });
      await createAuditLog({
        action: "CREATE",
        entity: "Server",
        entityId: result.id,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { code: input.code, ipAddress: input.ipAddress, provider: input.provider },
      });
      return result;
    }),

  update: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        code: z.string().optional(),
        ipAddress: z.string().optional(),
        netmask: z.string().nullable().optional(),
        gateway: z.string().nullable().optional(),
        allocation: z.string().nullable().optional(),
        provider: z.string().optional(),
        cpu: z.string().optional(),
        ram: z.string().optional(),
        status: z.enum(["BUILDING", "ACTIVE", "SUSPENDED", "EXPIRED", "MAINTENANCE"]).optional(),
        credentials: z.any().optional(),
        inventoryId: z.string().optional(),
        notes: z.string().nullable().optional(),
        gmailGroup: z.number().int().min(1).max(2).optional(),
        monthlyCost: z.number().nullable().optional(),
        billingCycle: z.number().int().min(1).nullable().optional(),
        createdDate: z.string().nullable().optional(),
        expiryDate: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, createdDate, expiryDate, credentials, ...rest } = input;
      await ctx.prisma.server.findFirstOrThrow({ where: { id, projectId } });
      const data: any = { ...rest };
      if (credentials) {
        data.credentials = encrypt(JSON.stringify(credentials));
      }
      if (createdDate !== undefined) data.createdDate = createdDate ? new Date(createdDate) : null;
      if (expiryDate !== undefined) data.expiryDate = expiryDate ? new Date(expiryDate) : null;
      const result = await ctx.prisma.server.update({ where: { id }, data });
      await createAuditLog({
        action: "UPDATE",
        entity: "Server",
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
      const server = await ctx.prisma.server.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      await createAuditLog({
        action: "DELETE",
        entity: "Server",
        entityId: input.id,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { code: server.code },
      });
      return ctx.prisma.server.delete({ where: { id: input.id } });
    }),

  getCredentials: infrastructureProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const server = await ctx.prisma.server.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        select: { credentials: true },
      });
      if (!server.credentials) return null;
      try {
        return JSON.parse(decrypt(server.credentials as string));
      } catch {
        return null;
      }
    }),

  renew: infrastructureProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const server = await ctx.prisma.server.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
      });
      const cycle = server.billingCycle ?? 1;
      const baseDate = server.expiryDate && new Date(server.expiryDate) > new Date()
        ? new Date(server.expiryDate)
        : new Date();
      baseDate.setMonth(baseDate.getMonth() + cycle);
      const result = await ctx.prisma.server.update({
        where: { id: input.id },
        data: { expiryDate: baseDate },
      });
      await createAuditLog({
        action: "UPDATE",
        entity: "Server",
        entityId: input.id,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { action: "renew", cycle, newExpiryDate: baseDate.toISOString() },
      });
      return result;
    }),

  bulkUpdateStatus: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      serverIds: z.array(z.string()).min(1),
      status: z.enum(["BUILDING", "ACTIVE", "SUSPENDED", "EXPIRED", "MAINTENANCE"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.server.updateMany({
        where: { id: { in: input.serverIds }, projectId: input.projectId },
        data: { status: input.status },
      });
      await createAuditLog({
        action: "BULK_UPDATE",
        entity: "Server",
        entityId: input.serverIds.join(","),
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { count: input.serverIds.length, status: input.status },
      });
      return { updated: result.count };
    }),

  bulkDelete: moderatorProcedure
    .input(z.object({ projectId: z.string(), serverIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await createAuditLog({
        action: "BULK_DELETE",
        entity: "Server",
        entityId: input.serverIds.join(","),
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { count: input.serverIds.length },
      });
      await ctx.prisma.virtualMachine.deleteMany({
        where: { server: { id: { in: input.serverIds }, projectId: input.projectId } },
      });
      const result = await ctx.prisma.server.deleteMany({
        where: { id: { in: input.serverIds }, projectId: input.projectId },
      });
      return { deleted: result.count };
    }),

  importFromCSV: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        code: z.string().min(1),
        ipAddress: z.string().optional(),
        netmask: z.string().optional(),
        gateway: z.string().optional(),
        allocation: z.string().optional(),
        provider: z.string().optional(),
        cpu: z.string().optional(),
        ram: z.string().optional(),
        status: z.enum(["BUILDING", "ACTIVE", "SUSPENDED", "EXPIRED", "MAINTENANCE"]).default("BUILDING"),
        inventoryId: z.string().optional(),
        notes: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const item of input.items) {
        try {
          const existing = await ctx.prisma.server.findFirst({
            where: { code: item.code, projectId: input.projectId },
          });
          if (existing) { skipped++; continue; }
          await ctx.prisma.server.create({
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
        entity: "Server",
        entityId: input.projectId,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { imported, skipped, totalItems: input.items.length },
      });
      return { imported, skipped, errors: errors.slice(0, 10) };
    }),
});
