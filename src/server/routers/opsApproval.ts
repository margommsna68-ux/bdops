import {z} from 'zod';
import {router,protectedProcedure,adminProcedure} from '../trpc';
import {domain} from './businessManagement';
import {decideApproval,listApprovals,pendingApprovalCount} from '../ops-api/approvals';
import {approveAllPending,closeApprovalSession,openApprovalSession,readApprovalSessions} from '../ops-api/approval-session';
// Phê duyệt lệnh AI (owner decision 23/10/2026): ADMIN of the project sees the held critical commands of the AI and approves / rejects
// each one with a Google Authenticator code. The AI then retries with the same Idempotency-Key.
const project=z.object({projectId:z.string().min(1)});
export const opsApprovalRouter=router({
  list:adminProcedure.input(project.extend({status:z.enum(['OPEN','PENDING','APPROVED','REJECTED','EXPIRED','CONSUMED']).optional()})).query(({ctx,input})=>listApprovals(ctx.prisma,input.projectId,{status:input.status})),
  decide:adminProcedure.input(project.extend({approvalId:z.string().min(1),approve:z.boolean(),code:z.string().min(6).max(12),note:z.string().max(300).nullish()}))
    .mutation(({ctx,input})=>domain(()=>decideApproval(ctx.prisma,{approvalId:input.approvalId,actorId:ctx.user.id,projectId:input.projectId,approve:input.approve,code:input.code,note:input.note}))),
  // 28/10/2026: "Duyệt tất cả đang chờ" with one code; the 15-minute session per token ("Mở phiên 15 phút" / "Khóa phiên ngay").
  // Each opener proves their OWN code (the service re-checks ADMIN + 2FA inside its transaction); the code is never stored.
  approveAll:adminProcedure.input(project.extend({code:z.string().min(6).max(12)}))
    .mutation(({ctx,input})=>domain(()=>approveAllPending(ctx.prisma,{projectId:input.projectId,actorId:ctx.user.id,code:input.code}))),
  sessions:adminProcedure.input(project).query(({ctx,input})=>readApprovalSessions(ctx.prisma,input.projectId)),
  openSession:adminProcedure.input(project.extend({tokenId:z.string().min(1).max(64),code:z.string().min(6).max(12)}))
    .mutation(({ctx,input})=>domain(()=>openApprovalSession(ctx.prisma,{projectId:input.projectId,tokenId:input.tokenId,admin:'',totp:input.code,via:'WEB',actorId:ctx.user.id}))),
  closeSession:adminProcedure.input(project.extend({tokenId:z.string().min(1).max(64).optional(),sessionId:z.string().min(1).max(64).optional()}))
    .mutation(({ctx,input})=>domain(()=>closeApprovalSession(ctx.prisma,{projectId:input.projectId,tokenId:input.tokenId,sessionId:input.sessionId,actorId:ctx.user.id}))),
  // Sidebar badge: ADMINs of the project see the number waiting; others 0.
  pendingCount:protectedProcedure.input(project).query(async({ctx,input})=>{
    const m=await ctx.prisma.projectMember.findUnique({where:{userId_projectId:{userId:ctx.user.id,projectId:input.projectId}},select:{role:true}});
    return {count:m?.role==='ADMIN'?await pendingApprovalCount(ctx.prisma,input.projectId):0};
  }),
});
