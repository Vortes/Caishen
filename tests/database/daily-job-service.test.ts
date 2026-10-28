import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, {
  after,
  afterEach,
  beforeEach,
  type TestContext,
} from "node:test";
import { PrismaClient, type Prisma } from "../../src/generated/prisma";
import {
  createBook,
  execute,
  type Budget,
  type Command,
} from "../../src/domain/engine";
import { runDailyJob } from "../../src/server/services/daily-job";
import { respondToDailyJob } from "../../src/server/daily-job-endpoint";
import {
  cancelScheduledDailyReviews,
  type DailyDeliveryPayload,
} from "../../src/server/services/daily-delivery";
import type { Database } from "../../src/server/services/household";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { ObservedRevision } from "../../src/server/api/trpc";
import {
  applyTransactionSync,
  normalizePlaidTransaction,
} from "../../src/server/integrations/transactions";
import { encryptBankToken } from "../../src/server/token-crypto";
import {
  createHousehold,
  createBankConnection,
  createDatabaseCaller,
} from "./fixtures";

assertDevelopmentDatabase(process.env);
const base = new PrismaClient();
const now = new Date("2026-10-17T00:20:00Z");
const keys = [
  "CLERK_SECRET_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_BASE_URL",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "BANK_TOKEN_ENCRYPTION_KEY",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
beforeEach(() => {
  process.env.CLERK_SECRET_KEY = "fixture-signing-key";
  process.env.RESEND_API_KEY = "fixture-email-key";
  process.env.EMAIL_FROM = "Caishen <daily@example.com>";
  process.env.APP_BASE_URL = "https://caishen.example";
  process.env.PLAID_CLIENT_ID = "fixture-client";
  process.env.PLAID_SECRET = "fixture-secret";
  process.env.PLAID_ENV = "sandbox";
  process.env.BANK_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
});
afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});
after(() => base.$disconnect());
async function fixture(
  t: TestContext,
  settings: Partial<Budget["settings"]> = {},
  count = 1,
) {
  const users = Array.from(
    { length: count },
    () => `test-daily-${randomUUID()}`,
  );
  t.after(async () => {
    await base.bankProviderEvent.deleteMany({
      where: { clerkUserId: { in: users } },
    });
    await base.dailyDelivery.deleteMany({
      where: { clerkUserId: { in: users } },
    });
    await base.reviewEvidence.deleteMany({
      where: { clerkUserId: { in: users } },
    });
    await base.bankConnection.deleteMany({
      where: { clerkUserId: { in: users } },
    });
    await base.workspace.deleteMany({
      where: { members: { some: { clerkUserId: { in: users } } } },
    });
    await base.user.deleteMany({ where: { clerkUserId: { in: users } } });
  });
  await base.user.createMany({
    data: users.map((clerkUserId) => ({ clerkUserId })),
  });
  for (const userId of users) {
    let book = createBook(userId, "Daily fixture", "2026-01");
    book.budgets[userId]!.settings = {
      emailEnabled: true,
      timezone: "America/Los_Angeles",
      emailHour: 8,
      ...settings,
    };
    book = execute(book, userId, {
      type: "account.add",
      id: "checking",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      openingBalance: 100_000,
      date: "2026-01-01",
    });
    await createHousehold(base, book);
  }
  // Restrict the real database adapter to this test's users, including recovery.
  const db = base.$extends({
    query: {
      workspaceMember: {
        findMany({ args, query }) {
          args.where = { ...args.where, clerkUserId: { in: users } };
          return query(args);
        },
      },
      dailyDelivery: {
        findMany({ args, query }) {
          args.where = { ...args.where, clerkUserId: { in: users } };
          return query(args);
        },
      },
      bankConnection: {
        findMany({ args, query }) {
          args.where = {
            AND: [args.where ?? {}, { clerkUserId: { in: users } }],
          };
          return query(args);
        },
      },
    },
  }) as unknown as Database;
  const sent: DailyDeliveryPayload[] = [];
  const accepted = new Map<
    string,
    { id: string; body: DailyDeliveryPayload }
  >();
  const canceled: string[] = [];
  const send = async (payload: DailyDeliveryPayload) => {
    sent.push(structuredClone(payload));
    const existing = accepted.get(payload.dedupeKey);
    if (existing) {
      assert.deepEqual(payload, existing.body);
      return { id: existing.id };
    }
    const id = `email_${accepted.size + 1}`;
    accepted.set(payload.dedupeKey, { id, body: structuredClone(payload) });
    return { id };
  };
  const cancel = async (id: string) => {
    canceled.push(id);
    return { id };
  };
  const dependencies = {
    verifiedEmail: async (userId: string) => `${userId}@example.com`,
    send,
    cancel: (client: Database, userId: string, at: Date) =>
      cancelScheduledDailyReviews(client, userId, at, cancel, send),
  };
  const api = createDatabaseCaller({
    db: base,
    userId: users[0]!,
    headers: new Headers(),
    revision: new ObservedRevision(),
  });
  const run = async (command: Command) =>
    api.budget.execute({
      command,
      clientId: "test",
      baseRevision: (await api.budget.state({ month: "2026-10" })).revision,
    });
  return {
    db,
    users,
    userId: users[0]!,
    sent,
    accepted,
    canceled,
    send,
    cancel,
    dependencies,
    api,
    run,
  };
}
void test("one UTC batch schedules the local morning once and never queues tomorrow on retry", async (t) => {
  const h = await fixture(t);
  const first = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(first.scheduled, 1);
  assert.equal(first.failed, 0);
  assert.equal("sent" in first, false);
  assert.equal(h.sent[0]!.scheduledAt, "2026-10-17T15:00:00.000Z");
  assert.equal(
    (await runDailyJob(h.db, new Date("2026-10-17T23:30:00Z"), h.dependencies))
      .scheduled,
    0,
  );
  assert.equal(h.accepted.size, 1);
  assert.equal(h.sent.length, 1);
});
void test("a late batch requests immediate delivery of today's review", async (t) => {
  const h = await fixture(t, { timezone: "UTC", emailHour: 0 });
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).scheduled, 1);
  assert.equal(h.sent[0]!.scheduledAt, undefined);
  assert.match(h.sent[0]!.dedupeKey, /2026-10-17$/);
});
void test("the real inbox counts posted imports and matching problems but excludes routine pending imports", async (t) => {
  const h = await fixture(t);
  const connectionId = randomUUID();
  const records = applyTransactionSync(
    [],
    {
      added: [
        normalizePlaidTransaction({
          transaction_id: "pending",
          account_id: "bank-checking",
          pending: true,
          amount: 12,
          iso_currency_code: "USD",
          date: "2026-10-17",
          name: "Pending",
        }),
        normalizePlaidTransaction({
          transaction_id: "posted",
          account_id: "bank-checking",
          pending: false,
          amount: 13,
          iso_currency_code: "USD",
          date: "2026-10-17",
          name: "Posted",
        }),
        normalizePlaidTransaction({
          transaction_id: "uncertain",
          account_id: "bank-checking",
          pending: true,
          amount: 14,
          iso_currency_code: "USD",
          date: "2026-10-17",
          name: "Uncertain",
        }),
      ],
      modified: [],
      removed: [],
    },
    connectionId,
  ).records;
  records.find(
    (record) => record.current.providerTransactionId === "uncertain",
  )!.matchStatus = "needs_review";
  await createBankConnection(base, {
    data: {
      id: connectionId,
      clerkUserId: h.userId,
      itemId: randomUUID(),
      encryptedToken: encryptBankToken("fixture-bank-token", h.userId),
      lastSyncedAt: now,
      accountMappings: {
        "bank-checking": { accountId: "checking", startDate: "2026-10-01" },
      },
      imports: {
        records: JSON.parse(JSON.stringify(records)) as Prisma.InputJsonValue,
        resolved: {},
        errors: {},
        reviews: {},
      },
    },
  });
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).scheduled, 1);
  assert.match(h.sent[0]!.message.text, /2 unresolved items are/);
});
void test("old statement discrepancies do not count as inbox items", async (t) => {
  const h = await fixture(t);
  await base.reviewEvidence.create({
    data: {
      clerkUserId: h.userId,
      accountId: "checking",
      kind: "statement",
      cutoff: "2026-10-16",
      evidence: { revision: 7 },
      result: { status: "unresolved_discrepancy" },
    },
  });
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).scheduled, 1);
  assert.match(h.sent[0]!.message.text, /^0 unresolved items are/);
});
void test("disabled email still refreshes banks once per UTC day despite scheduler jitter", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const h = await fixture(t, { emailEnabled: false });
  await createBankConnection(base, {
    data: {
      id: randomUUID(),
      clerkUserId: h.userId,
      itemId: randomUUID(),
      encryptedToken: encryptBankToken("fixture-bank-token", h.userId),
      lastSyncedAt: new Date("2026-10-16T00:50:00Z"),
      accountMappings: {},
      imports: {},
    },
  });
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const path = new URL(url instanceof Request ? url.url : url).pathname;
    if (path === "/item/get")
      return Response.json({
        item: { consent_expiration_time: null, error: null },
        status: null,
      });
    if (path === "/transactions/sync")
      return Response.json({
        added: [],
        modified: [],
        removed: [],
        accounts: [],
        has_more: false,
        next_cursor: "next",
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      });
    assert.equal(path, "/accounts/get");
    return Response.json({ accounts: [], item: {} });
  });
  const first = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(first.synced, 1);
  assert.equal(first.scheduled, 0);
  assert.equal(first.failed, 0);
  t.mock.timers.setTime(new Date("2026-10-17T01:00:00Z").getTime());
  assert.equal((await runDailyJob(h.db, new Date(), h.dependencies)).synced, 0);
  assert.deepEqual(h.sent, []);
});
void test("the daily job still updates every connection, and records each Item's health, when no webhook has arrived", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const h = await fixture(t, { emailEnabled: false });
  const connections = ["chase", "amex"].map((bank) => ({
    id: randomUUID(),
    itemId: `item-${bank}-${randomUUID()}`,
  }));
  for (const connection of connections)
    await createBankConnection(base, {
      data: {
        ...connection,
        clerkUserId: h.userId,
        encryptedToken: encryptBankToken("fixture-bank-token", h.userId),
        lastSyncedAt: new Date("2026-10-16T00:50:00Z"),
        accountMappings: {},
        imports: {},
      },
    });
  const itemReads: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(url instanceof Request ? url.url : url).pathname;
      if (path === "/item/get") {
        itemReads.push(
          (JSON.parse(init?.body as string) as { access_token: string })
            .access_token,
        );
        return Response.json({
          item: { consent_expiration_time: null, error: null },
          status: {
            transactions: {
              last_successful_update: "2026-10-16T23:00:00Z",
              last_failed_update: null,
            },
          },
        });
      }
      if (path === "/transactions/sync")
        return Response.json({
          added: [],
          modified: [],
          removed: [],
          accounts: [],
          has_more: false,
          next_cursor: "next",
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        });
      assert.equal(path, "/accounts/get");
      return Response.json({ accounts: [], item: {} });
    },
  );
  const result = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(result.synced, 2);
  assert.equal(result.failed, 0);
  const saved = await base.bankConnection.findMany({
    where: { clerkUserId: h.userId },
    orderBy: { itemId: "asc" },
  });
  assert.equal(saved.length, 2);
  for (const connection of saved) {
    assert.deepEqual(connection.lastSyncedAt, now);
    assert.equal(connection.updateRequestedAt, null);
    assert.equal(connection.status, "connected");
    assert.deepEqual(
      connection.lastSuccessfulUpdateAt,
      new Date("2026-10-16T23:00:00Z"),
    );
  }
  assert.equal(itemReads.length, 2);
});
void test("uncertain delivery retries the saved recipient, sender, message and schedule", async (t) => {
  const h = await fixture(t);
  const attempts: DailyDeliveryPayload[] = [];
  let fail = true;
  const send = async (payload: DailyDeliveryPayload) => {
    attempts.push(structuredClone(payload));
    const result = await h.send(payload);
    if (fail) {
      fail = false;
      throw new Error("response lost");
    }
    return result;
  };
  assert.equal(
    (await runDailyJob(h.db, now, { ...h.dependencies, send })).failed,
    1,
  );
  process.env.EMAIL_FROM = "Changed <changed@example.com>";
  process.env.APP_BASE_URL = "https://changed.example";
  assert.equal(
    (
      await runDailyJob(h.db, new Date("2026-10-17T16:00:00Z"), {
        ...h.dependencies,
        send,
        verifiedEmail: async () => "changed@example.com",
      })
    ).scheduled,
    1,
  );
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(h.accepted.size, 1);
});
void test("an expired ambiguous request is reported instead of sent again", async (t) => {
  const h = await fixture(t);
  await base.dailyDelivery.create({
    data: {
      clerkUserId: h.userId,
      localDate: "2026-10-17",
      status: "failed",
      leaseUntil: new Date("2026-10-16"),
      firstAttemptAt: new Date("2026-10-16T00:00:00Z"),
      scheduledAt: new Date("2026-10-17T15:00:00Z"),
      payload: {
        from: "daily@example.com",
        to: "original@example.com",
        dedupeKey: `daily-review:${h.userId}:2026-10-17`,
        message: { subject: "Review", text: "Original" },
      },
    },
  });
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).failed, 1);
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).failed, 1);
  assert.deepEqual(h.sent, []);
});
void test("an active provider request prevents a concurrent worker sending the same review", async (t) => {
  const h = await fixture(t);
  let release!: () => void;
  let started!: () => void;
  const sending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dependencies = {
    ...h.dependencies,
    send: async (payload: DailyDeliveryPayload) => {
      started();
      await gate;
      return h.send(payload);
    },
  };
  const first = runDailyJob(h.db, now, dependencies);
  try {
    await sending;
    assert.equal((await runDailyJob(h.db, now, dependencies)).scheduled, 0);
  } finally {
    release();
  }
  assert.equal((await first).scheduled, 1);
  assert.equal(h.sent.length, 1);
});
void test("a failed identity lookup can retry before any email reaches the provider", async (t) => {
  const h = await fixture(t);
  assert.equal(
    (
      await runDailyJob(h.db, now, {
        ...h.dependencies,
        verifiedEmail: async () => {
          throw new Error("Unverified email");
        },
      })
    ).failed,
    1,
  );
  assert.deepEqual(h.sent, []);
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).scheduled, 1);
  assert.equal(h.accepted.size, 1);
});
void test("a malformed saved request never reaches the email provider", async (t) => {
  const h = await fixture(t);
  await base.dailyDelivery.create({
    data: {
      clerkUserId: h.userId,
      localDate: "2026-10-17",
      status: "failed",
      leaseUntil: now,
      firstAttemptAt: now,
      scheduledAt: new Date("2026-10-17T15:00:00Z"),
      payload: { to: "attacker@example.com" },
    },
  });
  t.mock.method(console, "error", () => undefined);
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).failed, 1);
  assert.deepEqual(h.sent, []);
});
void test(
  "daily work schedules exactly one review for every member across database pages",
  { timeout: 600_000 },
  async (t) => {
    const h = await fixture(t, {}, 101);
    const result = await runDailyJob(h.db, now, h.dependencies);
    assert.equal(result.processed, 101);
    assert.equal(result.scheduled, 101);
    assert.equal(result.failed, 0);
    assert.deepEqual(
      h.sent.map((item) => item.to).sort(),
      h.users.map((id) => `${id}@example.com`).sort(),
    );
  },
);
void test("one failed daylight-saving target does not prevent the other local date in the UTC batch", async (t) => {
  const h = await fixture(t, { emailHour: 16 });
  const attempted: string[] = [];
  const result = await runDailyJob(h.db, new Date("2026-03-08T00:20:00Z"), {
    ...h.dependencies,
    send: async (payload) => {
      attempted.push(payload.dedupeKey);
      if (attempted.length === 1) throw new Error("first target failed");
      return h.send(payload);
    },
  });
  assert.equal(result.failed, 1);
  assert.equal(result.scheduled, 1);
  assert.deepEqual(attempted.map((key) => key.slice(-10)).sort(), [
    "2026-03-07",
    "2026-03-08",
  ]);
});
void test("reverting email opt-in cancels a scheduled review and retries a failed cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const h = await fixture(t, { emailEnabled: false });
  const enable = randomUUID();
  await h.run({ type: "settings.update", id: enable, emailEnabled: true });
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).scheduled, 1);
  let fail = true;
  const canceled: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const endpoint = new URL(url instanceof Request ? url.url : url);
    assert.equal(endpoint.origin, "https://api.resend.com");
    if (endpoint.pathname === "/emails/email_1/cancel") {
      if (fail) {
        fail = false;
        return Response.json({}, { status: 503 });
      }
      canceled.push("email_1");
      return Response.json({ id: "email_1" });
    }
    assert.equal(endpoint.pathname, "/emails/email_1");
    return Response.json({ id: "email_1", last_event: "scheduled" });
  });
  const revert = {
    clientId: "test",
    baseRevision: (await h.api.budget.state({ month: "2026-10" })).revision,
    command: {
      type: "revert" as const,
      id: randomUUID(),
      targetOperationId: enable,
    },
  };
  await assert.rejects(h.api.budget.execute(revert), {
    code: "INTERNAL_SERVER_ERROR",
    message: /settings were saved, but queued email could not be canceled/,
  });
  assert.equal(
    (await h.api.budget.state({ month: "2026-10" })).view?.budget.settings
      .emailEnabled,
    false,
  );
  const saved = await h.api.budget.execute(revert);
  assert.equal(saved.revision, revert.baseRevision + 1);
  await h.api.budget.execute(revert);
  assert.deepEqual(canceled, ["email_1"]);
});
for (const failedCancel of [false, true])
  void test(`disabling email during delivery ${failedCancel ? "retries a failed cancellation" : "cancels the accepted schedule"}`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const h = await fixture(t);
    let fail = failedCancel;
    const dependencies = {
      ...h.dependencies,
      send: async (payload: DailyDeliveryPayload) => {
        const accepted = await h.send(payload);
        // The preference saves while the provider request still holds its lease.
        await assert.rejects(
          h.run({
            type: "settings.update",
            id: randomUUID(),
            emailEnabled: false,
          }),
          /settings were saved, but queued email could not be canceled/,
        );
        return accepted;
      },
      cancel: (client: Database, userId: string, at: Date) =>
        cancelScheduledDailyReviews(
          client,
          userId,
          at,
          async (id) => {
            if (fail) {
              fail = false;
              throw new Error("cancel timeout");
            }
            return h.cancel(id);
          },
          h.send,
        ),
    };
    // Maintenance follows delivery, so the same run retries a failed cancel.
    const first = await runDailyJob(h.db, now, dependencies);
    assert.equal(first.failed, failedCancel ? 1 : 0);
    assert.equal(first.canceled, 1);
    const retry = await runDailyJob(
      h.db,
      new Date("2026-10-17T01:00:00Z"),
      dependencies,
    );
    assert.equal(retry.failed, 0);
    assert.equal(retry.canceled, 0);
    assert.equal(retry.scheduled, 0);
    assert.deepEqual(h.canceled, ["email_1"]);
    assert.equal(h.accepted.size, 1);
  });

void test("the daily job purges provider events older than the 90-day retention window and keeps newer ones", async (t) => {
  const h = await fixture(t);
  const day = 24 * 60 * 60 * 1000;
  const event = (requestId: string, ageDays: number) => ({
    kind: "request",
    method: "/accounts/get",
    requestId,
    clerkUserId: h.userId,
    createdAt: new Date(now.getTime() - ageDays * day),
  });
  await base.bankProviderEvent.createMany({
    data: [
      event("req-expired", 91),
      event("req-last-day", 89),
      event("req-today", 0),
    ],
  });
  await runDailyJob(h.db, now, h.dependencies);
  const kept = await base.bankProviderEvent.findMany({
    where: { clerkUserId: h.userId },
  });
  assert.deepEqual(kept.map((row) => row.requestId).sort(), [
    "req-last-day",
    "req-today",
  ]);
});

/** Plaid answering every update for the given access tokens with an empty delta, and failing the rest. */
function fakePlaid(t: TestContext, healthy: (token: string) => boolean) {
  const contacted: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(url instanceof Request ? url.url : url).pathname;
      const token = (
        JSON.parse(init!.body as string) as { access_token: string }
      ).access_token;
      if (path === "/item/get") contacted.push(token);
      if (!healthy(token))
        return Response.json(
          {
            error_code: "INSTITUTION_DOWN",
            error_message: "down",
            request_id: `req-${token}`,
          },
          { status: 503 },
        );
      if (path === "/item/get")
        return Response.json({
          item: { consent_expiration_time: null, error: null },
          status: null,
        });
      if (path === "/transactions/sync")
        return Response.json({
          added: [],
          modified: [],
          removed: [],
          accounts: [],
          has_more: false,
          next_cursor: "next",
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        });
      assert.equal(path, "/accounts/get");
      return Response.json({ accounts: [], item: {} });
    },
  );
  return contacted;
}

async function connect(
  userId: string,
  token: string,
  data: Partial<Prisma.BankConnectionUncheckedCreateInput> = {},
) {
  const id = `connection-${token}-${randomUUID()}`;
  await createBankConnection(base, {
    data: {
      id,
      clerkUserId: userId,
      itemId: randomUUID(),
      encryptedToken: encryptBankToken(token, userId),
      accountMappings: {},
      imports: {},
      ...data,
    },
  });
  return id;
}

void test("each run updates exactly the connections that are due, one connection at a time", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const h = await fixture(t, { emailEnabled: false });
  const yesterday = new Date("2026-10-16T00:50:00Z");
  const earlierToday = new Date("2026-10-17T00:05:00Z");
  await connect(h.userId, "synced-today", { lastSyncedAt: earlierToday });
  await connect(h.userId, "synced-yesterday", { lastSyncedAt: yesterday });
  await connect(h.userId, "never-synced");
  await connect(h.userId, "webhook-since-sync", {
    lastSyncedAt: earlierToday,
    updateRequestedAt: new Date("2026-10-17T00:10:00Z"),
  });
  await connect(h.userId, "pending-disconnect", {
    lastSyncedAt: yesterday,
    status: "pending_disconnect",
  });
  await connect(h.userId, "revoked", {
    lastSyncedAt: yesterday,
    status: "revoked",
  });
  const contacted = fakePlaid(t, () => true);
  const result = await runDailyJob(h.db, now, h.dependencies);
  assert.deepEqual(contacted.sort(), [
    "never-synced",
    "pending-disconnect",
    "synced-yesterday",
    "webhook-since-sync",
  ]);
  assert.equal(result.synced, 4);
  assert.equal(result.failed, 0);
});

void test("a database failure in cancellation recovery, as on October 27, leaves the run's bank updates and reviews done", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const h = await fixture(t);
  const connectionId = await connect(h.userId, "due", {
    lastSyncedAt: new Date("2026-10-16T00:50:00Z"),
  });
  fakePlaid(t, () => true);
  const unreachable = h.db.$extends({
    query: {
      dailyDelivery: {
        findMany() {
          throw new Error("Can't reach database server");
        },
      },
    },
  }) as unknown as Database;
  const result = await runDailyJob(unreachable, now, h.dependencies);
  assert.equal(result.synced, 1);
  assert.equal(result.scheduled, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(
    (
      await base.bankConnection.findUniqueOrThrow({
        where: { id: connectionId },
      })
    ).lastSyncedAt,
    now,
  );
});

void test("a connection is reported stale only once it has gone 28 hours without a committed update", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const h = await fixture(t, { emailEnabled: false });
  const lastMidnight = new Date("2026-10-16T00:20:00Z");
  const flaky = await connect(h.userId, "flaky", {
    lastSyncedAt: lastMidnight,
  });
  await connect(h.userId, "healthy", { lastSyncedAt: lastMidnight });
  await connect(h.userId, "needs-sign-in", {
    lastSyncedAt: new Date("2026-10-12T00:20:00Z"),
    status: "login_required",
  });
  fakePlaid(t, (token) => token === "healthy");
  const midnight = await runDailyJob(h.db, now, h.dependencies);
  assert.deepEqual(midnight.stale, []);
  assert.equal(midnight.failed, 2);
  const retryAt = new Date("2026-10-17T06:20:00Z");
  t.mock.timers.setTime(retryAt.getTime());
  const retry = await runDailyJob(h.db, retryAt, h.dependencies);
  assert.deepEqual(retry.stale, [flaky]);
});

const cronSecret = "c".repeat(32);
const pingUrl = "https://hc-ping.example/check-uuid";
/** The scheduler's request to the job route, and the monitor pings it sends. */
function scheduled(t: TestContext) {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = cronSecret;
  t.after(() => {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });
  const pings: { url: string; body: unknown }[] = [];
  const ping = async (url: string, body: unknown) => {
    pings.push({ url, body });
  };
  const request = () =>
    new Request("https://caishen.example/api/jobs/daily", {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
  return { pings, ping, request };
}

void test("a run that reaches its end answers 200 and pings the monitor, even when an institution failed", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const h = await fixture(t, { emailEnabled: false });
  await connect(h.userId, "down", {
    lastSyncedAt: new Date("2026-10-16T00:20:00Z"),
  });
  fakePlaid(t, () => false);
  const s = scheduled(t);
  const response = await respondToDailyJob(s.request(), {
    db: h.db,
    now: () => now,
    overrides: h.dependencies,
    pingUrl,
    ping: s.ping,
  });
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { failed: number }).failed, 1);
  assert.deepEqual(
    s.pings.map((ping) => ping.url),
    [pingUrl],
  );
});

void test("a run that leaves a connection stale pings the monitor's failure URL naming it", async (t) => {
  const retryAt = new Date("2026-10-17T06:20:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: retryAt });
  const h = await fixture(t, { emailEnabled: false });
  const down = await connect(h.userId, "down", {
    lastSyncedAt: new Date("2026-10-16T00:20:00Z"),
  });
  fakePlaid(t, () => false);
  const s = scheduled(t);
  const response = await respondToDailyJob(s.request(), {
    db: h.db,
    now: () => retryAt,
    overrides: h.dependencies,
    pingUrl,
    ping: s.ping,
  });
  assert.equal(response.status, 200);
  assert.equal(s.pings.length, 1);
  assert.equal(s.pings[0]!.url, `${pingUrl}/fail`);
  assert.deepEqual((s.pings[0]!.body as { stale: string[] }).stale, [down]);
});

void test("a run that cannot read which connections are due answers 503 and sends no ping", async (t) => {
  const h = await fixture(t);
  const unreachable = h.db.$extends({
    query: {
      bankConnection: {
        findMany() {
          throw new Error("Can't reach database server");
        },
      },
    },
  }) as unknown as Database;
  const s = scheduled(t);
  const response = await respondToDailyJob(s.request(), {
    db: unreachable,
    now: () => now,
    overrides: h.dependencies,
    pingUrl,
    ping: s.ping,
  });
  assert.equal(response.status, 503);
  assert.deepEqual(s.pings, []);
  assert.deepEqual(h.sent, []);
});
