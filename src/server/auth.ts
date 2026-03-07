import { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      if (!profile?.email) return false;
      // Invite-only: only allow users that exist in DB
      const user = await prisma.user.findUnique({
        where: { email: profile.email },
      });
      return !!user;
    },
    async session({ session, token }) {
      if (token) {
        (session.user as any).id = token.userId;
        (session.user as any).memberships = token.memberships;
      }
      return session;
    },
    async jwt({ token, profile, trigger }) {
      // Load user data on sign-in or when session is updated
      if (profile?.email || trigger === "update") {
        const email = profile?.email ?? token.email;
        if (email) {
          const dbUser = await prisma.user.findUnique({
            where: { email },
            include: {
              memberships: {
                include: { project: true },
              },
            },
          });
          if (dbUser) {
            token.userId = dbUser.id;
            token.memberships = dbUser.memberships;
          }
        }
      }
      return token;
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
