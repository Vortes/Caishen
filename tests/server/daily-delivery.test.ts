import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import { type DailyDelivery, type Prisma } from "../../src/generated/prisma";
import {
  cancelScheduledDailyReviews,
  type DailyDeliveryPayload,
} from "../../src/server/services/daily-delivery";
import { type Database } from "../../src/server/services/household";

const now = new Date("2026-10-17T01:00:00Z");
type Delivery = DailyDelivery;
type Selection = Prisma.DailyDeliveryWhereInput;

const environment = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
};
afterEach(() => {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function delivery(id: string, overrides: Partial<Delivery> = {}): Delivery {
  return {
    id,
    clerkUserId: "user_daily",
    status: "scheduled",
    scheduledAt: new Date("2026-10-17T15:00:00Z"),
    providerId: `email_${id}`,
    error: null,
    localDate: "2026-10-17",
    leaseUntil: new Date("2026-10-17T00:00:00Z"),
    payload: null,
    firstAttemptAt: null,
    sentAt: null,
    createdAt: new Date("2026-10-17T00:00:00Z"),
    ...overrides,
  };
}

function harness(rows: Delivery[]) {
  const events: string[] = [];
  let inTransaction = false;
  const matches = (row: Delivery, where: Selection): boolean => {
    if (where.OR && !where.OR.some((part) => matches(row, part))) return false;
    for (const field of [
      "id",
      "clerkUserId",
      "providerId",
      "status",
      "firstAttemptAt",
      "scheduledAt",
      "leaseUntil",
    ] as const) {
      const expected = where[field];
      if (expected === undefined) continue;
      const actual = row[field];
      if (
        expected &&
        typeof expected === "object" &&
        !(expected instanceof Date)
      ) {
        if ("not" in expected && expected.not === null && actual === null)
          return false;
        if (
          "in" in expected &&
          Array.isArray(expected.in) &&
          ![...expected.in].some((value) => value === actual)
        )
          return false;
        if (
          "gt" in expected &&
          (typeof expected.gt === "string" || expected.gt instanceof Date) &&
          (!(actual instanceof Date) ||
            !(actual.getTime() > new Date(expected.gt).getTime()))
        )
          return false;
      } else if (expected instanceof Date) {
        if (
          !(actual instanceof Date) ||
          actual.getTime() !== expected.getTime()
        )
          return false;
      } else if (actual !== expected) return false;
    }
    return true;
  };
  const dailyDelivery = {
    findMany: mock.fn(async ({ where }: { where: Selection }) => {
      assert.equal(where.clerkUserId, "user_daily");
      assert.deepEqual(where.scheduledAt, { gt: now });
      return structuredClone(rows.filter((row) => matches(row, where)));
    }),
    findUnique: mock.fn(
      async ({ where }: { where: Prisma.DailyDeliveryWhereUniqueInput }) => {
        const row = where.clerkUserId_localDate
          ? rows.find(
              (item) =>
                item.clerkUserId === where.clerkUserId_localDate!.clerkUserId &&
                item.localDate === where.clerkUserId_localDate!.localDate,
            )
          : rows.find((item) => item.id === where.id);
        return row ? structuredClone(row) : null;
      },
    ),
    update: mock.fn(
      async ({
        where,
        data,
      }: {
        where: Selection;
        data: Partial<Delivery>;
      }) => {
        const row = rows.find((item) => matches(item, where));
        assert.ok(row);
        events.push(`update:${row.id}:${data.status ?? "error"}`);
        Object.assign(row, data);
        return structuredClone(row);
      },
    ),
    updateMany: mock.fn(
      async ({
        where,
        data,
      }: {
        where: Selection;
        data: Partial<Delivery>;
      }) => {
        const selected = rows.filter((row) => matches(row, where));
        for (const row of selected) {
          events.push(`update:${row.id}:${data.status ?? "error"}`);
          Object.assign(row, data);
        }
        return { count: selected.length };
      },
    ),
  };
  const raw = {
    dailyDelivery,
    $transaction: mock.fn(
      async (
        work: (tx: { dailyDelivery: typeof dailyDelivery }) => Promise<unknown>,
      ) => {
        inTransaction = true;
        try {
          return await work({ dailyDelivery });
        } finally {
          inTransaction = false;
        }
      },
    ),
  };
  return {
    db: raw as unknown as Database,
    raw,
    events,
    inTransaction: () => inTransaction,
  };
}

void test("cancellation only changes this user's acknowledged future provider schedules", async () => {
  const rows = [
    delivery("future"),
    delivery("other_user", { clerkUserId: "user_other" }),
    delivery("past", { scheduledAt: new Date("2026-10-17T00:00:00Z") }),
    delivery("exact_now", { scheduledAt: now }),
    delivery("immediate", { scheduledAt: null }),
    delivery("no_provider", { providerId: null }),
    delivery("sending", { status: "sending" }),
    delivery("sent", { status: "sent" }),
    delivery("already_canceled", { status: "canceled" }),
  ];
  const { db, raw, events } = harness(rows);
  const cancel = mock.fn(async (id: string) => {
    assert.equal(rows[0]!.status, "scheduled");
    events.push(`cancel:${id}`);
    return { id };
  });
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, "user_daily", now, cancel),
    { canceled: 1 },
  );
  assert.deepEqual(events, ["cancel:email_future", "update:future:canceled"]);
  assert.equal(rows[0]!.status, "canceled");
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, "user_daily", now, cancel),
    { canceled: 0 },
  );
  assert.equal(cancel.mock.callCount(), 1);
  assert.equal(raw.$transaction.mock.callCount(), 0);
});

void test("provider failures leave queued status retryable without reporting cancellation", async () => {
  const rows = [delivery("first"), delivery("second")];
  const { db, events } = harness(rows);
  const cancel = mock.fn(async (id: string) => {
    events.push(`cancel:${id}`);
    if (id === "email_second") throw new Error("private provider failure");
    return { id };
  });
  await assert.rejects(
    cancelScheduledDailyReviews(db, "user_daily", now, cancel),
    {
      message: "Queued daily email could not be canceled. Retry the request.",
    },
  );
  assert.equal(rows[0]!.status, "canceled");
  assert.equal(rows[1]!.status, "scheduled");
  assert.equal(
    rows[1]!.error,
    "Queued daily email could not be canceled. Retry the request.",
  );
  const retry = mock.fn(async (id: string) => ({ id }));
  assert.deepEqual(
    await cancelScheduledDailyReviews(db, "user_daily", now, retry),
    { canceled: 1 },
  );
  assert.equal(retry.mock.calls[0]!.arguments[0], "email_second");
  assert.equal(rows[1]!.error, null);
});

void test("no pending provider email needs no configured email credentials", async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  const { db, raw } = harness([delivery("past", { scheduledAt: now })]);
  assert.deepEqual(await cancelScheduledDailyReviews(db, "user_daily", now), {
    canceled: 0,
  });
  assert.equal(raw.dailyDelivery.updateMany.mock.callCount(), 0);
});

const savedRequest = {
  from: "Original sender <original@example.com>",
  to: "original-recipient@example.com",
  dedupeKey: "daily-review:user_daily:2026-10-17",
  scheduledAt: "2026-10-17T15:00:00.000Z",
  message: {
    subject: "Original subject",
    text: "Original private inbox message",
  },
};
function attempted(overrides: Partial<Delivery> = {}) {
  return delivery("attempt", {
    providerId: null,
    status: "failed",
    firstAttemptAt: new Date("2026-10-17T00:30:00Z"),
    payload: savedRequest,
    ...overrides,
  });
}

void test("ambiguous accepted requests replay the immutable request within its idempotency window then cancel", async () => {
  const rows = [attempted()];
  const h = harness(rows);
  const send = mock.fn(async (payload: DailyDeliveryPayload) => {
    assert.equal(h.inTransaction(), false);
    assert.deepEqual(payload, savedRequest);
    assert.equal(rows[0]!.status, "sending");
    return { id: "email_recovered" };
  });
  const cancel = mock.fn(async (id: string) => {
    assert.equal(h.inTransaction(), false);
    assert.equal(rows[0]!.status, "scheduled");
    assert.equal(rows[0]!.providerId, id);
    return { id };
  });
  assert.deepEqual(
    await cancelScheduledDailyReviews(h.db, "user_daily", now, cancel, send),
    { canceled: 1 },
  );
  assert.equal(cancel.mock.calls[0]!.arguments[0], "email_recovered");
  assert.equal(send.mock.callCount(), 1);
  assert.equal(rows[0]!.status, "canceled");
  assert.deepEqual(rows[0]!.payload, savedRequest);
  assert.equal(
    rows[0]!.firstAttemptAt!.toISOString(),
    "2026-10-17T00:30:00.000Z",
  );
});

void test("a failed cancellation after recovery preserves the provider ID for a direct cancellation retry", async () => {
  const rows = [attempted()];
  const h = harness(rows);
  const send = mock.fn(async () => ({ id: "email_recovered" }));
  await assert.rejects(
    cancelScheduledDailyReviews(
      h.db,
      "user_daily",
      now,
      async () => {
        throw new Error("cancel timeout");
      },
      send,
    ),
    /could not be canceled/,
  );
  assert.equal(rows[0]!.providerId, "email_recovered");
  assert.equal(rows[0]!.status, "scheduled");
  const cancel = mock.fn(async (id: string) => ({ id }));
  assert.deepEqual(
    await cancelScheduledDailyReviews(h.db, "user_daily", now, cancel, send),
    { canceled: 1 },
  );
  assert.equal(send.mock.callCount(), 1);
});

void test("a failed recovery remains retryable with the same saved request", async () => {
  const rows = [attempted()];
  const h = harness(rows);
  const cancel = mock.fn(async (id: string) => ({ id }));
  await assert.rejects(
    cancelScheduledDailyReviews(h.db, "user_daily", now, cancel, async () => {
      throw new Error("uncertain send");
    }),
    /could not be recovered/,
  );
  assert.equal(rows[0]!.status, "failed");
  assert.equal(rows[0]!.providerId, null);
  const send = mock.fn(async (payload: DailyDeliveryPayload) => {
    assert.deepEqual(payload, savedRequest);
    return { id: "email_recovered" };
  });
  assert.deepEqual(
    await cancelScheduledDailyReviews(h.db, "user_daily", now, cancel, send),
    { canceled: 1 },
  );
});

void test("active leases, expired idempotency and missing saved requests remain visible without sending", async () => {
  const cancel = mock.fn(async (id: string) => ({ id }));
  const send = mock.fn(async () => ({ id: "must_not_send" }));
  const cases: [Partial<Delivery>, RegExp][] = [
    [
      { status: "sending", leaseUntil: new Date("2026-10-17T01:10:00Z") },
      /still in progress/,
    ],
    [{ firstAttemptAt: new Date("2026-10-16T00:59:00Z") }, /expired request/],
    [{ payload: null }, /saved request is missing or invalid/],
  ];
  for (const [override, expected] of cases) {
    const rows = [attempted(override)];
    const h = harness(rows);
    await assert.rejects(
      cancelScheduledDailyReviews(h.db, "user_daily", now, cancel, send),
      expected,
    );
    assert.notEqual(rows[0]!.status, "canceled");
  }
  assert.equal(send.mock.callCount(), 0);
  assert.equal(cancel.mock.callCount(), 0);
});

void test("unfinished preparation requires retry while leased and becomes canceled without sending once expired", async () => {
  const rows = [
    attempted({
      status: "preparing",
      firstAttemptAt: null,
      payload: null,
      leaseUntil: new Date("2026-10-17T01:10:00Z"),
    }),
  ];
  const h = harness(rows);
  const cancel = mock.fn(async (id: string) => ({ id }));
  const send = mock.fn(async () => ({ id: "must_not_send" }));
  await assert.rejects(
    cancelScheduledDailyReviews(h.db, "user_daily", now, cancel, send),
    /still in progress/,
  );
  rows[0]!.leaseUntil = new Date("2026-10-17T00:59:00Z");
  assert.deepEqual(
    await cancelScheduledDailyReviews(h.db, "user_daily", now, cancel, send),
    { canceled: 1 },
  );
  assert.equal(rows[0]!.status, "canceled");
  assert.equal(cancel.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 0);
});
