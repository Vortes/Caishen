import type { TRPCDefaultErrorShape, TRPCError } from "@trpc/server";
import { TRPC_ERROR_CODES_BY_KEY } from "@trpc/server/rpc";
import { ZodError } from "zod";
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
  return {
    ...shape,
    data: {
      ...shape.data,
      zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
    },
  };
}
