import {z} from 'zod';
import {TRPCError} from '@trpc/server';
import {Prisma} from '@prisma/client';
import {router,protectedProcedure} from '../trpc';
import {assertInfrastructureAction,loadInfrastructureScope,type InfrastructureAction} from '../permissions/infrastructure';
import {createProxyBatchService} from '../proxy-management/batches';
import {queryRegistry,getProxyTimeline,exportBlocked,copyProxyEndpoint} from '../proxy-management/history';
import {refreshGenjy} from '../proxy-management/sources';
import {ProxyDomainError} from '../proxy-management/types';
import {saveProviderAccount} from '../proxy-management/catalog-management';
import {listProxyMembers,setProxyCapabilities} from '../proxy-management/capabilities';
import {listOperations,inspectOperation} from '../operation-history/journal';
import {undoOperation} from '../operation-history/undo';
import {createSystemBackup,listSystemBackups} from '../system-backups/service';
const project=z.object({projectId:z.string().min(1)});
const text=z.string().max(300000).optional();
const owner=z.enum(['SELF','GENJY','UNKNOWN']);
const state=z.enum(['NEW','LIVE','BLOCKED','REPLACED','DIE','QUARANTINED','VOID']);
async function domain<T>(fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch(e){
  if(e instanceof ProxyDomainError){const code=e.code==='FORBIDDEN'?'FORBIDDEN':e.code==='NOT_FOUND'?'NOT_FOUND':e.code==='INVALID_INPUT'||e.code==='COUNT_MISMATCH'||e.code==='DUPLICATE_INPUT'?'BAD_REQUEST':e.code==='SOURCE_UNAVAILABLE'?'PRECONDITION_FAILED':'CONFLICT';throw new TRPCError({code,message:e.message});}
  if(e instanceof Prisma.PrismaClientKnownRequestError&&['P2002','P2034'].includes(e.code)) throw new TRPCError({code:'CONFLICT',message:'IP hoặc đợt này vừa được ghi; kiểm tra lại'});
  if(e instanceof TRPCError) throw e;
  throw new TRPCError({code:'INTERNAL_SERVER_ERROR',message:'Chưa lưu được; dữ liệu được giữ nguyên. Tải lại và kiểm tra đợt nhập.'});
}}
export const proxyManagementRouter=router({
  backups:protectedProcedure.query(({ctx})=>domain(()=>listSystemBackups(ctx.user.id))),
  createBackup:protectedProcedure.mutation(({ctx})=>domain(()=>createSystemBackup(ctx.user.id,ctx.prisma))),
  operations:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>listOperations(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),ctx.prisma))),
  operation:protectedProcedure.input(project.extend({id:z.string().min(1)})).query(({ctx,input})=>domain(async()=>inspectOperation(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.id,ctx.prisma))),
  undo:protectedProcedure.input(project.extend({id:z.string().min(1),reason:z.string().min(1).max(300)})).mutation(({ctx,input})=>domain(async()=>undoOperation(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.id,input.reason,ctx.prisma))),
  access:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>{
    const scope=await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId);assertInfrastructureAction(scope,'READ');
    const can=(action:InfrastructureAction)=>{try{assertInfrastructureAction(scope,action);return true;}catch{return false;}};
    const source=await ctx.prisma.proxySourceSnapshot.findFirst({where:{projectId:input.projectId,sourceKey:'GENJY'},orderBy:{fetchedAt:'desc'}});
    let sourceMode:string|null=null;try{sourceMode=JSON.parse(process.env.GENJY_SOURCE_JSON||'{}').mode||null;}catch{}
    return {businessMode:scope.businessMode||null,role:scope.role,canBlock:can('BLOCK'),canImport:can('IMPORT'),canReplace:can('REPLACE'),canCopy:can('COPY_CREDENTIALS'),canManage:can('MANAGE'),canGrant:scope.role==='ADMIN',canBackup:!!process.env.SYSTEM_OWNER_USER_ID&&ctx.user.id===process.env.SYSTEM_OWNER_USER_ID,source:{connected:source?.scanSucceeded||false,lastScan:source?.fetchedAt.toISOString()||null,mode:sourceMode},trial:process.env.APP_ENV==='trial'};
  })),
  list:protectedProcedure.input(project.extend({owner:owner.optional(),packageCode:z.string().max(80).optional(),state:state.optional(),view:z.enum(['CURRENT','HISTORY','ALL']).default('CURRENT'),search:z.string().max(100).optional(),cursor:z.string().max(200).optional(),limit:z.number().int().min(1).max(100).default(50)})).query(({ctx,input})=>domain(async()=>queryRegistry(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
  preview:protectedProcedure.input(project.extend({kind:z.enum(['NEW','BLOCKED','REPLACE','SHEET']),text,removedText:text,addedText:text,owner:owner.optional(),subgroup:z.literal('PC_CHUNG').nullable().optional(),receivedDate:z.string().nullable().optional(),snapshotIds:z.array(z.string()).max(10).optional(),idempotencyKey:z.string().min(8).max(100)})).mutation(({ctx,input})=>domain(async()=>createProxyBatchService(ctx.prisma).preview(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input))),
  commit:protectedProcedure.input(project.extend({token:z.string().max(100),idempotencyKey:z.string().min(8).max(100)})).mutation(({ctx,input})=>domain(async()=>createProxyBatchService(ctx.prisma).commit(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.token,input.idempotencyKey))),
  timeline:protectedProcedure.input(project.extend({identityId:z.string()})).query(({ctx,input})=>domain(async()=>getProxyTimeline(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.identityId,ctx.prisma))),
  exportBlocked:protectedProcedure.input(project).mutation(({ctx,input})=>domain(async()=>exportBlocked(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),ctx.prisma))),
  copyEndpoint:protectedProcedure.input(project.extend({endpointId:z.string().min(1)})).mutation(({ctx,input})=>domain(async()=>copyProxyEndpoint(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.endpointId,ctx.prisma))),
  members:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>listProxyMembers(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),ctx.prisma))),
  setCapabilities:protectedProcedure.input(project.extend({memberId:z.string().min(1),capabilities:z.array(z.enum(['COPY_CREDENTIALS','PROXY_IMPORT','PROXY_REPLACE'])).max(3),allowInfrastructure:z.boolean().optional()})).mutation(({ctx,input})=>domain(async()=>setProxyCapabilities(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input.memberId,input.capabilities,ctx.prisma,input.allowInfrastructure))),
  sync:protectedProcedure.input(project).mutation(({ctx,input})=>domain(async()=>{const scope=await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId);assertInfrastructureAction(scope,'BLOCK');return refreshGenjy(input.projectId,ctx.prisma);})),
  catalog:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>{const scope=await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId);assertInfrastructureAction(scope,'READ');return ctx.prisma.proxyProviderAccount.findMany({where:{projectId:input.projectId},select:{id:true,code:true,label:true,disabled:true},orderBy:{code:'asc'}});})),
  saveCatalog:protectedProcedure.input(project.extend({code:z.string().min(1).max(80),label:z.string().min(1).max(100),username:z.string().min(1).max(100),password:z.string().min(1).max(500)})).mutation(({ctx,input})=>domain(async()=>saveProviderAccount(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
});
