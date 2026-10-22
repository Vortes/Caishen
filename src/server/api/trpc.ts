import { auth } from "@clerk/nextjs/server";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";

import { formatTRPCError } from "~/server/api/error-formatter";
import { db } from "~/server/db";
import { readHouseholdRevision } from "~/server/storage/rows";
import { ensureLocalUser } from "~/server/users";

/**
 * The household revisions a request saw, for the x-caishen-revision
 * response header (ADR 0006): a browser that sees a revision it doesn't
 * hold pulls what it missed.
 */
export class ObservedRevision {
  value: number | undefined;
  observe = (revision: number) => {
    this.value = Math.max(this.value ?? revision, revision);
  };
}

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const { userId } = await auth();

  return { db, userId, revision: new ObservedRevision(), ...opts };
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
  const result = await next({ ctx: { ...ctx, userId: ctx.userId, localUser } });
  // Every response carries the household's revision, even when the
  // procedure didn't read the household.
  if (ctx.revision.value === undefined) {
    const household = await readHouseholdRevision(ctx.db, ctx.userId).catch(
      () => null,
    );
    if (household) ctx.revision.observe(household.revision);
  }
  return result;
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
