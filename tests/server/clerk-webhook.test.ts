import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  ClerkWebhookError,
  verifyClerkRequest,
} from "../../src/server/clerk-webhook";

const key = Buffer.from("fixture-webhook-hmac-key-32-bytes!", "utf8");
const secret = `whsec_${key.toString("base64")}`;
const messageId = "msg_fixture_verified_delivery";
const payload = JSON.stringify({
  type: "user.deleted",
  object: "event",
  data: { id: "user_fixture_private", object: "user", deleted: true },
  event_attributes: {
    http_request: { client_ip: "127.0.0.1", user_agent: "local fixture" },
  },
  timestamp: Date.now(),
  instance_id: "ins_fixture",
});

function signedHeaders(
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
  id = messageId,
): Headers {
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return new Headers({
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`,
  });
}

function request(body = payload, headers = signedHeaders(body)): Request {
  return new Request("https://caishen.example/api/webhooks/clerk", {
    method: "POST",
    body,
    headers,
  });
}

const hasStatus =
  (status: number) =>
  (error: unknown): boolean =>
    error instanceof ClerkWebhookError && error.status === status;

void test("Clerk SDK verifies locally signed raw payload and returns the authenticated delivery identity", async () => {
  const result = await verifyClerkRequest(request(), secret);
  assert.equal(result.messageId, messageId);
  assert.equal(result.event.type, "user.deleted");
  assert.equal(result.event.data.id, "user_fixture_private");
  const formatted = JSON.stringify(JSON.parse(payload) as unknown, null, 2);
  const exactWhitespace = await verifyClerkRequest(request(formatted), secret);
  assert.equal(exactWhitespace.event.type, "user.deleted");
});

void test("Clerk webhook rejects body tampering, wrong key, and modified delivery identity", async () => {
  const headers = signedHeaders(payload);
  await assert.rejects(
    verifyClerkRequest(
      request(payload.replace("user_fixture_private", "attacker"), headers),
      secret,
    ),
    hasStatus(400),
  );
  await assert.rejects(
    verifyClerkRequest(
      request(),
      `whsec_${Buffer.from("different-fixture-signing-key").toString("base64")}`,
    ),
    hasStatus(400),
  );
  const changedId = signedHeaders(payload);
  changedId.set("svix-id", "msg_attacker_delivery");
  await assert.rejects(
    verifyClerkRequest(request(payload, changedId), secret),
    hasStatus(400),
  );
});

void test("official verifier rejects stale and future replay timestamps", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const timestamp of [now - 600, now + 600]) {
    await assert.rejects(
      verifyClerkRequest(
        request(payload, signedHeaders(payload, timestamp)),
        secret,
      ),
      hasStatus(400),
    );
  }
  const malformed = signedHeaders(payload);
  malformed.set("svix-timestamp", `${now}trailing-text`);
  await assert.rejects(
    verifyClerkRequest(request(payload, malformed), secret),
    hasStatus(400),
  );
});

void test("fresh retry retains its message ID for durable database deduplication", async () => {
  const headers = signedHeaders(payload);
  const first = await verifyClerkRequest(request(payload, headers), secret);
  const retry = await verifyClerkRequest(request(payload, headers), secret);
  assert.equal(first.messageId, retry.messageId);
  assert.deepEqual(first.event, retry.event);
});

void test("absent or malformed signing configuration returns 503 without consuming payload", async () => {
  for (const signingSecret of [
    undefined,
    "",
    "  ",
    "sk_live_not-a-webhook-key",
    "whsec_not-valid-base64!",
  ]) {
    const incoming = request();
    await assert.rejects(
      verifyClerkRequest(incoming, signingSecret),
      hasStatus(503),
    );
    assert.equal(incoming.bodyUsed, false);
  }
});

void test("each Svix authentication header is required before parsing a body", async () => {
  for (const name of ["svix-id", "svix-timestamp", "svix-signature"]) {
    const headers = signedHeaders(payload);
    headers.delete(name);
    const incoming = request("unparsed sensitive body", headers);
    await assert.rejects(verifyClerkRequest(incoming, secret), hasStatus(400));
    assert.equal(incoming.bodyUsed, false);
  }
});

void test("signed malformed JSON and unreadable streams return a sanitized error without sensitive SDK details", async () => {
  const malformed = '{"secret": "fixture-sensitive-payload"';
  await assert.rejects(
    verifyClerkRequest(request(malformed), secret),
    (error: unknown) => {
      assert.ok(error instanceof ClerkWebhookError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Invalid Clerk webhook request.");
      assert.ok(!error.message.includes("fixture-sensitive-payload"));
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("sensitive stream failure"));
    },
  });
  const incoming = new Request("https://caishen.example/api/webhooks/clerk", {
    method: "POST",
    body: stream,
    headers: signedHeaders(payload),
    duplex: "half",
  } as RequestInit);
  await assert.rejects(
    verifyClerkRequest(incoming, secret),
    (error: unknown) =>
      error instanceof ClerkWebhookError &&
      error.status === 400 &&
      !error.message.includes("sensitive stream failure"),
  );
});

void test("webhook bodies are bounded to 256 KB by declared size and actual streamed bytes before JSON parsing", async () => {
  const oversized = "x".repeat(256 * 1024 + 1);
  const declaredHeaders = signedHeaders(payload);
  declaredHeaders.set("content-length", String(oversized.length));
  const declared = request(payload, declaredHeaders);
  await assert.rejects(verifyClerkRequest(declared, secret), hasStatus(413));
  assert.equal(declared.bodyUsed, false);
  const understated = signedHeaders(oversized);
  understated.set("content-length", "1");
  await assert.rejects(
    verifyClerkRequest(request(oversized, understated), secret),
    hasStatus(413),
  );
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamed = new Request("https://caishen.example/api/webhooks/clerk", {
    method: "POST",
    headers: signedHeaders(payload),
    body: stream,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(verifyClerkRequest(streamed, secret), hasStatus(413));
  assert.equal(cancelled, true);
});
