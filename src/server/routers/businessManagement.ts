import {z} from 'zod';
import {TRPCError} from '@trpc/server';
import {Prisma} from '@prisma/client';
import {router,protectedProcedure} from '../trpc';
import {ProxyDomainError} from '../proxy-management/types';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {assertBusinessArea} from '../business-management/scope';
import type {BusinessArea} from '../business-management/types';
import {saveOperatingAccount,readOperatingWorkspace,bindVMAccount,archiveOperatingAccount,copyOperatingCredentials} from '../business-management/accounts';
import {saveWork,readWorkWorkspace} from '../business-management/work';
import {saveFinance,voidFinance} from '../business-management/finance';
import {readFinanceWorkspace,readFinanceChoices,businessReport} from '../business-management/report';
import {createProfitPeriod,recalculateProfit,settleProfit,reopenProfit,markProfitPaid,correctProfitPaid,readProfitWorkspace} from '../business-management/profit';
const project=z.object({projectId:z.string().min(1)}),id=z.string().min(1),key=z.string().min(8).max(100),revision=z.number().int().nonnegative(),reason=z.string().trim().min(1).max(300);
const range=project.extend({start:z.string().length(10),end:z.string().length(10),currency:z.enum(['USD','VND'])});
async function domain<T>(fn:()=>Promise<T>){try{return await fn();}catch(error){
 if(error instanceof ProxyDomainError)throw new TRPCError({code:error.code==='FORBIDDEN'?'FORBIDDEN':error.code==='NOT_FOUND'?'NOT_FOUND':error.code==='INVALID_INPUT'?'BAD_REQUEST':'CONFLICT',message:error.message==='STALE_PREVIEW'?'Dữ liệu đã được sửa. Đóng form, cập nhật danh sách rồi kiểm tra lại trước khi lưu.':error.message});
 if(error instanceof TRPCError)throw error;
 if(error instanceof Prisma.PrismaClientKnownRequestError&&['P2002','P2034'].includes(error.code))throw new TRPCError({code:'CONFLICT',message:'Dữ liệu đã thay đổi hoặc trùng. Tải lại để kiểm tra.'});
 throw new TRPCError({code:'INTERNAL_SERVER_ERROR',message:'Chưa nhận được kết quả lưu. Tải lại để kiểm tra trước khi thử lại.'});
}}
export const businessManagementRouter=router({
 access:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>{
  const scope=await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId);if(scope.businessMode!=='PROXY_VM')throw new ProxyDomainError('FORBIDDEN');const can=(area:BusinessArea,write=false)=>{try{assertBusinessArea(scope,area,write);return true;}catch{return false;}};
  return {infra:can('INFRASTRUCTURE'),work:can('INFRASTRUCTURE',true),gmails:can('INFRASTRUCTURE'),paypals:can('PAYPALS'),manageGmails:can('INFRASTRUCTURE',true)&&['ADMIN','MODERATOR'].includes(scope.role),managePaypals:can('PAYPALS',true),funds:can('FUNDS'),withdrawals:can('WITHDRAWALS'),costs:can('COSTS'),profit:can('PROFIT'),writeFunds:can('FUNDS',true),writeWithdrawals:can('WITHDRAWALS',true),writeCosts:can('COSTS',true),writeProfit:can('PROFIT',true),admin:scope.role==='ADMIN',copy:scope.role!=='VIEWER'&&(scope.role==='ADMIN'||scope.capabilities.includes('COPY_CREDENTIALS')),trial:process.env.APP_ENV==='trial'};
 })),
 accounts:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>readOperatingWorkspace(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),ctx.prisma))),
 saveAccount:protectedProcedure.input(project.extend({kind:z.enum(['GMAIL','PAYPAL']),id:id.optional(),expectedRevision:revision.optional(),key,email:z.string().max(320),code:z.string().max(80).optional(),holder:z.string().max(200).optional(),password:z.string().max(20000).optional(),twoFa:z.string().max(20000).optional(),token:z.string().max(20000).optional(),recoveryEmail:z.string().max(320).optional(),paypalId:id.nullable().optional(),status:z.string().max(40),notes:z.string().max(1000).optional()})).mutation(({ctx,input})=>domain(async()=>saveOperatingAccount(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 archiveAccount:protectedProcedure.input(project.extend({kind:z.enum(['GMAIL','PAYPAL']),id,expectedRevision:revision,key})).mutation(({ctx,input})=>domain(async()=>archiveOperatingAccount(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 bindAccount:protectedProcedure.input(project.extend({vmId:id,gmailId:id.nullable(),expectedRevision:revision,key})).mutation(({ctx,input})=>domain(async()=>bindVMAccount(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 copyAccount:protectedProcedure.input(project.extend({kind:z.enum(['GMAIL','PAYPAL']),id,pin:z.string().min(1).max(80)})).mutation(({ctx,input})=>domain(async()=>copyOperatingCredentials(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 work:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>readWorkWorkspace(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),ctx.prisma))),
 saveWork:protectedProcedure.input(project.extend({id:id.optional(),expectedRevision:revision.optional(),key,title:z.string().trim().min(1).max(200),notes:z.string().max(2000).optional(),vmId:id.nullable().optional(),serverId:id.nullable().optional(),assigneeId:id.nullable().optional(),status:z.enum(['PENDING','IN_PROGRESS','COMPLETED','CANCELLED']),dueDate:z.string().length(10).nullable().optional()})).mutation(({ctx,input})=>domain(async()=>saveWork(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 finance:protectedProcedure.input(range).query(({ctx,input})=>domain(async()=>readFinanceWorkspace(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 choices:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>readFinanceChoices(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),ctx.prisma))),
 saveFinance:protectedProcedure.input(project.extend({kind:z.enum(['FUND','WITHDRAWAL','COST']),id:id.optional(),expectedRevision:revision.optional(),key,date:z.string().length(10),currency:z.enum(['USD','VND']),amount:z.string().max(20),notes:z.string().max(2000).optional(),transactionId:z.string().max(160).optional(),paypalId:id.optional(),paypalEmailId:id.nullable().optional(),serverId:id.nullable().optional(),vmId:id.nullable().optional(),proxyAccountId:id.nullable().optional(),category:z.enum(['SERVER','IP_PROXY','GMAIL','PAYPAL','OTHER']).optional(),confirmed:z.boolean().optional(),failed:z.boolean().optional(),company:z.string().max(200).optional(),type:z.enum(['EXCHANGE','MIXING']).optional(),destPaypalId:id.nullable().optional(),paidToTeam:z.boolean().optional(),isPrepaid:z.boolean().optional()})).mutation(({ctx,input})=>domain(async()=>saveFinance(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 voidFinance:protectedProcedure.input(project.extend({kind:z.enum(['FUND','WITHDRAWAL','COST']),id,expectedRevision:revision,key,reason})).mutation(({ctx,input})=>domain(async()=>voidFinance(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 report:protectedProcedure.input(range).query(({ctx,input})=>domain(async()=>businessReport(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 profit:protectedProcedure.input(range).query(({ctx,input})=>domain(async()=>readProfitWorkspace(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 createProfit:protectedProcedure.input(range.extend({key,partners:z.array(z.object({name:z.string().trim().min(1).max(100),percentage:z.string().max(8)})).min(1).max(30)})).mutation(({ctx,input})=>domain(async()=>createProfitPeriod(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 recalculateProfit:protectedProcedure.input(project.extend({id,expectedRevision:revision,key})).mutation(({ctx,input})=>domain(async()=>recalculateProfit(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 settleProfit:protectedProcedure.input(project.extend({id,expectedRevision:revision,key})).mutation(({ctx,input})=>domain(async()=>settleProfit(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 reopenProfit:protectedProcedure.input(project.extend({id,expectedRevision:revision,key,reason})).mutation(({ctx,input})=>domain(async()=>reopenProfit(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 markPaid:protectedProcedure.input(project.extend({allocationId:id,expectedRevision:revision,key,reason})).mutation(({ctx,input})=>domain(async()=>markProfitPaid(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 correctPaid:protectedProcedure.input(project.extend({allocationId:id,expectedRevision:revision,key,reason})).mutation(({ctx,input})=>domain(async()=>correctProfitPaid(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
});
