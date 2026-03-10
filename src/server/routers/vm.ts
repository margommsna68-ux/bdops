import { z } from "zod";
import { router, infrastructureProcedure, moderatorProcedure } from "../trpc";

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
      return ctx.prisma.virtualMachine.create({ data });
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
      return ctx.prisma.virtualMachine.update({ where: { id }, data });
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
      await ctx.prisma.virtualMachine.findFirstOrThrow({ where: { id: input.id, server: { projectId: input.projectId } } });
      return ctx.prisma.virtualMachine.delete({ where: { id: input.id } });
    }),

  // Bulk delete VMs
  bulkDelete: moderatorProcedure
    .input(z.object({ projectId: z.string(), vmIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
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

  // Assign/unassign gmail to a single VM
  assignGmail: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      vmId: z.string(),
      gmailId: z.string().nullable(), // null to unassign
    }))
    .mutation(async ({ ctx, input }) => {
      const vm = await ctx.prisma.virtualMachine.findFirstOrThrow({
        where: { id: input.vmId, server: { projectId: input.projectId } },
      });
      // Unassign current gmail from this VM
      await ctx.prisma.gmailAccount.updateMany({
        where: { vmId: vm.id },
        data: { vmId: null },
      });
      if (input.gmailId) {
        // Check gmail belongs to project and not assigned elsewhere
        const gmail = await ctx.prisma.gmailAccount.findFirstOrThrow({
          where: { id: input.gmailId, projectId: input.projectId },
        });
        if (gmail.vmId && gmail.vmId !== vm.id) {
          throw new Error(`Gmail already assigned to another VM`);
        }
        await ctx.prisma.gmailAccount.update({
          where: { id: input.gmailId },
          data: { vmId: vm.id },
        });
      }
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
      return { success: true };
    }),

  // Assign/unassign paypal to a VM (via gmail bridge)
  assignPaypal: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      vmId: z.string(),
      paypalId: z.string().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const vm = await ctx.prisma.virtualMachine.findFirstOrThrow({
        where: { id: input.vmId, server: { projectId: input.projectId } },
        include: { gmail: true },
      });
      if (!vm.gmail) {
        throw new Error("VM must have a Gmail assigned before assigning PayPal");
      }
      if (input.paypalId) {
        await ctx.prisma.payPalAccount.findFirstOrThrow({
          where: { id: input.paypalId, projectId: input.projectId },
        });
      }
      await ctx.prisma.gmailAccount.update({
        where: { id: vm.gmail.id },
        data: { paypalId: input.paypalId },
      });
      return { success: true };
    }),

  // Bulk paste: assign a list of values (gmail/proxy/paypal) to VMs in order
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
            // Find gmail by email (partial match)
            const gmail = await ctx.prisma.gmailAccount.findFirst({
              where: {
                projectId: input.projectId,
                email: { contains: val, mode: "insensitive" },
              },
            });
            if (!gmail) { errors.push(`Row ${i + 1}: Gmail "${val}" not found`); continue; }
            // Check if already assigned to another VM
            if (gmail.vmId && gmail.vmId !== vm.id) {
              errors.push(`Row ${i + 1}: "${val}" already assigned to another VM`);
              continue;
            }
            // Unassign current gmail from VM if any
            await ctx.prisma.gmailAccount.updateMany({
              where: { vmId: vm.id },
              data: { vmId: null },
            });
            // Assign new gmail
            await ctx.prisma.gmailAccount.update({
              where: { id: gmail.id },
              data: { vmId: vm.id },
            });
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

  // Auto-fill single VM: assign first available Gmail + Proxy + PayPal
  autoFill: infrastructureProcedure
    .input(z.object({ projectId: z.string(), vmId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const vm = await ctx.prisma.virtualMachine.findFirstOrThrow({
        where: { id: input.vmId, server: { projectId: input.projectId } },
        include: { gmail: true, proxy: true },
      });
      const results: string[] = [];

      // 1. Gmail
      if (!vm.gmail) {
        const gmail = await ctx.prisma.gmailAccount.findFirst({
          where: { projectId: input.projectId, status: "ACTIVE", vmId: null },
          orderBy: { email: "asc" },
        });
        if (gmail) {
          await ctx.prisma.gmailAccount.update({ where: { id: gmail.id }, data: { vmId: vm.id } });
          results.push(`Gmail: ${gmail.email}`);

          // 3. PayPal (needs gmail first)
          const paypal = await ctx.prisma.payPalAccount.findFirst({
            where: { projectId: input.projectId, status: "ACTIVE", gmails: { none: {} } },
            orderBy: { code: "asc" },
          });
          if (paypal) {
            await ctx.prisma.gmailAccount.update({ where: { id: gmail.id }, data: { paypalId: paypal.id } });
            results.push(`PayPal: ${paypal.code}`);
          }
        }
      } else if (!vm.gmail.paypalId) {
        // VM has gmail but no paypal
        const paypal = await ctx.prisma.payPalAccount.findFirst({
          where: { projectId: input.projectId, status: "ACTIVE", gmails: { none: {} } },
          orderBy: { code: "asc" },
        });
        if (paypal) {
          await ctx.prisma.gmailAccount.update({ where: { id: vm.gmail.id }, data: { paypalId: paypal.id } });
          results.push(`PayPal: ${paypal.code}`);
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

      return { filled: results.length, details: results };
    }),

  // Bulk auto-assign: assign available Gmail + Proxy + PayPal to multiple VMs
  bulkAutoAssign: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      vmIds: z.array(z.string()).min(1),
      assignGmail: z.boolean().default(true),
      assignProxy: z.boolean().default(true),
      assignPaypal: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const vms = await ctx.prisma.virtualMachine.findMany({
        where: { id: { in: input.vmIds }, server: { projectId: input.projectId } },
        include: { gmail: true, proxy: true },
        orderBy: { code: "asc" },
      });

      let gmailCount = 0, proxyCount = 0, paypalCount = 0;

      // Pre-fetch available resources
      const availGmails = input.assignGmail ? await ctx.prisma.gmailAccount.findMany({
        where: { projectId: input.projectId, status: "ACTIVE", vmId: null },
        orderBy: { email: "asc" },
      }) : [];
      const availProxies = input.assignProxy ? await ctx.prisma.proxyIP.findMany({
        where: { projectId: input.projectId, status: "AVAILABLE" },
        orderBy: { address: "asc" },
      }) : [];
      const availPaypals = input.assignPaypal ? await ctx.prisma.payPalAccount.findMany({
        where: { projectId: input.projectId, status: "ACTIVE", gmails: { none: {} } },
        orderBy: { code: "asc" },
      }) : [];

      let gi = 0, pi = 0, ppi = 0;

      for (const vm of vms) {
        // Gmail
        let gmailId = vm.gmail?.id;
        if (!vm.gmail && gi < availGmails.length && input.assignGmail) {
          const gmail = availGmails[gi++];
          await ctx.prisma.gmailAccount.update({ where: { id: gmail.id }, data: { vmId: vm.id } });
          gmailId = gmail.id;
          gmailCount++;
        }

        // Proxy
        if (!vm.proxyId && pi < availProxies.length && input.assignProxy) {
          const proxy = availProxies[pi++];
          await ctx.prisma.virtualMachine.update({ where: { id: vm.id }, data: { proxyId: proxy.id } });
          await ctx.prisma.proxyIP.update({ where: { id: proxy.id }, data: { status: "IN_USE" } });
          proxyCount++;
        }

        // PayPal (needs gmail)
        if (gmailId && input.assignPaypal) {
          const currentGmail = vm.gmail || availGmails[gi - 1];
          if (currentGmail && !currentGmail.paypalId && ppi < availPaypals.length) {
            const paypal = availPaypals[ppi++];
            await ctx.prisma.gmailAccount.update({ where: { id: gmailId }, data: { paypalId: paypal.id } });
            paypalCount++;
          }
        }
      }

      return {
        total: vms.length,
        gmail: gmailCount,
        proxy: proxyCount,
        paypal: paypalCount,
        availableLeft: {
          gmail: availGmails.length - gi,
          proxy: availProxies.length - pi,
          paypal: availPaypals.length - ppi,
        },
      };
    }),

  // Preview: count available resources for quick assign
  availableCounts: infrastructureProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [gmail, proxy, paypal] = await Promise.all([
        ctx.prisma.gmailAccount.count({ where: { projectId: input.projectId, status: "ACTIVE", vmId: null } }),
        ctx.prisma.proxyIP.count({ where: { projectId: input.projectId, status: "AVAILABLE" } }),
        ctx.prisma.payPalAccount.count({ where: { projectId: input.projectId, status: "ACTIVE", gmails: { none: {} } } }),
      ]);
      return { gmail, proxy, paypal };
    }),
});
