import { z } from "zod";
import { router, infrastructureProcedure, moderatorProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";

export const vmRouter = router({
  list: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        serverId: z.string().optional(),
        status: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { server: { projectId: input.projectId } };
      if (input.serverId) where.serverId = input.serverId;
      if (input.status) where.status = input.status;

      const [items, total] = await Promise.all([
        ctx.prisma.virtualMachine.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { code: "asc" },
          include: {
            server: { select: { code: true } },
            proxy: { select: { address: true, status: true } },
            gmail: { select: { email: true, status: true } },
          },
        }),
        ctx.prisma.virtualMachine.count({ where }),
      ]);

      return { items, total, page: input.page, limit: input.limit };
    }),

  getById: infrastructureProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.virtualMachine.findFirstOrThrow({
        where: { id: input.id, server: { projectId: input.projectId } },
        include: {
          server: { select: { code: true, ipAddress: true, provider: true } },
          proxy: true,
          gmail: {
            include: {
              paypal: { select: { id: true, code: true, status: true, primaryEmail: true } },
            },
          },
          tasks: {
            where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
            orderBy: { scheduledAt: "asc" },
          },
        },
      });
    }),

  create: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        code: z.string().min(1),
        serverId: z.string(),
        status: z.enum(["NEW", "OK", "ERROR", "SUSPENDED", "NOT_CONNECTED", "NOT_AVC", "BLOCKED"]).default("NEW"),
        sdkId: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify server belongs to project
      await ctx.prisma.server.findFirstOrThrow({ where: { id: input.serverId, projectId: input.projectId } });
      const { projectId: _, ...data } = input;
      const vm = await ctx.prisma.virtualMachine.create({ data });
      await createAuditLog({ action: "CREATE", entity: "VirtualMachine", entityId: vm.id, userId: (ctx.user as any).id, projectId: input.projectId, changes: { code: input.code, serverId: input.serverId, status: input.status } });
      return vm;
    }),

  update: infrastructureProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        status: z.enum(["NEW", "OK", "ERROR", "SUSPENDED", "NOT_CONNECTED", "NOT_AVC", "BLOCKED"]).optional(),
        sdkId: z.string().nullable().optional(),
        earnTotal: z.number().optional(),
        earn24h: z.number().optional(),
        uptime: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, ...data } = input;
      await ctx.prisma.virtualMachine.findFirstOrThrow({ where: { id, server: { projectId } } });
      const vm = await ctx.prisma.virtualMachine.update({ where: { id }, data });
      await createAuditLog({ action: "UPDATE", entity: "VirtualMachine", entityId: id, userId: (ctx.user as any).id, projectId, changes: data });
      return vm;
    }),

  // Get VMs without proxy assigned
  withoutProxy: infrastructureProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.virtualMachine.findMany({
        where: {
          server: { projectId: input.projectId },
          proxyId: null,
        },
        include: { server: { select: { code: true } } },
        orderBy: { code: "asc" },
      });
    }),

  // Bulk create VMs: M-001 to M-N
  bulkCreate: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      serverId: z.string(),
      prefix: z.string().default("M"),
      count: z.number().min(1).max(200),
      startFrom: z.number().min(1).default(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.server.findFirstOrThrow({ where: { id: input.serverId, projectId: input.projectId } });
      let created = 0;
      const errors: string[] = [];
      for (let i = 0; i < input.count; i++) {
        const num = input.startFrom + i;
        const code = `${input.prefix}-${String(num).padStart(3, "0")}`;
        try {
          await ctx.prisma.virtualMachine.create({
            data: { code, serverId: input.serverId, status: "NEW" },
          });
          created++;
        } catch {
          errors.push(`${code} already exists`);
        }
      }
      return { created, errors: errors.slice(0, 10) };
    }),

  // Bulk update status for multiple VMs
  bulkUpdateStatus: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      vmIds: z.array(z.string()).min(1),
      status: z.enum(["NEW", "OK", "ERROR", "SUSPENDED", "NOT_CONNECTED", "NOT_AVC", "BLOCKED"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.virtualMachine.updateMany({
        where: {
          id: { in: input.vmIds },
          server: { projectId: input.projectId },
        },
        data: { status: input.status },
      });
      await createAuditLog({ action: "BULK_UPDATE", entity: "VirtualMachine", entityId: input.vmIds[0], userId: (ctx.user as any).id, projectId: input.projectId, changes: { status: input.status, count: result.count, vmIds: input.vmIds } });
      return { updated: result.count };
    }),

  // Inline update a single field
  inlineUpdate: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      field: z.enum(["status", "sdkId", "notes", "code"]),
      value: z.string().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.virtualMachine.findFirstOrThrow({ where: { id: input.id, server: { projectId: input.projectId } } });
      return ctx.prisma.virtualMachine.update({
        where: { id: input.id },
        data: { [input.field]: input.value },
      });
    }),

  // Get all VMs for a server (no pagination, for spreadsheet view)
  listAll: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      serverId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      await ctx.prisma.server.findFirstOrThrow({ where: { id: input.serverId, projectId: input.projectId } });
      return ctx.prisma.virtualMachine.findMany({
        where: { serverId: input.serverId },
        orderBy: { code: "asc" },
        include: {
          proxy: { select: { id: true, address: true, status: true } },
          gmail: {
            select: {
              id: true, email: true, status: true,
              paypal: { select: { id: true, code: true, status: true } },
            },
          },
        },
      });
    }),

  // Delete VM
  delete: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const vm = await ctx.prisma.virtualMachine.findFirstOrThrow({ where: { id: input.id, server: { projectId: input.projectId } } });
      await createAuditLog({ action: "DELETE", entity: "VirtualMachine", entityId: input.id, userId: (ctx.user as any).id, projectId: input.projectId, changes: { code: vm.code, serverId: vm.serverId } });
      return ctx.prisma.virtualMachine.delete({ where: { id: input.id } });
    }),

  // Bulk delete VMs
  bulkDelete: moderatorProcedure
    .input(z.object({ projectId: z.string(), vmIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await createAuditLog({ action: "BULK_DELETE", entity: "VirtualMachine", entityId: input.vmIds[0], userId: (ctx.user as any).id, projectId: input.projectId, changes: { count: input.vmIds.length, vmIds: input.vmIds } });
      const result = await ctx.prisma.virtualMachine.deleteMany({
        where: { id: { in: input.vmIds }, server: { projectId: input.projectId } },
      });
      return { deleted: result.count };
    }),

  bulkImport: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        code: z.string().min(1),
        serverCode: z.string(),
        status: z.enum(["NEW", "OK", "ERROR", "SUSPENDED", "NOT_CONNECTED", "NOT_AVC", "BLOCKED"]).default("NEW"),
        sdkId: z.string().optional(),
        notes: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          const server = await ctx.prisma.server.findFirst({
            where: { code: item.serverCode, projectId: input.projectId },
          });
          if (!server) {
            errors.push(`Server ${item.serverCode} not found`);
            skipped++;
            continue;
          }
          const existing = await ctx.prisma.virtualMachine.findFirst({
            where: { code: item.code, serverId: server.id },
          });
          if (existing) {
            skipped++;
            continue;
          }
          await ctx.prisma.virtualMachine.create({
            data: {
              code: item.code,
              status: item.status,
              sdkId: item.sdkId,
              notes: item.notes,
              serverId: server.id,
            },
          });
          imported++;
        } catch (e: any) {
          errors.push(`${item.code}: ${e.message}`);
          skipped++;
        }
      }
      return { imported, skipped, errors: errors.slice(0, 10) };
    }),

  // Assign/unassign gmail to a single VM (max 2 VMs per Gmail)
  assignGmail: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      vmId: z.string(),
      gmailId: z.string().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const vm = await ctx.prisma.virtualMachine.findFirstOrThrow({
        where: { id: input.vmId, server: { projectId: input.projectId } },
        include: { server: { select: { gmailGroup: true } } },
      });
      if (input.gmailId) {
        const gmail = await ctx.prisma.gmailAccount.findFirstOrThrow({
          where: { id: input.gmailId, projectId: input.projectId },
        });
        // Check max VMs per Gmail based on server's gmailGroup
        const maxVms = vm.server.gmailGroup ?? 1;
        const assignedCount = await ctx.prisma.virtualMachine.count({ where: { gmailId: gmail.id, id: { not: vm.id }, server: { projectId: input.projectId } } });
        if (assignedCount >= maxVms) throw new Error(`Gmail already assigned to ${maxVms} VM(s)`);
        await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { gmailId: gmail.id } });
      } else {
        await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { gmailId: null } });
      }
      // Auto-set status OK if has gmail + proxy
      const updated = await ctx.prisma.virtualMachine.findUnique({ where: { id: vm.id } });
      if (updated && updated.gmailId && updated.proxyId && updated.status === "NEW") {
        await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { status: "OK" } });
      }
      await createAuditLog({ action: "ASSIGN", entity: "VirtualMachine", entityId: vm.id, userId: (ctx.user as any).id, projectId: input.projectId, changes: { type: "gmail", gmailId: input.gmailId, vmCode: vm.code } });
      return { success: true };
    }),

  // Assign/unassign proxy to a single VM
  assignProxy: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      vmId: z.string(),
      proxyId: z.string().nullable(), // null to unassign
    }))
    .mutation(async ({ ctx, input }) => {
      const vm = await ctx.prisma.virtualMachine.findFirstOrThrow({
        where: { id: input.vmId, server: { projectId: input.projectId } },
      });
      // Unassign current proxy
      if (vm.proxyId) {
        await ctx.prisma.virtualMachine.update({
          where: { id: vm.id },
          data: { proxyId: null },
        });
        await ctx.prisma.proxyIP.update({
          where: { id: vm.proxyId },
          data: { status: "AVAILABLE" },
        });
      }
      if (input.proxyId) {
        const proxy = await ctx.prisma.proxyIP.findFirstOrThrow({
          where: { id: input.proxyId, projectId: input.projectId },
        });
        // Unassign from old VM if any
        const oldVm = await ctx.prisma.virtualMachine.findFirst({
          where: { proxyId: proxy.id },
        });
        if (oldVm && oldVm.id !== vm.id) {
          await ctx.prisma.virtualMachine.update({
            where: { id: oldVm.id },
            data: { proxyId: null },
          });
        }
        await ctx.prisma.virtualMachine.update({
          where: { id: vm.id },
          data: { proxyId: proxy.id },
        });
        await ctx.prisma.proxyIP.update({
          where: { id: proxy.id },
          data: { status: "IN_USE" },
        });
      }
      // Auto-set status OK if has gmail + proxy
      const updated = await ctx.prisma.virtualMachine.findUnique({ where: { id: vm.id } });
      if (updated && updated.gmailId && updated.proxyId && updated.status === "NEW") {
        await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { status: "OK" } });
      }
      await createAuditLog({ action: "ASSIGN", entity: "VirtualMachine", entityId: vm.id, userId: (ctx.user as any).id, projectId: input.projectId, changes: { type: "proxy", proxyId: input.proxyId, vmCode: vm.code } });
      return { success: true };
    }),

  // Bulk paste: assign a list of values (gmail/proxy) to VMs in order
  bulkPaste: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      serverId: z.string(),
      field: z.enum(["gmail", "proxy", "paypal"]),
      values: z.array(z.string().min(1)),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.server.findFirstOrThrow({ where: { id: input.serverId, projectId: input.projectId } });
      const vms = await ctx.prisma.virtualMachine.findMany({
        where: { serverId: input.serverId },
        orderBy: { code: "asc" },
        select: { id: true, code: true },
      });

      let assigned = 0;
      const errors: string[] = [];

      for (let i = 0; i < Math.min(input.values.length, vms.length); i++) {
        const val = input.values[i].trim();
        if (!val) continue;
        const vm = vms[i];

        try {
          if (input.field === "gmail") {
            const gmail = await ctx.prisma.gmailAccount.findFirst({
              where: { projectId: input.projectId, email: { contains: val, mode: "insensitive" } },
            });
            if (!gmail) { errors.push(`Row ${i + 1}: Gmail "${val}" not found`); continue; }
            const assignedCount = await ctx.prisma.virtualMachine.count({ where: { gmailId: gmail.id, id: { not: vm.id }, server: { projectId: input.projectId } } });
            const maxVmsForPaste = vm.id ? (await ctx.prisma.virtualMachine.findUnique({ where: { id: vm.id }, include: { server: { select: { gmailGroup: true } } } }))?.server?.gmailGroup ?? 1 : 1;
            if (assignedCount >= maxVmsForPaste) { errors.push(`Row ${i + 1}: "${val}" already at max ${maxVmsForPaste} VMs`); continue; }
            await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { gmailId: gmail.id } });
            assigned++;
          } else if (input.field === "proxy") {
            // Find proxy by address (partial match)
            const proxy = await ctx.prisma.proxyIP.findFirst({
              where: {
                projectId: input.projectId,
                address: { contains: val, mode: "insensitive" },
              },
            });
            if (!proxy) { errors.push(`Row ${i + 1}: Proxy "${val}" not found`); continue; }
            // Unassign current proxy from VM
            if (vm.id) {
              await ctx.prisma.virtualMachine.update({
                where: { id: vm.id },
                data: { proxyId: null },
              });
            }
            // Check if proxy is already assigned to another VM
            const existingVm = await ctx.prisma.virtualMachine.findFirst({
              where: { proxyId: proxy.id },
            });
            if (existingVm && existingVm.id !== vm.id) {
              // Unassign from old VM
              await ctx.prisma.virtualMachine.update({
                where: { id: existingVm.id },
                data: { proxyId: null },
              });
            }
            await ctx.prisma.virtualMachine.update({
              where: { id: vm.id },
              data: { proxyId: proxy.id },
            });
            await ctx.prisma.proxyIP.update({
              where: { id: proxy.id },
              data: { status: "IN_USE" },
            });
            assigned++;
          } else if (input.field === "paypal") {
            // Find paypal by code or email
            const paypal = await ctx.prisma.payPalAccount.findFirst({
              where: {
                projectId: input.projectId,
                OR: [
                  { code: { contains: val, mode: "insensitive" } },
                  { primaryEmail: { contains: val, mode: "insensitive" } },
                ],
              },
            });
            if (!paypal) { errors.push(`Row ${i + 1}: PayPal "${val}" not found`); continue; }
            // VM must have gmail assigned
            const vmFull = await ctx.prisma.virtualMachine.findFirst({
              where: { id: vm.id },
              include: { gmail: true },
            });
            if (!vmFull?.gmail) { errors.push(`Row ${i + 1}: VM "${vm.code}" has no Gmail assigned`); continue; }
            await ctx.prisma.gmailAccount.update({
              where: { id: vmFull.gmail.id },
              data: { paypalId: paypal.id },
            });
            assigned++;
          }
        } catch (e: any) {
          errors.push(`Row ${i + 1}: ${e.message}`);
        }
      }

      if (input.values.length > vms.length) {
        errors.push(`Only ${vms.length} VMs on server, ${input.values.length - vms.length} values ignored`);
      }

      return { assigned, total: Math.min(input.values.length, vms.length), errors: errors.slice(0, 20) };
    }),

  // Bulk assign Gmail/Proxy to specific selected VM IDs (not whole server)
  bulkAssignSelected: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      vmIds: z.array(z.string()).min(1),
      field: z.enum(["gmail", "proxy"]),
      itemIds: z.array(z.string()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const vms = await ctx.prisma.virtualMachine.findMany({
        where: { id: { in: input.vmIds }, server: { projectId: input.projectId } },
        include: { server: { select: { gmailGroup: true } } },
        orderBy: { code: "asc" },
      });

      let assigned = 0;
      const errors: string[] = [];
      const count = Math.min(input.itemIds.length, vms.length);

      for (let i = 0; i < count; i++) {
        const vm = vms[i];
        const itemId = input.itemIds[i];
        try {
          if (input.field === "gmail") {
            const maxVms = vm.server.gmailGroup ?? 1;
            const assignedCount = await ctx.prisma.virtualMachine.count({ where: { gmailId: itemId, id: { not: vm.id }, server: { projectId: input.projectId } } });
            if (assignedCount >= maxVms) { errors.push(`${vm.code}: Gmail already at max ${maxVms} VMs`); continue; }
            await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { gmailId: itemId } });
            assigned++;
          } else {
            // Unassign old proxy
            if (vm.id) {
              const oldVm = await ctx.prisma.virtualMachine.findUnique({ where: { id: vm.id }, select: { proxyId: true } });
              if (oldVm?.proxyId) {
                await ctx.prisma.proxyIP.update({ where: { id: oldVm.proxyId }, data: { status: "AVAILABLE" } });
              }
            }
            await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { proxyId: itemId } });
            await ctx.prisma.proxyIP.update({ where: { id: itemId }, data: { status: "IN_USE" } });
            assigned++;
          }
          // Auto-set OK
          const updated = await ctx.prisma.virtualMachine.findUnique({ where: { id: vm.id } });
          if (updated && updated.gmailId && updated.proxyId && updated.status === "NEW") {
            await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { status: "OK" } });
          }
        } catch (e: any) {
          errors.push(`${vm.code}: ${e.message}`);
        }
      }
      return { assigned, total: count, errors: errors.slice(0, 20) };
    }),

  // Auto-fill single VM: assign first available Gmail + Proxy
  autoFill: infrastructureProcedure
    .input(z.object({ projectId: z.string(), vmId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const vm = await ctx.prisma.virtualMachine.findFirstOrThrow({
        where: { id: input.vmId, server: { projectId: input.projectId } },
        include: { gmail: true, proxy: true, server: { select: { gmailGroup: true } } },
      });
      const maxVms = vm.server.gmailGroup ?? 1;
      const results: string[] = [];

      // 1. Gmail (respect server's gmailGroup)
      if (!vm.gmailId) {
        // First try: find Gmail with no VMs
        const gmail = await ctx.prisma.gmailAccount.findFirst({
          where: { projectId: input.projectId, status: "ACTIVE", vms: { none: {} } },
          orderBy: { email: "asc" },
        });
        // Fallback for group 2: find Gmail with <maxVms
        let target = gmail;
        if (!target && maxVms > 1) {
          const candidates = await ctx.prisma.gmailAccount.findMany({
            where: { projectId: input.projectId, status: "ACTIVE" },
            include: { _count: { select: { vms: true } } },
            orderBy: { email: "asc" },
          });
          target = candidates.find(g => g._count.vms < maxVms) ?? null;
        }
        if (target) {
          await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { gmailId: target.id } });
          results.push(`Gmail: ${target.email}`);
        }
      }

      // 2. Proxy
      if (!vm.proxyId) {
        const proxy = await ctx.prisma.proxyIP.findFirst({
          where: { projectId: input.projectId, status: "AVAILABLE" },
          orderBy: { address: "asc" },
        });
        if (proxy) {
          await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { proxyId: proxy.id } });
          await ctx.prisma.proxyIP.update({ where: { id: proxy.id }, data: { status: "IN_USE" } });
          results.push(`Proxy: ${proxy.address}`);
        }
      }

      // Auto-set OK if both gmail + proxy
      const final = await ctx.prisma.virtualMachine.findUnique({ where: { id: vm.id } });
      if (final && final.gmailId && final.proxyId && final.status === "NEW") {
        await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { status: "OK" } });
      }

      return { filled: results.length, details: results };
    }),

  // Bulk auto-assign: assign available Gmail + Proxy to multiple VMs
  bulkAutoAssign: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      vmIds: z.array(z.string()).min(1),
      assignGmail: z.boolean().default(true),
      assignProxy: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const vms = await ctx.prisma.virtualMachine.findMany({
        where: { id: { in: input.vmIds }, server: { projectId: input.projectId } },
        include: { gmail: true, proxy: true, server: { select: { gmailGroup: true } } },
        orderBy: { code: "asc" },
      });

      let gmailCount = 0, proxyCount = 0;
      // Determine max VMs per Gmail from server's gmailGroup
      const maxVms = vms[0]?.server?.gmailGroup ?? 1;

      // Pre-fetch available resources (Gmail: those with < maxVms VMs)
      const availGmails = input.assignGmail ? await ctx.prisma.gmailAccount.findMany({
        where: { projectId: input.projectId, status: "ACTIVE" },
        include: { _count: { select: { vms: true } } },
        orderBy: { email: "asc" },
      }).then(gs => gs.filter(g => g._count.vms < maxVms)) : [];
      // Fetch proxies and shuffle by subnet (mix different subnets, avoid consecutive IPs)
      const shuffledProxies: any[] = [];
      if (input.assignProxy) {
        const rawProxies = await ctx.prisma.proxyIP.findMany({
          where: { projectId: input.projectId, status: "AVAILABLE" },
          orderBy: { address: "asc" },
        });
        // Group by subnet, then interleave (round-robin across subnets)
        const bySubnet: Record<string, typeof rawProxies> = {};
        for (const p of rawProxies) {
          const subnet = p.subnet || p.address.split(".").slice(0, 3).join(".");
          if (!bySubnet[subnet]) bySubnet[subnet] = [];
          bySubnet[subnet].push(p);
        }
        // Shuffle within each subnet
        const subnets = Object.keys(bySubnet);
        for (const s of subnets) {
          for (let i = bySubnet[s].length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bySubnet[s][i], bySubnet[s][j]] = [bySubnet[s][j], bySubnet[s][i]];
          }
        }
        // Shuffle subnet order
        for (let i = subnets.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [subnets[i], subnets[j]] = [subnets[j], subnets[i]];
        }
        // Round-robin interleave across subnets
        const indices = subnets.map(() => 0);
        let remaining = rawProxies.length;
        while (remaining > 0) {
          for (let si = 0; si < subnets.length && remaining > 0; si++) {
            const arr = bySubnet[subnets[si]];
            if (indices[si] < arr.length) {
              shuffledProxies.push(arr[indices[si]++]);
              remaining--;
            }
          }
        }
      }

      let gi = 0, pi = 0;
      const gmailUsage: Record<string, number> = {};

      for (const vm of vms) {
        // Gmail
        if (!vm.gmailId && gi < availGmails.length && input.assignGmail) {
          const gmail = availGmails[gi];
          const currentUsage = (gmailUsage[gmail.id] ?? gmail._count.vms);
          if (currentUsage < maxVms) {
            await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { gmailId: gmail.id } });
            gmailUsage[gmail.id] = currentUsage + 1;
            if (gmailUsage[gmail.id] >= maxVms) gi++;
            gmailCount++;
          } else { gi++; }
        }

        // Proxy (subnet-mixed)
        if (!vm.proxyId && pi < shuffledProxies.length && input.assignProxy) {
          const proxy = shuffledProxies[pi++];
          await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { proxyId: proxy.id } });
          await ctx.prisma.proxyIP.update({ where: { id: proxy.id }, data: { status: "IN_USE" } });
          proxyCount++;
        }

        // Auto-set OK
        const final = await ctx.prisma.virtualMachine.findUnique({ where: { id: vm.id } });
        if (final && final.gmailId && final.proxyId && final.status === "NEW") {
          await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { status: "OK" } });
        }
      }

      return {
        total: vms.length,
        gmail: gmailCount,
        proxy: proxyCount,
        paypal: 0,
      };
    }),

  // Preview: count available resources for quick assign
  availableCounts: infrastructureProcedure
    .input(z.object({ projectId: z.string(), serverId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      // Determine max VMs per Gmail from server's gmailGroup
      let maxVms = 1;
      if (input.serverId) {
        const server = await ctx.prisma.server.findUnique({ where: { id: input.serverId }, select: { gmailGroup: true } });
        maxVms = server?.gmailGroup ?? 1;
      }
      const gmails = await ctx.prisma.gmailAccount.findMany({
        where: { projectId: input.projectId, status: "ACTIVE" },
        include: { _count: { select: { vms: true } } },
      });
      const gmail = gmails.filter(g => g._count.vms < maxVms).length;
      const proxy = await ctx.prisma.proxyIP.count({ where: { projectId: input.projectId, status: "AVAILABLE" } });
      return { gmail, proxy };
    }),
});
