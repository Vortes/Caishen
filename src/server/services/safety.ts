import { TRPCError } from "@trpc/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "~/domain/canonical-json";
import type { Prisma } from "~/generated/prisma";
import { refusal } from "./sync-refusal";

const prismaErrorNames = new Set([
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientInitializationError",
  "PrismaClientValidationError",
  "PrismaClientRustPanicError",
]);
export const DATABASE_ERROR_MESSAGE =
  "The budget could not be saved. Try again.";

export function isPrismaError(
  error: unknown,
): error is Error & { clientVersion: string; code?: unknown } {
  return (
    error instanceof Error &&
    prismaErrorNames.has(error.name) &&
    "clientVersion" in error &&
    typeof error.clientVersion === "string"
  );
}

export function commandHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Identifies an operation for retries by its input exactly as it was
 * submitted. Hashing the validated form instead would let a later release that
 * adds a default reject a retry of the same operation as different details.
 */
export function operationHash(submitted: unknown): string {
  return createHash("sha256").update(canonicalJson(submitted)).digest("hex");
}

/**
 * Whether a saved operation hash identifies this retry. Operations saved before
 * submitted-input hashing hold `commandHash` of the validated operation.
 */
export function matchesSavedOperation(
  savedHash: string,
  submitted: unknown,
  validated: unknown,
): boolean {
  return (
    savedHash === operationHash(submitted) ||
    savedHash === commandHash(validated)
  );
}

export function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function domainError(error: unknown): never {
  throw domainRefusal(error);
}

/** The refusal a member sees for an error: its message, never internals. */
export function domainRefusal(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  if (isPrismaError(error)) {
    if (
      error.name === "PrismaClientKnownRequestError" &&
      (error.code === "P2034" || error.code === "P2002")
    )
      return refusal("conflict", "Your budget changed. Refresh and try again.");
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: DATABASE_ERROR_MESSAGE,
    });
  }
  return refusal(
    "rejected",
    error instanceof Error ? error.message : "Check the entered values.",
  );
}

export function requireCronAuthorization(header: string | null): void {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Hosted scheduling is not configured.",
    });
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(header ?? "");
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    throw new TRPCError({ code: "UNAUTHORIZED" });
}
