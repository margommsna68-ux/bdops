import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure, moderatorProcedure } from "../trpc";
import { APP_MODULES } from "../trpc";
import bcrypt from "bcryptjs";

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
      orderBy: { code: "asc" },
    });
  }),

  getById: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
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

  // Create a new user with email + password
  createUser: adminProcedure
    .input(
      z.object({
        projectId: z.string(),
        email: z.string().email(),
        name: z.string().min(1),
        password: z.string().min(6),
        role: z.enum(["ADMIN", "MODERATOR", "USER"]),
        allowedModules: z.array(z.enum(APP_MODULES as unknown as [string, ...string[]])).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const hashedPassword = await bcrypt.hash(input.password, 10);

      // Create or find user
      let user = await ctx.prisma.user.findUnique({
        where: { email: input.email },
      });
      if (user) {
        // Update password if user already exists
        user = await ctx.prisma.user.update({
          where: { id: user.id },
          data: { password: hashedPassword, name: input.name },
        });
      } else {
        user = await ctx.prisma.user.create({
          data: {
            email: input.email,
            name: input.name,
            password: hashedPassword,
          },
        });
      }

      // Add to project
      return ctx.prisma.projectMember.upsert({
        where: { userId_projectId: { userId: user.id, projectId: input.projectId } },
        update: { role: input.role, allowedModules: input.allowedModules },
        create: {
          userId: user.id,
          projectId: input.projectId,
          role: input.role,
          allowedModules: input.allowedModules,
        },
        include: { user: true },
      });
    }),

  addMember: adminProcedure
    .input(
      z.object({
        projectId: z.string(),
        email: z.string().email(),
        role: z.enum(["ADMIN", "MODERATOR", "USER"]),
        allowedModules: z.array(z.enum(APP_MODULES as unknown as [string, ...string[]])).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { email: input.email },
      });
      if (!user) {
        throw new Error("User not found. Create the user first.");
      }
      return ctx.prisma.projectMember.create({
        data: {
          userId: user.id,
          projectId: input.projectId,
          role: input.role,
          allowedModules: input.allowedModules,
        },
        include: { user: true },
      });
    }),

  updateMember: adminProcedure
    .input(
      z.object({
        projectId: z.string(),
        memberId: z.string(),
        role: z.enum(["ADMIN", "MODERATOR", "USER"]).optional(),
        allowedModules: z.array(z.enum(APP_MODULES as unknown as [string, ...string[]])).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const data: any = {};
      if (input.role) data.role = input.role;
      if (input.allowedModules) data.allowedModules = input.allowedModules;
      return ctx.prisma.projectMember.update({
        where: { id: input.memberId },
        data,
        include: { user: true },
      });
    }),

  removeMember: adminProcedure
    .input(z.object({ projectId: z.string(), memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.projectMember.delete({
        where: { id: input.memberId },
      });
    }),

  // List all users (for admin)
  listUsers: adminProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx }) => {
      return ctx.prisma.user.findMany({
        select: { id: true, email: true, name: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
    }),

  // Set PIN for a user (Admin/Moderator only)
  setPin: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        userId: z.string(),
        pin: z.string().min(4).max(8).regex(/^\d+$/, "PIN must be digits only"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const hashedPin = await bcrypt.hash(input.pin, 10);
      await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { pin: hashedPin },
      });
      return { success: true };
    }),

  // Remove PIN for a user (Admin/Moderator only)
  removePin: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { pin: null },
      });
      return { success: true };
    }),

  // Check if current logged-in user has PIN set
  myPinStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: (ctx.user as any).id },
        select: { pin: true },
      });
      return { hasPin: !!user?.pin };
    }),

  // Verify PIN for current logged-in user
  verifyPin: protectedProcedure
    .input(z.object({ pin: z.string().min(4).max(8) }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: (ctx.user as any).id },
        select: { pin: true },
      });
      if (!user?.pin) return { valid: true };
      const valid = await bcrypt.compare(input.pin, user.pin);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "PIN khong dung" });
      return { valid: true };
    }),
});
