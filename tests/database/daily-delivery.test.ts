import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, type TestContext } from "node:test";
import { Prisma, PrismaClient } from "../../src/generated/prisma";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import {
  cancelScheduledDailyReviews,
  type DailyDeliveryPayload,
} from "../../src/server/services/daily-delivery";

assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
after(() => db.$disconnect());
const now = new Date("2026-10-17T01:00:00Z");
const later = new Date("2026-10-17T01:11:00Z");
const request: DailyDeliveryPayload = {
  from: "Original sender <original@example.com>",
  to: "original-recipient@example.com",
  dedupeKey: "daily-review:fixture:2026-10-17",
  scheduledAt: "2026-10-17T15:00:00.000Z",
  message: {
    subject: "Original subject",
    text: "Original private inbox message",
  },
};
async function fixture(t: TestContext) {
  const userId = `test-delivery-${randomUUID()}`;
  await db.user.create({ data: { clerkUserId: userId } });
  t.after(async () => {
    await db.dailyDelivery.deleteMany({ where: { clerkUserId: userId } });
    await db.user.delete({ where: { clerkUserId: userId } });
  });
  let date = 0;
  const store = (
    id: string,
    overrides: Partial<Prisma.DailyDeliveryUncheckedCreateInput> = {},
  ) =>
    db.dailyDelivery.create({
      data: {
        id: randomUUID(),
        clerkUserId: userId,
        status: "scheduled",
        providerId: `email_${id}`,
        localDate: `2026-10-${String(++date).padStart(2, "0")}`,
        scheduledAt: new Date("2026-10-17T15:00:00Z"),
        leaseUntil: new Date("2026-10-17T00:00:00Z"),
        ...overrides,
      },
    });
  const attempted = (
    overrides: Partial<Prisma.DailyDeliveryUncheckedCreateInput> = {},
  ) =>
    store("attempt", {
      providerId: null,
      status: "failed",
      firstAttemptAt: new Date("2026-10-17T00:30:00Z"),
      payload: request,
      ...overrides,
    });
  const canceled: string[] = [];
  const sent: DailyDeliveryPayload[] = [];
  const cancel = async (id: string) => {
    canceled.push(id);
    return { id };
  };
  const send = async (payload: DailyDeliveryPayload) => {
    sent.push(payload);
    return { id: "email_recovered" };
  };
  return { userId, store, attempted, canceled, sent, cancel, send };
}
void test("cancellation affects only the owner's acknowledged future email and persists across retries", async (t) => {
  const h = await fixture(t);
  const other = await fixture(t);
  await h.store("future");
  await other.store("other_user");
  for (const [id, overrides] of [
    ["past", { scheduledAt: new Date("2026-10-17T00:00:00Z") }],
    ["exact_now", { scheduledAt: now }],
    ["immediate", { scheduledAt: null }],
    ["no_provider", { providerId: null }],
    ["sending", { status: "sending" }],
    ["sent", { status: "sent" }],
    ["already_canceled", { status: "canceled" }],
  ] as const)
    await h.store(id, overrides);
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, h.userId, now, h.cancel, h.send),
    { canceled: 1 },
  );
  assert.deepEqual(h.canceled, ["email_future"]);
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, h.userId, now, h.cancel, h.send),
    { canceled: 0 },
  );
  assert.deepEqual(h.canceled, ["email_future"]);
  assert.deepEqual(
    await cancelScheduledDailyReviews(
      db,
      other.userId,
      now,
      other.cancel,
      other.send,
    ),
    { canceled: 1 },
  );
  assert.deepEqual(other.canceled, ["email_other_user"]);
});
void test("a failed cancellation retries only the email that still needs cancellation", async (t) => {
  const h = await fixture(t);
  await h.store("first");
  await h.store("second");
  const accepted = new Set<string>();
  let fail = true;
  const cancel = async (id: string) => {
    if (id === "email_second" && fail)
      throw new Error("private provider failure");
    assert.ok(
      !accepted.has(id),
      "an acknowledged cancellation is not repeated",
    );
    accepted.add(id);
    return { id };
  };
  await assert.rejects(
    cancelScheduledDailyReviews(db, h.userId, now, cancel, h.send),
    { message: "Queued daily email could not be canceled. Retry the request." },
  );
  fail = false;
  await cancelScheduledDailyReviews(db, h.userId, now, cancel, h.send);
  assert.deepEqual([...accepted].sort(), ["email_first", "email_second"]);
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, h.userId, now, cancel, h.send),
    { canceled: 0 },
  );
});
void test("no pending email requires no provider credentials", async (t) => {
  const h = await fixture(t);
  await h.store("past", { scheduledAt: now });
  const original = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    assert.deepEqual(await cancelScheduledDailyReviews(db, h.userId, now), {
      canceled: 0,
    });
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
void test("an uncertain provider acceptance is recovered with its saved request then canceled", async (t) => {
  const h = await fixture(t);
  await h.attempted();
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, h.userId, now, h.cancel, h.send),
    { canceled: 1 },
  );
  assert.deepEqual(h.sent, [request]);
  assert.deepEqual(h.canceled, ["email_recovered"]);
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, h.userId, later, h.cancel, h.send),
    { canceled: 0 },
  );
  assert.deepEqual(h.sent, [request]);
});
void test("failed cancellation after recovery reuses the acknowledged provider ID", async (t) => {
  const h = await fixture(t);
  await h.attempted();
  await assert.rejects(
    cancelScheduledDailyReviews(
      db,
      h.userId,
      now,
      async () => {
        throw new Error("cancel timeout");
      },
      h.send,
    ),
    /could not be canceled/,
  );
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, h.userId, later, h.cancel, h.send),
    { canceled: 1 },
  );
  assert.deepEqual(h.sent, [request]);
  assert.deepEqual(h.canceled, ["email_recovered"]);
});
void test("failed recovery retries the same saved request", async (t) => {
  const h = await fixture(t);
  await h.attempted();
  const attempted: DailyDeliveryPayload[] = [];
  await assert.rejects(
    cancelScheduledDailyReviews(
      db,
      h.userId,
      now,
      h.cancel,
      async (payload) => {
        attempted.push(payload);
        throw new Error("uncertain send");
      },
    ),
    /could not be recovered/,
  );
  assert.deepEqual(h.canceled, []);
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, h.userId, later, h.cancel, h.send),
    { canceled: 1 },
  );
  assert.deepEqual(attempted, [request]);
  assert.deepEqual(h.sent, [request]);
});
for (const [name, overrides, error] of [
  [
    "active lease",
    { status: "sending", leaseUntil: new Date("2026-10-17T01:10:00Z") },
    /still in progress/,
  ],
  [
    "expired idempotency",
    { firstAttemptAt: new Date("2026-10-16T00:59:00Z") },
    /expired request/,
  ],
  [
    "missing request",
    { payload: Prisma.DbNull },
    /saved request is missing or invalid/,
  ],
] as const)
  void test(`${name} prevents unsafe cancellation recovery`, async (t) => {
    const h = await fixture(t);
    await h.attempted(overrides);
    await assert.rejects(
      cancelScheduledDailyReviews(db, h.userId, now, h.cancel, h.send),
      error,
    );
    assert.deepEqual(h.sent, []);
    assert.deepEqual(h.canceled, []);
  });
void test("unfinished preparation can be canceled without sending once its lease expires", async (t) => {
  const h = await fixture(t);
  await h.attempted({
    status: "preparing",
    firstAttemptAt: null,
    payload: Prisma.DbNull,
    leaseUntil: new Date("2026-10-17T01:10:00Z"),
  });
  await assert.rejects(
    cancelScheduledDailyReviews(db, h.userId, now, h.cancel, h.send),
    /still in progress/,
  );
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, h.userId, later, h.cancel, h.send),
    { canceled: 1 },
  );
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.canceled, []);
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, h.userId, later, h.cancel, h.send),
    { canceled: 0 },
  );
});
