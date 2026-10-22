import type { TRPCDefaultErrorShape, TRPCError } from "@trpc/server";
import { TRPC_ERROR_CODES_BY_KEY } from "@trpc/server/rpc";
import { ZodError } from "zod";
import { SyncRefusal } from "~/server/services/sync-refusal";
import {
  DATABASE_ERROR_MESSAGE,
  isPrismaError,
} from "~/server/services/safety";

export function formatTRPCError({
  shape,
  error,
}: {
  shape: TRPCDefaultErrorShape;
  error: TRPCError;
}) {
  if (isPrismaError(error.cause))
    return {
      ...shape,
      message: DATABASE_ERROR_MESSAGE,
      code: TRPC_ERROR_CODES_BY_KEY.INTERNAL_SERVER_ERROR,
      data: {
        code: "INTERNAL_SERVER_ERROR" as const,
        httpStatus: 500,
        path: shape.data.path,
        zodError: null,
      },
    };
  const cause = error.cause;
  return {
    ...shape,
    data: {
      ...shape.data,
      zodError: cause instanceof ZodError ? cause.flatten() : null,
      // A refusal the browser's sync layer acts on (ADR 0006).
      ...(cause instanceof SyncRefusal
        ? {
            caishen: {
              kind: cause.kind,
              ...(cause.revision === undefined
                ? {}
                : { revision: cause.revision }),
              message: cause.message,
            },
          }
        : {}),
    },
  };
}
