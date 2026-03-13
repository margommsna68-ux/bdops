import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure, moderatorProcedure } from "../trpc";
import { APP_MODULES } from "../trpc";
import bcrypt from "bcryptjs";
import { createAuditLog } from "@/lib/audit";

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
            include: {
              user: {
                include: {
                  memberships: {
                    include: { project: { select: { id: true, code: true, name: true } } },
                  },
                },
              },
            },
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
      const result = await ctx.prisma.project.create({
        data: {
          name: input.name,
          code: input.code.toUpperCase(),
          description: input.description,
          members: {
            create: { userId, role: "ADMIN" },
          },
        },
      });
      await createAuditLog({ action: "CREATE", entity: "Project", entityId: result.id, userId, projectId: result.id, changes: { code: result.code, name: result.name } });
      return result;
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
      const result = await ctx.prisma.project.update({
        where: { id: projectId },
        data,
      });
      await createAuditLog({ action: "UPDATE", entity: "Project", entityId: projectId, userId: (ctx.user as any).id, projectId, changes: data });
      return result;
    }),

  // Create a new user with username + password
  createUser: adminProcedure
    .input(
      z.object({
        projectId: z.string(),
        username: z.string().min(1).max(50).regex(/^[a-zA-Z0-9._-]+$/, "Username chỉ chứa chữ, số, dấu chấm, gạch ngang"),
        name: z.string().min(1),
        password: z.string().min(6),
        pin: z.string().min(4).max(6).regex(/^\d+$/).optional(),
        role: z.enum(["ADMIN", "MODERATOR", "USER"]),
        allowedModules: z.array(z.enum(APP_MODULES as unknown as [string, ...string[]])).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const hashedPassword = await bcrypt.hash(input.password, 10);
      const hashedPin = input.pin ? await bcrypt.hash(input.pin, 10) : undefined;

      // Check if username already exists
      const existing = await ctx.prisma.user.findFirst({
        where: { username: input.username },
      });

      let user;
      if (existing) {
        // Update password if user already exists
        const updateData: any = { password: hashedPassword, name: input.name };
        if (hashedPin) updateData.pin = hashedPin;
        user = await ctx.prisma.user.update({
          where: { id: existing.id },
          data: updateData,
        });
      } else {
        // Auto-generate email from username for backward compat
        const email = `${input.username}@bdops.local`;
        user = await ctx.prisma.user.create({
          data: {
            email,
            username: input.username,
            name: input.name,
            password: hashedPassword,
            ...(hashedPin ? { pin: hashedPin } : {}),
          },
        });
      }

      // Add to project
      const member = await ctx.prisma.projectMember.upsert({
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
      await createAuditLog({ action: "CREATE", entity: "User", entityId: user.id, userId: (ctx.user as any).id, projectId: input.projectId, changes: { username: input.username, name: input.name, role: input.role } });
      return member;
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
      const result = await ctx.prisma.projectMember.update({
        where: { id: input.memberId },
        data,
        include: { user: true },
      });
      await createAuditLog({ action: "UPDATE", entity: "ProjectMember", entityId: input.memberId, userId: (ctx.user as any).id, projectId: input.projectId, changes: data });
      return result;
    }),

  removeMember: adminProcedure
    .input(z.object({ projectId: z.string(), memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.prisma.projectMember.findUnique({ where: { id: input.memberId }, include: { user: { select: { username: true, name: true } } } });
      await createAuditLog({ action: "DELETE", entity: "ProjectMember", entityId: input.memberId, userId: (ctx.user as any).id, projectId: input.projectId, changes: { removedUser: member?.user?.username || member?.user?.name } });
      return ctx.prisma.projectMember.delete({
        where: { id: input.memberId },
      });
    }),

  // List users in this project (for admin)
  listUsers: adminProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.user.findMany({
        where: {
          memberships: { some: { projectId: input.projectId } },
        },
        select: { id: true, email: true, username: true, name: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
    }),

  // Update user info (name, username) - Admin only
  updateUserInfo: adminProcedure
    .input(
      z.object({
        projectId: z.string(),
        userId: z.string(),
        name: z.string().min(1).optional(),
        username: z.string().min(1).max(50).regex(/^[a-zA-Z0-9._-]+$/, "Username chỉ chứa chữ, số, dấu chấm, gạch ngang").optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify user belongs to project
      await ctx.prisma.projectMember.findFirstOrThrow({
        where: { projectId: input.projectId, userId: input.userId },
      });

      const data: any = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.username !== undefined) {
        // Check uniqueness
        const existing = await ctx.prisma.user.findFirst({
          where: { username: input.username, NOT: { id: input.userId } },
        });
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "Username đã tồn tại" });
        data.username = input.username;
      }

      const result = await ctx.prisma.user.update({
        where: { id: input.userId },
        data,
        select: { id: true, username: true, name: true, email: true },
      });
      await createAuditLog({ action: "UPDATE", entity: "User", entityId: input.userId, userId: (ctx.user as any).id, projectId: input.projectId, changes: data });
      return result;
    }),

  // Set PIN for a user (Admin/Moderator only)
  setPin: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        userId: z.string(),
        pin: z.string().min(4).max(6).regex(/^\d+$/, "PIN must be digits only"),
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
