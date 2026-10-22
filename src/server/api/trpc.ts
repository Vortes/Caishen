import { auth } from "@clerk/nextjs/server";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";

import { formatTRPCError } from "~/server/api/error-formatter";
import { ObservedRevision } from "~/server/api/revision-header";
import { db } from "~/server/db";
import { readHouseholdRevision } from "~/server/storage/rows";
import { ensureLocalUser } from "~/server/users";
import { CLIENT_FORMAT_HEADER, MINIMUM_CLIENT_FORMAT } from "~/domain/client-format";
import { refusal } from "~/server/services/sync-refusal";

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const { userId } = await auth();

  return { db, userId, revision: new ObservedRevision(), ...opts };
};

export { ObservedRevision };

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter: formatTRPCError,
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });

  const header = ctx.headers.get(CLIENT_FORMAT_HEADER);
  const format = header === null ? 1 : /^[1-9]\d*$/.test(header) ? Number(header) : 0;
  if (!Number.isSafeInteger(format) || format < MINIMUM_CLIENT_FORMAT)
    throw refusal("staleClient", "Reload Caishen to get the latest version.");

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
