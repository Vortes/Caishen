import { z } from "zod";
import {
  createPlaidClient,
  type PlaidRequestRecorder,
} from "~/server/integrations/plaid";
import { providerIdSchema } from "~/server/integrations/validation";
import type { Database } from "./household";
import { jsonValue } from "./safety";

// The provider event audit trail (spec #139): what Caishen asked Plaid, what
// Plaid answered, and when, for any connection. Rows hold ids and outcomes
// only; tokens, account numbers, and request bodies are never stored.

const webhookDetailSchema = z.object({
  webhookType: z.string().max(100).nullable(),
  webhookCode: z.string().max(100).nullable(),
  verification: z.string().min(1).max(100),
});
const linkDetailSchema = z.object({
  institutionId: providerIdSchema.nullable(),
  accountCount: z.number().int().nonnegative().nullable(),
});
/** BankProviderEvent.detail: what a webhook or Link event adds to its row. */
export const bankProviderEventDetailSchema = z.union([
  webhookDetailSchema,
  linkDetailSchema,
]);
type EventDetail = z.infer<typeof bankProviderEventDetailSchema>;

interface ProviderEvent {
  kind: "request" | "webhook" | "link";
  method: string;
  requestId?: string | null;
  errorCode?: string | null;
  connectionId?: string | null;
  userId?: string | null;
  durationMs?: number | null;
  detail?: EventDetail;
}

async function writeEvent(db: Database, event: ProviderEvent) {
  await db.bankProviderEvent.create({
    data: {
      kind: event.kind,
      method: event.method,
      requestId: event.requestId ?? null,
      errorCode: event.errorCode ?? null,
      connectionId: event.connectionId ?? null,
      clerkUserId: event.userId ?? null,
      durationMs: event.durationMs ?? null,
      detail: event.detail
        ? jsonValue(bankProviderEventDetailSchema.parse(event.detail))
        : undefined,
    },
  });
}

// The audit trail must never fail the bank operation it describes, so a
// failed event write is logged and swallowed here and nowhere else.
async function recordEvent(db: Database, event: ProviderEvent) {
  try {
    await writeEvent(db, event);
  } catch (error) {
    console.error("Bank provider event could not be recorded", {
      ...event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Records each Plaid request a client makes on behalf of one member. */
export function plaidRequestRecorder(
  db: Database,
  on: { userId: string | null; connectionId?: string | null },
): PlaidRequestRecorder {
  return (event) =>
    writeEvent(db, {
      kind: "request",
      method: event.path,
      requestId: event.requestId,
      errorCode: event.errorCode,
      durationMs: event.durationMs,
      userId: on.userId,
      connectionId: on.connectionId,
    });
}

/** Where a member's Link attempt ended: completed, or exited with a reason. */
export async function recordBankLinkOutcome(
  db: Database,
  outcome: {
    userId: string;
    method: "success" | "exit";
    connectionId?: string | null;
    institutionId: string | null;
    accountCount: number | null;
    requestId?: string | null;
    errorCode?: string | null;
  },
) {
  await recordEvent(db, {
    kind: "link",
    method: outcome.method,
    userId: outcome.userId,
    connectionId: outcome.connectionId,
    requestId: outcome.requestId,
    errorCode: outcome.errorCode,
    detail: {
      institutionId: outcome.institutionId,
      accountCount: outcome.accountCount,
    },
  });
}

/**
 * A webhook Plaid delivered, verified or not. The route that verifies and
 * handles webhooks (#146) calls this for every receipt; an unverified body
 * is recorded without a type or code, since nothing in it can be trusted.
 */
export async function recordBankWebhookReceipt(
  db: Database,
  receipt: {
    webhookType: string | null;
    webhookCode: string | null;
    verification: string;
    connectionId?: string | null;
    userId?: string | null;
    requestId?: string | null;
    errorCode?: string | null;
  },
) {
  const named = [receipt.webhookType, receipt.webhookCode].filter(
    (part): part is string => !!part,
  );
  await recordEvent(db, {
    kind: "webhook",
    method: named.length ? named.join("/") : "unverified",
    connectionId: receipt.connectionId,
    userId: receipt.userId,
    requestId: receipt.requestId,
    errorCode: receipt.errorCode,
    detail: {
      webhookType: receipt.webhookType,
      webhookCode: receipt.webhookCode,
      verification: receipt.verification,
    },
  });
}

/** Operational records are kept no longer than 90 days. */
export const BANK_PROVIDER_EVENT_RETENTION_DAYS = 90;

/** Removes events past the retention window; the daily job's scheduled purge. */
export async function purgeBankProviderEvents(db: Database, now: Date) {
  const cutoff = new Date(
    now.getTime() - BANK_PROVIDER_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const { count } = await db.bankProviderEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}

export function bankClient(
  db: Database,
  userId: string | null,
  connectionId?: string | null,
) {
  return createPlaidClient(
    {
      clientId: process.env.PLAID_CLIENT_ID ?? "",
      secret: process.env.PLAID_SECRET ?? "",
      environment: z
        .enum(["sandbox", "production"])
        .parse(process.env.PLAID_ENV ?? "sandbox"),
      redirectUri: process.env.PLAID_REDIRECT_URI,
    },
    undefined,
    plaidRequestRecorder(db, { userId, connectionId }),
  );
}
