import { z } from "zod";
import { router, protectedProcedure, operatorProcedure } from "../trpc";

export const vmTaskRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        vmId: z.string().optional(),
        status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { vm: { server: { projectId: input.projectId } } };
      if (input.vmId) where.vmId = input.vmId;
      if (input.status) where.status = input.status;

      return ctx.prisma.vMTask.findMany({
        where,
        include: {
          vm: { select: { code: true, server: { select: { code: true } } } },
          assignedTo: { select: { name: true, email: true } },
        },
        orderBy: { scheduledAt: "asc" },
      });
    }),

  create: operatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        vmId: z.string(),
        type: z.string(),
        title: z.string(),
        description: z.string().optional(),
        scheduledAt: z.string(),
        assignedToId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify VM belongs to project
      await ctx.prisma.virtualMachine.findFirstOrThrow({ where: { id: input.vmId, server: { projectId: input.projectId } } });
      const { projectId: _, ...data } = input;
      return ctx.prisma.vMTask.create({
        data: {
          ...data,
          scheduledAt: new Date(data.scheduledAt),
        },
      });
    }),

  updateStatus: operatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify task belongs to project
      await ctx.prisma.vMTask.findFirstOrThrow({
        where: { id: input.id, vm: { server: { projectId: input.projectId } } },
      });
      const data: any = { status: input.status };
      if (input.status === "COMPLETED") data.completedAt = new Date();
      return ctx.prisma.vMTask.update({
        where: { id: input.id },
        data,
      });
    }),

  upcoming: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.vMTask.findMany({
        where: {
          vm: { server: { projectId: input.projectId } },
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
        include: {
          vm: { select: { code: true } },
          assignedTo: { select: { name: true } },
        },
        orderBy: { scheduledAt: "asc" },
        take: 20,
      });
    }),

  overdue: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.vMTask.findMany({
        where: {
          vm: { server: { projectId: input.projectId } },
          status: "PENDING",
          scheduledAt: { lt: new Date() },
        },
        include: {
          vm: { select: { code: true } },
          assignedTo: { select: { name: true } },
        },
        orderBy: { scheduledAt: "asc" },
      });
    }),
});
