import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { budgetRouter } from "~/server/api/routers/budget";
import { syncRouter } from "~/server/api/routers/sync";

export const appRouter = createTRPCRouter({
  budget: budgetRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
