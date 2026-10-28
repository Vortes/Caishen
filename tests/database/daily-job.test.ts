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
const keys = [
  "CLERK_SECRET_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_BASE_URL",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
process.env.CLERK_SECRET_KEY = "fixture-signing-key";
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
  const accepted: { scheduledAt?: string }[] = [];
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
    send: async (payload: { scheduledAt?: string }) => {
      accepted.push(payload);
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
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0]!.scheduledAt, "2026-10-17T15:00:00.000Z");
    assert.equal(
      results.reduce((total, result) => total + result.scheduled, 0),
      1,
    );
    assert.equal(
      results.reduce((total, result) => total + result.failed, 0),
      0,
    );
    assert.equal((await runDailyJob(db, batchTime, dependencies)).scheduled, 0);
    assert.equal(accepted.length, 1);
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
      assert.equal(
        (await runDailyJob(db, batchTime, dependencies)).scheduled,
        0,
      );
      assert.equal(providerAccepted.size, 1);
    } finally {
      process.env.EMAIL_FROM = "Fixture <daily@example.com>";
      process.env.APP_BASE_URL = "https://caishen.example";
      await current.cleanup();
    }
  });
}

void test("a failed cancellation for an owner who became inactive is recovered by the run's maintenance", async () => {
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
    // Maintenance follows delivery, so the same run retries the cancel.
    const first = await runDailyJob(db, batchTime, dependencies);
    assert.equal(first.scheduled, 1);
    assert.equal(first.canceled, 1);
    assert.equal(first.failed, 1);
    const retry = await runDailyJob(
      db,
      new Date("2026-10-17T01:20:00Z"),
      dependencies,
    );
    assert.equal(retry.processed, 0);
    assert.equal(retry.scheduled, 0);
    assert.equal(retry.canceled, 0);
    assert.equal(retry.failed, 0);
    assert.equal(sends, 1);
    assert.equal(cancels, 2);
    assert.equal((await runDailyJob(db, batchTime, dependencies)).canceled, 0);
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
      if (inactiveDuringSend) {
        assert.equal(first.canceled, 1);
        assert.equal(first.scheduled, 0);
      } else {
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
      assert.equal(
        (await runDailyJob(db, batchTime, dependencies)).canceled,
        0,
      );
      assert.equal(accepted.size, 1);
    } finally {
      await current.cleanup();
    }
  });
}
