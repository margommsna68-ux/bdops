import { initTRPC, TRPCError } from "@trpc/server";
import { type Session, getServerSession } from "next-auth";
import superjson from "superjson";
import { ZodError } from "zod";
import { authOptions } from "./auth";
import { prisma } from "@/lib/prisma";
import { type ProjectRole } from "@prisma/client";

export const APP_MODULES = [
  "FUNDS",
  "WITHDRAWALS",
  "PAYPALS",
  "INFRASTRUCTURE",
  "COSTS",
  "PROFIT",
  "AGENT_PP",
  "AUTOTYPE",
] as const;

export type AppModule = (typeof APP_MODULES)[number];

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

// Role hierarchy: ADMIN > MODERATOR > USER
const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  ADMIN: 3,
  MODERATOR: 2,
  USER: 1,
};

// Base middleware: verify project membership and extract role
const enforceProjectMember = enforceAuth.unstable_pipe(({ ctx, next, rawInput }) => {
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
  return next({
    ctx: {
      ...ctx,
      projectId,
      membership,
      role: membership.role as ProjectRole,
    },
  });
});

// Require minimum role (ADMIN or MODERATOR)
export function requireRole(minRole: ProjectRole) {
  return enforceProjectMember.unstable_pipe(({ ctx, next }) => {
    if (ROLE_HIERARCHY[ctx.role] < ROLE_HIERARCHY[minRole]) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Requires ${minRole} role or higher` });
    }
    return next({ ctx });
  });
}

// Require access to a specific module
export function requireModule(module: AppModule) {
  return enforceProjectMember.unstable_pipe(({ ctx, next }) => {
    // ADMIN has access to all modules
    if (ctx.role === "ADMIN") {
      return next({ ctx: { ...ctx, module } });
    }
    // MODERATOR and USER: check allowedModules
    const allowedModules: string[] = ctx.membership.allowedModules || [];
    if (!allowedModules.includes(module)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `No access to ${module} module` });
    }
    return next({ ctx: { ...ctx, module } });
  });
}

// Check if user can delete directly (ADMIN/MODERATOR) or needs approval (USER)
export function canDeleteDirectly(role: ProjectRole): boolean {
  return role === "ADMIN" || role === "MODERATOR";
}

// Exported procedures
export const memberProcedure = t.procedure.use(enforceProjectMember);
export const moderatorProcedure = t.procedure.use(requireRole("MODERATOR"));
export const adminProcedure = t.procedure.use(requireRole("ADMIN"));

// Module-specific procedures
export const fundsProcedure = t.procedure.use(requireModule("FUNDS"));
export const withdrawalsProcedure = t.procedure.use(requireModule("WITHDRAWALS"));
export const paypalsProcedure = t.procedure.use(requireModule("PAYPALS"));
export const infrastructureProcedure = t.procedure.use(requireModule("INFRASTRUCTURE"));
export const costsProcedure = t.procedure.use(requireModule("COSTS"));
export const profitProcedure = t.procedure.use(requireModule("PROFIT"));
export const agentPPProcedure = t.procedure.use(requireModule("AGENT_PP"));

// Keep backward compat alias
export const operatorProcedure = memberProcedure;
