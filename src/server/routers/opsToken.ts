import {z} from 'zod';
import {router,protectedProcedure} from '../trpc';
import {domain} from './businessManagement';
import {OPS_SCOPES,createOpsToken,listOpsTokens,revokeOpsToken,tokenCandidates} from '../ops-api/tokens';
// Token API vận hành (21/10/2026): ADMIN of a Proxy / VM project, signed in on the web (session). A Bearer token never reaches tRPC.
const project=z.object({projectId:z.string().min(1)});
export const opsTokenRouter=router({
  list:protectedProcedure.input(project).query(({ctx,input})=>domain(()=>listOpsTokens(ctx.user.id,input.projectId,ctx.prisma))),
  candidates:protectedProcedure.input(project).query(({ctx,input})=>domain(()=>tokenCandidates(ctx.user.id,input.projectId,ctx.prisma))),
  create:protectedProcedure.input(project.extend({userId:z.string().min(1),name:z.string().min(1).max(60),scopes:z.array(z.enum(OPS_SCOPES)).min(1).max(OPS_SCOPES.length),projectIds:z.array(z.string().min(1)).max(10).optional(),expiresInDays:z.number().int().min(1).max(90),allowedIps:z.array(z.string().max(50)).max(20).optional(),pin:z.string().min(4).max(12)}))
    .mutation(({ctx,input})=>domain(()=>createOpsToken(ctx.user.id,input,ctx.prisma))),
  revoke:protectedProcedure.input(project.extend({tokenId:z.string().min(1)})).mutation(({ctx,input})=>domain(()=>revokeOpsToken(ctx.user.id,input,ctx.prisma))),
});
