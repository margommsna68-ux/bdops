import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
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

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (token) {
        (session.user as any).id = token.userId;
        (session.user as any).memberships = token.memberships;
      }
      return session;
    },
    async jwt({ token, user }) {
      // Always refresh memberships from DB to get latest role/modules
      const userId = (user as any)?.id ?? token.userId;
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
          token.memberships = dbUser.memberships;
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
