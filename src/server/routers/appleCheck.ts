import {z} from 'zod';
import {router,protectedProcedure} from '../trpc';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {domain} from './businessManagement';
import {readChecks,configureWorker,requestCheck,cancelCheck,disableWorker} from '../apple-check/service';
const project=z.object({projectId:z.string().min(1)});
export const appleCheckRouter=router({
 overview:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>readChecks(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),ctx.prisma))),
 configure:protectedProcedure.input(project.extend({name:z.string().trim().min(1).max(100),proxyGroupId:z.string().min(1)})).mutation(({ctx,input})=>domain(async()=>configureWorker(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 request:protectedProcedure.input(project.extend({accountId:z.string().min(1),expectedRevision:z.number().int().nonnegative(),key:z.string().min(8).max(100)})).mutation(({ctx,input})=>domain(async()=>requestCheck(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 cancel:protectedProcedure.input(project.extend({jobId:z.string().min(1)})).mutation(({ctx,input})=>domain(async()=>cancelCheck(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.jobId,ctx.prisma))),
 disable:protectedProcedure.input(project).mutation(({ctx,input})=>domain(async()=>disableWorker(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),ctx.prisma))),
});
