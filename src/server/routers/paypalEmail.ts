import { z } from "zod";
import { router, paypalsProcedure } from "../trpc";
import { encrypt, decrypt } from "@/lib/encryption";

export const paypalEmailRouter = router({
  // List emails for a PP account
  list: paypalsProcedure
    .input(z.object({ projectId: z.string(), paypalId: z.string() }))
    .query(async ({ ctx, input }) => {
      const emails = await ctx.prisma.payPalEmail.findMany({
        where: { paypalId: input.paypalId, projectId: input.projectId },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        include: {
          _count: { select: { funds: true } },
        },
      });

      // Aggregate funds per email
      const fundAggs = await ctx.prisma.fundTransaction.groupBy({
        by: ["paypalEmailId"],
        where: { paypalId: input.paypalId, paypalEmailId: { not: null } },
        _sum: { amount: true },
      });
      const fundMap = new Map(fundAggs.map((f) => [f.paypalEmailId, Number(f._sum.amount ?? 0)]));

      return emails.map((e) => ({
        ...e,
        totalReceived: fundMap.get(e.id) ?? 0,
      }));
    }),

  // Create email for a PP account
  create: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      paypalId: z.string(),
      email: z.string().email(),
      password: z.string().optional(),
      twoFa: z.string().optional(),
      hotmailToken: z.string().optional(),
      isPrimary: z.boolean().default(false),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { password, twoFa, hotmailToken, ...rest } = input;

      // If setting as primary, unset existing primary
      if (rest.isPrimary) {
        await ctx.prisma.payPalEmail.updateMany({
          where: { paypalId: input.paypalId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      // Check if this is first email → auto-set primary
      const count = await ctx.prisma.payPalEmail.count({ where: { paypalId: input.paypalId } });
      if (count === 0) rest.isPrimary = true;

      const data: any = { ...rest };
      if (password) data.password = encrypt(password);
      if (twoFa) data.twoFa = encrypt(twoFa);
      if (hotmailToken) data.hotmailToken = encrypt(hotmailToken);

      const created = await ctx.prisma.payPalEmail.create({ data });

      // Sync primaryEmail on PayPalAccount
      if (created.isPrimary) {
        await ctx.prisma.payPalAccount.update({
          where: { id: input.paypalId },
          data: { primaryEmail: input.email },
        });
      }

      return created;
    }),

  // Update email
  update: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      email: z.string().email().optional(),
      password: z.string().nullable().optional(),
      twoFa: z.string().nullable().optional(),
      hotmailToken: z.string().nullable().optional(),
      isPrimary: z.boolean().optional(),
      notes: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, id, password, twoFa, hotmailToken, isPrimary, ...rest } = input;
      const existing = await ctx.prisma.payPalEmail.findFirstOrThrow({ where: { id, projectId } });

      // If setting as primary, unset existing primary
      if (isPrimary) {
        await ctx.prisma.payPalEmail.updateMany({
          where: { paypalId: existing.paypalId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const data: any = { ...rest };
      if (isPrimary !== undefined) data.isPrimary = isPrimary;
      if (password !== undefined) data.password = password ? encrypt(password) : null;
      if (twoFa !== undefined) data.twoFa = twoFa ? encrypt(twoFa) : null;
      if (hotmailToken !== undefined) data.hotmailToken = hotmailToken ? encrypt(hotmailToken) : null;

      const updated = await ctx.prisma.payPalEmail.update({ where: { id }, data });

      // Sync primaryEmail on PayPalAccount
      if (updated.isPrimary) {
        await ctx.prisma.payPalAccount.update({
          where: { id: existing.paypalId },
          data: { primaryEmail: updated.email },
        });
      }

      return updated;
    }),

  // Delete email
  delete: paypalsProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const email = await ctx.prisma.payPalEmail.findFirstOrThrow({ where: { id: input.id, projectId: input.projectId } });
      await ctx.prisma.payPalEmail.delete({ where: { id: input.id } });

      // If deleted email was primary, promote next one
      if (email.isPrimary) {
        const next = await ctx.prisma.payPalEmail.findFirst({
          where: { paypalId: email.paypalId },
          orderBy: { createdAt: "asc" },
        });
        if (next) {
          await ctx.prisma.payPalEmail.update({ where: { id: next.id }, data: { isPrimary: true } });
          await ctx.prisma.payPalAccount.update({ where: { id: email.paypalId }, data: { primaryEmail: next.email } });
        }
      }
      return { deleted: true };
    }),

  // Get credentials (decrypted)
  getCredentials: paypalsProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      const email = await ctx.prisma.payPalEmail.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
        select: { password: true, twoFa: true, hotmailToken: true },
      });
      return {
        password: email.password ? decrypt(email.password) : null,
        twoFa: email.twoFa ? decrypt(email.twoFa) : null,
        hotmailToken: email.hotmailToken ? decrypt(email.hotmailToken) : null,
      };
    }),

  // Bulk create emails (for quick add)
  bulkCreate: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      paypalId: z.string(),
      items: z.array(z.object({
        email: z.string().email(),
        password: z.string().optional(),
        twoFa: z.string().optional(),
        hotmailToken: z.string().optional(),
        isPrimary: z.boolean().default(false),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let created = 0;
      const existingCount = await ctx.prisma.payPalEmail.count({ where: { paypalId: input.paypalId } });

      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const data: any = {
          email: item.email,
          isPrimary: existingCount === 0 && i === 0 ? true : item.isPrimary,
          paypalId: input.paypalId,
          projectId: input.projectId,
        };
        if (item.password) data.password = encrypt(item.password);
        if (item.twoFa) data.twoFa = encrypt(item.twoFa);
        if (item.hotmailToken) data.hotmailToken = encrypt(item.hotmailToken);

        try {
          await ctx.prisma.payPalEmail.create({ data });
          created++;
        } catch { /* skip duplicates */ }
      }

      // Sync primary email
      if (existingCount === 0 && created > 0) {
        const primary = await ctx.prisma.payPalEmail.findFirst({
          where: { paypalId: input.paypalId, isPrimary: true },
        });
        if (primary) {
          await ctx.prisma.payPalAccount.update({
            where: { id: input.paypalId },
            data: { primaryEmail: primary.email },
          });
        }
      }

      return { created };
    }),
});
