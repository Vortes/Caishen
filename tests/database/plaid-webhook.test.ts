import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { afterEach, mock } from "node:test";
import nextEnv from "@next/env";

import { PrismaClient } from "../../src/generated/prisma";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { respondToPlaidWebhook } from "../../src/server/plaid-webhook";
import { fetchPlaidWebhookKey } from "../../src/server/services/banks";
import { onboard } from "../../src/server/services/household-operations";
import { encryptBankToken } from "../../src/server/token-crypto";
import { signedRequest, signingKey } from "../plaid-webhook-fixture";

// The webhook route against a real household: each Item webhook Plaid
// sends, signed, and the connection status the Banks panel then shows.
nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const alice = `test-plaid-webhook-${randomUUID()}`;
const now = new Date("2026-10-25T12:00:00Z");
const key = signingKey("key-current");
const fetchKey = async (keyId: string) => {
  assert.equal(keyId, key.key.kid);
  return key.key;
};

const environmentKeys = [
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "BANK_TOKEN_ENCRYPTION_KEY",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((name) => [name, process.env[name]]),
);
afterEach(async () => {
  mock.restoreAll();
  for (const name of environmentKeys) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  const memberships = await db.workspaceMember.findMany({
    where: { clerkUserId: alice },
  });
  await db.workspace.deleteMany({
    where: { id: { in: memberships.map((member) => member.workspaceId) } },
  });
  await db.bankConnection.deleteMany({ where: { clerkUserId: alice } });
  await db.bankProviderEvent.deleteMany({ where: { clerkUserId: alice } });
});
test.before(() => db.user.create({ data: { clerkUserId: alice } }));
test.after(async () => {
  await db.user.delete({ where: { clerkUserId: alice } });
  await db.$disconnect();
});

async function harness() {
  process.env.PLAID_CLIENT_ID = "fixture-client";
  process.env.PLAID_SECRET = "fixture-secret";
  process.env.PLAID_ENV = "sandbox";
  process.env.BANK_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  await onboard(db, alice, {
    name: "Alice",
    month: "2026-10",
    timezone: "America/Los_Angeles",
  });
  const connection = await db.bankConnection.create({
    data: {
      id: `connection-${randomUUID()}`,
      clerkUserId: alice,
      itemId: `item-${randomUUID()}`,
      encryptedToken: encryptBankToken("private-access-token", alice),
      imports: { institutionName: "Chase" },
      accountMappings: {},
    },
  });
  const scheduled: Promise<void>[] = [];
  const deliver = (webhook: Record<string, unknown>) =>
    respondToPlaidWebhook(
      signedRequest(JSON.stringify(webhook), key.privateKey, {
        keyId: key.key.kid,
        issuedAt: now.getTime() / 1000,
      }),
      {
        db,
        fetchKey,
        now: () => now,
        schedule: (task) => {
          scheduled.push(task());
        },
      },
    );
  return {
    connection,
    deliver,
    scheduled,
    saved: () =>
      db.bankConnection.findUniqueOrThrow({ where: { id: connection.id } }),
  };
}

void test("ITEM ERROR with ITEM_LOGIN_REQUIRED marks the connection login required", async () => {
  const h = await harness();
  const response = await h.deliver({
    webhook_type: "ITEM",
    webhook_code: "ERROR",
    item_id: h.connection.itemId,
    error: {
      error_type: "ITEM_ERROR",
      error_code: "ITEM_LOGIN_REQUIRED",
      error_message: "the login details of this item have changed",
      display_message: null,
    },
    environment: "sandbox",
  });
  assert.equal(response.status, 200);
  assert.equal((await h.saved()).status, "login_required");
});

void test("pending disconnect, pending expiration, revoked permission, and new accounts each set what the Banks panel shows", async () => {
  const h = await harness();
  const item = (webhook: Record<string, unknown>) => ({
    item_id: h.connection.itemId,
    environment: "sandbox",
    webhook_type: "ITEM",
    ...webhook,
  });
  assert.equal(
    (
      await h.deliver(
        item({
          webhook_code: "PENDING_DISCONNECT",
          reason: "INSTITUTION_MIGRATION",
        }),
      )
    ).status,
    200,
  );
  assert.equal((await h.saved()).status, "pending_disconnect");
  assert.equal((await h.saved()).consentExpiresAt, null);

  await h.deliver(
    item({
      webhook_code: "PENDING_EXPIRATION",
      consent_expiration_time: "2026-11-01T12:00:00Z",
    }),
  );
  assert.equal((await h.saved()).status, "pending_disconnect");
  assert.deepEqual(
    (await h.saved()).consentExpiresAt,
    new Date("2026-11-01T12:00:00Z"),
  );

  await h.deliver(item({ webhook_code: "NEW_ACCOUNTS_AVAILABLE" }));
  assert.equal((await h.saved()).newAccountsAvailable, true);
  assert.equal((await h.saved()).status, "pending_disconnect");

  await h.deliver(
    item({
      webhook_code: "USER_PERMISSION_REVOKED",
      error: {
        error_type: "ITEM_ERROR",
        error_code: "USER_PERMISSION_REVOKED",
        error_message: "",
        display_message: null,
      },
    }),
  );
  assert.equal((await h.saved()).status, "revoked");
  assert.deepEqual(h.scheduled, []);
});

void test("SYNC_UPDATES_AVAILABLE records the request and runs the account update, which stores the Item's health from /item/get", async (t) => {
  const h = await harness();
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const path = new URL(url instanceof Request ? url.url : url).pathname;
    paths.push(path);
    switch (path) {
      case "/item/get":
        return Response.json({
          item: {
            item_id: h.connection.itemId,
            institution_id: "ins_3",
            consent_expiration_time: "2027-10-01T00:00:00Z",
            error: null,
          },
          status: {
            transactions: {
              last_successful_update: "2026-10-25T11:30:00Z",
              last_failed_update: "2026-10-24T03:00:00Z",
            },
          },
        });
      case "/transactions/sync":
        return Response.json({
          added: [],
          modified: [],
          removed: [],
          accounts: [],
          has_more: false,
          next_cursor: "cursor-1",
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        });
      case "/accounts/get":
        return Response.json({ accounts: [], item: {} });
      default:
        throw new Error(`Unexpected provider request: ${path}`);
    }
  });
  const response = await h.deliver({
    webhook_type: "TRANSACTIONS",
    webhook_code: "SYNC_UPDATES_AVAILABLE",
    item_id: h.connection.itemId,
    initial_update_complete: true,
    historical_update_complete: true,
    environment: "sandbox",
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await h.saved()).updateRequestedAt, now);
  await Promise.all(h.scheduled);
  const saved = await h.saved();
  assert.ok(saved.lastSyncedAt, "the account update ran");
  assert.equal(saved.cursor, "cursor-1");
  assert.deepEqual(saved.consentExpiresAt, new Date("2027-10-01T00:00:00Z"));
  assert.deepEqual(
    saved.lastSuccessfulUpdateAt,
    new Date("2026-10-25T11:30:00Z"),
  );
  assert.deepEqual(saved.lastFailedUpdateAt, new Date("2026-10-24T03:00:00Z"));
  assert.equal(saved.status, "connected");
  assert.ok(paths.includes("/item/get"), paths.join(", "));
});

void test("LOGIN_REPAIRED returns a login-required connection to connected; unknown Items and unhandled codes are acknowledged; unverified deliveries are refused", async (t) => {
  const h = await harness();
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => {
    warnings.push(args);
  });
  await db.bankConnection.update({
    where: { id: h.connection.id },
    data: { status: "login_required" },
  });
  const repaired = await h.deliver({
    webhook_type: "ITEM",
    webhook_code: "LOGIN_REPAIRED",
    item_id: h.connection.itemId,
    environment: "sandbox",
  });
  assert.equal(repaired.status, 200);
  assert.equal((await h.saved()).status, "connected");

  const unknownItem = await h.deliver({
    webhook_type: "ITEM",
    webhook_code: "PENDING_DISCONNECT",
    item_id: "item-nobody-holds",
    environment: "sandbox",
  });
  assert.equal(unknownItem.status, 200);
  assert.deepEqual(await unknownItem.json(), { received: true, ignored: true });

  const unhandled = await h.deliver({
    webhook_type: "ITEM",
    webhook_code: "WEBHOOK_UPDATE_ACKNOWLEDGED",
    item_id: h.connection.itemId,
    new_webhook_url: "https://caishen.example/api/webhooks/plaid",
    environment: "sandbox",
  });
  assert.equal(unhandled.status, 200);
  assert.deepEqual(await unhandled.json(), { received: true, ignored: true });
  assert.equal((await h.saved()).status, "connected");
  assert.equal(warnings.length, 2);
  assert.ok(
    warnings.every(
      (entry) =>
        JSON.stringify(entry).includes(h.connection.itemId) ||
        JSON.stringify(entry).includes("item-nobody-holds"),
    ),
  );

  const stranger = signingKey("key-current");
  const refused = await respondToPlaidWebhook(
    signedRequest(
      JSON.stringify({
        webhook_type: "ITEM",
        webhook_code: "USER_PERMISSION_REVOKED",
        item_id: h.connection.itemId,
      }),
      stranger.privateKey,
      { keyId: "key-current", issuedAt: now.getTime() / 1000 },
    ),
    { db, fetchKey, now: () => now, schedule: () => assert.fail("scheduled") },
  );
  assert.equal(refused.status, 401);
  assert.equal((await h.saved()).status, "connected");
  assert.deepEqual(h.scheduled, []);
});

void test("a webhook issued in the future is refused before changing Item health", async () => {
  const h = await harness();
  const response = await respondToPlaidWebhook(
    signedRequest(
      JSON.stringify({
        webhook_type: "ITEM",
        webhook_code: "USER_PERMISSION_REVOKED",
        item_id: h.connection.itemId,
      }),
      key.privateKey,
      {
        keyId: key.key.kid,
        issuedAt: now.getTime() / 1000 + 3600,
      },
    ),
    {
      db,
      fetchKey,
      now: () => now,
      schedule: () => assert.fail("Must not schedule an unverified webhook"),
    },
  );
  assert.equal(response.status, 401);
  assert.equal((await h.saved()).status, "connected");
});

void test("a webhook verification key request is audited before the sender has an authenticated user", async () => {
  const h = await harness();
  const requestId = `key-request-${randomUUID()}`;
  mock.method(globalThis, "fetch", async () =>
    Response.json({ key: key.key, request_id: requestId }),
  );
  const response = await respondToPlaidWebhook(
    signedRequest(
      JSON.stringify({
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        item_id: h.connection.itemId,
      }),
      key.privateKey,
      { keyId: key.key.kid, issuedAt: now.getTime() / 1000 },
    ),
    {
      db,
      fetchKey: (keyId) => fetchPlaidWebhookKey(db, keyId),
      now: () => now,
      schedule: () => assert.fail("scheduled"),
    },
  );
  assert.equal(response.status, 200);
  const events = await db.bankProviderEvent.findMany({ where: { requestId } });
  assert.deepEqual(
    events.map(({ kind, method, clerkUserId, connectionId }) => ({
      kind,
      method,
      clerkUserId,
      connectionId,
    })),
    [
      {
        kind: "request",
        method: "/webhook_verification_key/get",
        clerkUserId: null,
        connectionId: null,
      },
    ],
  );
  await db.bankProviderEvent.deleteMany({ where: { requestId } });
});

void test("a verified webhook records only its outcome and the owning connection in the audit trail", async () => {
  const h = await harness();
  const response = await h.deliver({
    webhook_type: "ITEM",
    webhook_code: "ERROR",
    item_id: h.connection.itemId,
    error: {
      error_code: "ITEM_LOGIN_REQUIRED",
      error_message: "private bank details",
    },
    access_token: "must-not-be-recorded",
  });
  assert.equal(response.status, 200);
  const events = await db.bankProviderEvent.findMany({
    where: { connectionId: h.connection.id, kind: "webhook" },
  });
  assert.deepEqual(
    events.map(({ method, clerkUserId, errorCode, detail }) => ({
      method,
      clerkUserId,
      errorCode,
      detail,
    })),
    [
      {
        method: "ITEM/ERROR",
        clerkUserId: alice,
        errorCode: "ITEM_LOGIN_REQUIRED",
        detail: {
          webhookType: "ITEM",
          webhookCode: "ERROR",
          verification: "verified",
        },
      },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(events),
    /private bank details|must-not-be-recorded/,
  );
});

void test("a verified webhook for an unknown Item is audited without attributing it to a user", async (t) => {
  const h = await harness();
  const code = `UNKNOWN_${randomUUID()}`;
  t.after(() =>
    db.bankProviderEvent.deleteMany({ where: { method: `ITEM/${code}` } }),
  );
  const response = await h.deliver({
    webhook_type: "ITEM",
    webhook_code: code,
    item_id: "unknown-item",
  });
  assert.deepEqual(await response.json(), { received: true, ignored: true });
  const events = await db.bankProviderEvent.findMany({
    where: { method: `ITEM/${code}` },
  });
  assert.deepEqual(
    events.map(({ clerkUserId, connectionId, detail }) => ({
      clerkUserId,
      connectionId,
      detail,
    })),
    [
      {
        clerkUserId: null,
        connectionId: null,
        detail: {
          webhookType: "ITEM",
          webhookCode: code,
          verification: "verified",
        },
      },
    ],
  );
});

void test("an unverified webhook is audited without trusting the Item or fields in its body", async (t) => {
  const h = await harness();
  const existing = await db.bankProviderEvent.findMany({
    select: { id: true },
  });
  const newReceipts = {
    kind: "webhook",
    id: { notIn: existing.map(({ id }) => id) },
  };
  t.after(() => db.bankProviderEvent.deleteMany({ where: newReceipts }));
  const stranger = signingKey("key-current");
  const response = await respondToPlaidWebhook(
    signedRequest(
      JSON.stringify({
        webhook_type: "ITEM",
        webhook_code: "USER_PERMISSION_REVOKED",
        item_id: h.connection.itemId,
        access_token: "untrusted-token",
      }),
      stranger.privateKey,
      { keyId: key.key.kid, issuedAt: now.getTime() / 1000 },
    ),
    { db, fetchKey, now: () => now, schedule: () => assert.fail("scheduled") },
  );
  assert.equal(response.status, 401);
  const events = await db.bankProviderEvent.findMany({ where: newReceipts });
  assert.deepEqual(
    events.map(({ method, connectionId, clerkUserId, detail }) => ({
      method,
      connectionId,
      clerkUserId,
      detail,
    })),
    [
      {
        method: "unverified",
        connectionId: null,
        clerkUserId: null,
        detail: {
          webhookType: null,
          webhookCode: null,
          verification: "failed",
        },
      },
    ],
  );
  assert.equal((await h.saved()).status, "connected");
  assert.doesNotMatch(JSON.stringify(events), /untrusted-token/);
});
