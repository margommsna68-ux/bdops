import { z } from "zod";
import { router, infrastructureProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";
import { EarnWithdrawalStatus } from "@prisma/client";

export const earnWithdrawalRouter = router({
  // ═══ List earn account rows per server ═══
  listByServer: infrastructureProcedure
    .input(z.object({ projectId: z.string(), serverId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.serverId) where.id = input.serverId;

      const servers = await ctx.prisma.server.findMany({
        where,
        select: {
          id: true, code: true, gmailGroup: true,
          vms: {
            select: {
              id: true, code: true, gmailId: true,
              gmail: {
                select: {
                  id: true, email: true, status: true,
                  paypal: { select: { id: true, code: true, status: true } },
                },
              },
            },
            orderBy: { code: "asc" },
          },
        },
        orderBy: { code: "asc" },
      });

      // For each server, group VMs by gmailId to build rows
      const result = [];
      for (const server of servers) {
        const gmailGroups = new Map<string, { gmail: any; vms: any[] }>();
        const noGmailVms: any[] = [];

        for (const vm of server.vms) {
          if (vm.gmailId && vm.gmail) {
            const group = gmailGroups.get(vm.gmailId);
            if (group) {
              group.vms.push(vm);
            } else {
              gmailGroups.set(vm.gmailId, { gmail: vm.gmail, vms: [vm] });
            }
          } else {
            noGmailVms.push(vm);
          }
        }

        // Fetch latest EarnWithdrawal per gmail for this server
        const gmailIds = Array.from(gmailGroups.keys());
        const latestWithdrawals = gmailIds.length > 0
          ? await ctx.prisma.earnWithdrawal.findMany({
              where: { serverId: server.id, gmailId: { in: gmailIds }, projectId: input.projectId },
              orderBy: { createdAt: "desc" },
              distinct: ["gmailId"],
              select: {
                id: true, vmCodes: true, amount: true, date: true, time: true,
                status: true, notes: true, round: true, gmailId: true,
                paypal: { select: { id: true, code: true, primaryEmail: true } },
                createdAt: true,
              },
            })
          : [];

        const latestMap = new Map(latestWithdrawals.map((w) => [w.gmailId, w]));

        // Build rows — paypal from latest withdrawal takes priority over gmail.paypal
        const rows = [];
        for (const [gmailId, group] of Array.from(gmailGroups.entries())) {
          const vmCodes = group.vms.map((v: any) => v.code).sort().join("-");
          const latest = latestMap.get(gmailId) ?? null;
          const ppFromWithdrawal = latest?.paypal;
          const ppFromGmail = group.gmail.paypal;
          rows.push({
            gmailId,
            gmailEmail: group.gmail.email,
            gmailStatus: group.gmail.status,
            paypalId: ppFromWithdrawal?.id ?? ppFromGmail?.id ?? null,
            paypalCode: ppFromWithdrawal?.code ?? ppFromGmail?.code ?? null,
            paypalStatus: ppFromGmail?.status ?? null,
            vmCodes,
            vmIds: group.vms.map((v: any) => v.id),
            latest,
          });
        }

        // Add VMs without gmail as empty rows
        for (const vm of noGmailVms) {
          rows.push({
            gmailId: null,
            gmailEmail: null,
            gmailStatus: null,
            paypalId: null,
            paypalCode: null,
            paypalStatus: null,
            vmCodes: vm.code,
            vmIds: [vm.id],
            latest: null,
          });
        }

        result.push({
          serverId: server.id,
          serverCode: server.code,
          gmailGroup: server.gmailGroup,
          rows,
          totalRows: rows.length,
        });
      }

      return result;
    }),

  // ═══ Create new withdrawal record ═══
  create: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      serverId: z.string(),
      gmailId: z.string(),
      vmCodes: z.string(),
      paypalId: z.string().nullable().optional(),
      amount: z.number().positive().optional(),
      date: z.string().optional(),
      time: z.string().optional(),
      status: z.nativeEnum(EarnWithdrawalStatus).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Auto-derive paypalId from gmail if not provided
      let paypalId = input.paypalId;
      if (!paypalId) {
        const gmail = await ctx.prisma.gmailAccount.findUnique({
          where: { id: input.gmailId },
          select: { paypalId: true },
        });
        paypalId = gmail?.paypalId ?? null;
      }

      // Compute round
      const maxRound = await ctx.prisma.earnWithdrawal.aggregate({
        where: { gmailId: input.gmailId, serverId: input.serverId, projectId: input.projectId },
        _max: { round: true },
      });
      const round = (maxRound._max.round ?? 0) + 1;

      const record = await ctx.prisma.earnWithdrawal.create({
        data: {
          vmCodes: input.vmCodes,
          amount: input.amount,
          date: input.date ? new Date(input.date) : null,
          time: input.time || null,
          status: input.status ?? "PENDING",
          notes: input.notes || null,
          round,
          gmailId: input.gmailId,
          paypalId,
          serverId: input.serverId,
          projectId: input.projectId,
        },
      });

      await createAuditLog({
        action: "CREATE", entity: "EarnWithdrawal", entityId: record.id,
        projectId: input.projectId, userId: (ctx.session!.user as any).id,
        changes: { vmCodes: input.vmCodes, round },
      });

      return record;
    }),

  // ═══ Update (inline edit) ═══
  update: infrastructureProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      amount: z.number().nullable().optional(),
      date: z.string().nullable().optional(),
      time: z.string().nullable().optional(),
      status: z.nativeEnum(EarnWithdrawalStatus).optional(),
      notes: z.string().nullable().optional(),
      paypalId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.earnWithdrawal.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
      });

      const data: any = {};
      if (input.amount !== undefined) data.amount = input.amount;
      if (input.date !== undefined) data.date = input.date ? new Date(input.date) : null;
      if (input.time !== undefined) data.time = input.time;
      if (input.status !== undefined) data.status = input.status;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.paypalId !== undefined) data.paypalId = input.paypalId;

      const updated = await ctx.prisma.earnWithdrawal.update({
        where: { id: input.id },
        data,
      });

      return updated;
    }),

  // ═══ History per gmail+server ═══
  history: infrastructureProcedure
    .input(z.object({ projectId: z.string(), gmailId: z.string(), serverId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.earnWithdrawal.findMany({
        where: { gmailId: input.gmailId, serverId: input.serverId, projectId: input.projectId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, vmCodes: true, amount: true, date: true, time: true,
          status: true, notes: true, round: true, createdAt: true,
          paypal: { select: { code: true } },
        },
      });
    }),

  // ═══ Server overview stats ═══
  serverOverview: infrastructureProcedure
    .input(z.object({ projectId: z.string(), serverId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.serverId) where.serverId = input.serverId;

      // Get latest withdrawal per gmail (need to compute in app layer)
      const allLatest = await ctx.prisma.earnWithdrawal.findMany({
        where,
        orderBy: { createdAt: "desc" },
        distinct: ["gmailId"],
        select: { status: true, amount: true },
      });

      const counts: Record<string, number> = { PENDING: 0, WITHDRAWAL: 0, PAID: 0, SUSPEND: 0, PP_LIMIT: 0 };
      let totalAmount = 0;
      for (const w of allLatest) {
        counts[w.status] = (counts[w.status] || 0) + 1;
        totalAmount += Number(w.amount ?? 0);
      }

      return { counts, totalAmount, totalAccounts: allLatest.length };
    }),

  // ═══ Bulk create new round for all active gmails on a server ═══
  bulkCreateRound: infrastructureProcedure
    .input(z.object({ projectId: z.string(), serverId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Get all gmail groups on this server
      const vms = await ctx.prisma.virtualMachine.findMany({
        where: { serverId: input.serverId, gmailId: { not: null } },
        select: { code: true, gmailId: true, gmail: { select: { paypalId: true } } },
        orderBy: { code: "asc" },
      });

      const gmailGroups = new Map<string, { vmCodes: string[]; paypalId: string | null }>();
      for (const vm of vms) {
        if (!vm.gmailId) continue;
        const g = gmailGroups.get(vm.gmailId);
        if (g) {
          g.vmCodes.push(vm.code);
        } else {
          gmailGroups.set(vm.gmailId, {
            vmCodes: [vm.code],
            paypalId: vm.gmail?.paypalId ?? null,
          });
        }
      }

      let created = 0;
      for (const [gmailId, group] of Array.from(gmailGroups.entries())) {
        const maxRound = await ctx.prisma.earnWithdrawal.aggregate({
          where: { gmailId, serverId: input.serverId, projectId: input.projectId },
          _max: { round: true },
        });
        const round = (maxRound._max.round ?? 0) + 1;

        await ctx.prisma.earnWithdrawal.create({
          data: {
            vmCodes: group.vmCodes.sort().join("-"),
            status: "PENDING",
            round,
            gmailId,
            paypalId: group.paypalId,
            serverId: input.serverId,
            projectId: input.projectId,
          },
        });
        created++;
      }

      return { created };
    }),
});
