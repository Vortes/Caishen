import { TRPCError } from "@trpc/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma } from "~/generated/prisma";

export function commandHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function domainError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034" || error.code === "P2002")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Your budget changed. Refresh and try again.",
      });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The budget could not be saved. Try again.",
    });
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      error instanceof Error ? error.message : "Check the entered values.",
  });
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
