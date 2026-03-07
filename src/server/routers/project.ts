import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../trpc";

export const projectRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = (ctx.user as any).id;
    return ctx.prisma.project.findMany({
      where: {
        members: { some: { userId } },
      },
      include: {
        _count: {
          select: {
            servers: true,
            paypalAccounts: true,
            fundTransactions: true,
          },
        },
      },
    });
  }),

  getById: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify user is a member of this project
      const userId = (ctx.user as any).id;
      await ctx.prisma.projectMember.findFirstOrThrow({
        where: { projectId: input.projectId, userId },
      });
      return ctx.prisma.project.findUniqueOrThrow({
        where: { id: input.projectId },
        include: {
          members: {
            include: { user: true },
          },
          _count: {
            select: {
              servers: true,
              paypalAccounts: true,
              fundTransactions: true,
              withdrawals: true,
            },
          },
        },
      });
    }),

  create: adminProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        name: z.string().min(1),
        code: z.string().min(1).max(10),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = (ctx.user as any).id;
      return ctx.prisma.project.create({
        data: {
          name: input.name,
          code: input.code.toUpperCase(),
          description: input.description,
          members: {
            create: { userId, role: "ADMIN" },
          },
        },
      });
    }),

  update: adminProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        settings: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, ...data } = input;
      return ctx.prisma.project.update({
        where: { id: projectId },
        data,
      });
    }),

  addMember: adminProcedure
    .input(
      z.object({
        projectId: z.string(),
        email: z.string().email(),
        role: z.enum(["ADMIN", "MANAGER", "OPERATOR", "PARTNER", "VIEWER"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { email: input.email },
      });
      if (!user) {
        // Create user for invite
        const newUser = await ctx.prisma.user.create({
          data: { email: input.email },
        });
        return ctx.prisma.projectMember.create({
          data: {
            userId: newUser.id,
            projectId: input.projectId,
            role: input.role,
          },
        });
      }
      return ctx.prisma.projectMember.create({
        data: {
          userId: user.id,
          projectId: input.projectId,
          role: input.role,
        },
      });
    }),
});
