import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import bcrypt from "bcryptjs";

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

  // Admin: reset PIN for any user
  adminResetPin: adminProcedure
    .input(
      z.object({
        projectId: z.string(),
        userId: z.string(),
        newPin: z.string().min(4).max(6).regex(/^\d+$/, "PIN must be digits only"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const hashedPin = await bcrypt.hash(input.newPin, 10);
      await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { pin: hashedPin },
      });
      return { success: true };
    }),

  // Admin: reset password for any user
  adminResetPassword: adminProcedure
    .input(
      z.object({
        projectId: z.string(),
        userId: z.string(),
        newPassword: z.string().min(6),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const hashedPassword = await bcrypt.hash(input.newPassword, 10);
      await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { password: hashedPassword },
      });
      return { success: true };
    }),

  // Admin: get online users (active in last 5 minutes)
  onlineUsers: adminProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const members = await ctx.prisma.projectMember.findMany({
        where: { projectId: input.projectId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              lastActiveAt: true,
              pin: true, // just to check hasPin
            },
          },
        },
      });
      return members.map((m) => ({
        memberId: m.id,
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        hasPin: !!m.user.pin,
        isOnline: m.user.lastActiveAt ? m.user.lastActiveAt > fiveMinAgo : false,
        lastActiveAt: m.user.lastActiveAt,
      }));
    }),
});
