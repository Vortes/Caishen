import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { pull, pullInputSchema } from "~/server/services/pull";

// The browser's sync layer (ADR 0006). budget.execute runs its commands.
export const syncRouter = createTRPCRouter({
  pull: protectedProcedure
    .input(pullInputSchema)
    .query(({ ctx, input }) =>
      pull(ctx.db, ctx.userId, input, ctx.revision.observe),
    ),
});
