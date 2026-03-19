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

  // Get current user's membership for a project (role + modules, fresh from DB)
  myMembership: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = (ctx.user as any).id;
      const membership = await ctx.prisma.projectMember.findFirst({
        where: { userId, projectId: input.projectId },
        select: { id: true, role: true, allowedModules: true, canManageUsers: true, managerId: true },
      });
      return membership ?? { id: "", role: "USER" as const, allowedModules: [] as string[], canManageUsers: false, managerId: null };
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

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        code: z.string().min(1).max(10),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = (ctx.user as any).id;

      // Check: user must be ADMIN in at least one existing project, OR no projects exist yet
      const existingMemberships = await ctx.prisma.projectMember.findMany({
        where: { userId },
        select: { role: true },
      });
      const isAdminAnywhere = existingMemberships.some((m) => m.role === "ADMIN");
      const noProjectsExist = existingMemberships.length === 0;

      if (!isAdminAnywhere && !noProjectsExist) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ ADMIN mới được tạo dự án mới" });
      }

      // Check if project code already exists
      const existing = await ctx.prisma.project.findUnique({
        where: { code: input.code.toUpperCase() },
        include: { members: { where: { userId }, take: 1 } },
      });

      if (existing) {
        // Project exists — check if user is already a member
        if (existing.members.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: `Mã dự án "${input.code.toUpperCase()}" đã tồn tại và bạn đã là thành viên.` });
        }
        // Project exists but user is NOT a member → add as ADMIN
        await ctx.prisma.projectMember.create({
          data: { userId, projectId: existing.id, role: "ADMIN" },
        });
        // Update name/description if provided
        const result = await ctx.prisma.project.update({
          where: { id: existing.id },
          data: {
            ...(input.name ? { name: input.name } : {}),
            ...(input.description ? { description: input.description } : {}),
          },
        });
        await createAuditLog({ action: "CREATE", entity: "Project", entityId: result.id, userId, projectId: result.id, changes: { code: result.code, action: "joined_existing" } });
        return result;
      }

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

  // List ALL projects with stats (admin page)
  listAll: protectedProcedure
    .query(async ({ ctx }) => {
      const userId = (ctx.user as any).id;
      // Check user is admin in at least one project
      const adminMembership = await ctx.prisma.projectMember.findFirst({
        where: { userId, role: "ADMIN" },
      });
      if (!adminMembership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ ADMIN mới xem được" });
      }

      return ctx.prisma.project.findMany({
        include: {
          _count: {
            select: {
              members: true,
              servers: true,
              paypalAccounts: true,
              fundTransactions: true,
              withdrawals: true,
              costRecords: true,
              gmailAccounts: true,
              proxyIPs: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });
    }),

  // Delete project + ALL related data
  deleteProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = (ctx.user as any).id;
      // Must be ADMIN in this project
      const membership = await ctx.prisma.projectMember.findFirst({
        where: { userId, projectId: input.projectId, role: "ADMIN" },
      });
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ ADMIN của project mới được xóa" });
      }

      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        select: { code: true, name: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project không tồn tại" });

      // Delete in correct FK order (children first)
      await ctx.prisma.vMTask.deleteMany({ where: { vm: { server: { projectId: input.projectId } } } });
      await ctx.prisma.proxyAssignmentHistory.deleteMany({ where: { proxy: { projectId: input.projectId } } });
      await ctx.prisma.earnWithdrawal.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.fundTransaction.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.agentSale.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.withdrawal.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.agentPaypalEmail.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.payPalEmail.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.holderMergeTarget.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.virtualMachine.updateMany({ where: { server: { projectId: input.projectId } }, data: { gmailId: null, proxyId: null } });
      await ctx.prisma.virtualMachine.deleteMany({ where: { server: { projectId: input.projectId } } });
      await ctx.prisma.gmailAccount.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.payPalAccount.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.proxyIP.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.server.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.splitAllocation.deleteMany({ where: { split: { projectId: input.projectId } } });
      await ctx.prisma.profitSplit.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.partner.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.costRecord.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.deleteRequest.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.auditLog.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.projectMember.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.project.delete({ where: { id: input.projectId } });

      return { deleted: true, code: project.code, name: project.name };
    }),

  // Wipe all data in a project but keep the project + members
  wipeProjectData: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = (ctx.user as any).id;
      const membership = await ctx.prisma.projectMember.findFirst({
        where: { userId, projectId: input.projectId, role: "ADMIN" },
      });
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ ADMIN của project mới được xóa dữ liệu" });
      }

      const project = await ctx.prisma.project.findUnique({ where: { id: input.projectId }, select: { code: true } });

      // Delete order: children first, then parents (respect FK constraints)
      // 1. VM tasks (depends on VM)
      await ctx.prisma.vMTask.deleteMany({ where: { vm: { server: { projectId: input.projectId } } } });
      // 2. Proxy assignment history (depends on proxy + VM)
      await ctx.prisma.proxyAssignmentHistory.deleteMany({ where: { proxy: { projectId: input.projectId } } });
      // 3. Earn withdrawals (depends on gmail + paypal + server)
      await ctx.prisma.earnWithdrawal.deleteMany({ where: { projectId: input.projectId } });
      // 4. Fund transactions (depends on paypal + paypalEmail + server + VM)
      await ctx.prisma.fundTransaction.deleteMany({ where: { projectId: input.projectId } });
      // 5. Agent sales (depends on agentPaypalEmail)
      await ctx.prisma.agentSale.deleteMany({ where: { projectId: input.projectId } });
      // 6. Withdrawals (depends on paypal + agentPaypalEmail)
      await ctx.prisma.withdrawal.deleteMany({ where: { projectId: input.projectId } });
      // 7. Agent paypal emails
      await ctx.prisma.agentPaypalEmail.deleteMany({ where: { projectId: input.projectId } });
      // 8. PayPal emails (depends on paypal)
      await ctx.prisma.payPalEmail.deleteMany({ where: { projectId: input.projectId } });
      // 9. Holder merge targets (depends on paypal)
      await ctx.prisma.holderMergeTarget.deleteMany({ where: { projectId: input.projectId } });
      // 10. VMs (depends on server, proxy, gmail) — clear gmail refs first
      await ctx.prisma.virtualMachine.updateMany({ where: { server: { projectId: input.projectId } }, data: { gmailId: null, proxyId: null } });
      await ctx.prisma.virtualMachine.deleteMany({ where: { server: { projectId: input.projectId } } });
      // 11. Gmail accounts (depends on paypal via paypalId)
      await ctx.prisma.gmailAccount.deleteMany({ where: { projectId: input.projectId } });
      // 12. PayPal accounts
      await ctx.prisma.payPalAccount.deleteMany({ where: { projectId: input.projectId } });
      // 13. Proxies
      await ctx.prisma.proxyIP.deleteMany({ where: { projectId: input.projectId } });
      // 14. Servers
      await ctx.prisma.server.deleteMany({ where: { projectId: input.projectId } });
      // 15. Financial
      await ctx.prisma.splitAllocation.deleteMany({ where: { split: { projectId: input.projectId } } });
      await ctx.prisma.profitSplit.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.partner.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.costRecord.deleteMany({ where: { projectId: input.projectId } });
      // 16. Admin
      await ctx.prisma.deleteRequest.deleteMany({ where: { projectId: input.projectId } });
      await ctx.prisma.auditLog.deleteMany({ where: { projectId: input.projectId } });

      return { wiped: true, code: project?.code };
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

  // Create a new user with username + password (Admin or Moderator with canManageUsers)
  createUser: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        username: z.string().min(1).max(50).regex(/^[a-zA-Z0-9._-]+$/, "Username chỉ chứa chữ, số, dấu chấm, gạch ngang"),
        name: z.string().min(1),
        password: z.string().min(6),
        pin: z.string().min(4).max(6).regex(/^\d+$/).optional().or(z.literal("")),
        role: z.enum(["ADMIN", "MODERATOR", "USER"]),
        allowedModules: z.array(z.enum(APP_MODULES as unknown as [string, ...string[]])).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const callerRole = ctx.role;
      const callerId = (ctx.user as any).id;

      // Moderator restrictions
      if (callerRole === "MODERATOR") {
        if (!ctx.membership.canManageUsers) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Bạn chưa được cấp quyền quản lý user" });
        }
        if (input.role !== "USER") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Moderator chỉ tạo được user với role USER" });
        }
        // Can only assign modules within own allowedModules
        const myModules = ctx.membership.allowedModules || [];
        const invalidModules = input.allowedModules.filter((m: string) => !myModules.includes(m));
        if (invalidModules.length > 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: `Bạn không có quyền gán module: ${invalidModules.join(", ")}` });
        }
      }

      const hashedPassword = await bcrypt.hash(input.password, 10);
      const hashedPin = input.pin ? await bcrypt.hash(input.pin, 10) : undefined;

      // Check if username already exists
      const existing = await ctx.prisma.user.findFirst({
        where: { username: input.username },
      });

      let user;
      if (existing) {
        const updateData: any = { password: hashedPassword, name: input.name };
        if (hashedPin) updateData.pin = hashedPin;
        user = await ctx.prisma.user.update({
          where: { id: existing.id },
          data: updateData,
        });
      } else {
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

      // Get caller's membership ID for managerId
      let managerId: string | undefined;
      if (callerRole === "MODERATOR") {
        const callerMember = await ctx.prisma.projectMember.findFirst({
          where: { userId: callerId, projectId: input.projectId },
          select: { id: true },
        });
        managerId = callerMember?.id;
      }

      // Add to project
      const member = await ctx.prisma.projectMember.upsert({
        where: { userId_projectId: { userId: user.id, projectId: input.projectId } },
        update: { role: input.role, allowedModules: input.allowedModules, ...(managerId ? { managerId } : {}) },
        create: {
          userId: user.id,
          projectId: input.projectId,
          role: input.role,
          allowedModules: input.allowedModules,
          ...(managerId ? { managerId } : {}),
        },
        include: { user: true },
      });
      await createAuditLog({ action: "CREATE", entity: "User", entityId: user.id, userId: callerId, projectId: input.projectId, changes: { username: input.username, name: input.name, role: input.role } });
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

  updateMember: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        memberId: z.string(),
        role: z.enum(["ADMIN", "MODERATOR", "USER"]).optional(),
        allowedModules: z.array(z.enum(APP_MODULES as unknown as [string, ...string[]])).optional(),
        canManageUsers: z.boolean().optional(),
        managerId: z.string().nullable().optional(),
        maxAutotypeDevices: z.number().int().min(1).max(20).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const callerRole = ctx.role;
      const callerId = (ctx.user as any).id;

      // Moderator restrictions
      if (callerRole === "MODERATOR") {
        if (!ctx.membership.canManageUsers) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Bạn chưa được cấp quyền quản lý user" });
        }
        // Can only edit team members
        const target = await ctx.prisma.projectMember.findUnique({ where: { id: input.memberId } });
        const callerMember = await ctx.prisma.projectMember.findFirst({
          where: { userId: callerId, projectId: input.projectId },
          select: { id: true, allowedModules: true },
        });
        if (!target || target.managerId !== callerMember?.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Bạn chỉ quản lý user trong nhóm của mình" });
        }
        // Can only set USER role
        if (input.role && input.role !== "USER") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Moderator chỉ set được role USER" });
        }
        // Can't toggle canManageUsers or reassign manager
        if (input.canManageUsers !== undefined || input.managerId !== undefined) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ Admin mới thay đổi được quyền này" });
        }
        // Module scope check
        if (input.allowedModules) {
          const myModules = callerMember?.allowedModules || [];
          const invalidModules = input.allowedModules.filter((m: string) => !myModules.includes(m));
          if (invalidModules.length > 0) {
            throw new TRPCError({ code: "FORBIDDEN", message: `Bạn không có quyền gán module: ${invalidModules.join(", ")}` });
          }
        }
      }

      const data: any = {};
      if (input.role) data.role = input.role;
      if (input.allowedModules) data.allowedModules = input.allowedModules;
      if (input.canManageUsers !== undefined) data.canManageUsers = input.canManageUsers;
      if (input.managerId !== undefined) data.managerId = input.managerId;
      if (input.maxAutotypeDevices !== undefined) data.maxAutotypeDevices = input.maxAutotypeDevices;
      const result = await ctx.prisma.projectMember.update({
        where: { id: input.memberId },
        data,
        include: { user: true },
      });
      await createAuditLog({ action: "UPDATE", entity: "ProjectMember", entityId: input.memberId, userId: callerId, projectId: input.projectId, changes: data });
      return result;
    }),

  removeMember: moderatorProcedure
    .input(z.object({ projectId: z.string(), memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const callerRole = ctx.role;
      const callerId = (ctx.user as any).id;

      if (callerRole === "MODERATOR") {
        if (!ctx.membership.canManageUsers) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Bạn chưa được cấp quyền quản lý user" });
        }
        const callerMember = await ctx.prisma.projectMember.findFirst({
          where: { userId: callerId, projectId: input.projectId },
          select: { id: true },
        });
        const target = await ctx.prisma.projectMember.findUnique({ where: { id: input.memberId } });
        if (!target || target.managerId !== callerMember?.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Bạn chỉ xóa được user trong nhóm của mình" });
        }
      }

      const member = await ctx.prisma.projectMember.findUnique({ where: { id: input.memberId }, include: { user: { select: { username: true, name: true } } } });
      await createAuditLog({ action: "DELETE", entity: "ProjectMember", entityId: input.memberId, userId: callerId, projectId: input.projectId, changes: { removedUser: member?.user?.username || member?.user?.name } });
      return ctx.prisma.projectMember.delete({
        where: { id: input.memberId },
      });
    }),

  // List users in this project (admin sees all, moderator sees team)
  listUsers: moderatorProcedure
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

  // Update user info (name, username)
  updateUserInfo: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        userId: z.string(),
        name: z.string().min(1).optional(),
        username: z.string().min(1).max(50).regex(/^[a-zA-Z0-9._-]+$/, "Username chỉ chứa chữ, số, dấu chấm, gạch ngang").optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const callerRole = ctx.role;
      const callerId = (ctx.user as any).id;

      // Verify user belongs to project
      const targetMember = await ctx.prisma.projectMember.findFirstOrThrow({
        where: { projectId: input.projectId, userId: input.userId },
      });

      // Moderator: can only edit team members
      if (callerRole === "MODERATOR") {
        if (!ctx.membership.canManageUsers) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Bạn chưa được cấp quyền quản lý user" });
        }
        const callerMember = await ctx.prisma.projectMember.findFirst({
          where: { userId: callerId, projectId: input.projectId },
          select: { id: true },
        });
        if (targetMember.managerId !== callerMember?.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Bạn chỉ sửa được user trong nhóm của mình" });
        }
      }

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
