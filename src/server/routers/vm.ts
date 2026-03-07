import { z } from "zod";
import { router, protectedProcedure, operatorProcedure } from "../trpc";

export const vmRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        serverId: z.string().optional(),
        status: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { server: { projectId: input.projectId } };
      if (input.serverId) where.serverId = input.serverId;
      if (input.status) where.status = input.status;

      const [items, total] = await Promise.all([
        ctx.prisma.virtualMachine.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { code: "asc" },
          include: {
            server: { select: { code: true } },
            proxy: { select: { address: true, status: true } },
            gmail: { select: { email: true, status: true } },
          },
        }),
        ctx.prisma.virtualMachine.count({ where }),
      ]);

      return { items, total, page: input.page, limit: input.limit };
    }),

  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.virtualMachine.findFirstOrThrow({
        where: { id: input.id, server: { projectId: input.projectId } },
        include: {
          server: { select: { code: true, ipAddress: true, provider: true } },
          proxy: true,
          gmail: {
            include: {
              paypal: { select: { id: true, code: true, status: true, primaryEmail: true } },
            },
          },
          tasks: {
            where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
            orderBy: { scheduledAt: "asc" },
          },
        },
      });
    }),

  create: operatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        code: z.string().min(1),
        serverId: z.string(),
        status: z.enum(["NEW", "OK", "ERROR", "SUSPENDED", "NOT_CONNECTED", "NOT_AVC", "BLOCKED"]).default("NEW"),
        sdkId: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify server belongs to project
      await ctx.prisma.server.findFirstOrThrow({ where: { id: input.serverId, projectId: input.projectId } });
      const { projectId: _, ...data } = input;
      return ctx.prisma.virtualMachine.create({ data });
    }),

  update: operatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        status: z.enum(["NEW", "OK", "ERROR", "SUSPENDED", "NOT_CONNECTED", "NOT_AVC", "BLOCKED"]).optional(),
        sdkId: z.string().nullable().optional(),
        earnTotal: z.number().optional(),
        earn24h: z.number().optional(),
        uptime: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      await ctx.prisma.virtualMachine.findFirstOrThrow({ where: { id, server: { projectId } } });
      return ctx.prisma.virtualMachine.update({ where: { id }, data });
    }),

  // Get VMs without proxy assigned
  withoutProxy: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.virtualMachine.findMany({
        where: {
          server: { projectId: input.projectId },
          proxyId: null,
        },
        include: { server: { select: { code: true } } },
        orderBy: { code: "asc" },
      });
    }),

  bulkImport: operatorProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        code: z.string().min(1),
        serverCode: z.string(),
        status: z.enum(["NEW", "OK", "ERROR", "SUSPENDED", "NOT_CONNECTED", "NOT_AVC", "BLOCKED"]).default("NEW"),
        sdkId: z.string().optional(),
        notes: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          const server = await ctx.prisma.server.findFirst({
            where: { code: item.serverCode, projectId: input.projectId },
          });
          if (!server) {
            errors.push(`Server ${item.serverCode} not found`);
            skipped++;
            continue;
          }
          const existing = await ctx.prisma.virtualMachine.findFirst({
            where: { code: item.code, serverId: server.id },
          });
          if (existing) {
            skipped++;
            continue;
          }
          await ctx.prisma.virtualMachine.create({
            data: {
              code: item.code,
              status: item.status,
              sdkId: item.sdkId,
              notes: item.notes,
              serverId: server.id,
            },
          });
          imported++;
        } catch (e: any) {
          errors.push(`${item.code}: ${e.message}`);
          skipped++;
        }
      }
      return { imported, skipped, errors: errors.slice(0, 10) };
    }),
});
