import { z } from "zod";
import { router, profitProcedure, moderatorProcedure } from "../trpc";

export const partnerRouter = router({
  list: profitProcedure
    .input(z.object({ projectId: z.string(), activeOnly: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.partner.findMany({
        where: {
          projectId: input.projectId,
          ...(input.activeOnly ? { active: true } : {}),
        },
        orderBy: { name: "asc" },
      });
    }),

  create: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      name: z.string().min(1),
      percentage: z.number().min(0).max(100),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.partner.create({
        data: {
          name: input.name,
          percentage: input.percentage,
          note: input.note,
          projectId: input.projectId,
        },
      });
    }),

  update: moderatorProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      name: z.string().min(1).optional(),
      percentage: z.number().min(0).max(100).optional(),
      note: z.string().nullable().optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.partner.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
      });
      const { projectId: _pid, id, ...data } = input;
      return ctx.prisma.partner.update({ where: { id }, data });
    }),

  delete: moderatorProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.partner.findFirstOrThrow({
        where: { id: input.id, projectId: input.projectId },
      });
      return ctx.prisma.partner.delete({ where: { id: input.id } });
    }),
});
