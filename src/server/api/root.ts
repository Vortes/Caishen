import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { budgetRouter } from "~/server/api/routers/budget";

export const appRouter = createTRPCRouter({
  budget: budgetRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
