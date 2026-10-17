import {z} from 'zod';
import {router,protectedProcedure} from '../trpc';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {domain} from './businessManagement';
import {previewStockImport,commitStockImport,recordBatchCost,setStockStatus} from '../account-store/inventory';
import {previewLinks,applyLinks,planAutoLinks,markEarnAppRegistered} from '../account-store/links';
import {readAccountStore,readVmAccounts} from '../account-store/read';
// Kho tài khoản (Gmail / Apple ID / PayPal stock and purchase batches) and the EarnApp account of each VM.
const project=z.object({projectId:z.string().min(1)}),id=z.string().min(1),key=z.string().min(8).max(100),revision=z.number().int().nonnegative();
const money=z.string().max(40);
const batch=z.object({code:z.string().max(60),source:z.string().max(200).nullish(),purchasedAt:z.string().length(10),priceMode:z.enum(['NONE','UNIT','TOTAL']),amount:money.nullish(),currency:z.string().max(8).nullish(),rate:money.nullish(),notes:z.string().max(1000).nullish()});
const stockImport=project.extend({kind:z.enum(['LOGIN','PAYPAL']),loginType:z.enum(['GMAIL','APPLE_ID']).nullish(),text:z.string().max(400000),batch});
const link=z.object({line:z.number().int().positive(),vmId:id,login:id.nullable().optional(),paypal:id.nullable().optional()});
const scope=(ctx:{prisma:Parameters<typeof loadInfrastructureScope>[0];user:{id:string}},projectId:string)=>loadInfrastructureScope(ctx.prisma,ctx.user.id,projectId);
export const accountStoreRouter=router({
 store:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>readAccountStore(await scope(ctx,input.projectId),ctx.prisma))),
 vmAccounts:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>readVmAccounts(await scope(ctx,input.projectId),ctx.prisma))),
 importPreview:protectedProcedure.input(stockImport).mutation(({ctx,input})=>domain(async()=>previewStockImport(await scope(ctx,input.projectId),input,ctx.prisma))),
 importCommit:protectedProcedure.input(stockImport.extend({key})).mutation(({ctx,input})=>domain(async()=>commitStockImport(await scope(ctx,input.projectId),input,ctx.prisma))),
 batchCost:protectedProcedure.input(project.extend({batchId:id,expectedRevision:revision,priceMode:z.enum(['UNIT','TOTAL']),amount:money,currency:z.string().max(8),rate:money.nullish(),date:z.string().length(10).nullish(),key})).mutation(({ctx,input})=>domain(async()=>recordBatchCost(await scope(ctx,input.projectId),input,ctx.prisma))),
 setStatus:protectedProcedure.input(project.extend({kind:z.enum(['LOGIN','PAYPAL']),items:z.array(z.object({id,expectedRevision:revision})).min(1).max(1000),status:z.string().max(40),key})).mutation(({ctx,input})=>domain(async()=>setStockStatus(await scope(ctx,input.projectId),input,ctx.prisma))),
 linkPreview:protectedProcedure.input(project.extend({text:z.string().max(200000).optional(),items:z.array(link).max(1000).optional()})).mutation(({ctx,input})=>domain(async()=>previewLinks(await scope(ctx,input.projectId),input,ctx.prisma))),
 linkApply:protectedProcedure.input(project.extend({key,items:z.array(link.extend({expectedRevision:revision})).min(1).max(1000)})).mutation(({ctx,input})=>domain(async()=>applyLinks(await scope(ctx,input.projectId),input,ctx.prisma))),
 autoPlan:protectedProcedure.input(project.extend({vmIds:z.array(id).min(1).max(1000),loginType:z.enum(['GMAIL','APPLE_ID']),withPaypal:z.boolean()})).mutation(({ctx,input})=>domain(async()=>planAutoLinks(await scope(ctx,input.projectId),input,ctx.prisma))),
 markRegistered:protectedProcedure.input(project.extend({vmId:id,registered:z.boolean(),expectedRevision:revision,key})).mutation(({ctx,input})=>domain(async()=>markEarnAppRegistered(await scope(ctx,input.projectId),input,ctx.prisma))),
});
