import { z } from "zod";
import { router, memberProcedure } from "../trpc";
import {TRPCError} from '@trpc/server';
import {assertProjectCanBeDestroyed} from '../permissions/legacy-infrastructure';

export const editHistoryRouter = router({
  // List edit history for an entity (or all for a project)
  list: memberProcedure
    .input(z.object({
      projectId: z.string(),
      entityId: z.string().optional(),
      entity: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ ctx,input }) => {
      const where: any = { projectId: input.projectId };
      if (input.entityId) where.entityId = input.entityId;
      if (input.entity) where.entity = input.entity;
      // Only show last 30 days
      where.createdAt = { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };

      return ctx.prisma.editHistory.findMany({
        where,
        include: { user: { select: { id: true, name: true, username: true } } },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
    }),

  // Revert a specific edit
  revert: memberProcedure
    .input(z.object({
      projectId: z.string(),
      historyId: z.string(),
    }))
    .mutation(async ({ ctx,input }) => {
      if((ctx.membership.project.settings as {businessMode?:string}|null)?.businessMode==='PROXY_VM')throw new TRPCError({code:'PRECONDITION_FAILED',message:'Dùng Lịch sử thao tác mới để kiểm tra dữ liệu trước khi hoàn tác'});
      const entry = await ctx.prisma.editHistory.findFirstOrThrow({
        where: { id: input.historyId, projectId: input.projectId, reverted: false },
      });

      // Apply the old value back to the entity
      const model = getModelForEntity(entry.entity);
      if (!model) throw new Error(`Unknown entity: ${entry.entity}`);
      if(entry.entity==='Project'&&entry.entityId!==input.projectId)throw new TRPCError({code:'BAD_REQUEST',message:'Dự án trong lịch sử không thuộc phạm vi thao tác'});
      const resource=await (ctx.prisma as any)[model].findFirst({where:{id:entry.entityId,...(entry.entity==='Project'?{}:entry.entity==='VirtualMachine'?{server:{projectId:input.projectId}}:{projectId:input.projectId})}});
      if(!resource)throw new TRPCError({code:'BAD_REQUEST',message:'Dữ liệu lịch sử không thuộc dự án'});
      if(resource.managed&&['Server','VirtualMachine'].includes(entry.entity))throw new TRPCError({code:'PRECONDITION_FAILED',message:'VM quản lý cấu hình phải dùng hoàn tác mới'});
      if(entry.entity==='Project')await assertProjectCanBeDestroyed(ctx.prisma,input.projectId);

      const updateData: any = {};
      updateData[entry.field] = entry.oldValue;

      // Handle type conversion for specific fields
      if (["amount", "feePercent", "paypalFee", "netAmount", "monthlyCost"].includes(entry.field)) {
        updateData[entry.field] = entry.oldValue ? parseFloat(entry.oldValue) : null;
      }
      if (["confirmed", "failed", "isPrimary"].includes(entry.field)) {
        updateData[entry.field] = entry.oldValue === "true";
      }

      await (ctx.prisma as any)[model].update({
        where: { id: entry.entityId },
        data: updateData,
      });

      // Mark as reverted
      await ctx.prisma.editHistory.update({
        where: { id: entry.id },
        data: { reverted: true, revertedAt: new Date() },
      });

      return { success: true, field: entry.field, oldValue: entry.oldValue, newValue: entry.newValue };
    }),
});

function getModelForEntity(entity: string): string | null {
  const map: Record<string, string> = {
    PayPalAccount: "payPalAccount",
    PayPalEmail: "payPalEmail",
    FundTransaction: "fundTransaction",
    Withdrawal: "withdrawal",
    Server: "server",
    VirtualMachine: "virtualMachine",
    GmailAccount: "gmailAccount",
    CostRecord: "costRecord",
    Project: "project",
  };
  return map[entity] || null;
}
