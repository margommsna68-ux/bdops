import {z} from 'zod';
import {TRPCError} from '@trpc/server';
import {Prisma} from '@prisma/client';
import {router,protectedProcedure} from '../trpc';
import {ProxyDomainError} from '../proxy-management/types';
import {loadInfrastructureScope,assertInfrastructureAction,type InfrastructureAction} from '../permissions/infrastructure';
import {createVMService} from '../vm-management/allocation';
import {readVMWorkspace} from '../vm-management/repository';
import {createManagedServer,addManagedVMs,updateManagedServer,archiveManagedResource} from '../vm-management/metadata';
import {startInstall,copyConfiguration,reportInstallFailure,confirmInstalled} from '../vm-management/installation';
import {getEligibleInventory} from '../proxy-management/repository';
const project=z.object({projectId:z.string().min(1)}),id=z.string().min(1),key=z.string().min(8).max(100);
async function domain<T>(fn:()=>Promise<T>){try{return await fn();}catch(error){
  if(error instanceof ProxyDomainError)throw new TRPCError({code:error.code==='FORBIDDEN'?'FORBIDDEN':error.code==='NOT_FOUND'?'NOT_FOUND':error.code==='SOURCE_UNAVAILABLE'?'PRECONDITION_FAILED':error.code==='INVALID_INPUT'?'BAD_REQUEST':'CONFLICT',message:error.message});
  if(error instanceof Prisma.PrismaClientKnownRequestError&&['P2002','P2034'].includes(error.code))throw new TRPCError({code:'CONFLICT',message:'VM/proxy vừa được thay đổi; tải lại để kiểm tra'});
  if(error instanceof TRPCError)throw error;throw new TRPCError({code:'INTERNAL_SERVER_ERROR',message:'Chưa lưu được. Dữ liệu giao/cài được giữ nguyên; tải lại để kiểm tra.'});
}}
export const vmManagementRouter=router({
  access:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>{
    const scope=await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId);assertInfrastructureAction(scope,'READ');const can=(action:InfrastructureAction)=>{try{assertInfrastructureAction(scope,action);return scope.businessMode==='PROXY_VM';}catch{return false;}};
    const source=await ctx.prisma.proxySourceSnapshot.findFirst({where:{projectId:input.projectId,sourceKey:'GENJY'},orderBy:{fetchedAt:'desc'}});return {businessMode:scope.businessMode,canManage:can('MANAGE'),canAssign:can('ASSIGN'),canConfirm:can('CONFIRM'),canCopy:can('COPY_CREDENTIALS'),sourceConnected:!!source?.scanSucceeded,trial:['trial','staging'].includes(process.env.APP_ENV||'')};
  })),
  workspace:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>readVMWorkspace(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),ctx.prisma))),
  eligible:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>{const scope=await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId);assertInfrastructureAction(scope,'ASSIGN');if(scope.businessMode!=='PROXY_VM')throw new ProxyDomainError('FORBIDDEN');return getEligibleInventory(input.projectId,ctx.prisma);})),
  createServer:protectedProcedure.input(project.extend({code:z.string().min(1).max(80),vmCodes:z.array(z.string()).min(1).max(500),ipAddress:z.string().max(100).optional()})).mutation(({ctx,input})=>domain(async()=>createManagedServer(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
  addVMs:protectedProcedure.input(project.extend({serverId:id,vmCodes:z.array(z.string()).min(1).max(500)})).mutation(({ctx,input})=>domain(async()=>addManagedVMs(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.serverId,input.vmCodes,ctx.prisma))),
  updateServer:protectedProcedure.input(project.extend({serverId:id,code:z.string().min(1).max(80),ipAddress:z.string().max(100).optional(),notes:z.string().max(1000).optional(),expectedRevision:z.number().int().nonnegative()})).mutation(({ctx,input})=>domain(async()=>updateManagedServer(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.serverId,input,ctx.prisma))),
  archive:protectedProcedure.input(project.extend({type:z.enum(['SERVER','VM']),id})).mutation(({ctx,input})=>domain(async()=>archiveManagedResource(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.type,input.id,ctx.prisma))),
  preview:protectedProcedure.input(project.extend({mode:z.enum(['AUTO','MANUAL']),serverId:id.optional(),vmIds:z.array(id).min(1).max(1000).optional(),endpointId:id.optional(),idempotencyKey:key})).mutation(({ctx,input})=>domain(async()=>createVMService(ctx.prisma).preview(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input))),
  commit:protectedProcedure.input(project.extend({token:z.string().max(100),idempotencyKey:key})).mutation(({ctx,input})=>domain(async()=>createVMService(ctx.prisma).commit(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.token,input.idempotencyKey))),
  start:protectedProcedure.input(project.extend({configurationId:id})).mutation(({ctx,input})=>domain(async()=>startInstall(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.configurationId,ctx.prisma))),
  copy:protectedProcedure.input(project.extend({configurationId:id})).mutation(({ctx,input})=>domain(async()=>copyConfiguration(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.configurationId,ctx.prisma))),
  reportFailure:protectedProcedure.input(project.extend({configurationId:id,note:z.string().min(1).max(1000)})).mutation(({ctx,input})=>domain(async()=>reportInstallFailure(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.configurationId,input.note,ctx.prisma))),
  confirm:protectedProcedure.input(project.extend({configurationId:id,configurationHash:z.string().length(64),expectedVmRevision:z.number().int().nonnegative()})).mutation(({ctx,input})=>domain(async()=>confirmInstalled(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
});
