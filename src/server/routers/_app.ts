import { router } from "../trpc";
import { projectRouter } from "./project";
import { paypalRouter } from "./paypal";
import { fundRouter } from "./fund";
import { withdrawalRouter } from "./withdrawal";
import { costRouter } from "./cost";
import { dashboardRouter } from "./dashboard";
import { profitSplitRouter } from "./profitSplit";
import { serverRouter } from "./server";
import { vmRouter } from "./vm";
import { proxyRouter } from "./proxy";
import { gmailRouter } from "./gmail";
import { vmTaskRouter } from "./vmTask";
import { auditLogRouter } from "./auditLog";
import { deleteRequestRouter } from "./deleteRequest";
import { userRouter } from "./user";

export const appRouter = router({
  project: projectRouter,
  paypal: paypalRouter,
  fund: fundRouter,
  withdrawal: withdrawalRouter,
  cost: costRouter,
  dashboard: dashboardRouter,
  profitSplit: profitSplitRouter,
  server: serverRouter,
  vm: vmRouter,
  proxy: proxyRouter,
  gmail: gmailRouter,
  vmTask: vmTaskRouter,
  auditLog: auditLogRouter,
  deleteRequest: deleteRequestRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
