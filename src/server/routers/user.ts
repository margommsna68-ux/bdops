import { z } from "zod";
import { router, protectedProcedure, moderatorProcedure } from "../trpc";
import bcrypt from "bcryptjs";

import { createAuditLog } from "@/lib/audit";
import { LOCK_DURATION_MS } from "../auth";
import { accountState, setOwnPin, setUserDisabled, unlockWebSession } from "../users/access";
import { checkPinVersion } from "../business-management/pin";
import { adminProcedure } from "../trpc";
// The web session of an HTTP call (trpc.ts createTRPCContext), when there is one.
const webSessionId = (ctx: { web?: unknown }) => { const w = ctx.web as { sessionId?: string } | null | undefined; return w && typeof w.sessionId === "string" ? w.sessionId : null; };

export const userRouter = router({
  // Check if current user has PIN set
  hasPin: protectedProcedure.query(async ({ ctx }) => {
    const userId = (ctx.user as any).id;
    const user = await ctx.prisma.user.findUnique({
      where: { id: userId },
      select: { pin: true },
    });
    // unlocked: the PIN was proved on THIS server session for the current PIN version (22/10/2026); never a client flag.
    const w = (ctx as { web?: unknown }).web as { pinUnlocked?: boolean } | null | undefined;
    return { hasPin: !!user?.pin, unlocked: !!user?.pin && (w && "pinUnlocked" in w ? !!w.pinUnlocked : true) };
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
      // Review fix 22/10/2026: a first PIN or a change proved by the current PIN through the shared PIN rule (count + lock); the new hash and
      // version are written together on the version that was proved; this session is unlocked with the new version.
      try { await setOwnPin(ctx.prisma, userId, await bcrypt.hash(input.pin, 12), input.currentPin, webSessionId(ctx)); }
      catch (e) { throw new Error(e instanceof Error ? e.message : "Không đổi được PIN"); }
      return { success: true };
    }),

  // Verify PIN (for sensitive actions)
  verifyPin: protectedProcedure
    .input(z.object({ pin: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = (ctx.user as any).id;
      // One rule with the ops API (pin.ts, review fix 21/10/2026): concurrent checks are decided on the user row as it is then.
      const { result: r, pinVersion } = await checkPinVersion(ctx.prisma, userId, input.pin);
      if (r === "NOT_SET") throw new Error("PIN not set");
      if (r === "LOCKED") {
        const u = await ctx.prisma.user.findUnique({ where: { id: userId }, select: { pinLockedAt: true } });
        const minsLeft = u?.pinLockedAt ? Math.max(1, Math.ceil((u.pinLockedAt.getTime() + LOCK_DURATION_MS - Date.now()) / 60000)) : 30;
        throw new Error(`PIN_LOCKED: PIN bị khóa — còn ${minsLeft} phút. Liên hệ admin để mở khóa sớm.`);
      }
      if (r === "LOCKED_NOW") throw new Error("PIN_LOCKED: Đã sai 3 lần — PIN bị khóa 30 phút. Liên hệ admin để mở khóa sớm.");
      if (r === "INVALID") {
        const u = await ctx.prisma.user.findUnique({ where: { id: userId }, select: { pinFailedCount: true } });
        throw new Error(`Sai PIN (còn ${Math.max(1, 3 - (u?.pinFailedCount ?? 0))} lần trước khi bị khóa 30 phút)`);
      }
      // The unlock belongs to this server session and to the PIN version just verified (review fix 22/10/2026): a PIN changed meanwhile is refused.
      const sid = webSessionId(ctx);
      if (sid && !(await unlockWebSession(ctx.prisma, sid, userId, pinVersion))) throw new Error("PIN vừa được đổi hoặc tài khoản vừa thay đổi; nhập lại PIN");
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
      const hashedPassword = await bcrypt.hash(input.newPassword, 12);
      await ctx.prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword, loginFailedCount: 0, loginLockedAt: null },
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
      // "Đặt PIN" / "Đổi PIN" (22/10/2026): the new PIN replaces the old one; older PIN unlocks of that user stop working.
      const had = !!(await ctx.prisma.user.findUnique({ where: { id: input.userId }, select: { pin: true } }))?.pin;
      const hashedPin = await bcrypt.hash(input.newPin, 12);
      await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { pin: hashedPin, pinFailedCount: 0, pinLockedAt: null, pinVersion: { increment: 1 } },
      });
      await createAuditLog({ action: had ? "CHANGE_PIN" : "SET_PIN", entity: "User", entityId: input.userId, userId: callerId, projectId: input.projectId, changes: { targetUserId: input.userId } });
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
      const hashedPassword = await bcrypt.hash(input.newPassword, 12);
      await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { password: hashedPassword, loginFailedCount: 0, loginLockedAt: null },
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
              disabledAt: true,
            },
          },
        },
      });
      // Ops tokens in force in this project, per user (22/10/2026: shown on Nhân viên).
      const tokenRows = await ctx.prisma.opsToken.groupBy({ by: ["userId"], where: { projectIds: { has: input.projectId }, revokedAt: null, expiresAt: { gt: new Date() } }, _count: { _all: true } });

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
          agentFeePercent: m.agentFeePercent != null ? Number(m.agentFeePercent) : null,
          hasPin: !!m.user.pin,
          disabled: !!m.user.disabledAt,
          activeTokens: tokenRows.find((t) => t.userId === m.user.id)?._count._all ?? 0,
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
          id: true, email: true, username: true, name: true, lastActiveAt: true, createdAt: true,
          loginFailedCount: true, loginLockedAt: true, pinFailedCount: true, pinLockedAt: true,
          memberships: {
            where:{project:{members:{some:{userId:ctx.user.id}}}},
            include: { project: { select: { id: true, code: true, name: true } } },
          },
        },
      });
      // Separately check if PIN exists (never load the hash into main user object)
      const pinCheck = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        select: { pin: true },
      });
      const hasPin = !!pinCheck?.pin;

      // Current project membership
      const membership = user.memberships.find((m) => m.projectId === input.projectId);
      const can=(module:string)=>ctx.role==='ADMIN'||ctx.membership.allowedModules.includes(module),managed=(ctx.membership.project.settings as {businessMode?:string}|null)?.businessMode==='PROXY_VM'||!!await ctx.prisma.operationJournal.findFirst({where:{projectId:input.projectId,kind:{startsWith:'BUSINESS_'}},select:{id:true}}),agent=can('AGENT_PP')&&!managed;

      // Agent emails
      const agentEmails = agent?await ctx.prisma.agentPaypalEmail.findMany({
        where: { userId: input.userId, projectId: input.projectId },
        orderBy: { createdAt: "desc" },
      }):[];

      // Agent sales stats
      const agentSales = agent?await ctx.prisma.agentSale.findMany({
        where: { agentUserId: input.userId, projectId: input.projectId },
        orderBy: { date: "desc" },
        take: 50,
        include: { agentEmail: { select: { email: true } } },
      }):[];
      const totalEarning = agentSales.reduce((s, r) => s + Number(r.agentEarning ?? 0), 0);
      const totalWithdrawn = agentSales.filter((s) => s.withdrawn).reduce((s, r) => s + Number(r.agentEarning ?? 0), 0);
      const totalSold = agentSales.reduce((s, r) => s + Number(r.amount), 0);

      // AutoType sessions
      const sessions = can('AUTOTYPE')?await ctx.prisma.autotypeSession.findMany({
        where: { userId: input.userId },
        orderBy: { lastActiveAt: "desc" },
        take: 20,
      }):[];

      // Edit history by this user
      const editHistory = ctx.role==='ADMIN'&&!managed?await ctx.prisma.editHistory.findMany({
        where: { userId: input.userId, projectId: input.projectId },
        orderBy: { createdAt: "desc" },
        take: 30,
      }):[];

      // Fund transactions created/confirmed (recent)
      const recentFunds = can('FUNDS')?await ctx.prisma.fundTransaction.findMany({
        where: { projectId: input.projectId,voidedAt:null },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, amount: true, confirmed: true, date: true, transactionId: true, paypal: { select: { code: true } } },
      }):[];

      // Collector expenses (cross-project for admin view)
      const collectorExpenses = agent?await ctx.prisma.collectorExpense.findMany({
        where: { collectorId: input.userId,projectId:input.projectId },
        orderBy: { date: "desc" },
        take: 50,
        include: {
          project: { select: { id: true, code: true, name: true } },
          withdrawals: { select: { id: true, transactionId: true, amount: true } },
        },
      }):[];

      // Agent withdrawals (cross-project, where this user is recipient)
      const agentEmailIds = (await ctx.prisma.agentPaypalEmail.findMany({
        where: { userId: input.userId,projectId:input.projectId },
        select: { id: true },
      })).map((e) => e.id);
      const agentWithdrawals = agent&&agentEmailIds.length > 0 ? await ctx.prisma.withdrawal.findMany({
        where: {
          projectId:input.projectId,businessManaged:false,
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
          project: { select: { code: true, name: true } },
          agentEmail: { select: { email: true } },
        },
      }) : [];

      return {
        user: { ...user, hasPin },
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

  // "Xoá PIN" (22/10/2026: this removes the PIN; it is not a change). Without a PIN nothing that needs one goes through until a new PIN
  // is set; older PIN unlocks stop working.
  resetPin: moderatorProcedure
    .input(z.object({ projectId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.user.update({ where: { id: input.userId }, data: { pin: null, pinFailedCount: 0, pinLockedAt: null, pinVersion: { increment: 1 } } });
      await createAuditLog({ action: "REMOVE_PIN", entity: "User", entityId: input.userId, userId: (ctx.user as any).id, projectId: input.projectId });
      return { success: true };
    }),

  // Reset password for a user
  resetPassword: moderatorProcedure
    .input(z.object({ projectId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const newPassword = Math.random().toString(36).slice(2, 10);
      const hashed = await bcrypt.hash(newPassword, 12);
      await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { password: hashed, loginFailedCount: 0, loginLockedAt: null },
      });
      await createAuditLog({ action: "RESET_PASSWORD", entity: "User", entityId: input.userId, userId: (ctx.user as any).id, projectId: input.projectId });
      return { newPassword };
    }),

  // Admin/Moderator: unlock a locked account (login and/or PIN)
  adminUnlockAccount: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      userId: z.string(),
      type: z.enum(["LOGIN", "PIN", "BOTH"]).default("BOTH"),
    }))
    .mutation(async ({ ctx, input }) => {
      const callerRole = ctx.role;
      const callerId = (ctx.user as any).id;
      // Moderator can only unlock their team
      if (callerRole === "MODERATOR") {
        const callerMember = await ctx.prisma.projectMember.findFirst({
          where: { userId: callerId, projectId: input.projectId },
          select: { id: true },
        });
        const target = await ctx.prisma.projectMember.findFirst({
          where: { userId: input.userId, projectId: input.projectId },
        });
        if (!target || !callerMember || target.managerId !== callerMember.id) {
          throw new Error("Bạn chỉ mở khóa cho user trong nhóm của mình");
        }
      }
      const data: any = {};
      if (input.type === "LOGIN" || input.type === "BOTH") {
        data.loginFailedCount = 0;
        data.loginLockedAt = null;
      }
      if (input.type === "PIN" || input.type === "BOTH") {
        data.pinFailedCount = 0;
        data.pinLockedAt = null;
      }
      await ctx.prisma.user.update({ where: { id: input.userId }, data });
      await createAuditLog({
        action: "UNLOCK_ACCOUNT",
        entity: "User",
        entityId: input.userId,
        userId: callerId,
        projectId: input.projectId,
        changes: { type: input.type, targetUserId: input.userId },
      });
      return { success: true };
    }),

  // Admin/Moderator: list locked users in project (only those with ACTIVE lock)
  lockedUsers: moderatorProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const members = await ctx.prisma.projectMember.findMany({
        where: { projectId: input.projectId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              name: true,
              loginFailedCount: true,
              loginLockedAt: true,
              pinFailedCount: true,
              pinLockedAt: true,
            },
          },
        },
      });
      const now = Date.now();
      return members
        .map((m) => {
          // Filter out expired locks (lock > 30 min ago)
          const loginActive = m.user.loginLockedAt
            ? (m.user.loginLockedAt.getTime() + LOCK_DURATION_MS) > now
            : false;
          const pinActive = m.user.pinLockedAt
            ? (m.user.pinLockedAt.getTime() + LOCK_DURATION_MS) > now
            : false;
          return {
            userId: m.user.id,
            email: m.user.email,
            username: m.user.username,
            name: m.user.name,
            loginLockedAt: loginActive ? m.user.loginLockedAt : null,
            pinLockedAt: pinActive ? m.user.pinLockedAt : null,
            active: loginActive || pinActive,
          };
        })
        .filter((u) => u.active);
    }),
  // ─── Account access (owner brief 22/10/2026) ───
  // Short state of a member of this project for the user page: role, account state, PIN set, ops tokens in force (this project).
  access: moderatorProcedure
    .input(z.object({ projectId: z.string(), userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: input.userId }, select: { pin: true, disabledAt: true, disabledReason: true, loginLockedAt: true, pinLockedAt: true, memberships: { select: { projectId: true } } } });
      const tokens = await ctx.prisma.opsToken.count({ where: { userId: input.userId, projectIds: { has: input.projectId }, revokedAt: null, expiresAt: { gt: new Date() } } });
      const otherProjects = u.memberships.filter((m) => m.projectId !== input.projectId).length;
      // The viewer's own role and the project's mode, in THIS project (never the project picked elsewhere in the browser).
      const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { name: true, code: true, settings: true } });
      const target = await ctx.prisma.projectMember.findUnique({ where: { userId_projectId: { userId: input.userId, projectId: input.projectId } }, select: { id: true, role: true } });
      return { hasPin: !!u.pin, state: accountState(u, LOCK_DURATION_MS), loginLocked: !!u.loginLockedAt && u.loginLockedAt.getTime() + LOCK_DURATION_MS > Date.now(), pinLocked: !!u.pinLockedAt && u.pinLockedAt.getTime() + LOCK_DURATION_MS > Date.now(),
        disabledAt: u.disabledAt?.toISOString() ?? null, disabledReason: u.disabledReason, activeTokens: tokens, otherProjects, self: input.userId === (ctx.user as any).id,
        viewerRole: ctx.role, memberId: target?.id ?? null, memberRole: target?.role ?? null, project: { name: project.name, code: project.code, businessMode: (project.settings as { businessMode?: string } | null)?.businessMode ?? null },
        canDisable: ctx.role === "ADMIN" && input.userId !== (ctx.user as any).id };
    }),
  // Disable / enable the whole account (ADMIN of every project of the user: assertUserTarget in trpc.ts).
  setDisabled: adminProcedure
    .input(z.object({ projectId: z.string(), userId: z.string(), disabled: z.boolean(), reason: z.string().max(300).nullish() }))
    .mutation(async ({ ctx, input }) => {
      try { return await setUserDisabled(ctx.prisma, (ctx.user as any).id, input); }
      catch (e) { throw new Error(e instanceof Error ? e.message : "Không thực hiện được"); }
    }),
});
