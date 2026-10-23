import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { executeCommand, requireHousehold, type Database } from "./household";
import { cancelScheduledDailyReviews } from "./daily-delivery";

function signature(payload: string) {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key)
    throw new Error("Email preferences require the application signing key.");
  return createHmac("sha256", key)
    .update(`caishen-email-preferences:v1:${payload}`)
    .digest();
}

export function emailPreferenceToken(userId: string) {
  const payload = Buffer.from(
    JSON.stringify({ userId, expiresAt: Date.now() + 90 * 86_400_000 }),
  ).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

function tokenOwner(token: string) {
  const broken = () =>
    new TRPCError({
      code: "NOT_FOUND",
      message:
        "This link doesn’t work anymore. Sign in to change your daily email in Settings.",
    });
  const [payload, signed, extra] = token.split(".");
  if (!payload || !signed || extra) throw broken();
  const expected = signature(payload);
  const actual = Buffer.from(signed, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
    throw broken();
  try {
    const parsed = z
      .object({
        userId: z.string().min(1).max(255),
        expiresAt: z.number().int().min(Date.now()),
      })
      .parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    return parsed.userId;
  } catch {
    throw broken();
  }
}

async function subscription(db: Database, token: string) {
  const userId = tokenOwner(token);
  const user = await db.user.findUnique({ where: { clerkUserId: userId } });
  if (!user?.active)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This link doesn’t work anymore.",
    });
  return { user, opened: await requireHousehold(db, userId) };
}

export async function readEmailSubscription(db: Database, token: string) {
  const { user, opened } = await subscription(db, token);
  const email = user.primaryEmail;
  return {
    enabled: opened.ledger.budget.settings.emailEnabled,
    email: email
      ? `${email.slice(0, 2)}••••••@${email.split("@")[1]}`
      : "your account",
  };
}

export async function setEmailSubscription(
  db: Database,
  token: string,
  enabled: boolean,
) {
  const { user, opened } = await subscription(db, token);
  if (opened.ledger.budget.settings.emailEnabled !== enabled) {
    const command = {
      type: "settings.update" as const,
      id: randomUUID(),
      emailEnabled: enabled,
    };
    await executeCommand(db, user.clerkUserId, {
      command,
      submitted: command,
      baseRevision: opened.household.revision,
    });
  }
  if (!enabled) await cancelScheduledDailyReviews(db, user.clerkUserId);
  return { enabled };
}
