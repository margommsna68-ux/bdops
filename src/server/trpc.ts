import { initTRPC, TRPCError } from "@trpc/server";
import { type Session, getServerSession } from "next-auth";
import superjson from "superjson";
import { ZodError } from "zod";
import { authOptions } from "./auth";
import { prisma } from "@/lib/prisma";
import { type ProjectRole } from "@prisma/client";
import {assertLegacyInfrastructureTargets} from './permissions/legacy-infrastructure';
import {assertUserTarget} from './permissions/user-target';
import {loadInfrastructureScope} from './permissions/infrastructure';
import {checkWebSession} from './users/access';

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

// web: set for HTTP requests (22/10/2026): the server session behind the JWT and whether its PIN unlock holds. Server-side callers
// (createCaller in jobs / tests) have no web session and are checked by the services themselves.
export type Context = {
  session: Session | null;
  prisma: typeof prisma;
  web?: { sessionId: string; pinUnlocked: boolean } | { ended: string } | null;
};

export const createTRPCContext = async (): Promise<Context> => {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!session?.user || !userId) return { session: null, prisma, web: null };
  const check = await checkWebSession(prisma, (session as any).sid, userId);
  if (!check.ok) return { session: null, prisma, web: { ended: check.reason } };
  return { session, prisma, web: { sessionId: check.sessionId, pinUnlocked: check.pinUnlocked } };
};
// Calls allowed before the PIN of this session is proved (they are how it gets proved / set).
const PIN_FREE = new Set(["user.hasPin", "user.verifyPin", "user.setPin", "user.securityStatus", "user.totpBegin", "user.totpConfirm"]);

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

const enforceAuth = t.middleware(({ ctx, next, path }) => {
  if (!ctx.session?.user) {
    const ended = ctx.web && "ended" in ctx.web ? ctx.web.ended : null;
    throw new TRPCError({ code: "UNAUTHORIZED", message: ended ? "SESSION_ENDED: " + (ended === "DISABLED" ? "Tài khoản đã bị vô hiệu hoá" : "Phiên đăng nhập đã hết; đăng nhập lại") : undefined });
  }
  if (ctx.web && "pinUnlocked" in ctx.web && !ctx.web.pinUnlocked && !PIN_FREE.has(path)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "PIN_REQUIRED: Nhập PIN để tiếp tục" });
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
  VIEWER: 0,
};

// Base middleware: verify project membership and extract role
const enforceProjectMember = enforceAuth.unstable_pipe(async ({ ctx, next, rawInput, type, path }) => {
  const input = rawInput as any;
  const projectId = input?.projectId;
  if (!projectId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "projectId required" });
  }
  const membership = await ctx.prisma.projectMember.findUnique({
    where: { userId_projectId: {userId:ctx.user.id,projectId} },
    include: { project:true },
  });
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this project" });
  }
  if (type === 'mutation' && membership.role === 'VIEWER') {
    throw new TRPCError({code:'FORBIDDEN',message:'Tài khoản chỉ xem không được thay đổi dữ liệu'});
  }
  const businessMode=(membership.project.settings as {businessMode?:string}|null)?.businessMode;
  const cashEnabled=(await loadInfrastructureScope(ctx.prisma,ctx.user.id,projectId)).teamCashEnabled;
  if(/^(gmail|paypal|paypalEmail|fund|withdrawal|cost|profitSplit|partner|earnWithdrawal|dashboard|editHistory|agentPP)\./.test(path)){
    const managedBusiness=businessMode==='PROXY_VM'||!cashEnabled&&await ctx.prisma.operationJournal.findFirst({where:{projectId,kind:{startsWith:'BUSINESS_'}},select:{id:true}});
    if(managedBusiness)throw new TRPCError({code:'PRECONDITION_FAILED',message:'Dùng luồng business hợp nhất để giữ dữ liệu, quyền và lịch sử'});
  }
  if(type==='mutation'&&cashEnabled){
    if(path==='editHistory.revert'){
      const entry=await ctx.prisma.editHistory.findFirst({where:{id:input.historyId,projectId},select:{entity:true}});
      if(entry&&['CostRecord','FundTransaction','Withdrawal','CollectorExpense','ProfitSplit'].includes(entry.entity))throw new TRPCError({code:'PRECONDITION_FAILED',message:'Dùng thu chi và Lịch sử thao tác mới để giữ tỷ giá và khóa kỳ'});
    }
    if(/^(cost|profitSplit)\./.test(path))throw new TRPCError({code:'PRECONDITION_FAILED',message:'Dùng thu chi USDT để giữ tỷ giá và khóa kỳ'});
    if(/^(fund|withdrawal)\./.test(path)){
      const model=path.startsWith('fund.')?ctx.prisma.fundTransaction:ctx.prisma.withdrawal;
      const ids=[input.id,...(input.ids||[])].filter((id):id is string=>typeof id==='string');
      if(ids.length&&await (model as any).findFirst({where:{projectId,id:{in:ids},businessManaged:true},select:{id:true}}))throw new TRPCError({code:'PRECONDITION_FAILED',message:'Dữ liệu đã có lịch sử; dùng nghiệp vụ mới'});
    }
  }
  if(path==='server.getCredentials'&&membership.role==='VIEWER')throw new TRPCError({code:'FORBIDDEN',message:'Tài khoản chỉ xem không được xem/copy thông tin đăng nhập'});
  if(/^(server|vmTask)\./.test(path)){
    const managedProject=businessMode==='PROXY_VM'||await ctx.prisma.server.findFirst({where:{projectId,managed:true},select:{id:true}});
    if(managedProject&&(path.startsWith('server.')||type==='mutation'))throw new TRPCError({code:'PRECONDITION_FAILED',message:'Dữ liệu Server/VM có cấu hình và lịch sử. Dùng luồng quản lý mới.'});
  }
  if(type==='mutation'&&businessMode==='PROXY_VM'&&/^(server|vmTask)\./.test(path))throw new TRPCError({code:'PRECONDITION_FAILED',message:'Dùng luồng Server/VM mới để giữ cấu hình và lịch sử cài'});
  if(/^(proxy|vm)\./.test(path)||(type==='mutation'&&/^server\.(delete|bulkDelete)$/.test(path))) {
    const featureLinked=businessMode==='PROXY_VM'||await ctx.prisma.proxyIP.findFirst({where:{projectId,identityId:{not:null}},select:{id:true}});
    if(featureLinked) throw new TRPCError({code:'PRECONDITION_FAILED',message:'Dùng luồng quản lý proxy/VM mới để giữ lịch sử và kiểm tra trùng'});
  }
  if(/^(proxy|vm|server)\./.test(path)) await assertLegacyInfrastructureTargets(ctx.prisma,projectId,path,input);
  if(typeof input.userId==='string'&&(/^user\.(getDetail|adminResetPin|adminResetPassword|resetPin|resetPassword|adminUnlockAccount|kickAutotypeSession|kickAllAutotypeSessions|setDisabled|access|requireTotp|resetTotp)$/.test(path)||/^project\.(updateUserInfo|setPin|removePin)$/.test(path)))await assertUserTarget(ctx.prisma,membership,input.userId,type==='mutation');
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
