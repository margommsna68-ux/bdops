import {z} from 'zod';
import {router,protectedProcedure} from '../trpc';
import {domain} from './businessManagement';
import {OPS_SCOPES,createOpsToken,listOpsTokens,revokeOpsToken,tokenCandidates} from '../ops-api/tokens';
// Token API vận hành (21/10/2026): ADMIN of a Proxy / VM project, signed in on the web (session). A Bearer token never reaches tRPC.
const project=z.object({projectId:z.string().min(1)}),forUser=project.extend({userId:z.string().min(1).optional()});
export const opsTokenRouter=router({
  // The user page (22/10/2026) lists and creates tokens of the user being viewed, in the project being viewed; filtered on the server.
  list:protectedProcedure.input(forUser).query(({ctx,input})=>domain(()=>listOpsTokens(ctx.user.id,input.projectId,ctx.prisma,{userId:input.userId}))),
  candidates:protectedProcedure.input(forUser).query(({ctx,input})=>domain(()=>tokenCandidates(ctx.user.id,input.projectId,ctx.prisma,{userId:input.userId}))),
  create:protectedProcedure.input(project.extend({userId:z.string().min(1),name:z.string().min(1).max(60),scopes:z.array(z.enum(OPS_SCOPES)).min(1).max(OPS_SCOPES.length),projectIds:z.array(z.string().min(1)).max(10).optional(),expiresInDays:z.number().int().min(1).max(90).nullable(),allowedIps:z.array(z.string().max(50)).max(20).optional(),pin:z.string().min(4).max(12),createKey:z.string().min(8).max(80).optional()}))
    .mutation(({ctx,input})=>domain(()=>createOpsToken(ctx.user.id,input,ctx.prisma))),
  revoke:protectedProcedure.input(project.extend({tokenId:z.string().min(1)})).mutation(({ctx,input})=>domain(()=>revokeOpsToken(ctx.user.id,input,ctx.prisma))),
});
