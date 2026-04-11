import { z } from "zod";
import { router, protectedProcedure, moderatorProcedure } from "../trpc";
import bcrypt from "bcryptjs";
import { createAuditLog } from "@/lib/audit";

export const userRouter = router({
  // Check if current user has PIN set
  hasPin: protectedProcedure.query(async ({ ctx }) => {
    const userId = (ctx.user as any).id;
    const user = await ctx.prisma.user.findUnique({
      where: { id: userId },
      select: { pin: true },
    });
    return { hasPin: !!user?.pin };
  }),

  // Set or update own PIN
  setPin: protectedProcedure
    .input(
      z.object({
        pin: z.string().min(4).max(6).regex(/^\d+$/, "PIN must be digits only"),
        currentPin: z.string().optional(), // required if updating existing PIN
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = (ctx.user as any).id;
      const user = await ctx.prisma.user.findUnique({
        where: { id: userId },
        select: { pin: true },
      });

      // If user already has PIN, verify current PIN
      if (user?.pin) {
        if (!input.currentPin) {
          throw new Error("Current PIN required to update");
        }
        const valid = await bcrypt.compare(input.currentPin, user.pin);
        if (!valid) throw new Error("Current PIN is incorrect");
      }

      const hashedPin = await bcrypt.hash(input.pin, 10);
      await ctx.prisma.user.update({
        where: { id: userId },
        data: { pin: hashedPin },
      });
      return { success: true };
    }),

  // Verify PIN (for sensitive actions)
  verifyPin: protectedProcedure
    .input(z.object({ pin: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = (ctx.user as any).id;
      const user = await ctx.prisma.user.findUnique({
        where: { id: userId },
        select: { pin: true },
      });
      if (!user?.pin) throw new Error("PIN not set");
      const valid = await bcrypt.compare(input.pin, user.pin);
      if (!valid) throw new Error("Incorrect PIN");
      return { valid: true };
    }),

  // Change own password
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(6),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = (ctx.user as any).id;
      const user = await ctx.prisma.user.findUnique({
        where: { id: userId },
        select: { password: true },
      });
      if (!user?.password) throw new Error("No password set");
      const valid = await bcrypt.compare(input.currentPassword, user.password);
      if (!valid) throw new Error("Current password is incorrect");
      const hashedPassword = await bcrypt.hash(input.newPassword, 10);
      await ctx.prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });
      return { success: true };
    }),

  // Heartbeat - update lastActiveAt
  heartbeat: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = (ctx.user as any).id;
    await ctx.prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: new Date() },
    });
    return { ok: true };
  }),

  // ─── Admin endpoints ───

  // Admin/Moderator: reset PIN for user (moderator: team only)
  adminResetPin: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        userId: z.string(),
        newPin: z.string().min(4).max(6).regex(/^\d+$/, "PIN must be digits only"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const callerRole = ctx.role;
      const callerId = (ctx.user as any).id;
      if (callerRole === "MODERATOR") {
        const callerMember = await ctx.prisma.projectMember.findFirst({ where: { userId: callerId, projectId: input.projectId }, select: { id: true } });
        const target = await ctx.prisma.projectMember.findFirst({ where: { userId: input.userId, projectId: input.projectId } });
        if (!target || !callerMember || target.managerId !== callerMember.id) {
          throw new Error("Bạn chỉ reset PIN cho user trong nhóm của mình");
        }
      }
      const hashedPin = await bcrypt.hash(input.newPin, 10);
      await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { pin: hashedPin },
      });
      await createAuditLog({ action: "RESET_PIN", entity: "User", entityId: input.userId, userId: callerId, projectId: input.projectId, changes: { targetUserId: input.userId } });
      return { success: true };
    }),

  // Admin/Moderator: reset password for user (moderator: team only)
  adminResetPassword: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        userId: z.string(),
        newPassword: z.string().min(6),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const callerRole = ctx.role;
      const callerId = (ctx.user as any).id;
      if (callerRole === "MODERATOR") {
        const callerMember = await ctx.prisma.projectMember.findFirst({ where: { userId: callerId, projectId: input.projectId }, select: { id: true } });
        const target = await ctx.prisma.projectMember.findFirst({ where: { userId: input.userId, projectId: input.projectId } });
        if (!target || !callerMember || target.managerId !== callerMember.id) {
          throw new Error("Bạn chỉ reset password cho user trong nhóm của mình");
        }
      }
      const hashedPassword = await bcrypt.hash(input.newPassword, 10);
      await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { password: hashedPassword },
      });
      await createAuditLog({ action: "RESET_PASSWORD", entity: "User", entityId: input.userId, userId: callerId, projectId: input.projectId, changes: { targetUserId: input.userId } });
      return { success: true };
    }),

  // Admin: kick autotype session
  kickAutotypeSession: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      userId: z.string(),
      deviceId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.autotypeSession.deleteMany({
        where: { userId: input.userId, deviceId: input.deviceId },
      });
      return { success: true };
    }),

  // Admin: kick all autotype sessions for a user
  kickAllAutotypeSessions: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      userId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.autotypeSession.deleteMany({
        where: { userId: input.userId },
      });
      return { success: true };
    }),

  // Admin/Moderator: get online users
  onlineUsers: moderatorProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const members = await ctx.prisma.projectMember.findMany({
        where: { projectId: input.projectId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              name: true,
              lastActiveAt: true,
              pin: true,
            },
          },
        },
      });

      // Get autotype session counts for all users in this project
      const userIds = members.map((m) => m.user.id);
      const autotypeSessions = await ctx.prisma.autotypeSession.findMany({
        where: {
          userId: { in: userIds },
          lastActiveAt: { gt: sevenDaysAgo },
        },
        select: { userId: true, deviceId: true, deviceName: true, lastActiveAt: true },
      });

      // Group sessions by userId
      const sessionMap = new Map<string, typeof autotypeSessions>();
      autotypeSessions.forEach((s) => {
        const list = sessionMap.get(s.userId) || [];
        list.push(s);
        sessionMap.set(s.userId, list);
      });

      return members.map((m) => {
        const sessions = sessionMap.get(m.user.id) || [];
        return {
          memberId: m.id,
          userId: m.user.id,
          email: m.user.email,
          username: m.user.username,
          name: m.user.name,
          role: m.role,
          allowedModules: m.allowedModules,
          canManageUsers: m.canManageUsers,
          managerId: m.managerId,
          maxAutotypeDevices: m.maxAutotypeDevices,
          agentFeePercent: m.agentFeePercent ? Number(m.agentFeePercent) : null,
          hasPin: !!m.user.pin,
          isOnline: m.user.lastActiveAt ? m.user.lastActiveAt > fiveMinAgo : false,
          lastActiveAt: m.user.lastActiveAt,
          autotypeActiveDevices: sessions.length,
          autotypeSessions: sessions.map((s) => ({
            deviceId: s.deviceId,
            deviceName: s.deviceName,
            lastActiveAt: s.lastActiveAt,
          })),
        };
      });
    }),

  // User detail page
  getDetail: moderatorProcedure
    .input(z.object({ projectId: z.string(), userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: {
          id: true, email: true, username: true, name: true, pin: true, lastActiveAt: true, createdAt: true,
          memberships: {
            include: { project: { select: { id: true, code: true, name: true } } },
          },
        },
      });

      // Current project membership
      const membership = user.memberships.find((m) => m.projectId === input.projectId);

      // Agent emails
      const agentEmails = await ctx.prisma.agentPaypalEmail.findMany({
        where: { userId: input.userId, projectId: input.projectId },
        orderBy: { createdAt: "desc" },
      });

      // Agent sales stats
      const agentSales = await ctx.prisma.agentSale.findMany({
        where: { agentUserId: input.userId, projectId: input.projectId },
        orderBy: { date: "desc" },
        take: 50,
        include: { agentEmail: { select: { email: true } } },
      });
      const totalEarning = agentSales.reduce((s, r) => s + Number(r.agentEarning ?? 0), 0);
      const totalWithdrawn = agentSales.filter((s) => s.withdrawn).reduce((s, r) => s + Number(r.agentEarning ?? 0), 0);
      const totalSold = agentSales.reduce((s, r) => s + Number(r.amount), 0);

      // AutoType sessions
      const sessions = await ctx.prisma.autotypeSession.findMany({
        where: { userId: input.userId },
        orderBy: { lastActiveAt: "desc" },
        take: 20,
      });

      // Edit history by this user
      const editHistory = await ctx.prisma.editHistory.findMany({
        where: { userId: input.userId, projectId: input.projectId },
        orderBy: { createdAt: "desc" },
        take: 30,
      });

      // Fund transactions created/confirmed (recent)
      const recentFunds = await ctx.prisma.fundTransaction.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, amount: true, confirmed: true, date: true, transactionId: true, paypal: { select: { code: true } } },
      });

      // Collector expenses (cross-project for admin view)
      const collectorExpenses = await ctx.prisma.collectorExpense.findMany({
        where: { collectorId: input.userId },
        orderBy: { date: "desc" },
        take: 50,
        include: {
          project: { select: { id: true, code: true } },
          withdrawals: { select: { id: true, transactionId: true, amount: true } },
        },
      });

      // Agent withdrawals (cross-project, where this user is recipient)
      const agentEmailIds = (await ctx.prisma.agentPaypalEmail.findMany({
        where: { userId: input.userId },
        select: { id: true },
      })).map((e) => e.id);
      const agentWithdrawals = agentEmailIds.length > 0 ? await ctx.prisma.withdrawal.findMany({
        where: {
          type: "EXCHANGE",
          OR: [
            { agentEmailId: { in: agentEmailIds } },
            { agentUserId: input.userId },
          ],
        },
        orderBy: { date: "desc" },
        take: 50,
        select: {
          id: true, date: true, amount: true, paypalFee: true, paypalFeeSetAt: true,
          transactionId: true, collectorNote: true, paidToTeam: true, projectId: true,
          sourcePaypal: { select: { code: true } },
          project: { select: { code: true } },
          agentEmail: { select: { email: true } },
        },
      }) : [];

      return {
        user: { ...user, hasPin: !!user.pin, pin: undefined },
        membership,
        agentEmails,
        agentSales,
        agentStats: { totalEarning, totalWithdrawn, pending: totalEarning - totalWithdrawn, totalSold, count: agentSales.length },
        sessions,
        editHistory,
        recentFunds: recentFunds.slice(0, 50),
        collectorExpenses,
        agentWithdrawals,
      };
    }),

  // Reset PIN for a user
  resetPin: moderatorProcedure
    .input(z.object({ projectId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.user.update({ where: { id: input.userId }, data: { pin: null } });
      await createAuditLog({ action: "RESET_PIN", entity: "User", entityId: input.userId, userId: (ctx.user as any).id, projectId: input.projectId });
      return { success: true };
    }),

  // Reset password for a user
  resetPassword: moderatorProcedure
    .input(z.object({ projectId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const newPassword = Math.random().toString(36).slice(2, 10);
      const hashed = await bcrypt.hash(newPassword, 10);
      await ctx.prisma.user.update({ where: { id: input.userId }, data: { password: hashed } });
      await createAuditLog({ action: "RESET_PASSWORD", entity: "User", entityId: input.userId, userId: (ctx.user as any).id, projectId: input.projectId });
      return { newPassword };
    }),
});
