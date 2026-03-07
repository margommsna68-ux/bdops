import { initTRPC, TRPCError } from "@trpc/server";
import { type Session, getServerSession } from "next-auth";
import superjson from "superjson";
import { ZodError } from "zod";
import { authOptions } from "./auth";
import { prisma } from "@/lib/prisma";
import { type ProjectRole } from "@prisma/client";

export type Context = {
  session: Session | null;
  prisma: typeof prisma;
};

export const createTRPCContext = async (): Promise<Context> => {
  const session = await getServerSession(authOptions);
  return { session, prisma };
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const enforceAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      session: ctx.session,
      user: ctx.session.user as Session["user"] & { id: string; memberships: any[] },
    },
  });
});

export const protectedProcedure = t.procedure.use(enforceAuth);

// Role-based procedures - check role for a specific project
const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  ADMIN: 5,
  MANAGER: 4,
  OPERATOR: 3,
  PARTNER: 2,
  VIEWER: 1,
};

export function requireRole(minRole: ProjectRole) {
  return enforceAuth.unstable_pipe(({ ctx, next, rawInput }) => {
    const input = rawInput as any;
    const projectId = input?.projectId;
    if (!projectId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "projectId required" });
    }
    const membership = (ctx.user.memberships as any[])?.find(
      (m: any) => m.projectId === projectId
    );
    if (!membership) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this project" });
    }
    if (ROLE_HIERARCHY[membership.role as ProjectRole] < ROLE_HIERARCHY[minRole]) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Requires ${minRole} role or higher` });
    }
    return next({
      ctx: {
        ...ctx,
        projectId,
        membership,
      },
    });
  });
}

export const operatorProcedure = t.procedure.use(requireRole("OPERATOR"));
export const managerProcedure = t.procedure.use(requireRole("MANAGER"));
export const adminProcedure = t.procedure.use(requireRole("ADMIN"));
