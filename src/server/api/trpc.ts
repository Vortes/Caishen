import { auth } from "@clerk/nextjs/server";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";

import { formatTRPCError } from "~/server/api/error-formatter";
import { db } from "~/server/db";
import { ensureLocalUser } from "~/server/users";

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const { userId } = await auth();

  return { db, userId, ...opts };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter: formatTRPCError,
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });

  const localUser = await ensureLocalUser(ctx.db, ctx.userId);
  if (!localUser.active)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This Caishen account is inactive.",
    });
  return next({ ctx: { ...ctx, userId: ctx.userId, localUser } });
});

/**
 * Keeps the input exactly as the client sent it, before validation fills in
 * defaults, for procedures that identify retried operations by what was
 * submitted.
 */
export const submittedInputProcedure = protectedProcedure.use(
  async ({ getRawInput, next }) =>
    next({ ctx: { submittedInput: await getRawInput() } }),
);
