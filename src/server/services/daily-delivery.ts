import { z } from "zod";
import { Prisma, type DailyDelivery } from "~/generated/prisma";
import { createResendClient } from "~/server/integrations/daily-review";
import { providerIdSchema } from "~/server/integrations/validation";
import { reportUnreadable, zodIssues } from "./stored-data";
import type { Database } from "./household";

export const dailyDeliveryPayloadSchema = z
  .object({
    from: z
      .string()
      .min(3)
      .max(320)
      .refine((value) => !/[\r\n]/.test(value)),
    to: z.string().email().max(320),
    dedupeKey: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[\x21-\x7e]+$/),
    scheduledAt: z.string().datetime().optional(),
    unsubscribeUrl: z.string().url().optional(),
    message: z
      .object({
        subject: z
          .string()
          .min(1)
          .max(200)
          .refine((value) => !/[\r\n]/.test(value)),
        text: z.string().min(1).max(10_000),
      })
      .strict(),
  })
  .strict();
export type DailyDeliveryPayload = z.infer<typeof dailyDeliveryPayloadSchema>;
export type DailyDeliveryTarget = {
  localDate: string;
  scheduledAt: string;
  dedupeKey: string;
};

export async function claimDailyDelivery(
  db: Database,
  userId: string,
  target: DailyDeliveryTarget,
  now: Date,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const existing = await tx.dailyDelivery.findUnique({
            where: {
              clerkUserId_localDate: {
                clerkUserId: userId,
                localDate: target.localDate,
              },
            },
          });
          if (
            existing?.providerId ||
            existing?.status === "sent" ||
            existing?.status === "scheduled" ||
            existing?.status === "canceled"
          )
            return null;
          if (existing?.status === "unknown")
            return { kind: "expired" as const };
          if (
            (existing?.status === "sending" ||
              existing?.status === "preparing") &&
            existing.leaseUntil > now
          )
            return null;
          // Resend retains request idempotency for 24 hours; leave time for the request to arrive.
          if (
            existing?.firstAttemptAt &&
            now.getTime() - existing.firstAttemptAt.getTime() >=
              24 * 60 * 60_000 - 60_000
          ) {
            await tx.dailyDelivery.update({
              where: { id: existing.id },
              data: {
                status: "unknown",
                error:
                  "The provider outcome needs verification before retrying an expired idempotency key.",
              },
            });
            return { kind: "expired" as const };
          }
          const leaseUntil = new Date(now.getTime() + 10 * 60_000);
          const delivery = existing
            ? await tx.dailyDelivery.update({
                where: { id: existing.id },
                data: { status: "preparing", leaseUntil, error: null },
              })
            : await tx.dailyDelivery.create({
                data: {
                  clerkUserId: userId,
                  localDate: target.localDate,
                  status: "preparing",
                  leaseUntil,
                  scheduledAt: new Date(target.scheduledAt),
                },
              });
          return { kind: "claimed" as const, delivery };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(error.code) &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
  throw new Error("The daily delivery could not be claimed.");
}

type CancelEmail = (providerId: string) => Promise<{ id: string }>;
type SendEmail = (payload: DailyDeliveryPayload) => Promise<{ id: string }>;

async function recoverAttemptedDelivery(
  db: Database,
  delivery: DailyDelivery,
  now: Date,
  send: SendEmail,
): Promise<DailyDelivery | null> {
  const claim = await claimDailyDelivery(
    db,
    delivery.clerkUserId,
    {
      localDate: delivery.localDate,
      scheduledAt: delivery.scheduledAt!.toISOString(),
      dedupeKey: `daily-review:${delivery.clerkUserId}:${delivery.localDate}`,
    },
    now,
  );
  if (!claim) {
    const current = await db.dailyDelivery.findUnique({
      where: { id: delivery.id },
    });
    if (current?.status === "canceled") return null;
    if (current?.status === "scheduled" && current.providerId) return current;
    throw new Error(
      "A daily email request is still in progress. Retry cancellation after it finishes.",
    );
  }
  if (claim.kind === "expired")
    throw new Error(
      "The queued email outcome needs verification before its expired request can be retried.",
    );
  const selected = { id: delivery.id, leaseUntil: claim.delivery.leaseUntil };
  if (!claim.delivery.firstAttemptAt)
    return db.dailyDelivery.update({
      where: selected,
      data: { status: "canceled", error: null },
    });
  const saved = dailyDeliveryPayloadSchema.safeParse(claim.delivery.payload);
  if (!saved.success && claim.delivery.payload !== null)
    reportUnreadable(
      {
        record: "DailyDelivery.payload",
        deliveryId: delivery.id,
        userId: delivery.clerkUserId,
      },
      [{ issues: zodIssues(saved.error) }],
    );
  if (!saved.success) {
    const message =
      "The queued email outcome needs verification because its saved request is missing or invalid.";
    await db.dailyDelivery.update({
      where: selected,
      data: { status: "unknown", error: message },
    });
    throw new Error(message);
  }
  await db.dailyDelivery.update({
    where: selected,
    data: { status: "sending" },
  });
  try {
    const result = await send(saved.data);
    return await db.dailyDelivery.update({
      where: selected,
      data: {
        status: "scheduled",
        providerId: providerIdSchema.parse(result.id),
        sentAt: null,
        error: null,
      },
    });
  } catch {
    const message =
      "The queued email request could not be recovered. Retry cancellation.";
    await db.dailyDelivery.updateMany({
      where: { ...selected, status: "sending", providerId: null },
      data: { status: "failed", error: message },
    });
    throw new Error(message);
  }
}

export async function cancelScheduledDailyReviews(
  db: Database,
  userId: string,
  now = new Date(),
  cancel: CancelEmail = async (providerId) =>
    createResendClient({
      apiKey: process.env.RESEND_API_KEY ?? "",
      from: process.env.EMAIL_FROM ?? "",
    }).cancelEmail(providerId),
  send: SendEmail = async (payload) =>
    createResendClient({
      apiKey: process.env.RESEND_API_KEY ?? "",
      from: payload.from,
    }).sendDailyReview(payload),
): Promise<{ canceled: number }> {
  providerIdSchema.parse(userId);
  if (!Number.isFinite(now.getTime()))
    throw new Error("The cancellation time must be valid.");
  const where = {
    clerkUserId: userId,
    scheduledAt: { gt: now },
  };
  const deliveries = await db.dailyDelivery.findMany({
    where: {
      ...where,
      OR: [
        { status: "scheduled", providerId: { not: null } },
        {
          status: { in: ["preparing", "sending", "failed", "unknown"] },
          providerId: null,
          firstAttemptAt: { not: null },
        },
        { status: "preparing", providerId: null, firstAttemptAt: null },
      ],
    },
  });
  let canceled = 0;
  for (const pending of deliveries) {
    const delivery = pending.providerId
      ? pending
      : await recoverAttemptedDelivery(db, pending, now, send);
    if (!delivery) continue;
    if (delivery.status === "canceled") {
      canceled++;
      continue;
    }
    const selected = {
      ...where,
      id: delivery.id,
      status: "scheduled",
      providerId: delivery.providerId!,
    };
    try {
      await cancel(delivery.providerId!);
    } catch {
      const message =
        "Queued daily email could not be canceled. Retry the request.";
      await db.dailyDelivery.updateMany({
        where: selected,
        data: { error: message },
      });
      throw new Error(message);
    }
    const updated = await db.dailyDelivery.updateMany({
      where: selected,
      data: { status: "canceled", error: null },
    });
    canceled += updated.count;
  }
  return { canceled };
}
