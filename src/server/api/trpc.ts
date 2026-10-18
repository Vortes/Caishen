import { auth } from "@clerk/nextjs/server";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { db } from "~/server/db";
import { ensureLocalUser } from "~/server/users";

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const { userId } = await auth();

  return { db, userId, ...opts };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
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
