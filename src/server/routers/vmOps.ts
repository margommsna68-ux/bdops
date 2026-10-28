import {z} from 'zod';
import {router,protectedProcedure} from '../trpc';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {domain} from './businessManagement';
import {VM_OPS_STATUSES} from '@/lib/vm-ops';
import {setVmStatus,recordRecreated} from '../vm-ops/ops';
import {createPayoutRequest,updatePayoutRequest,readVmOps,readVmOpsHistory,readPayoutPick,readPaypalGather,recordPayoutReceipt} from '../vm-ops/payout';
import {addPayoutMembers,removePayoutMember} from '../vm-ops/payout-members';
import {editPayoutRequest,unsendPayoutRequest,voidPayoutRequest} from '../vm-ops/payout-fix';
import {markEarnAppSuspended} from '../vm-ops/suspend';
import {recordBalanceChecks,readBalanceHistory,previewBalancePaste} from '../vm-ops/balance';
import {readPayoutReport,readPayoutDashboard,readPayoutVoided,PAYOUT_REPORT_VIEWS} from '../vm-ops/payout-report';
// VM operating state, payout requests and recreation (owner brief 18/10/2026). People and AI use these same checked endpoints.
const project=z.object({projectId:z.string().min(1)}),id=z.string().min(1),key=z.string().min(8).max(100),cycle=z.number().int().positive(),revision=z.number().int().nonnegative();
const member=z.object({vmId:id,expectedCycle:cycle,expectedVmRevision:revision.optional(),shareAmount:z.string().max(40).nullish()});
const scope=(ctx:{prisma:Parameters<typeof loadInfrastructureScope>[0];user:{id:string}},projectId:string)=>loadInfrastructureScope(ctx.prisma,ctx.user.id,projectId);
export const vmOpsRouter=router({
  payoutDashboard:protectedProcedure.input(project.extend({serverId:id.optional()})).query(({ctx,input})=>domain(async()=>readPayoutDashboard(await scope(ctx,input.projectId),input,ctx.prisma))),
  payoutReport:protectedProcedure.input(project.extend({serverId:id.optional(),paypalId:id.optional(),status:z.enum(['PREPARING','UNKNOWN','WAITING','PARTIAL','RECEIVED','FAILED','CANCELLED','REVIEW','LOST']).optional(),q:z.string().max(200).optional(),from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),page:z.number().int().min(1).max(100000).optional(),view:z.enum(PAYOUT_REPORT_VIEWS).optional(),day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()})).query(({ctx,input})=>domain(async()=>readPayoutReport(await scope(ctx,input.projectId),input,ctx.prisma))),
  payoutVoided:protectedProcedure.input(project.extend({serverId:id.optional(),page:z.number().int().min(1).max(100000).optional()})).query(({ctx,input})=>domain(async()=>readPayoutVoided(await scope(ctx,input.projectId),input,ctx.prisma))),
  board:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>readVmOps(await scope(ctx,input.projectId),ctx.prisma))),
  history:protectedProcedure.input(project.extend({vmId:id})).query(({ctx,input})=>domain(async()=>readVmOpsHistory(await scope(ctx,input.projectId),input,ctx.prisma))),
  setStatus:protectedProcedure.input(project.extend({key,note:z.string().max(500).nullish(),items:z.array(z.object({vmId:id,status:z.enum(VM_OPS_STATUSES),expectedCycle:cycle,expectedRevision:revision.nullish(),expectedEndpointId:id.nullish()})).min(1).max(1000)})).mutation(({ctx,input})=>domain(async()=>setVmStatus(await scope(ctx,input.projectId),input,ctx.prisma))),
  recreate:protectedProcedure.input(project.extend({key,vmId:id,expectedCycle:cycle,note:z.string().max(500).nullish()})).mutation(({ctx,input})=>domain(async()=>recordRecreated(await scope(ctx,input.projectId),input,ctx.prisma))),
  payoutPick:protectedProcedure.input(project.extend({vmId:id,amount:z.string().max(40).nullish()})).query(({ctx,input})=>domain(async()=>readPayoutPick(await scope(ctx,input.projectId),input,ctx.prisma))),
  gather:protectedProcedure.input(project).query(({ctx,input})=>domain(async()=>readPaypalGather(await scope(ctx,input.projectId),ctx.prisma))),
  requestPayout:protectedProcedure.input(project.extend({key,vmId:id,expectedCycle:cycle,expectedVmRevision:revision.optional(),earnAppId:id,paypalEmailId:id,amount:z.string().max(40),currency:z.string().max(5).optional(),reference:z.string().max(200).nullish(),date:z.string().length(10),submission:z.enum(['PREPARING','SENT']).optional(),members:z.array(member).max(100).optional()})).mutation(({ctx,input})=>domain(async()=>createPayoutRequest(await scope(ctx,input.projectId),input,ctx.prisma))),
  // Merged payout (27/10/2026).
  addPayoutMembers:protectedProcedure.input(project.extend({key,requestId:id,expectedRevision:revision,members:z.array(member).min(1).max(100)})).mutation(({ctx,input})=>domain(async()=>addPayoutMembers(await scope(ctx,input.projectId),input,ctx.prisma))),
  removePayoutMember:protectedProcedure.input(project.extend({key,requestId:id,expectedRevision:revision,vmId:id})).mutation(({ctx,input})=>domain(async()=>removePayoutMember(await scope(ctx,input.projectId),input,ctx.prisma))),
  updatePayout:protectedProcedure.input(project.extend({key,requestId:id,expectedRevision:revision,vmId:id,expectedCycle:cycle,earnAppId:id,history:z.boolean().optional(),action:z.enum(['FAILED','CANCELLED','RETRY','CORRECT','SETTLE','SENT','UNKNOWN']),note:z.string().max(500).nullish(),amount:z.string().max(40).nullish(),reference:z.string().max(200).nullish()})).mutation(({ctx,input})=>domain(async()=>updatePayoutRequest(await scope(ctx,input.projectId),input,ctx.prisma))),
  // Fixing a mistaken request and EarnApp SUS (owner 28/10/2026): the same services as the ops API.
  editPayout:protectedProcedure.input(project.extend({key,requestId:id,expectedRevision:revision,vmId:id,expectedCycle:cycle,earnAppId:id,paypalEmailId:id.optional(),amount:z.string().max(40).optional(),requestedAt:z.string().max(40).optional(),reference:z.string().max(200).nullish(),note:z.string().max(500).nullish()})).mutation(({ctx,input})=>domain(async()=>editPayoutRequest(await scope(ctx,input.projectId),input,ctx.prisma))),
  unsendPayout:protectedProcedure.input(project.extend({key,requestId:id,expectedRevision:revision,vmId:id,expectedCycle:cycle,earnAppId:id,note:z.string().max(500).nullish()})).mutation(({ctx,input})=>domain(async()=>unsendPayoutRequest(await scope(ctx,input.projectId),input,ctx.prisma))),
  voidPayout:protectedProcedure.input(project.extend({key,requestId:id,expectedRevision:revision,vmId:id,expectedCycle:cycle,earnAppId:id,reason:z.string().min(1).max(500)})).mutation(({ctx,input})=>domain(async()=>voidPayoutRequest(await scope(ctx,input.projectId),input,ctx.prisma))),
  suspendEarnApp:protectedProcedure.input(project.extend({key,vmId:id,expectedCycle:cycle,expectedVmRevision:revision.optional(),note:z.string().max(500).nullish()})).mutation(({ctx,input})=>domain(async()=>markEarnAppSuspended(await scope(ctx,input.projectId),input,ctx.prisma))),
  // Money received for one payout request (review fix 21/10/2026): the same command as the ops API (recordPayoutReceipt); managers or
  // PAYPAL_RECEIPT_RECORD. Confirmed money only, parts add up, the exact PayPal figure even above what is open (settled as a surplus, 28/10/2026), duplicates refused, period lock.
  payoutReceipt:protectedProcedure.input(project.extend({key,requestId:id,expectedRequestRevision:revision,amount:z.string().max(20),currency:z.string().max(5),receivedAt:z.string().max(40),transactionId:z.string().max(100).nullish(),evidence:z.string().max(300).nullish(),settleRemainder:z.boolean().optional()})).mutation(({ctx,input})=>domain(async()=>recordPayoutReceipt(await scope(ctx,input.projectId),input,ctx.prisma))),
  // EarnApp balance at the VM (owner brief 20/10/2026): one command for the cell, the paste and AI; every line carries VM, round and
  // EarnApp seen; the check time is when it was read.
  balanceRecord:protectedProcedure.input(project.extend({key,source:z.enum(['CELL','PASTE','AI','OTHER']),items:z.array(z.object({vmId:id,expectedCycle:cycle,earnAppId:id,checkedAt:z.string().max(40),outcome:z.enum(['OK','FAILED']),amount:z.string().max(20).nullish(),currency:z.string().max(5).nullish(),withdrawable:z.enum(['YES','NO','UNKNOWN']).nullish(),condition:z.string().max(300).nullish(),failure:z.string().max(300).nullish(),evidence:z.string().max(300).nullish(),line:z.number().int().positive().optional()})).min(1).max(1000)})).mutation(({ctx,input})=>domain(async()=>recordBalanceChecks(await scope(ctx,input.projectId),input,ctx.prisma))),
  balancePreview:protectedProcedure.input(project.extend({text:z.string().min(1).max(200000),serverId:id.nullish()})).mutation(({ctx,input})=>domain(async()=>previewBalancePaste(await scope(ctx,input.projectId),input,ctx.prisma))),
  balanceHistory:protectedProcedure.input(project.extend({vmId:id})).query(({ctx,input})=>domain(async()=>readBalanceHistory(await scope(ctx,input.projectId),input,ctx.prisma))),
});
