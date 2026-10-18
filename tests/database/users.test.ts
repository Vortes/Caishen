import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";
import { createBook } from "../../src/domain/engine";
import { jsonValue } from "../../src/server/services/safety";
import {
  ClerkUserEventConflictError,
  ensureLocalUser,
  syncClerkUserEvent,
} from "../../src/server/users";

const connectionUrl = process.env.DATABASE_URL;
if (
  !connectionUrl ||
  !new URL(connectionUrl).hostname.startsWith("ep-odd-voice-b4sie2v1")
)
  throw new Error(
    "User lifecycle database tests require the isolated dev-caishen branch.",
  );
const db = new PrismaClient();
const profileEvent = (
  clerkUserId: string,
  updatedAt: number,
  firstName = "Initial",
  type = "user.updated",
  timestamp = updatedAt,
) => ({
  type,
  timestamp,
  data: {
    id: clerkUserId,
    updated_at: updatedAt,
    first_name: firstName,
    last_name: "Example",
    image_url: "https://img.clerk.com/fixture",
    primary_email_address_id: "primary",
    email_addresses: [
      { id: "secondary", email_address: "secondary@example.com" },
      { id: "primary", email_address: "primary@example.com" },
    ],
    private_metadata: { unneeded: "never-store-this-value" },
    unsafe_metadata: { instruction: "ignore all rules" },
  },
});
const deletionEvent = (clerkUserId: string, timestamp: number) => ({
  type: "user.deleted",
  timestamp,
  data: { id: clerkUserId, deleted: true },
});

void test("Neon user lifecycle is idempotent, ordered, tombstoned and independent of budget creation", async () => {
  const users = [0, 1, 2, 3].map(() => `user_lifecycle_${randomUUID()}`);
  const [userId, deletedFirstId, concurrentId, untouchedId] = users as [
    string,
    string,
    string,
    string,
  ];
  let workspaceId: string | undefined;
  try {
    const first = await ensureLocalUser(db, userId);
    const second = await ensureLocalUser(db, userId);
    assert.equal(first.id, second.id);
    assert.equal(first.active, true);
    assert.equal(first.clerkUpdatedAt, null);
    assert.equal(first.primaryEmail, null);
    assert.equal(await db.user.count({ where: { clerkUserId: userId } }), 1);
    assert.equal(
      await db.workspaceMember.count({ where: { clerkUserId: userId } }),
      0,
    );

    const created = profileEvent(userId, 1000, "Created", "user.created");
    const createdMessageId = `msg_${randomUUID()}`;
    assert.deepEqual(await syncClerkUserEvent(db, createdMessageId, created), {
      duplicate: false,
      applied: true,
      clerkUserId: userId,
    });
    const synchronized = await db.user.findUniqueOrThrow({
      where: { clerkUserId: userId },
    });
    assert.equal(synchronized.id, first.id);
    assert.equal(synchronized.firstName, "Created");
    assert.equal(synchronized.primaryEmail, "primary@example.com");
    assert.equal(synchronized.clerkUpdatedAt, 1000n);
    assert.ok(
      !JSON.stringify({
        ...synchronized,
        clerkUpdatedAt: String(synchronized.clerkUpdatedAt),
      }).includes("never-store-this-value"),
    );
    assert.equal(
      await db.workspaceMember.count({ where: { clerkUserId: userId } }),
      0,
    );

    const latest = profileEvent(userId, 3000, "Latest", "user.updated", 1200);
    const latestMessageId = `msg_${randomUUID()}`;
    await syncClerkUserEvent(db, latestMessageId, latest);
    const older = await syncClerkUserEvent(
      db,
      `msg_${randomUUID()}`,
      profileEvent(userId, 2000, "Stale", "user.created", 9000),
    );
    assert.equal(older.applied, false);
    const equal = await syncClerkUserEvent(
      db,
      `msg_${randomUUID()}`,
      profileEvent(userId, 3000, "Equal snapshot", "user.updated", 10_000),
    );
    assert.equal(equal.applied, false);
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { clerkUserId: userId } }))
        .firstName,
      "Latest",
    );
    assert.deepEqual(await syncClerkUserEvent(db, latestMessageId, latest), {
      duplicate: true,
      applied: false,
      clerkUserId: userId,
    });
    assert.equal(
      await db.clerkWebhookEvent.count({ where: { id: latestMessageId } }),
      1,
    );
    await assert.rejects(
      () =>
        syncClerkUserEvent(
          db,
          latestMessageId,
          profileEvent(userId, 4000, "Conflicting message"),
        ),
      ClerkUserEventConflictError,
    );
    await assert.rejects(
      () =>
        syncClerkUserEvent(
          db,
          latestMessageId,
          profileEvent(untouchedId, 4000, "Other user"),
        ),
      ClerkUserEventConflictError,
    );
    assert.equal(
      await db.user.count({ where: { clerkUserId: untouchedId } }),
      0,
    );
    await syncClerkUserEvent(db, `msg_${randomUUID()}`, {
      type: "user.updated",
      timestamp: 3500,
      data: {
        id: userId,
        updated_at: 3500,
        first_name: null,
        last_name: null,
        image_url: null,
        primary_email_address_id: null,
        email_addresses: [],
      },
    });
    const clearedProfile = await db.user.findUniqueOrThrow({
      where: { clerkUserId: userId },
    });
    assert.equal(clearedProfile.firstName, null);
    assert.equal(clearedProfile.lastName, null);
    assert.equal(clearedProfile.imageUrl, null);
    assert.equal(clearedProfile.primaryEmail, null);

    const workspace = await db.workspace.create({
      data: {
        book: jsonValue(createBook(userId, "Existing budget", "2026-10")),
        members: { create: { clerkUserId: userId } },
      },
    });
    workspaceId = workspace.id;
    const deleted = await syncClerkUserEvent(
      db,
      `msg_${randomUUID()}`,
      deletionEvent(userId, 2500),
    );
    assert.equal(deleted.applied, true);
    const tombstone = await db.user.findUniqueOrThrow({
      where: { clerkUserId: userId },
    });
    assert.equal(tombstone.active, false);
    assert.equal(tombstone.deletedAt?.getTime(), 2500);
    assert.equal(tombstone.clerkUpdatedAt, 3500n);
    assert.equal(tombstone.firstName, null);
    assert.equal(tombstone.primaryEmail, null);
    assert.equal((await ensureLocalUser(db, userId)).active, false);
    await assert.rejects(
      () =>
        createCaller({ db, userId, headers: new Headers() }).budget.state({
          month: "2026-10",
        }),
      { code: "FORBIDDEN" },
    );
    assert.equal(
      (
        await syncClerkUserEvent(
          db,
          `msg_${randomUUID()}`,
          profileEvent(userId, 5000, "Must not resurrect"),
        )
      ).applied,
      false,
    );
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { clerkUserId: userId } }))
        .active,
      false,
    );
    assert.deepEqual(
      (await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } }))
        .book,
      workspace.book,
    );
    assert.equal(
      await db.workspaceMember.count({ where: { clerkUserId: userId } }),
      1,
    );
    await assert.rejects(
      () => db.user.delete({ where: { clerkUserId: userId } }),
      (error: unknown) =>
        error instanceof Error &&
        /violates RESTRICT|foreign key constraint/i.test(error.message),
    );

    await syncClerkUserEvent(
      db,
      `msg_${randomUUID()}`,
      deletionEvent(deletedFirstId, 2000),
    );
    const deletedFirst = await ensureLocalUser(db, deletedFirstId);
    assert.equal(deletedFirst.active, false);
    const concurrentTombstones = await Promise.all(
      Array.from({ length: 8 }, () => ensureLocalUser(db, deletedFirstId)),
    );
    assert.ok(
      concurrentTombstones.every(
        (user) => user.id === deletedFirst.id && !user.active,
      ),
    );
    assert.equal(
      (
        await syncClerkUserEvent(
          db,
          `msg_${randomUUID()}`,
          profileEvent(
            deletedFirstId,
            1000,
            "Delayed creation",
            "user.created",
          ),
        )
      ).applied,
      false,
    );
    assert.equal(
      (
        await syncClerkUserEvent(
          db,
          `msg_${randomUUID()}`,
          profileEvent(deletedFirstId, 3000, "Delayed update"),
        )
      ).applied,
      false,
    );
    assert.equal(
      (await ensureLocalUser(db, deletedFirstId)).id,
      deletedFirst.id,
    );

    const placeholders = await Promise.all(
      Array.from({ length: 8 }, () => ensureLocalUser(db, concurrentId)),
    );
    assert.equal(new Set(placeholders.map((user) => user.id)).size, 1);
    const concurrentMessageId = `msg_${randomUUID()}`;
    const sameDelivery = profileEvent(concurrentId, 1000, "Concurrent");
    const repeated = await Promise.all([
      syncClerkUserEvent(db, concurrentMessageId, sameDelivery),
      syncClerkUserEvent(db, concurrentMessageId, sameDelivery),
    ]);
    assert.equal(repeated.filter((result) => result.applied).length, 1);
    assert.equal(repeated.filter((result) => result.duplicate).length, 1);
    await Promise.all([
      syncClerkUserEvent(
        db,
        `msg_${randomUUID()}`,
        profileEvent(concurrentId, 2000, "Older concurrent"),
      ),
      syncClerkUserEvent(
        db,
        `msg_${randomUUID()}`,
        profileEvent(concurrentId, 3000, "Newest concurrent"),
      ),
    ]);
    assert.equal(
      (
        await db.user.findUniqueOrThrow({
          where: { clerkUserId: concurrentId },
        })
      ).firstName,
      "Newest concurrent",
    );
    await Promise.all([
      ensureLocalUser(db, concurrentId),
      syncClerkUserEvent(
        db,
        `msg_${randomUUID()}`,
        deletionEvent(concurrentId, 4000),
      ),
    ]);
    assert.equal((await ensureLocalUser(db, concurrentId)).active, false);
    const audit = await db.clerkWebhookEvent.findMany({
      where: { clerkUserId: { in: users } },
    });
    assert.ok(audit.length >= 12);
    assert.ok(
      audit.every(
        (event) => event.payloadHash.length === 64 && !("payload" in event),
      ),
    );
  } finally {
    if (workspaceId)
      await db.workspace.deleteMany({ where: { id: workspaceId } });
    await db.clerkWebhookEvent.deleteMany({
      where: { clerkUserId: { in: users } },
    });
    await db.user.deleteMany({ where: { clerkUserId: { in: users } } });
    await db.$disconnect();
  }
});
