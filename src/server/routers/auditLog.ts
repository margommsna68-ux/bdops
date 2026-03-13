import { z } from "zod";
import { router, adminProcedure } from "../trpc";

export const auditLogRouter = router({
  list: adminProcedure
    .input(
      z.object({
        projectId: z.string(),
        entity: z.string().optional(),
        action: z.string().optional(),
        userId: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { projectId: input.projectId };
      if (input.entity) where.entity = input.entity;
      if (input.action) where.action = input.action;
      if (input.userId) where.userId = input.userId;
      if (input.dateFrom || input.dateTo) {
        where.createdAt = {};
        if (input.dateFrom) where.createdAt.gte = new Date(input.dateFrom);
        if (input.dateTo) where.createdAt.lte = new Date(input.dateTo);
      }

      const [items, total] = await Promise.all([
        ctx.prisma.auditLog.findMany({
          where,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { id: true, name: true, email: true, username: true, image: true } },
          },
        }),
        ctx.prisma.auditLog.count({ where }),
      ]);

      return { items, total, page: input.page, limit: input.limit };
    }),

  stats: adminProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [totalLogs, todayLogs] = await Promise.all([
        ctx.prisma.auditLog.count({ where: { projectId: input.projectId } }),
        ctx.prisma.auditLog.count({ where: { projectId: input.projectId, createdAt: { gte: today } } }),
      ]);

      return { totalLogs, todayLogs };
    }),
});
