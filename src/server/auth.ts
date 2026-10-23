import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { openWebSession, revokeWebSession } from "./users/access";

// Lock duration — 30 minutes. Admin can still unlock earlier via adminUnlockAccount.
export const LOCK_DURATION_MS = 30 * 60 * 1000;

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
        code: { label: "2FA code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        // Try username first, then email for backward compat
        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { username: credentials.username },
              { email: credentials.username },
            ],
          },
        });
        if (!user || !user.password) return null;

        // Lock check — 30 min auto-expire, admin can unlock earlier
        let currentFailedCount = user.loginFailedCount || 0;
        if (user.loginLockedAt) {
          const lockExpiry = user.loginLockedAt.getTime() + LOCK_DURATION_MS;
          const msLeft = lockExpiry - Date.now();
          if (msLeft > 0) {
            const minsLeft = Math.ceil(msLeft / 60000);
            throw new Error(`ACCOUNT_LOCKED: Tài khoản bị khóa — còn ${minsLeft} phút. Liên hệ admin để mở khóa sớm.`);
          }
          // Lock expired — auto-unlock (treat as fresh attempt)
          await prisma.user.update({
            where: { id: user.id },
            data: { loginLockedAt: null, loginFailedCount: 0 },
          });
          currentFailedCount = 0;
        }

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) {
          // Increment failed counter; lock if >= 3
          const newCount = currentFailedCount + 1;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              loginFailedCount: newCount,
              loginLockedAt: newCount >= 3 ? new Date() : null,
            },
          });
          if (newCount >= 3) {
            throw new Error("ACCOUNT_LOCKED: Đã sai 3 lần — tài khoản bị khóa 30 phút. Liên hệ admin để mở khóa sớm.");
          }
          throw new Error(`INVALID_CREDENTIALS: Sai mật khẩu (còn ${3 - newCount} lần trước khi bị khóa 30 phút)`);
        }

        // Disabled by an ADMIN (22/10/2026): said only after the right password, never unlocked by time.
        if (user.disabledAt) throw new Error("ACCOUNT_DISABLED: Tài khoản đã bị vô hiệu hoá. Liên hệ quản trị.");

        // 2FA at sign-in (owner decision 23/10/2026): with 2FA on, the password alone is not a sign-in. The form asks for the code
        // only after TOTP_REQUIRED; wrong codes share the 3 → 30 minutes rule of the unlock.
        let totpVersion: number | null = null;
        if (user.totpEnabledAt) {
          const code = (credentials as { code?: string }).code?.trim();
          if (!code) throw new Error("TOTP_REQUIRED: Nhập mã Google Authenticator");
          const { checkTotp, totpMessage } = await import("./users/totp");
          const t = await checkTotp(prisma, user.id, code);
          if (t.result !== "OK") throw new Error("TOTP_INVALID: " + totpMessage(t.result, user.totpLockedAt));
          totpVersion = t.totpVersion;
        }

        // Success — reset counter
        if (currentFailedCount > 0) {
          await prisma.user.update({
            where: { id: user.id },
            data: { loginFailedCount: 0 },
          });
        }

        return { id: user.id, email: user.email, name: user.name, totpVersion };
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (token) {
        (session.user as any).id = token.userId;
        (session.user as any).memberships = token.memberships;
        // Name and login come from the DB on every refresh, so a rename shows without signing in again.
        if (session.user) session.user.name = (token.name as string | null | undefined) ?? session.user.name;
        (session.user as any).username = token.username ?? null;
        (session as any).sid = token.sid ?? null;
      }
      return session;
    },
    async jwt({ token, user }) {
      // Always refresh memberships from DB to get latest role/modules
      const userId = (user as any)?.id ?? token.userId;
      // A new sign-in opens its server session (22/10/2026); the token carries only its id. Checked on every request (trpc.ts).
      if ((user as any)?.id) {
        const s = await openWebSession(prisma, (user as any).id);
        token.sid = s.id;
        // The code given at sign-in also unlocks this session (no second prompt right after signing in).
        const v = (user as any).totpVersion;
        if (typeof v === "number") { const { unlockWebSessionTotp } = await import("./users/totp"); await unlockWebSessionTotp(prisma, s.id, (user as any).id, v, true); }
      }
      if (userId) {
        const dbUser = await prisma.user.findUnique({
          where: { id: userId as string },
          include: {
            memberships: {
              include: { project: true },
            },
          },
        });
        if (dbUser) {
          token.userId = dbUser.id;
          token.email = dbUser.email;
          token.name = dbUser.name;
          token.username = dbUser.username;
          token.memberships = dbUser.memberships;
        }
      }
      return token;
    },
  },
  events: {
    async signOut({ token }) {
      const sid = (token as any)?.sid;
      if (sid) await revokeWebSession(prisma, sid, "SIGN_OUT");
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
};
