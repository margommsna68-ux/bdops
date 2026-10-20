import {z} from 'zod';
import {router,protectedProcedure} from '../trpc';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {domain} from './businessManagement';
import {VM_OPS_STATUSES} from '@/lib/vm-ops';
import {setVmStatus,recordRecreated} from '../vm-ops/ops';
import {createPayoutRequest,updatePayoutRequest,readVmOps,readVmOpsHistory,readPayoutPick,readPaypalGather} from '../vm-ops/payout';
import {recordBalanceChecks,readBalanceHistory,previewBalancePaste} from '../vm-ops/balance';
// VM operating state, payout requests and recreation (owner brief 18/10/2026). People and AI use these same checked endpoints.
const project=z.object({projectId:z.string().min(1)}),id=z.string().min(1),key=z.string().min(8).max(100),cycle=z.number().int().positive(),revision=z.number().int().nonnegative();
const scope=(ctx:{prisma:Parameters<typeof loadInfrastructureScope>[0];user:{id:string}},projectId:string)=>loadInfrastructureScope(ctx.prisma,ctx.user.id,projectId);
export const vmOpsRouter=router({
  board:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>readVmOps(await scope(ctx,input.projectId),ctx.prisma))),
  history:protectedProcedure.input(project.extend({vmId:id})).query(({ctx,input})=>domain(async()=>readVmOpsHistory(await scope(ctx,input.projectId),input,ctx.prisma))),
  setStatus:protectedProcedure.input(project.extend({key,note:z.string().max(500).nullish(),items:z.array(z.object({vmId:id,status:z.enum(VM_OPS_STATUSES),expectedCycle:cycle})).min(1).max(1000)})).mutation(({ctx,input})=>domain(async()=>setVmStatus(await scope(ctx,input.projectId),input,ctx.prisma))),
  recreate:protectedProcedure.input(project.extend({key,vmId:id,expectedCycle:cycle,note:z.string().max(500).nullish()})).mutation(({ctx,input})=>domain(async()=>recordRecreated(await scope(ctx,input.projectId),input,ctx.prisma))),
  payoutPick:protectedProcedure.input(project.extend({vmId:id,amount:z.string().max(40).nullish()})).query(({ctx,input})=>domain(async()=>readPayoutPick(await scope(ctx,input.projectId),input,ctx.prisma))),
  gather:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>readPaypalGather(await scope(ctx,input.projectId),ctx.prisma))),
  requestPayout:protectedProcedure.input(project.extend({key,vmId:id,expectedCycle:cycle,earnAppId:id,paypalEmailId:id,amount:z.string().max(40),currency:z.string().max(5).optional(),reference:z.string().max(200).nullish(),date:z.string().length(10),submission:z.enum(['PREPARING','SENT']).optional()})).mutation(({ctx,input})=>domain(async()=>createPayoutRequest(await scope(ctx,input.projectId),input,ctx.prisma))),
  updatePayout:protectedProcedure.input(project.extend({key,requestId:id,expectedRevision:revision,vmId:id,expectedCycle:cycle,earnAppId:id,history:z.boolean().optional(),action:z.enum(['FAILED','CANCELLED','RETRY','CORRECT','SETTLE','SENT','UNKNOWN']),note:z.string().max(500).nullish(),amount:z.string().max(40).nullish(),reference:z.string().max(200).nullish()})).mutation(({ctx,input})=>domain(async()=>updatePayoutRequest(await scope(ctx,input.projectId),input,ctx.prisma))),
  // EarnApp balance at the VM (owner brief 20/10/2026): one command for the cell, the paste and AI; every line carries VM, round and
  // EarnApp seen; the check time is when it was read.
  balanceRecord:protectedProcedure.input(project.extend({key,source:z.enum(['CELL','PASTE','AI','OTHER']),items:z.array(z.object({vmId:id,expectedCycle:cycle,earnAppId:id,checkedAt:z.string().max(40),outcome:z.enum(['OK','FAILED']),amount:z.string().max(20).nullish(),currency:z.string().max(5).nullish(),withdrawable:z.enum(['YES','NO','UNKNOWN']).nullish(),condition:z.string().max(300).nullish(),failure:z.string().max(300).nullish(),evidence:z.string().max(300).nullish(),line:z.number().int().positive().optional()})).min(1).max(1000)})).mutation(({ctx,input})=>domain(async()=>recordBalanceChecks(await scope(ctx,input.projectId),input,ctx.prisma))),
  balancePreview:protectedProcedure.input(project.extend({text:z.string().min(1).max(200000),serverId:id.nullish()})).mutation(({ctx,input})=>domain(async()=>previewBalancePaste(await scope(ctx,input.projectId),input,ctx.prisma))),
  balanceHistory:protectedProcedure.input(project.extend({vmId:id})).query(({ctx,input})=>domain(async()=>readBalanceHistory(await scope(ctx,input.projectId),input,ctx.prisma))),
});
