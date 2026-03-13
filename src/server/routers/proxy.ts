import { z } from "zod";
import { router, infrastructureProcedure, moderatorProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";

export const proxyRouter = router({
  list: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        status: z.enum(["AVAILABLE", "IN_USE", "BLOCKED", "RESERVED"]).optional(),
        subnet: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.status) where.status = input.status;
      if (input.subnet) where.subnet = input.subnet;

      const [items, total] = await Promise.all([
        ctx.prisma.proxyIP.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { address: "asc" },
          include: {
            vm: { select: { code: true, serverId: true } },
          },
        }),
        ctx.prisma.proxyIP.count({ where }),
      ]);

      return { items, total, page: input.page, limit: input.limit };
    }),

  statusCounts: infrastructureProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.proxyIP.groupBy({
        by: ["status"],
        where: { projectId: input.projectId },
        _count: true,
      });
    }),

  bySubnet: infrastructureProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.proxyIP.groupBy({
        by: ["subnet"],
        where: { projectId: input.projectId },
        _count: true,
      });
    }),

  // Update proxy fields
  update: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      address: z.string().optional(),
      host: z.string().nullable().optional(),
      port: z.number().nullable().optional(),
      subnet: z.string().nullable().optional(),
      status: z.enum(["AVAILABLE", "IN_USE", "BLOCKED", "RESERVED"]).optional(),
      outboundIP: z.string().nullable().optional(),
      blockReason: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      await ctx.prisma.proxyIP.findFirstOrThrow({ where: { id, projectId } });
      const result = await ctx.prisma.proxyIP.update({ where: { id }, data });
      await createAuditLog({
        action: "UPDATE",
        entity: "ProxyIP",
        entityId: id,
        userId: (ctx.user as any).id,
        projectId,
        changes: data,
      });
      return result;
    }),

  // Manual assign proxy to VM
  assign: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        proxyId: z.string(),
        vmId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check proxy belongs to project and is available
      const proxy = await ctx.prisma.proxyIP.findFirstOrThrow({
        where: { id: input.proxyId, projectId: input.projectId },
      });
      if (proxy.status === "IN_USE") {
        throw new Error("Proxy is already in use");
      }

      // Check VM belongs to project and doesn't have proxy
      const vm = await ctx.prisma.virtualMachine.findFirstOrThrow({
        where: { id: input.vmId, server: { projectId: input.projectId } },
      });
      if (vm.proxyId) {
        throw new Error("VM already has a proxy assigned");
      }

      // Assign in transaction
      await ctx.prisma.$transaction([
        ctx.prisma.virtualMachine.update({
          where: { id: input.vmId },
          data: { proxyId: input.proxyId },
        }),
        ctx.prisma.proxyIP.update({
          where: { id: input.proxyId },
          data: { status: "IN_USE" },
        }),
      ]);

      // Log history
      const userId = ctx.user.id;
      await ctx.prisma.proxyAssignmentHistory.create({
        data: {
          proxyId: input.proxyId,
          vmId: input.vmId,
          assignedById: userId,
        },
      });

      await createAuditLog({
        action: "ASSIGN",
        entity: "ProxyIP",
        entityId: input.proxyId,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { vmId: input.vmId, proxyAddress: proxy.address },
      });

      return { success: true };
    }),

  // Unassign proxy from VM
  unassign: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        proxyId: z.string(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify proxy belongs to project
      const proxy = await ctx.prisma.proxyIP.findFirstOrThrow({
        where: { id: input.proxyId, projectId: input.projectId },
        include: { vm: true },
      });

      if (!proxy.vm) throw new Error("Proxy is not assigned to any VM");

      // Remove assignment
      await ctx.prisma.virtualMachine.update({
        where: { id: proxy.vm.id },
        data: { proxyId: null },
      });

      // Update proxy status
      const newStatus = input.reason === "blocked" ? "BLOCKED" : "AVAILABLE";
      await ctx.prisma.proxyIP.update({
        where: { id: input.proxyId },
        data: {
          status: newStatus as any,
          blockReason: input.reason === "blocked" ? input.reason : null,
        },
      });

      // Update history
      const lastHistory = await ctx.prisma.proxyAssignmentHistory.findFirst({
        where: { proxyId: input.proxyId, vmId: proxy.vm.id, unassignedAt: null },
        orderBy: { assignedAt: "desc" },
      });
      if (lastHistory) {
        await ctx.prisma.proxyAssignmentHistory.update({
          where: { id: lastHistory.id },
          data: { unassignedAt: new Date(), reason: input.reason },
        });
      }

      await createAuditLog({
        action: "UNASSIGN",
        entity: "ProxyIP",
        entityId: input.proxyId,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { vmId: proxy.vm.id, proxyAddress: proxy.address, reason: input.reason },
      });

      return { success: true };
    }),

  // Auto-assign: shuffle available proxies into VMs without proxy
  autoAssign: moderatorProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Get available proxies
      const available = await ctx.prisma.proxyIP.findMany({
        where: { projectId: input.projectId, status: "AVAILABLE" },
      });

      // Get VMs without proxy
      const vmsNoProxy = await ctx.prisma.virtualMachine.findMany({
        where: {
          server: { projectId: input.projectId },
          proxyId: null,
        },
      });

      if (available.length === 0 || vmsNoProxy.length === 0) {
        return { assigned: 0, message: "No available proxies or VMs to assign" };
      }

      // Shuffle proxies randomly
      const shuffled = [...available].sort(() => Math.random() - 0.5);
      const toAssign = Math.min(shuffled.length, vmsNoProxy.length);
      const userId = ctx.user.id;

      for (let i = 0; i < toAssign; i++) {
        const proxy = shuffled[i];
        const vm = vmsNoProxy[i];

        await ctx.prisma.virtualMachine.update({
          where: { id: vm.id },
          data: { proxyId: proxy.id },
        });
        await ctx.prisma.proxyIP.update({
          where: { id: proxy.id },
          data: { status: "IN_USE" },
        });
        await ctx.prisma.proxyAssignmentHistory.create({
          data: {
            proxyId: proxy.id,
            vmId: vm.id,
            assignedById: userId,
          },
        });
      }

      return { assigned: toAssign, message: `Assigned ${toAssign} proxies to VMs` };
    }),

  // Assignment history for a proxy
  history: infrastructureProcedure
    .input(z.object({ projectId: z.string(), proxyId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify proxy belongs to project
      await ctx.prisma.proxyIP.findFirstOrThrow({
        where: { id: input.proxyId, projectId: input.projectId },
      });
      return ctx.prisma.proxyAssignmentHistory.findMany({
        where: { proxyId: input.proxyId },
        include: {
          vm: { select: { code: true } },
          assignedBy: { select: { name: true, email: true } },
        },
        orderBy: { assignedAt: "desc" },
      });
    }),

  // Bulk import proxies
  bulkImport: moderatorProcedure
    .input(
      z.object({
        projectId: z.string(),
        proxies: z.array(
          z.object({
            address: z.string(),
            subnet: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      for (const p of input.proxies) {
        const parts = p.address.split(":");
        try {
          await ctx.prisma.proxyIP.create({
            data: {
              address: p.address,
              host: parts[0],
              port: parts[1] && !isNaN(parseInt(parts[1])) && parseInt(parts[1]) >= 1 && parseInt(parts[1]) <= 65535 ? parseInt(parts[1]) : null,
              subnet: p.subnet,
              status: "AVAILABLE",
              projectId: input.projectId,
            },
          });
          imported++;
        } catch {
          // Skip duplicates
        }
      }
      return { imported, total: input.proxies.length };
    }),

  delete: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const proxy = await ctx.prisma.proxyIP.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      await createAuditLog({
        action: "DELETE",
        entity: "ProxyIP",
        entityId: input.id,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { address: proxy.address, status: proxy.status },
      });
      // Unassign from VM first if assigned
      await ctx.prisma.virtualMachine.updateMany({ where: { proxyId: input.id }, data: { proxyId: null } });
      return ctx.prisma.proxyIP.delete({ where: { id: input.id } });
    }),

  bulkDelete: moderatorProcedure
    .input(z.object({ projectId: z.string(), ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await createAuditLog({
        action: "BULK_DELETE",
        entity: "ProxyIP",
        entityId: input.ids.join(","),
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { count: input.ids.length, ids: input.ids },
      });
      // Unassign VMs first
      await ctx.prisma.virtualMachine.updateMany({ where: { proxyId: { in: input.ids } }, data: { proxyId: null } });
      const result = await ctx.prisma.proxyIP.deleteMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
      });
      return { deleted: result.count };
    }),
});
