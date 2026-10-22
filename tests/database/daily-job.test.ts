import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma, PrismaClient } from "../../src/generated/prisma";
import { createBook } from "../../src/domain/engine";
import { runDailyJob } from "../../src/server/services/daily-job";
import { cancelScheduledDailyReviews } from "../../src/server/services/daily-delivery";
import { createHousehold } from "./fixtures";
import { type Database } from "../../src/server/services/household";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";

assertDevelopmentDatabase(process.env);
const base = new PrismaClient();
const batchTime = new Date("2026-10-17T00:20:00Z");
const keys = ["RESEND_API_KEY", "EMAIL_FROM", "APP_BASE_URL"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
process.env.RESEND_API_KEY = "fixture-never-call-provider";
process.env.EMAIL_FROM = "Fixture <daily@example.com>";
process.env.APP_BASE_URL = "https://caishen.example";

after(async () => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  await base.$disconnect();
});

async function fixture() {
  const userId = `user_daily_${randomUUID()}`;
  await base.user.create({ data: { clerkUserId: userId } });
  const workspaceId = await createHousehold(
    base,
    createBook(userId, "Daily job fixture", "2026-10"),
  );
  return {
    userId,
    async cleanup() {
      await base.dailyDelivery.deleteMany({ where: { clerkUserId: userId } });
      await base.workspace.delete({ where: { id: workspaceId } });
      await base.user.delete({ where: { clerkUserId: userId } });
    },
  };
}

void test("concurrent daily workers resolve real serializable conflicts and schedule once", async () => {
  const current = await fixture();
  let waiting = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let conflicts = 0;
  let providerCalls = 0;
  const scoped = base.$extends({
    query: {
      workspaceMember: {
        findMany({ args, query }) {
          args.where = { ...args.where, clerkUserId: current.userId };
          return query(args);
        },
      },
      dailyDelivery: {
        findMany({ args, query }) {
          args.where = { ...args.where, clerkUserId: current.userId };
          return query(args);
        },
        async findUnique({ args, query }) {
          const result = await query(args);
          if (!result && waiting < 2) {
            waiting++;
            if (waiting === 2) release();
            await barrier;
          }
          return result;
        },
      },
    },
  });
  const scopedDatabase = scoped as unknown as Database;
  const trackedTransaction = async <T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ) => {
    try {
      return await scopedDatabase.$transaction(operation, options);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      )
        conflicts++;
      throw error;
    }
  };
  const db = new Proxy(scoped, {
    get(target, property, receiver): unknown {
      return property === "$transaction"
        ? trackedTransaction
        : Reflect.get(target, property, receiver);
    },
  }) as unknown as Database;
  const dependencies = {
    verifiedEmail: async () => "verified@example.com",
    send: async () => {
      providerCalls++;
      return { id: "provider_concurrent_fixture" };
    },
  };
  try {
    const results = await Promise.all([
      runDailyJob(db, batchTime, dependencies),
      runDailyJob(db, batchTime, dependencies),
    ]);
    assert.equal(waiting, 2);
    assert.ok(
      conflicts >= 1,
      "Concurrent claims must exercise a real P2034 retry.",
    );
    assert.equal(providerCalls, 1);
    assert.equal(
      results.reduce((total, result) => total + result.scheduled, 0),
      1,
    );
    assert.equal(
      results.reduce((total, result) => total + result.failed, 0),
      0,
    );
    assert.equal(
      await base.dailyDelivery.count({
        where: { clerkUserId: current.userId },
      }),
      1,
    );
    const delivery = await base.dailyDelivery.findUniqueOrThrow({
      where: {
        clerkUserId_localDate: {
          clerkUserId: current.userId,
          localDate: "2026-10-17",
        },
      },
    });
    assert.equal(delivery.status, "scheduled");
    assert.equal(delivery.providerId, "provider_concurrent_fixture");
    assert.equal(delivery.sentAt, null);
    assert.equal(
      delivery.scheduledAt?.toISOString(),
      "2026-10-17T15:00:00.000Z",
    );
    assert.ok(delivery.payload);
    assert.ok(delivery.firstAttemptAt);
  } finally {
    release();
    await current.cleanup();
  }
});

for (const committed of [false, true]) {
  void test(`lost database acknowledgement ${committed ? "after commit preserves the provider state" : "before commit retries the immutable request"}`, async () => {
    const current = await fixture();
    let loseAcknowledgement = true;
    let verifiedEmailCalls = 0;
    const requests: string[] = [];
    const providerAccepted = new Map<string, { body: string; id: string }>();
    const scoped = base.$extends({
      query: {
        workspaceMember: {
          findMany({ args, query }) {
            args.where = { ...args.where, clerkUserId: current.userId };
            return query(args);
          },
        },
        dailyDelivery: {
          findMany({ args, query }) {
            args.where = { ...args.where, clerkUserId: current.userId };
            return query(args);
          },
          async update({ args, query }) {
            if (args.data.status === "scheduled" && loseAcknowledgement) {
              loseAcknowledgement = false;
              if (committed) await query(args);
              throw new Error(
                "Simulated database acknowledgement failure after provider acceptance.",
              );
            }
            return query(args);
          },
        },
      },
    });
    const db = scoped as unknown as Database;
    const dependencies: NonNullable<Parameters<typeof runDailyJob>[2]> = {
      verifiedEmail: async () => {
        verifiedEmailCalls++;
        return verifiedEmailCalls === 1
          ? "original@example.com"
          : "changed@example.com";
      },
      send: async (payload) => {
        const stored = await base.dailyDelivery.findUniqueOrThrow({
          where: {
            clerkUserId_localDate: {
              clerkUserId: current.userId,
              localDate: "2026-10-17",
            },
          },
        });
        assert.equal(stored.status, "sending");
        assert.deepEqual(stored.payload, payload);
        assert.ok(stored.firstAttemptAt);
        const body = JSON.stringify(payload);
        requests.push(body);
        const previous = providerAccepted.get(payload.dedupeKey);
        if (previous) {
          assert.equal(body, previous.body);
          return { id: previous.id };
        }
        const accepted = { body, id: "provider_immutable_fixture" };
        providerAccepted.set(payload.dedupeKey, accepted);
        return { id: accepted.id };
      },
    };
    try {
      assert.equal((await runDailyJob(db, batchTime, dependencies)).failed, 1);
      const failed = await base.dailyDelivery.findUniqueOrThrow({
        where: {
          clerkUserId_localDate: {
            clerkUserId: current.userId,
            localDate: "2026-10-17",
          },
        },
      });
      assert.equal(failed.status, committed ? "scheduled" : "failed");
      assert.equal(
        failed.providerId,
        committed ? "provider_immutable_fixture" : null,
      );
      assert.ok(failed.payload);
      process.env.EMAIL_FROM = "Changed <changed@example.com>";
      process.env.APP_BASE_URL = "https://changed.example";
      const retried = await runDailyJob(
        db,
        new Date("2026-10-17T01:20:00Z"),
        dependencies,
      );
      assert.equal(retried.scheduled, committed ? 0 : 1);
      assert.equal(retried.failed, 0);
      assert.equal(requests.length, committed ? 1 : 2);
      if (!committed) assert.equal(requests[1], requests[0]);
      assert.equal(providerAccepted.size, 1);
      assert.equal(verifiedEmailCalls, 1);
      const delivery = await base.dailyDelivery.findUniqueOrThrow({
        where: {
          clerkUserId_localDate: {
            clerkUserId: current.userId,
            localDate: "2026-10-17",
          },
        },
      });
      assert.equal(delivery.status, "scheduled");
      assert.equal(delivery.providerId, "provider_immutable_fixture");
      assert.equal(delivery.sentAt, null);
      assert.equal(
        delivery.firstAttemptAt?.toISOString(),
        failed.firstAttemptAt?.toISOString(),
      );
      assert.deepEqual(delivery.payload, failed.payload);
    } finally {
      process.env.EMAIL_FROM = "Fixture <daily@example.com>";
      process.env.APP_BASE_URL = "https://caishen.example";
      await current.cleanup();
    }
  });
}

void test("daily retry recovers a failed cancellation for an inactive owner excluded from member processing", async () => {
  const current = await fixture();
  let sends = 0;
  let cancels = 0;
  const scoped = base.$extends({
    query: {
      workspaceMember: {
        findMany({ args, query }) {
          args.where = { ...args.where, clerkUserId: current.userId };
          return query(args);
        },
      },
      dailyDelivery: {
        findMany({ args, query }) {
          args.where = { ...args.where, clerkUserId: current.userId };
          return query(args);
        },
      },
    },
  });
  const db = scoped as unknown as Database;
  const dependencies: NonNullable<Parameters<typeof runDailyJob>[2]> = {
    verifiedEmail: async () => "verified@example.com",
    send: async () => {
      sends++;
      await base.user.update({
        where: { clerkUserId: current.userId },
        data: { active: false },
      });
      return { id: "provider_cancel_recovery" };
    },
    cancel: async (client, userId, at) =>
      cancelScheduledDailyReviews(client, userId, at, async (providerId) => {
        cancels++;
        if (cancels === 1) throw new Error("Provider cancel timed out.");
        return { id: providerId };
      }),
  };
  try {
    const first = await runDailyJob(db, batchTime, dependencies);
    assert.equal(first.scheduled, 1);
    assert.equal(first.failed, 1);
    const queued = await base.dailyDelivery.findUniqueOrThrow({
      where: {
        clerkUserId_localDate: {
          clerkUserId: current.userId,
          localDate: "2026-10-17",
        },
      },
    });
    assert.equal(queued.status, "scheduled");
    const retry = await runDailyJob(
      db,
      new Date("2026-10-17T01:20:00Z"),
      dependencies,
    );
    assert.equal(retry.processed, 0);
    assert.equal(retry.scheduled, 0);
    assert.equal(retry.canceled, 1);
    assert.equal(retry.failed, 0);
    assert.equal(sends, 1);
    assert.equal(cancels, 2);
    const canceled = await base.dailyDelivery.findUniqueOrThrow({
      where: { id: queued.id },
    });
    assert.equal(canceled.status, "canceled");
    assert.equal(canceled.error, null);
  } finally {
    await current.cleanup();
  }
});

for (const inactiveDuringSend of [false, true]) {
  void test(`ambiguous acceptance is recovered and canceled when deactivation happens ${inactiveDuringSend ? "during" : "after"} the provider attempt`, async () => {
    const current = await fixture();
    const accepted = new Map<string, { body: string; id: string }>();
    const requests: string[] = [];
    const cancellations: string[] = [];
    const scoped = base.$extends({
      query: {
        workspaceMember: {
          findMany({ args, query }) {
            args.where = { ...args.where, clerkUserId: current.userId };
            return query(args);
          },
        },
        dailyDelivery: {
          findMany({ args, query }) {
            args.where = { ...args.where, clerkUserId: current.userId };
            return query(args);
          },
        },
      },
    });
    const db = scoped as unknown as Database;
    const send: NonNullable<
      NonNullable<Parameters<typeof runDailyJob>[2]>["send"]
    > = async (payload) => {
      const body = JSON.stringify(payload);
      requests.push(body);
      const previous = accepted.get(payload.dedupeKey);
      if (previous) {
        assert.equal(body, previous.body);
        return { id: previous.id };
      }
      accepted.set(payload.dedupeKey, {
        body,
        id: "provider_ambiguous_fixture",
      });
      if (inactiveDuringSend)
        await base.user.update({
          where: { clerkUserId: current.userId },
          data: { active: false },
        });
      throw new Error(
        "Provider accepted the request but its response was lost.",
      );
    };
    const dependencies: NonNullable<Parameters<typeof runDailyJob>[2]> = {
      verifiedEmail: async () => "verified@example.com",
      send,
      cancel: async (client, userId, at) =>
        cancelScheduledDailyReviews(
          client,
          userId,
          at,
          async (providerId) => {
            cancellations.push(providerId);
            return { id: providerId };
          },
          send,
        ),
    };
    try {
      const first = await runDailyJob(db, batchTime, dependencies);
      assert.equal(first.failed, 1);
      const attempted = await base.dailyDelivery.findUniqueOrThrow({
        where: {
          clerkUserId_localDate: {
            clerkUserId: current.userId,
            localDate: "2026-10-17",
          },
        },
      });
      assert.ok(attempted.payload);
      assert.ok(attempted.firstAttemptAt);
      if (inactiveDuringSend) {
        assert.equal(first.canceled, 1);
        assert.equal(first.scheduled, 0);
      } else {
        assert.equal(attempted.status, "failed");
        assert.equal(attempted.providerId, null);
        await base.user.update({
          where: { clerkUserId: current.userId },
          data: { active: false },
        });
        const retry = await runDailyJob(
          db,
          new Date("2026-10-17T01:20:00Z"),
          dependencies,
        );
        assert.equal(retry.processed, 0);
        assert.equal(retry.failed, 0);
        assert.equal(retry.canceled, 1);
        assert.equal(retry.scheduled, 0);
      }
      assert.equal(accepted.size, 1);
      assert.equal(requests.length, 2);
      assert.equal(requests[0], requests[1]);
      assert.deepEqual(cancellations, ["provider_ambiguous_fixture"]);
      const canceled = await base.dailyDelivery.findUniqueOrThrow({
        where: { id: attempted.id },
      });
      assert.equal(canceled.status, "canceled");
      assert.equal(canceled.providerId, "provider_ambiguous_fixture");
      assert.equal(canceled.sentAt, null);
      assert.deepEqual(canceled.payload, attempted.payload);
      assert.equal(
        canceled.firstAttemptAt?.toISOString(),
        attempted.firstAttemptAt?.toISOString(),
      );
    } finally {
      await current.cleanup();
    }
  });
}
