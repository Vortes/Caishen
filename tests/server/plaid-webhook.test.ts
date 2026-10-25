import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  cachedKeyFetcher,
  PlaidWebhookError,
  verifyPlaidWebhook,
} from "../../src/server/plaid-webhook";
import {
  base64url,
  signingKey,
  verificationHeader,
} from "../plaid-webhook-fixture";

const now = new Date("2026-10-25T12:00:00Z");
const current = signingKey("key-current");
const verification = (
  body: string,
  privateKey: Parameters<typeof verificationHeader>[1],
  {
    keyId = "key-current",
    issuedAt = now.getTime() / 1000,
    hash,
  }: { keyId?: string; issuedAt?: number; hash?: string } = {},
) => verificationHeader(body, privateKey, { keyId, issuedAt, hash });
const body = JSON.stringify({
  webhook_type: "ITEM",
  webhook_code: "PENDING_DISCONNECT",
  item_id: "item-fixture",
  environment: "sandbox",
});

function request(verificationHeader: string, payload = body) {
  return new Request("https://caishen.example/api/webhooks/plaid", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "plaid-verification": verificationHeader,
    },
    body: payload,
  });
}

const fetchKey = async (keyId: string) => {
  if (keyId === current.key.kid) return current.key;
  throw new Error(`Unknown key ${keyId}`);
};

const hasStatus =
  (status: number) =>
  (error: unknown): boolean =>
    error instanceof PlaidWebhookError && error.status === status;

void test("a webhook signed with Plaid's current key is verified and its body returned", async () => {
  const verified = await verifyPlaidWebhook(
    request(verification(body, current.privateKey)),
    fetchKey,
    () => now,
  );
  assert.deepEqual(verified, {
    webhook_type: "ITEM",
    webhook_code: "PENDING_DISCONNECT",
    item_id: "item-fixture",
    environment: "sandbox",
  });
});

void test("a wrong key, a stale iat, or a body that differs from the signed hash is refused with 401", async () => {
  const other = signingKey("key-current");
  await assert.rejects(
    verifyPlaidWebhook(
      request(verification(body, other.privateKey)),
      fetchKey,
      () => now,
    ),
    hasStatus(401),
  );
  const stale = verification(body, current.privateKey, {
    issuedAt: now.getTime() / 1000 - 5 * 60 - 1,
  });
  await assert.rejects(
    verifyPlaidWebhook(request(stale), fetchKey, () => now),
    hasStatus(401),
  );
  const tampered = body.replace("PENDING_DISCONNECT", "LOGIN_REPAIRED");
  await assert.rejects(
    verifyPlaidWebhook(
      request(verification(body, current.privateKey), tampered),
      fetchKey,
      () => now,
    ),
    hasStatus(401),
  );
  await assert.rejects(
    verifyPlaidWebhook(request("not-a-jwt"), fetchKey, () => now),
    hasStatus(401),
  );
  const unsigned = `${base64url(JSON.stringify({ alg: "none", kid: "key-current" }))}.${base64url(JSON.stringify({ iat: now.getTime() / 1000, request_body_sha256: createHash("sha256").update(body).digest("hex") }))}.`;
  await assert.rejects(
    verifyPlaidWebhook(request(unsigned), fetchKey, () => now),
    hasStatus(401),
  );
});

void test("a key Plaid marked expired is refused, and an unknown key id is fetched once and cached", async () => {
  const expired = signingKey("key-expired");
  expired.key.expired_at = 1_750_000_000;
  const next = signingKey("key-next");
  const fetched: string[] = [];
  const cached = cachedKeyFetcher(async (keyId) => {
    fetched.push(keyId);
    const found = [expired.key, next.key].find((key) => key.kid === keyId);
    if (!found) throw new Error(`Unknown key ${keyId}`);
    return found;
  });
  await assert.rejects(
    verifyPlaidWebhook(
      request(verification(body, expired.privateKey, { keyId: "key-expired" })),
      cached,
      () => now,
    ),
    hasStatus(401),
  );
  for (let delivery = 0; delivery < 2; delivery++)
    assert.equal(
      (
        await verifyPlaidWebhook(
          request(verification(body, next.privateKey, { keyId: "key-next" })),
          cached,
          () => now,
        )
      ).webhook_code,
      "PENDING_DISCONNECT",
    );
  assert.deepEqual(fetched, ["key-expired", "key-next"]);
  await assert.rejects(
    verifyPlaidWebhook(
      request(verification(body, current.privateKey, { keyId: "key-unknown" })),
      cached,
      () => now,
    ),
    hasStatus(401),
  );
});
