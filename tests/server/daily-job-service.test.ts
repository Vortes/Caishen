import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import { type DailyDelivery, type Prisma } from "../../src/generated/prisma";
import { bookSchema, createBook } from "../../src/domain/engine";
import { runDailyJob } from "../../src/server/services/daily-job";
import { type Database } from "../../src/server/services/workspace";

type Payload = Parameters<
  NonNullable<NonNullable<Parameters<typeof runDailyJob>[2]>["send"]>
>[0];
type Member = Prisma.WorkspaceMemberGetPayload<{
  include: { workspace: true };
}>;
const now = new Date("2026-10-17T00:20:00Z");
const environmentKeys = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_BASE_URL",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function makeMember(
  userId = "user_daily",
  enabled = true,
  timezone = "America/Los_Angeles",
  hour = 8,
): Member {
  const book = createBook(userId, "Daily fixture", "2026-10");
  book.budgets[userId]!.settings = {
    emailEnabled: enabled,
    timezone,
    emailHour: hour,
  };
  return {
    clerkUserId: userId,
    workspaceId: `workspace_${userId}`,
    createdAt: now,
    workspace: {
      id: `workspace_${userId}`,
      revision: 0,
      resetRevision: 0,
      history: {},
      book: JSON.parse(JSON.stringify(book)) as Prisma.JsonValue,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function harness(members = [makeMember()]) {
  process.env.RESEND_API_KEY = "fixture-email-key";
  process.env.EMAIL_FROM = "Caishen <daily@example.com>";
  process.env.APP_BASE_URL = "https://caishen.example";
  const rows = new Map<string, DailyDelivery>();
  const connections: { lastSyncedAt: Date | null }[] = [];
  let transactionQueue = Promise.resolve();
  const raw = {
    workspaceMember: {
      findMany: mock.fn(
        async (args: {
          cursor?: { clerkUserId: string };
          take: number;
          skip?: number;
          where: { user: { active: boolean } };
        }) => {
          assert.equal(args.where.user.active, true);
          const start = args.cursor
            ? members.findIndex(
                (member) => member.clerkUserId === args.cursor!.clerkUserId,
              ) + (args.skip ?? 0)
            : 0;
          return members.slice(start, start + args.take);
        },
      ),
    },
    bankConnection: { findMany: mock.fn(async () => connections) },
    reviewEvidence: { findMany: mock.fn(async () => []) },
    user: { findUnique: mock.fn(async () => ({ active: true })) },
    dailyDelivery: {
      updateMany: async (args: {
        where: {
          id: string;
          leaseUntil: Date;
          status: { in: string[] };
          providerId: null;
        };
        data: Partial<DailyDelivery>;
      }) => {
        const selected = [...rows.values()].filter(
          (row) =>
            row.id === args.where.id &&
            row.leaseUntil.getTime() === args.where.leaseUntil.getTime() &&
            args.where.status.in.includes(row.status) &&
            row.providerId === null,
        );
        for (const row of selected) Object.assign(row, args.data);
        return { count: selected.length };
      },
      findMany: mock.fn(
        async (args: {
          where: { scheduledAt: { gt: Date }; id?: { gt: string } };
          take: number;
        }) =>
          [...rows.values()]
            .filter(
              (row) =>
                row.scheduledAt !== null &&
                row.scheduledAt > args.where.scheduledAt.gt &&
                (!args.where.id || row.id > args.where.id.gt) &&
                ((row.status === "scheduled" && row.providerId !== null) ||
                  (row.status === "preparing" &&
                    row.providerId === null &&
                    row.firstAttemptAt === null) ||
                  (["preparing", "sending", "failed", "unknown"].includes(
                    row.status,
                  ) &&
                    row.providerId === null &&
                    row.firstAttemptAt !== null)),
            )
            .sort((left, right) => left.id.localeCompare(right.id))
            .slice(0, args.take),
      ),
      findUnique: async (args: {
        where: {
          clerkUserId_localDate: { clerkUserId: string; localDate: string };
        };
      }) =>
        rows.get(
          `${args.where.clerkUserId_localDate.clerkUserId}:${args.where.clerkUserId_localDate.localDate}`,
        ) ?? null,
      create: async (args: { data: Partial<DailyDelivery> }) => {
        const row: DailyDelivery = {
          id: `delivery_${rows.size}`,
          clerkUserId: args.data.clerkUserId!,
          localDate: args.data.localDate!,
          status: args.data.status!,
          leaseUntil: args.data.leaseUntil!,
          error: null,
          sentAt: null,
          providerId: null,
          scheduledAt: args.data.scheduledAt ?? null,
          payload: null,
          firstAttemptAt: null,
          createdAt: now,
        };
        rows.set(`${row.clerkUserId}:${row.localDate}`, row);
        return structuredClone(row);
      },
      update: async (args: {
        where: { id: string; leaseUntil?: Date };
        data: Partial<DailyDelivery>;
      }) => {
        const row = [...rows.values()].find(
          (item) => item.id === args.where.id,
        );
        assert.ok(row);
        if (args.where.leaseUntil)
          assert.equal(
            row.leaseUntil.getTime(),
            args.where.leaseUntil.getTime(),
          );
        Object.assign(row, args.data);
        return structuredClone(row);
      },
    },
    async $transaction<T>(operation: (db: Database) => Promise<T>): Promise<T> {
      const pending = transactionQueue.then(() =>
        operation(raw as unknown as Database),
      );
      transactionQueue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
  };
  const send = mock.fn(async (_payload: Payload) => ({
    id: "provider_fixture",
  }));
  const verifiedEmail = mock.fn(
    async (_userId: string) => "verified@example.com",
  );
  const syncBanks = mock.fn(async () => {
    for (const connection of connections) connection.lastSyncedAt = now;
    return { imported: 0, updated: 0 };
  });
  const dependencies = {
    send,
    verifiedEmail,
    syncBanks,
    cancel: mock.fn(async (_db: Database, userId: string, at: Date) => {
      let canceled = 0;
      for (const row of rows.values())
        if (
          row.clerkUserId === userId &&
          row.status === "scheduled" &&
          row.providerId &&
          row.scheduledAt &&
          row.scheduledAt > at
        ) {
          row.status = "canceled";
          canceled++;
        }
      return { canceled };
    }),
    bankInbox: async () => [],
    readWorkspace: async (_db: Database, userId: string) =>
      members.find((member) => member.clerkUserId === userId) ?? null,
  };
  return {
    members,
    db: raw as unknown as Database,
    raw,
    rows,
    connections,
    dependencies,
    send,
    verifiedEmail,
    syncBanks,
  };
}

void test("one daily batch durably schedules the local morning and repeated runs never queue tomorrow", async () => {
  const h = harness();
  h.send.mock.mockImplementation(async (payload) => {
    const row = [...h.rows.values()][0]!;
    assert.equal(row.status, "sending");
    assert.deepEqual(row.payload, payload);
    assert.equal(row.firstAttemptAt?.toISOString(), now.toISOString());
    return { id: "provider_fixture" };
  });
  const result = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(result.scheduled, 1);
  assert.equal(result.failed, 0);
  assert.equal("sent" in result, false);
  const row = [...h.rows.values()][0]!;
  assert.equal(row.status, "scheduled");
  assert.equal(row.providerId, "provider_fixture");
  assert.equal(row.scheduledAt?.toISOString(), "2026-10-17T15:00:00.000Z");
  assert.equal(row.sentAt, null);
  assert.equal(
    h.send.mock.calls[0]!.arguments[0].scheduledAt,
    "2026-10-17T15:00:00.000Z",
  );
  const repeated = await runDailyJob(
    h.db,
    new Date("2026-10-17T23:30:00Z"),
    h.dependencies,
  );
  assert.equal(repeated.scheduled, 0);
  assert.equal(h.send.mock.callCount(), 1);
  assert.equal(h.rows.size, 1);
});

void test("late batch prepares an immediate request for today's already due email", async () => {
  const h = harness([makeMember("user_daily", true, "UTC", 0)]);
  const result = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(result.scheduled, 1);
  assert.equal(h.send.mock.calls[0]!.arguments[0].scheduledAt, undefined);
  assert.equal(
    [...h.rows.values()][0]!.scheduledAt?.toISOString(),
    "2026-10-17T00:00:00.000Z",
  );
  assert.equal([...h.rows.values()][0]!.sentAt, null);
});

void test("daily review counts posted activity and matching problems without alerting on routine pending imports", async () => {
  const h = harness();
  const item = {
    connectionId: "bank",
    logicalId: "pending",
    categoryId: undefined,
    transactionId: undefined,
    fingerprint: "a".repeat(64),
    providerAccountId: "provider-checking",
    accountId: "checking",
    date: "2026-10-17",
    payee: "Pending purchase",
    amount: -1200,
    pending: true,
    removed: false,
    needsMatchReview: false,
    error: null,
    history: [],
    reviewEvidence: [],
    quarantined: false,
  };
  const result = await runDailyJob(h.db, now, {
    ...h.dependencies,
    bankInbox: async () => [
      item,
      { ...item, logicalId: "posted", pending: false },
      { ...item, logicalId: "uncertain", needsMatchReview: true },
    ],
  });
  assert.equal(result.scheduled, 1);
  assert.match(
    h.send.mock.calls[0]!.arguments[0].message.text,
    /2 unresolved items are/,
  );
});

void test("disabled email creates no delivery while bank refresh uses UTC dates despite scheduler jitter", async () => {
  const h = harness([makeMember("user_daily", false)]);
  h.connections.push({ lastSyncedAt: new Date("2026-10-16T00:50:00Z") });
  const first = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(first.synced, 1);
  assert.equal(first.scheduled, 0);
  assert.equal(h.rows.size, 0);
  assert.equal(h.send.mock.callCount(), 0);
  assert.equal(h.verifiedEmail.mock.callCount(), 0);
  const repeated = await runDailyJob(
    h.db,
    new Date("2026-10-17T01:00:00Z"),
    h.dependencies,
  );
  assert.equal(repeated.synced, 0);
  assert.equal(h.syncBanks.mock.callCount(), 1);
});

void test("uncertain provider attempts retry the same persisted recipient, sender, message and schedule", async () => {
  const h = harness();
  h.send.mock.mockImplementationOnce(async () => {
    throw new Error("provider timeout");
  });
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).failed, 1);
  const first = structuredClone(h.send.mock.calls[0]!.arguments[0]);
  process.env.EMAIL_FROM = "Changed <changed@example.com>";
  process.env.APP_BASE_URL = "https://changed.example";
  h.verifiedEmail.mock.mockImplementation(async () => "changed@example.com");
  const retry = await runDailyJob(
    h.db,
    new Date("2026-10-17T16:00:00Z"),
    h.dependencies,
  );
  assert.equal(retry.scheduled, 1);
  assert.deepEqual(h.send.mock.calls[1]!.arguments[0], first);
  assert.equal(h.verifiedEmail.mock.callCount(), 1);
  assert.equal(
    [...h.rows.values()][0]!.firstAttemptAt?.toISOString(),
    now.toISOString(),
  );
});

void test("expired ambiguous attempts require provider reconciliation instead of risking duplicates", async () => {
  const h = harness();
  h.send.mock.mockImplementationOnce(async () => {
    throw new Error("provider timeout");
  });
  await runDailyJob(h.db, now, h.dependencies);
  const row = [...h.rows.values()][0]!;
  row.firstAttemptAt = new Date(now.getTime() - 25 * 60 * 60_000);
  const retry = await runDailyJob(
    h.db,
    new Date("2026-10-17T02:00:00Z"),
    h.dependencies,
  );
  assert.equal(retry.failed, 1);
  assert.equal(row.status, "unknown");
  assert.equal(h.send.mock.callCount(), 1);
});

void test("an active delivery lease prevents concurrent provider requests", async () => {
  const h = harness();
  let release!: () => void;
  let started!: () => void;
  const sending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.send.mock.mockImplementation(async () => {
    started();
    await gate;
    return { id: "provider_fixture" };
  });
  const first = runDailyJob(h.db, now, h.dependencies);
  await sending;
  const second = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(second.scheduled, 0);
  assert.equal(h.send.mock.callCount(), 1);
  release();
  assert.equal((await first).scheduled, 1);
});

void test("preparation failures can retry without recording a provider attempt", async () => {
  const h = harness();
  h.verifiedEmail.mock.mockImplementationOnce(async () => {
    throw new Error("unverified primary email");
  });
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).failed, 1);
  const row = [...h.rows.values()][0]!;
  assert.equal(row.firstAttemptAt, null);
  assert.equal(row.payload, null);
  assert.equal(h.send.mock.callCount(), 0);
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).scheduled, 1);
});

void test("malformed stored payload never reaches the provider", async () => {
  const h = harness();
  h.send.mock.mockImplementationOnce(async () => {
    throw new Error("provider timeout");
  });
  await runDailyJob(h.db, now, h.dependencies);
  [...h.rows.values()][0]!.payload = { to: "attacker@example.com" };
  assert.equal((await runDailyJob(h.db, now, h.dependencies)).failed, 1);
  assert.equal(h.send.mock.callCount(), 1);
});

void test("daily work schedules one review per member across multiple pages", async () => {
  const members = Array.from({ length: 101 }, (_, index) =>
    makeMember(`user_${String(index).padStart(3, "0")}`),
  );
  const h = harness(members);
  h.verifiedEmail.mock.mockImplementation(
    async (userId) => `${userId}@example.com`,
  );
  const result = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(result.processed, 101);
  assert.equal(result.scheduled, 101);
  assert.equal(result.failed, 0);
  assert.deepEqual(
    h.send.mock.calls.map((call) => call.arguments[0].to).sort(),
    members.map((member) => `${member.clerkUserId}@example.com`).sort(),
  );
});

void test("a failed DST target does not prevent the other local date in the same UTC batch", async () => {
  const h = harness([
    makeMember("user_daily", true, "America/Los_Angeles", 16),
  ]);
  h.send.mock.mockImplementationOnce(async () => {
    throw new Error("first target failed");
  });
  const result = await runDailyJob(
    h.db,
    new Date("2026-03-08T00:20:00Z"),
    h.dependencies,
  );
  assert.equal(result.failed, 1);
  assert.equal(result.scheduled, 1);
  assert.equal(h.send.mock.callCount(), 2);
});

void test("email disabled while the provider request is in flight is canceled after acceptance", async () => {
  const h = harness();
  h.send.mock.mockImplementation(async () => {
    const member = h.members[0]!;
    const book = bookSchema.parse(member.workspace.book);
    book.budgets[member.clerkUserId]!.settings.emailEnabled = false;
    member.workspace.book = JSON.parse(
      JSON.stringify(book),
    ) as Prisma.JsonValue;
    return { id: "provider_fixture" };
  });
  const result = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(result.scheduled, 0);
  assert.equal(result.canceled, 1);
  assert.equal(result.failed, 0);
  assert.equal([...h.rows.values()][0]!.status, "canceled");
  assert.equal(h.dependencies.cancel.mock.callCount(), 1);
});

void test("account deactivation during scheduling also cancels future email", async () => {
  const h = harness();
  h.raw.user.findUnique.mock.mockImplementation(async () => ({
    active: false,
  }));
  const result = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(result.scheduled, 0);
  assert.equal(result.canceled, 1);
  assert.equal(h.dependencies.cancel.mock.callCount(), 1);
});

void test("failed cancellation keeps the accepted provider schedule available for another attempt", async () => {
  const h = harness();
  h.raw.user.findUnique.mock.mockImplementation(async () => ({
    active: false,
  }));
  h.dependencies.cancel.mock.mockImplementation(async () => {
    throw new Error("cancel timeout");
  });
  const result = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(result.failed, 1);
  assert.equal(result.scheduled, 1);
  const delivery = [...h.rows.values()][0]!;
  assert.equal(delivery.status, "scheduled");
  assert.equal(delivery.providerId, "provider_fixture");
});

for (const ownerState of ["inactive", "disabled"] as const) {
  void test(`batch retry cancels a previously accepted email after failed cancellation for an ${ownerState} owner`, async () => {
    const h = harness();
    h.send.mock.mockImplementation(async () => {
      if (ownerState === "inactive") {
        h.raw.user.findUnique.mock.mockImplementation(async () => ({
          active: false,
        }));
      } else {
        const member = h.members[0]!;
        const book = bookSchema.parse(member.workspace.book);
        book.budgets[member.clerkUserId]!.settings.emailEnabled = false;
        member.workspace.book = JSON.parse(
          JSON.stringify(book),
        ) as Prisma.JsonValue;
      }
      return { id: "provider_fixture" };
    });
    h.dependencies.cancel.mock.mockImplementationOnce(async () => {
      throw new Error("cancel timeout");
    });
    const first = await runDailyJob(h.db, now, h.dependencies);
    assert.equal(first.failed, 1);
    assert.equal([...h.rows.values()][0]!.status, "scheduled");
    if (ownerState === "inactive")
      h.raw.workspaceMember.findMany.mock.mockImplementation(async () => []);
    const retry = await runDailyJob(
      h.db,
      new Date("2026-10-17T01:00:00Z"),
      h.dependencies,
    );
    assert.equal(retry.failed, 0);
    assert.equal(retry.canceled, 1);
    assert.equal(retry.scheduled, 0);
    assert.equal(h.send.mock.callCount(), 1);
    assert.equal([...h.rows.values()][0]!.status, "canceled");
    assert.equal(h.dependencies.cancel.mock.callCount(), 2);
  });
}

void test("a timed-out provider attempt still checks consent and immediately invokes cancellation recovery", async () => {
  const h = harness();
  h.send.mock.mockImplementation(async () => {
    h.raw.user.findUnique.mock.mockImplementation(async () => ({
      active: false,
    }));
    throw new Error("Provider accepted but response timed out.");
  });
  h.dependencies.cancel.mock.mockImplementation(async () => {
    const row = [...h.rows.values()][0]!;
    assert.equal(row.status, "failed");
    assert.ok(row.payload);
    assert.ok(row.firstAttemptAt);
    row.providerId = "recovered_provider_fixture";
    row.status = "canceled";
    return { canceled: 1 };
  });
  const result = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(result.canceled, 1);
  assert.equal(result.scheduled, 0);
  assert.equal(h.dependencies.cancel.mock.callCount(), 1);
  assert.equal([...h.rows.values()][0]!.status, "canceled");
});

void test("a committed provider acknowledgement survives a lost database response", async () => {
  const h = harness();
  const update = h.raw.dailyDelivery.update.bind(h.raw.dailyDelivery);
  h.raw.dailyDelivery.update = async (args) => {
    const result = await update(args);
    if (args.data.status === "scheduled")
      throw new Error("Database response lost after commit.");
    return result;
  };
  const first = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(first.failed, 1);
  const delivery = [...h.rows.values()][0]!;
  assert.equal(delivery.status, "scheduled");
  assert.equal(delivery.providerId, "provider_fixture");
  const retry = await runDailyJob(h.db, now, h.dependencies);
  assert.equal(retry.failed, 0);
  assert.equal(retry.scheduled, 0);
  assert.equal(h.send.mock.callCount(), 1);
});
