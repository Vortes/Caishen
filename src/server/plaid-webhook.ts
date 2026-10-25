import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { z } from "zod";
import {
  bankConnectionStatusSchema,
  webhookChange,
} from "./services/bank-connection-status";
import { syncBanks } from "./services/banks";
import type { Database } from "./services/household";
import {
  CONNECTION_MAINTENANCE_MESSAGE,
  reportUnreadable,
  zodIssues,
} from "./services/stored-data";

// Plaid signs each webhook with an ES256 JWT in the Plaid-Verification
// header whose payload names the SHA-256 of the body. The key is fetched by
// its id from Plaid and cached; a key Plaid has marked expired is refused.
// https://plaid.com/docs/api/webhooks/webhook-verification/

const MAX_BODY_BYTES = 256 * 1024;
const REPLAY_WINDOW_SECONDS = 5 * 60;

export class PlaidWebhookError extends Error {
  constructor(
    public readonly status: 401 | 413,
    message: string,
  ) {
    super(message);
    this.name = "PlaidWebhookError";
  }
}

export const plaidWebhookKeySchema = z.object({
  alg: z.literal("ES256"),
  crv: z.literal("P-256"),
  kid: z.string().min(1).max(256),
  kty: z.literal("EC"),
  use: z.literal("sig"),
  x: z.string().min(1).max(256),
  y: z.string().min(1).max(256),
  created_at: z.number().int(),
  expired_at: z.number().int().nullable(),
});
export type PlaidWebhookKey = z.infer<typeof plaidWebhookKeySchema>;
/** Plaid's key for a key id, as /webhook_verification_key/get returns it. */
export type PlaidWebhookKeyFetcher = (keyId: string) => Promise<unknown>;

const headerSchema = z.object({
  alg: z.literal("ES256"),
  kid: z.string().min(1).max(256),
  typ: z.literal("JWT").optional(),
});
const claimsSchema = z.object({
  iat: z.number().int(),
  request_body_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const plaidWebhookSchema = z
  .object({
    webhook_type: z.string().min(1).max(100),
    webhook_code: z.string().min(1).max(100),
    item_id: z.string().min(1).max(256).optional(),
    error: z
      .object({ error_code: z.string().max(100).nullable() })
      .passthrough()
      .nullable()
      .optional(),
    consent_expiration_time: z.string().datetime().nullable().optional(),
    account_ids: z.array(z.string().min(1).max(256)).max(1000).optional(),
  })
  .passthrough();
export type PlaidWebhook = z.infer<typeof plaidWebhookSchema>;

const refused = (message = "Plaid webhook verification failed.") =>
  new PlaidWebhookError(401, message);

function decodeSegment<T>(segment: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw refused();
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw refused();
  return result.data;
}

async function boundedBody(request: Request): Promise<Buffer> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES)
    throw new PlaidWebhookError(413, "Plaid webhook body is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw refused();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PlaidWebhookError(413, "Plaid webhook body is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PlaidWebhookError) throw error;
    throw refused();
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

/**
 * Keys by id, fetched once. Plaid rotates keys by publishing a new id, so a
 * key id not seen before is fetched; one Plaid has marked expired is kept so
 * it keeps being refused without another fetch.
 */
export function cachedKeyFetcher(
  fetchKey: PlaidWebhookKeyFetcher,
): PlaidWebhookKeyFetcher {
  const keys = new Map<string, unknown>();
  return async (keyId) => {
    const cached = keys.get(keyId);
    if (cached) return cached;
    const key = await fetchKey(keyId);
    keys.set(keyId, key);
    return key;
  };
}

/**
 * The verified webhook body, or a 401 PlaidWebhookError. The signature,
 * replay window, and body hash are all checked before the body is parsed.
 */
export async function verifyPlaidWebhook(
  request: Request,
  fetchKey: PlaidWebhookKeyFetcher,
  now: () => Date = () => new Date(),
): Promise<PlaidWebhook> {
  const token = request.headers.get("plaid-verification")?.trim();
  if (!token || token.length > 4096) throw refused();
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment))
    throw refused();
  const [encodedHeader, encodedClaims, encodedSignature] = segments as [
    string,
    string,
    string,
  ];
  const header = decodeSegment(encodedHeader, headerSchema);
  let key: PlaidWebhookKey;
  try {
    key = plaidWebhookKeySchema.parse(await fetchKey(header.kid));
  } catch {
    throw refused();
  }
  if (key.expired_at !== null) throw refused();
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
      format: "jwk",
    });
  } catch {
    throw refused();
  }
  const signature = Buffer.from(encodedSignature, "base64url");
  if (
    signature.length !== 64 ||
    !verify(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    )
  )
    throw refused();
  const claims = decodeSegment(encodedClaims, claimsSchema);
  const age = now().getTime() / 1000 - claims.iat;
  if (age > REPLAY_WINDOW_SECONDS) throw refused();
  const body = await boundedBody(request);
  const digest = Buffer.from(
    createHash("sha256").update(body).digest("hex"),
    "utf8",
  );
  const claimed = Buffer.from(claims.request_body_sha256, "utf8");
  if (digest.length !== claimed.length || !timingSafeEqual(digest, claimed))
    throw refused();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw refused();
  }
  const webhook = plaidWebhookSchema.safeParse(parsed);
  if (!webhook.success) throw refused();
  return webhook.data;
}

export interface PlaidWebhookDependencies {
  db: Database;
  fetchKey: PlaidWebhookKeyFetcher;
  now?: () => Date;
  /** Runs work after the response, so Plaid gets its 200 without waiting. */
  schedule: (task: () => Promise<void>) => void;
}

/**
 * The webhook route's response: 401 for anything not verifiably from Plaid,
 * otherwise 200 once the connection's status is recorded. A webhook for an
 * Item this app does not hold, or one it does not act on, is recorded in the
 * logs and acknowledged so Plaid does not retry it.
 */
export async function respondToPlaidWebhook(
  request: Request,
  { db, fetchKey, now = () => new Date(), schedule }: PlaidWebhookDependencies,
): Promise<Response> {
  let webhook: PlaidWebhook;
  try {
    webhook = await verifyPlaidWebhook(request, fetchKey, now);
  } catch (error) {
    if (error instanceof PlaidWebhookError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const connection = webhook.item_id
    ? await db.bankConnection.findUnique({
        where: { itemId: webhook.item_id },
        select: { id: true, clerkUserId: true, status: true },
      })
    : null;
  const receipt = {
    type: webhook.webhook_type,
    code: webhook.webhook_code,
    itemId: webhook.item_id ?? null,
  };
  if (!connection) {
    console.warn("Plaid webhook for an unknown Item was ignored", receipt);
    return Response.json({ received: true, ignored: true });
  }
  const status = bankConnectionStatusSchema.safeParse(connection.status);
  if (!status.success) {
    reportUnreadable(
      {
        record: "BankConnection.status",
        connectionId: connection.id,
        userId: connection.clerkUserId,
      },
      [{ issues: zodIssues(status.error) }],
    );
    return Response.json(
      { error: CONNECTION_MAINTENANCE_MESSAGE },
      { status: 503 },
    );
  }
  const decision = webhookChange(webhook, status.data, now());
  if (!decision) {
    console.warn("Plaid webhook was not acted on", receipt);
    return Response.json({ received: true, ignored: true });
  }
  if (Object.keys(decision.change).length)
    await db.bankConnection.update({
      where: { id: connection.id },
      data: decision.change,
    });
  if (decision.update)
    schedule(() =>
      syncBanks(db, connection.clerkUserId).then(
        () => undefined,
        (error: unknown) =>
          console.error("Account update after a Plaid webhook failed", {
            connectionId: connection.id,
            error: error instanceof Error ? error.message : String(error),
          }),
      ),
    );
  return Response.json({ received: true });
}
