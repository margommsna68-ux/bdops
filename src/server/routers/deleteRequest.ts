import { z } from "zod";
import {TRPCError} from '@trpc/server';
import { router, memberProcedure, moderatorProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";
import {assertDeleteTarget} from '../permissions/legacy-infrastructure';

export const deleteRequestRouter = router({
  list: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.status) where.status = input.status;
      else where.status = "PENDING";

      return ctx.prisma.deleteRequest.findMany({
        where,
        include: {
          requestedBy: { select: { id: true, name: true, email: true } },
          reviewedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  pendingCount: moderatorProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.deleteRequest.count({
        where: { projectId: input.projectId, status: "PENDING" },
      });
    }),

  create: memberProcedure
    .input(
      z.object({
        projectId: z.string(),
        entity: z.string(),
        entityId: z.string(),
        entityLabel: z.string().optional(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if there's already a pending request for this entity
      await assertDeleteTarget(ctx.prisma,input.projectId,input.entity,input.entityId);
      const existing = await ctx.prisma.deleteRequest.findFirst({
        where: {
          entity: input.entity,
          entityId: input.entityId,
          projectId: input.projectId,
          status: "PENDING",
        },
      });
      if (existing) {
        throw new Error("A delete request for this item is already pending");
      }

      return ctx.prisma.deleteRequest.create({
        data: {
          entity: input.entity,
          entityId: input.entityId,
          entityLabel: input.entityLabel,
          reason: input.reason,
          requestedById: ctx.user.id,
          projectId: input.projectId,
        },
      });
    }),

  approve: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.prisma.deleteRequest.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId, status: "PENDING" },
      });
      await assertDeleteTarget(ctx.prisma,input.projectId,request.entity,request.entityId);
      if(['ProxyIP','VirtualMachine','Server'].includes(request.entity)) {
        const mode=(ctx.membership.project.settings as {businessMode?:string}|null)?.businessMode;
        const linked=mode==='PROXY_VM'||await ctx.prisma.proxyIP.findFirst({where:{projectId:input.projectId,identityId:{not:null}},select:{id:true}});
        if(linked) throw new TRPCError({code:'PRECONDITION_FAILED',message:'Hạ tầng đã quản lý lịch sử; dùng luồng nghỉ dùng thay vì xoá'});
      }

      // Perform the actual delete based on entity type
      const entityModelMap: Record<string, any> = {
        FundTransaction: ctx.prisma.fundTransaction,
        Withdrawal: ctx.prisma.withdrawal,
        PayPalAccount: ctx.prisma.payPalAccount,
        Server: ctx.prisma.server,
        VirtualMachine: ctx.prisma.virtualMachine,
        ProxyIP: ctx.prisma.proxyIP,
        GmailAccount: ctx.prisma.gmailAccount,
        CostRecord: ctx.prisma.costRecord,
        ProfitSplit: ctx.prisma.profitSplit,
        VMTask: ctx.prisma.vMTask,
      };

      const model = entityModelMap[request.entity];
      if (model) {
        try {
          await model.delete({ where: { id: request.entityId } });
        } catch (e: any) {
          throw new Error(`Failed to delete: ${e.message}`);
        }
      }

      // Update request status
      const result = await ctx.prisma.deleteRequest.update({
        where: { id: input.id },
        data: {
          status: "APPROVED",
          reviewedById: ctx.user.id,
        },
      });

      await createAuditLog({
        action: "DELETE_APPROVED",
        entity: request.entity as any,
        entityId: request.entityId,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { requestId: input.id, requestedBy: request.requestedById },
      });

      return result;
    }),

  reject: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        reviewNote: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.deleteRequest.update({
        where: { id: input.id },
        data: {
          status: "REJECTED",
          reviewedById: ctx.user.id,
          reviewNote: input.reviewNote,
        },
      });
    }),
});
