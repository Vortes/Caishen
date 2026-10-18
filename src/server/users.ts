import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "~/generated/prisma";

const identifier = z.string().min(1).max(255);
const timestamp = z
  .number()
  .int()
  .safe()
  .nonnegative()
  .max(8_640_000_000_000_000);
const nullableName = z.string().max(255).nullable().optional();
const imageUrl = z
  .string()
  .url()
  .max(2048)
  .regex(/^https?:\/\//i)
  .nullable()
  .optional();
const profile = z
  .object({
    id: identifier,
    updated_at: timestamp,
    first_name: nullableName,
    last_name: nullableName,
    image_url: imageUrl,
    primary_email_address_id: identifier.nullable().optional(),
    email_addresses: z
      .array(
        z.object({
          id: identifier,
          email_address: z.string().email().max(320),
        }),
      )
      .max(100)
      .default([]),
  })
  .superRefine((value, context) => {
    if (
      value.primary_email_address_id &&
      !value.email_addresses.some(
        (email) => email.id === value.primary_email_address_id,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Primary email is missing from the profile snapshot",
      });
  });
const eventSchema = z.union([
  z.object({
    type: z.enum(["user.created", "user.updated"]),
    timestamp,
    data: profile,
  }),
  z.object({
    type: z.literal("user.deleted"),
    timestamp,
    data: z.object({ id: identifier, deleted: z.literal(true) }),
  }),
]);

export class ClerkUserEventValidationError extends Error {
  constructor() {
    super("Invalid Clerk user event.");
    this.name = "ClerkUserEventValidationError";
  }
}
export class ClerkUserEventConflictError extends Error {
  constructor() {
    super("Webhook message ID was already used for a different event.");
    this.name = "ClerkUserEventConflictError";
  }
}

export type ClerkUserEvent = {
  type: "user.created" | "user.updated" | "user.deleted";
  clerkUserId: string;
  occurredAt: Date;
  semanticTimestamp: bigint;
  payloadHash: string;
  profile: {
    firstName: string | null;
    lastName: string | null;
    imageUrl: string | null;
    primaryEmail: string | null;
  } | null;
};

export function parseClerkUserEvent(input: unknown): ClerkUserEvent {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) throw new ClerkUserEventValidationError();
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new ClerkUserEventValidationError();
  }
  if (!serialized) throw new ClerkUserEventValidationError();
  const event = parsed.data;
  const common = {
    type: event.type,
    clerkUserId: event.data.id,
    occurredAt: new Date(event.timestamp),
    payloadHash: createHash("sha256").update(serialized).digest("hex"),
  };
  if (event.type === "user.deleted")
    return {
      ...common,
      semanticTimestamp: BigInt(event.timestamp),
      profile: null,
    };
  const primaryEmail =
    event.data.email_addresses.find(
      (email) => email.id === event.data.primary_email_address_id,
    )?.email_address ?? null;
  return {
    ...common,
    semanticTimestamp: BigInt(event.data.updated_at),
    profile: {
      firstName: event.data.first_name ?? null,
      lastName: event.data.last_name ?? null,
      imageUrl: event.data.image_url ?? null,
      primaryEmail,
    },
  };
}

export async function ensureLocalUser(db: PrismaClient, clerkUserId: string) {
  if (!identifier.safeParse(clerkUserId).success)
    throw new ClerkUserEventValidationError();
  const existing = await db.user.findUnique({ where: { clerkUserId } });
  if (existing) return existing;
  await db.user.createMany({ data: [{ clerkUserId }], skipDuplicates: true });
  return db.user.findUniqueOrThrow({ where: { clerkUserId } });
}

export async function syncClerkUserEvent(
  db: PrismaClient,
  messageId: string,
  input: unknown,
) {
  if (!identifier.safeParse(messageId).success)
    throw new ClerkUserEventValidationError();
  const event = parseClerkUserEvent(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const previous = await tx.clerkWebhookEvent.findUnique({
            where: { id: messageId },
          });
          if (previous) {
            if (previous.payloadHash !== event.payloadHash)
              throw new ClerkUserEventConflictError();
            return {
              duplicate: true,
              applied: false,
              clerkUserId: previous.clerkUserId,
            };
          }
          const user = await tx.user.upsert({
            where: { clerkUserId: event.clerkUserId },
            create: { clerkUserId: event.clerkUserId },
            update: {},
          });
          let applied = false;
          if (event.type === "user.deleted") {
            if (user.active || !user.deletedAt) {
              await tx.user.update({
                where: { id: user.id },
                data: {
                  active: false,
                  deletedAt: event.occurredAt,
                  clerkUpdatedAt:
                    user.clerkUpdatedAt !== null &&
                    user.clerkUpdatedAt > event.semanticTimestamp
                      ? user.clerkUpdatedAt
                      : event.semanticTimestamp,
                  firstName: null,
                  lastName: null,
                  imageUrl: null,
                  primaryEmail: null,
                },
              });
              applied = true;
            }
          } else if (
            user.active &&
            !user.deletedAt &&
            (user.clerkUpdatedAt === null ||
              event.semanticTimestamp > user.clerkUpdatedAt)
          ) {
            await tx.user.update({
              where: { id: user.id },
              data: {
                ...event.profile,
                clerkUpdatedAt: event.semanticTimestamp,
              },
            });
            applied = true;
          }
          await tx.clerkWebhookEvent.create({
            data: {
              id: messageId,
              clerkUserId: event.clerkUserId,
              type: event.type,
              occurredAt: event.occurredAt,
              payloadHash: event.payloadHash,
              applied,
            },
          });
          return { duplicate: false, applied, clerkUserId: event.clerkUserId };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000,
        },
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
  throw new Error("User synchronization could not be completed.");
}
