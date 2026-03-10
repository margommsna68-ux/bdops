import { z } from "zod";
import { router, infrastructureProcedure, moderatorProcedure } from "../trpc";
import { encrypt, decrypt } from "@/lib/encryption";

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
              gmail: { include: { paypal: { select: { code: true, status: true } } } },
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
        provider: z.string().optional(),
        cpu: z.string().optional(),
        ram: z.string().optional(),
        status: z.enum(["BUILDING", "ACTIVE", "SUSPENDED", "EXPIRED", "MAINTENANCE"]).default("BUILDING"),
        credentials: z.any().optional(),
        inventoryId: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const data: any = { ...input };
      if (input.credentials) {
        data.credentials = encrypt(JSON.stringify(input.credentials));
      }
      return ctx.prisma.server.create({ data });
    }),

  update: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        code: z.string().optional(),
        ipAddress: z.string().optional(),
        provider: z.string().optional(),
        cpu: z.string().optional(),
        ram: z.string().optional(),
        status: z.enum(["BUILDING", "ACTIVE", "SUSPENDED", "EXPIRED", "MAINTENANCE"]).optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      await ctx.prisma.server.findFirstOrThrow({ where: { id, projectId } });
      return ctx.prisma.server.update({ where: { id }, data });
    }),

  delete: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.server.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      return ctx.prisma.server.delete({ where: { id: input.id } });
    }),

  getCredentials: moderatorProcedure
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
        return server.credentials;
      }
    }),
});
