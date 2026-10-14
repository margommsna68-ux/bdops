import { z } from "zod";
import { router, fundsProcedure, moderatorProcedure } from "../trpc";
import { createAuditLog } from "@/lib/audit";
import { decrypt } from "@/lib/encryption";
import { readMailbox } from "@/lib/pp-checker";
import { findMatchingPayment } from "@/lib/paypal-payment-parser";
import { fetchBDSheet, filterByDateAndStatus, getTodayDDMMYYYY } from "@/lib/bd-sheet-parser";
// encrypt unused here but kept for potential future use

export const fundRouter = router({
  list: fundsProcedure
    .input(
      z.object({
        projectId: z.string(),
        paypalId: z.string().optional(),
        serverId: z.string().optional(),
        confirmed: z.boolean().optional(),
        failed: z.boolean().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        search: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.paypalId) where.paypalId = input.paypalId;
      if (input.confirmed !== undefined) where.confirmed = input.confirmed;
      if (input.failed !== undefined) where.failed = input.failed;
      if (input.dateFrom || input.dateTo) {
        where.date = {};
        // Parse as VN timezone (UTC+7) — "2026-04-02" → 2026-04-01T17:00:00Z (start of day VN)
        if (input.dateFrom) where.date.gte = new Date(`${input.dateFrom}T00:00:00+07:00`);
        if (input.dateTo) where.date.lte = new Date(`${input.dateTo}T23:59:59.999+07:00`);
      }
      if (input.search) {
        where.OR = [
          { transactionId: { contains: input.search, mode: "insensitive" } },
          { paypal: { code: { contains: input.search, mode: "insensitive" } } },
        ];
      }

      if (input.serverId) where.serverId = input.serverId;

      const [items, total] = await Promise.all([
        ctx.prisma.fundTransaction.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          include: {
            paypal: {
              select: {
                code: true, primaryEmail: true, holder: true, vmppCode: true,
                emails: { select: { email: true }, orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }], take: 5 },
              },
            },
            server: { select: { code: true } },
            vm: { select: { code: true } },
          },
        }),
        ctx.prisma.fundTransaction.count({ where }),
      ]);

      // Resolve creator names
      const creatorIds = Array.from(new Set(items.map((i) => i.createdById).filter(Boolean))) as string[];
      const creators = creatorIds.length > 0 ? await ctx.prisma.user.findMany({
        where: { id: { in: creatorIds as string[] } },
        select: { id: true, name: true, username: true },
      }) : [];
      const creatorMap = new Map(creators.map((u) => [u.id, u.name || u.username || "?"]));
      const enrichedItems = items.map((i) => ({ ...i, createdByName: i.createdById ? creatorMap.get(i.createdById) || null : null }));

      return { items: enrichedItems, total, page: input.page, limit: input.limit };
    }),

  create: fundsProcedure
    .input(
      z.object({
        projectId: z.string(),
        date: z.string().refine((d) => new Date(d) <= new Date(), {
          message: "Date cannot be in the future",
        }),
        amount: z.number().positive(),
        transactionId: z.string().optional(),
        confirmed: z.boolean().default(false),
        company: z.string().default("Bright Data Ltd."),
        notes: z.string().optional(),
        paypalId: z.string(),
        serverId: z.string().optional(),
        vmId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Generate unique transactionId if not provided
      const transactionId = input.transactionId || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Verify PayPal belongs to same project
      const pp = await ctx.prisma.payPalAccount.findFirst({
        where: { id: input.paypalId, projectId: input.projectId },
      });
      if (!pp) throw new Error("PayPal account not found in this project");

      // Verify server belongs to project if provided
      if (input.serverId) {
        const srv = await ctx.prisma.server.findFirst({
          where: { id: input.serverId, projectId: input.projectId },
        });
        if (!srv) throw new Error("Server not found in this project");
      }

      // Verify VM belongs to selected server if provided
      if (input.vmId) {
        const vm = await ctx.prisma.virtualMachine.findFirst({
          where: { id: input.vmId, serverId: input.serverId || undefined },
        });
        if (!vm) throw new Error("VM not found on this server");
      }

      // Check for potential duplicate (same amount + date + paypal)
      const inputDate = new Date(input.date);
      const dayStart = new Date(inputDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(inputDate);
      dayEnd.setHours(23, 59, 59, 999);
      const duplicate = await ctx.prisma.fundTransaction.findFirst({
        where: {
          projectId: input.projectId,
          paypalId: input.paypalId,
          amount: input.amount,
          date: { gte: dayStart, lte: dayEnd },
        },
      });
      if (duplicate) {
        throw new Error(`Potential duplicate: TX ${duplicate.transactionId} has same amount ($${input.amount}) on same day for same PayPal`);
      }

      const result = await ctx.prisma.fundTransaction.create({
        data: {
          ...input,
          transactionId,
          date: new Date(input.date),
          amount: input.amount,
          createdById: ctx.user.id,
        },
      });
      await createAuditLog({
        action: "CREATE",
        entity: "FundTransaction",
        entityId: result.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { amount: input.amount, transactionId, paypalId: input.paypalId },
      });
      return result;
    }),

  update: fundsProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        date: z.string().optional(),
        transactionId: z.string().optional(),
        confirmed: z.boolean().optional(),
        failed: z.boolean().optional(),
        notes: z.string().nullable().optional(),
        amount: z.number().positive().optional(),
        serverId: z.string().nullable().optional(),
        vmId: z.string().nullable().optional(),
        paypalId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, date, ...data } = input;
      await ctx.prisma.fundTransaction.findFirstOrThrow({ where: { id, projectId } });
      const updateData: any = { ...data };
      if (date) updateData.date = new Date(date);
      const result = await ctx.prisma.fundTransaction.update({ where: { id }, data: updateData });
      await createAuditLog({
        action: "UPDATE",
        entity: "FundTransaction",
        entityId: id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: data,
      });
      return result;
    }),

  delete: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.fundTransaction.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      const result = await ctx.prisma.fundTransaction.delete({ where: { id: input.id } });
      await createAuditLog({
        action: "DELETE",
        entity: "FundTransaction",
        entityId: input.id,
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { amount: existing.amount, transactionId: existing.transactionId },
      });
      return result;
    }),

  todaySummary: fundsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const funds = await ctx.prisma.fundTransaction.findMany({
        where: {
          projectId: input.projectId,
          date: { gte: today, lt: tomorrow },
        },
        include: {
          paypal: { select: { code: true } },
          server: { select: { code: true } },
          vm: { select: { code: true } },
        },
        orderBy: { date: "desc" },
      });

      const total = await ctx.prisma.fundTransaction.aggregate({
        where: {
          projectId: input.projectId,
          date: { gte: today, lt: tomorrow },
        },
        _sum: { amount: true },
        _count: true,
      });

      return {
        funds,
        totalAmount: total._sum.amount ?? 0,
        count: total._count,
      };
    }),

  unconfirmed: fundsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.fundTransaction.findMany({
        where: { projectId: input.projectId, confirmed: false },
        include: {
          paypal: { select: { code: true } },
          server: { select: { code: true } },
          vm: { select: { code: true } },
        },
        orderBy: { date: "desc" },
      });
    }),

  // Confirmed total all-time
  confirmedTotal: fundsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.prisma.fundTransaction.aggregate({
        where: { projectId: input.projectId, confirmed: true },
        _sum: { amount: true },
        _count: true,
      });
      return {
        amount: result._sum.amount ?? 0,
        count: result._count,
      };
    }),

  dailySummary: fundsProcedure
    .input(
      z.object({
        projectId: z.string(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.dateFrom || input.dateTo) {
        where.date = {};
        // Parse as VN timezone (UTC+7) — "2026-04-02" → 2026-04-01T17:00:00Z (start of day VN)
        if (input.dateFrom) where.date.gte = new Date(`${input.dateFrom}T00:00:00+07:00`);
        if (input.dateTo) where.date.lte = new Date(`${input.dateTo}T23:59:59.999+07:00`);
      }

      return ctx.prisma.fundTransaction.groupBy({
        by: ["date"],
        where,
        _sum: { amount: true },
        _count: true,
        orderBy: { date: "desc" },
      });
    }),

  bulkConfirm: fundsProcedure
    .input(z.object({
      projectId: z.string(),
      ids: z.array(z.string()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify all belong to project
      const count = await ctx.prisma.fundTransaction.count({
        where: { id: { in: input.ids }, projectId: input.projectId },
      });
      if (count !== input.ids.length) {
        throw new Error("Some transactions not found in this project");
      }
      const result = await ctx.prisma.fundTransaction.updateMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
        data: { confirmed: true },
      });
      await createAuditLog({
        action: "UPDATE",
        entity: "FundTransaction",
        entityId: input.ids.join(","),
        userId: ctx.user.id,
        projectId: input.projectId,
        changes: { bulkConfirm: true, count: result.count },
      });
      return { confirmed: result.count };
    }),

  bulkImport: fundsProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        date: z.string(),
        amount: z.number().positive(),
        transactionId: z.string().optional(),
        confirmed: z.boolean().default(false),
        company: z.string().default("Bright Data Ltd."),
        notes: z.string().optional(),
        paypalCode: z.string(),
        serverCode: z.string().optional(),
        vmCode: z.string().optional(),
      })).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          const pp = await ctx.prisma.payPalAccount.findFirst({
            where: { code: item.paypalCode, projectId: input.projectId },
          });
          if (!pp) {
            errors.push(`PP ${item.paypalCode} not found`);
            skipped++;
            continue;
          }
          // Auto-generate transactionId if empty
          const txId = item.transactionId || `IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          // Skip if transactionId already exists
          if (item.transactionId) {
            const existing = await ctx.prisma.fundTransaction.findFirst({
              where: { transactionId: item.transactionId, projectId: input.projectId },
            });
            if (existing) {
              skipped++;
              continue;
            }
          }
          let serverId: string | undefined;
          let vmId: string | undefined;
          if (item.serverCode) {
            const srv = await ctx.prisma.server.findFirst({
              where: { code: item.serverCode, projectId: input.projectId },
            });
            if (srv) serverId = srv.id;
          }
          if (item.vmCode && serverId) {
            const vm = await ctx.prisma.virtualMachine.findFirst({
              where: { code: item.vmCode, serverId },
            });
            if (vm) vmId = vm.id;
          }
          await ctx.prisma.fundTransaction.create({
            data: {
              date: new Date(item.date),
              amount: item.amount,
              transactionId: txId,
              confirmed: item.confirmed,
              company: item.company,
              notes: item.notes,
              paypalId: pp.id,
              serverId,
              vmId,
              projectId: input.projectId,
              createdById: (ctx.user as any).id,
            },
          });
          imported++;
        } catch (e: any) {
          errors.push(`Row ${item.transactionId}: ${e.message}`);
          skipped++;
        }
      }
      return { imported, skipped, errors: errors.slice(0, 10) };
    }),

  bulkCreate: fundsProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        date: z.string(),
        amount: z.number().positive(),
        transactionId: z.string().optional(),
        confirmed: z.boolean().default(false),
        company: z.string().default("Bright Data Ltd."),
        paypalId: z.string(),
        serverId: z.string().optional(),
        vmId: z.string().optional(),
      })).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      let created = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          const pp = await ctx.prisma.payPalAccount.findFirst({
            where: { id: item.paypalId, projectId: input.projectId },
          });
          if (!pp) { errors.push("PayPal not found"); continue; }

          if (item.serverId) {
            const srv = await ctx.prisma.server.findFirst({
              where: { id: item.serverId, projectId: input.projectId },
            });
            if (!srv) { errors.push("Server not found"); continue; }
          }

          if (item.vmId) {
            const vm = await ctx.prisma.virtualMachine.findFirst({
              where: { id: item.vmId, serverId: item.serverId || undefined },
            });
            if (!vm) { errors.push("VM not found"); continue; }
          }

          const bulkTxId = item.transactionId || `BULK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await ctx.prisma.fundTransaction.create({
            data: {
              date: new Date(item.date),
              amount: item.amount,
              transactionId: bulkTxId,
              confirmed: item.confirmed,
              company: item.company,
              paypalId: item.paypalId,
              serverId: item.serverId || null,
              vmId: item.vmId || null,
              projectId: input.projectId,
              createdById: (ctx.user as any).id,
            },
          });
          await createAuditLog({
            action: "CREATE",
            entity: "FundTransaction",
            entityId: "bulk",
            userId: ctx.user.id,
            projectId: input.projectId,
            changes: { amount: item.amount, paypalId: item.paypalId },
          });
          created++;
        } catch (e: any) {
          errors.push(e.message);
        }
      }

      return { created, errors };
    }),

  // Confirmed funds grouped by PayPal — for withdrawal/mixing flow
  confirmedByPaypal: fundsProcedure
    .input(z.object({
      projectId: z.string(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: any = {
        projectId: input.projectId,
        confirmed: true,
      };
      if (input.dateFrom || input.dateTo) {
        where.date = {};
        if (input.dateFrom) where.date.gte = new Date(input.dateFrom);
        if (input.dateTo) where.date.lte = new Date(input.dateTo + "T23:59:59");
      }

      const funds = await ctx.prisma.fundTransaction.findMany({
        where,
        include: {
          paypal: { select: { id: true, code: true, primaryEmail: true, role: true, holder: true, vmppCode: true } },
          server: { select: { code: true } },
          vm: { select: { code: true } },
        },
        orderBy: { date: "desc" },
      });

      // Group by paypal
      const grouped: Record<string, {
        paypalId: string;
        paypalCode: string;
        paypalEmail: string;
        paypalRole: string;
        holder: string | null;
        vmppCode: string | null;
        totalAmount: number;
        transactions: typeof funds;
      }> = {};

      for (const f of funds) {
        if (!grouped[f.paypalId]) {
          grouped[f.paypalId] = {
            paypalId: f.paypalId,
            paypalCode: f.paypal.code,
            paypalEmail: f.paypal.primaryEmail,
            paypalRole: f.paypal.role,
            holder: f.paypal.holder,
            vmppCode: f.paypal.vmppCode,
            totalAmount: 0,
            transactions: [],
          };
        }
        grouped[f.paypalId].totalAmount += Number(f.amount);
        grouped[f.paypalId].transactions.push(f);
      }

      return Object.values(grouped).sort((a, b) => b.totalAmount - a.totalAmount);
    }),

  serverTotals: fundsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.prisma.fundTransaction.groupBy({
        by: ["serverId"],
        where: { projectId: input.projectId, confirmed: true },
        _sum: { amount: true },
        _count: true,
      });
      return results
        .filter((r) => r.serverId)
        .map((r) => ({
          serverId: r.serverId!,
          total: Number(r._sum.amount ?? 0),
          count: r._count,
        }));
    }),

  // ─── Lookup PP by codes (for PAYPAL_ONLY quick add) ───
  lookupPPCodes: fundsProcedure
    .input(z.object({
      projectId: z.string(),
      codes: z.array(z.string().min(1)),
    }))
    .query(async ({ ctx, input }) => {
      const pps = await ctx.prisma.payPalAccount.findMany({
        where: {
          projectId: input.projectId,
          OR: input.codes.map((code) => ({
            OR: [
              { code: { equals: code, mode: "insensitive" as const } },
              { primaryEmail: { equals: code, mode: "insensitive" as const } },
            ],
          })),
        },
        select: {
          id: true,
          code: true,
          primaryEmail: true,
          holder: true,
          vmppCode: true,
          status: true,
          emails: { select: { email: true }, orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }], take: 5 },
        },
      });

      // Aggregate balances
      const [fundAggs, withdrawalAggs] = await Promise.all([
        ctx.prisma.fundTransaction.groupBy({
          by: ["paypalId"],
          where: { paypalId: { in: pps.map((p) => p.id) } },
          _sum: { amount: true },
        }),
        ctx.prisma.withdrawal.groupBy({
          by: ["sourcePaypalId"],
          where: { sourcePaypalId: { in: pps.map((p) => p.id) } },
          _sum: { amount: true },
        }),
      ]);
      const fundMap = new Map(fundAggs.map((f) => [f.paypalId, Number(f._sum.amount ?? 0)]));
      const withdrawMap = new Map(withdrawalAggs.map((w) => [w.sourcePaypalId, Number(w._sum.amount ?? 0)]));

      return pps.map((pp) => ({
        ...pp,
        balance: (fundMap.get(pp.id) ?? 0) - (withdrawMap.get(pp.id) ?? 0),
      }));
    }),

  // ─── Quick add funds by PP code (PAYPAL_ONLY projects) ───
  quickAddByPPCode: fundsProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        paypalId: z.string(),
        amount: z.number().positive(),
        notes: z.string().optional(),
      })).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      let created = 0;
      for (const item of input.items) {
        // Verify PP belongs to this project (multi-tenancy)
        const pp = await ctx.prisma.payPalAccount.findFirst({
          where: { id: item.paypalId, projectId: input.projectId },
        });
        if (!pp) continue; // skip invalid PP

        await ctx.prisma.fundTransaction.create({
          data: {
            date: new Date(),
            amount: item.amount,
            transactionId: `QA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            paypalId: item.paypalId,
            projectId: input.projectId,
            confirmed: false,
            notes: item.notes || null,
            createdById: (ctx.user as any).id,
          },
        });
        created++;
      }
      await createAuditLog({
        action: "CREATE",
        entity: "FundTransaction",
        entityId: input.projectId,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { type: "quickAddByPPCode", count: created },
      });
      return { created };
    }),

  // ─── Auto Confirm: scan PP emails for PayPal payment, extract txId + amount ───
  autoConfirm: fundsProcedure
    .input(z.object({
      projectId: z.string(),
      fundIds: z.array(z.string()).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const funds = await ctx.prisma.fundTransaction.findMany({
        where: { id: { in: input.fundIds }, projectId: input.projectId, confirmed: false },
        include: {
          paypal: {
            select: {
              id: true, code: true, primaryEmail: true, hotmailToken: true,
              emails: {
                select: { email: true, hotmailToken: true, isPrimary: true },
                orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
              },
            },
          },
        },
      });

      const results: Array<{
        fundId: string;
        ppCode: string;
        status: "confirmed" | "not_found" | "no_token" | "error";
        message: string;
        txId?: string;
        emailAmount?: number;
        originalAmount?: number;
      }> = [];

      for (const fund of funds) {
        const pp = fund.paypal;
        if (!pp) { results.push({ fundId: fund.id, ppCode: "?", status: "error", message: "PP không tồn tại" }); continue; }

        // Resolve token: primary email → other emails → legacy
        let token: string | null = null;
        const primaryEmail = pp.emails.find((e: any) => e.isPrimary && e.hotmailToken);
        if (primaryEmail?.hotmailToken) {
          try { token = decrypt(primaryEmail.hotmailToken); } catch {}
        }
        if (!token) {
          for (const em of pp.emails) {
            if (em.hotmailToken) { try { token = decrypt(em.hotmailToken); break; } catch {} }
          }
        }
        if (!token && pp.hotmailToken) {
          try { token = decrypt(pp.hotmailToken); } catch {}
        }

        if (!token) {
          results.push({ fundId: fund.id, ppCode: pp.code, status: "no_token", message: "PP không có email token — cần check tay" });
          continue;
        }

        try {
          // Read recent emails (200 max)
          const mailResult = await readMailbox(token, 200);
          if (mailResult.error || !mailResult.emails.length) {
            results.push({ fundId: fund.id, ppCode: pp.code, status: "error", message: mailResult.error || "Không đọc được email" });
            continue;
          }

          // Fund date minus 1 day (emails might arrive slightly before note)
          const fundDate = new Date(fund.date);
          const searchAfter = new Date(fundDate.getTime() - 24 * 60 * 60 * 1000);
          const targetAmount = Number(fund.amount);

          // Convert mailbox emails to parser format (need body text)
          const emailsForParser = mailResult.emails.map((e) => ({
            subject: e.subject,
            bodyText: e.preview, // preview is the body text we have
            senderEmail: e.sender,
            receivedAt: e.receivedAt,
          }));

          const match = findMatchingPayment(emailsForParser, targetAmount, searchAfter, 0.50);

          if (match && match.isPayment && match.transactionId) {
            // Auto confirm: update fund with txId + exact amount from email + confirmed
            await ctx.prisma.fundTransaction.update({
              where: { id: fund.id },
              data: {
                transactionId: match.transactionId,
                amount: match.amount ?? fund.amount,
                confirmed: true,
                notes: fund.notes
                  ? `${fund.notes} | Auto-confirmed: $${match.amount?.toFixed(2)} (email ${match.emailDate ? new Date(match.emailDate).toLocaleDateString("vi-VN") : ""})`
                  : `Auto-confirmed: $${match.amount?.toFixed(2)}`,
              },
            });
            results.push({
              fundId: fund.id, ppCode: pp.code, status: "confirmed",
              message: `Tìm thấy! TX: ${match.transactionId}, $${match.amount?.toFixed(2)}`,
              txId: match.transactionId, emailAmount: match.amount, originalAmount: targetAmount,
            });
          } else if (match && match.isPayment && !match.transactionId) {
            // Found payment but no TX ID
            results.push({
              fundId: fund.id, ppCode: pp.code, status: "not_found",
              message: `Tìm thấy payment $${match.amount?.toFixed(2)} nhưng không có mã giao dịch — check tay`,
              emailAmount: match.amount, originalAmount: targetAmount,
            });
          } else {
            results.push({
              fundId: fund.id, ppCode: pp.code, status: "not_found",
              message: `Không tìm thấy payment ~$${targetAmount.toFixed(2)} sau ngày ${fundDate.toLocaleDateString("vi-VN")} — check tay`,
              originalAmount: targetAmount,
            });
          }
        } catch (err: any) {
          results.push({ fundId: fund.id, ppCode: pp.code, status: "error", message: err.message?.slice(0, 200) || "Lỗi đọc email" });
        }
      }

      const confirmed = results.filter((r) => r.status === "confirmed").length;
      const notFound = results.filter((r) => r.status === "not_found").length;
      const errors = results.filter((r) => r.status === "error" || r.status === "no_token").length;

      await createAuditLog({
        action: "BULK_UPDATE",
        entity: "FundTransaction",
        entityId: input.projectId,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { type: "autoConfirm", confirmed, notFound, errors, total: funds.length },
      });

      return { confirmed, notFound, errors, total: funds.length, results };
    }),

  // ═══ BD Sheet Import: Scan ═══
  scanBDSheet: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      sheetUrl: z.string().url(),
      targetDate: z.string().optional(), // dd/mm/yyyy, default today
    }))
    .mutation(async ({ ctx, input }) => {
      const allRows = await fetchBDSheet(input.sheetUrl);
      const date = input.targetDate || getTodayDDMMYYYY();
      const withdrawals = filterByDateAndStatus(allRows, date, "Withdrawal");

      // Check which PP codes exist in system
      const ppCodes = Array.from(new Set(withdrawals.map((r) => r.ppCode)));
      const existingPPs = await ctx.prisma.payPalAccount.findMany({
        where: { projectId: input.projectId, code: { in: ppCodes } },
        select: { code: true, primaryEmail: true, id: true },
      });
      const ppMap = new Map(existingPPs.map((pp) => [pp.code, pp]));

      const preview = withdrawals.map((r) => {
        const existing = ppMap.get(r.ppCode);
        return {
          ppCode: r.ppCode,
          email: r.email,
          vm: r.vm,
          amount: r.amount,
          time: r.time,
          server: r.server,
          existsInSystem: !!existing,
          currentEmail: existing?.primaryEmail ?? null,
          emailMatch: existing ? existing.primaryEmail === r.email : false,
          paypalId: existing?.id ?? null,
        };
      });

      return {
        date,
        totalScanned: allRows.length,
        withdrawalCount: withdrawals.length,
        items: preview,
      };
    }),

  // ═══ BD Sheet Import: Execute ═══
  executeBDSheetImport: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        ppCode: z.string(),
        email: z.string(),
        amount: z.number().positive(),
        createPP: z.boolean().default(false), // create new PP if not exists
      })).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0, emailsUpdated = 0, ppCreated = 0, skipped = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        try {
          // Find or create PP
          let pp = await ctx.prisma.payPalAccount.findFirst({
            where: { projectId: input.projectId, code: item.ppCode },
          });

          if (!pp && item.createPP) {
            pp = await ctx.prisma.payPalAccount.create({
              data: {
                code: item.ppCode,
                primaryEmail: item.email,
                status: "ACTIVE",
                role: "NORMAL",
                company: "Bright Data Ltd.",
                projectId: input.projectId,
              },
            });
            // Also create PayPalEmail record
            await ctx.prisma.payPalEmail.create({
              data: {
                email: item.email,
                isPrimary: true,
                paypalId: pp.id,
                projectId: input.projectId,
              },
            });
            ppCreated++;
          }

          if (!pp) {
            skipped++;
            errors.push(`${item.ppCode}: PP không tồn tại, bỏ qua`);
            continue;
          }

          // Update email if different
          if (item.email && pp.primaryEmail !== item.email) {
            // Check if email already exists as PayPalEmail
            const existingEmail = await ctx.prisma.payPalEmail.findFirst({
              where: { email: item.email, projectId: input.projectId },
            });
            if (!existingEmail) {
              await ctx.prisma.payPalEmail.create({
                data: {
                  email: item.email,
                  isPrimary: false,
                  paypalId: pp.id,
                  projectId: input.projectId,
                },
              });
              emailsUpdated++;
            }
          }

          // Create FundTransaction
          await ctx.prisma.fundTransaction.create({
            data: {
              date: new Date(),
              amount: item.amount,
              transactionId: `BD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              paypalId: pp.id,
              projectId: input.projectId,
              confirmed: false,
              company: "Bright Data Ltd.",
              notes: `BD Sheet import: ${item.email}`,
            },
          });
          imported++;
        } catch (e: any) {
          errors.push(`${item.ppCode}: ${e.message}`);
        }
      }

      await createAuditLog({
        action: "IMPORT",
        entity: "FundTransaction",
        entityId: input.projectId,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { source: "bd_sheet", imported, emailsUpdated, ppCreated, skipped },
      });

      return { imported, emailsUpdated, ppCreated, skipped, errors: errors.slice(0, 20) };
    }),
});
