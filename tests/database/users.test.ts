import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { PrismaClient } from "../../src/generated/prisma";
import { createDatabaseCaller as createCaller } from "./fixtures";
import { ObservedRevision } from "../../src/server/api/trpc";
import { createBook } from "../../src/domain/engine";
import { loadRows } from "../../src/server/storage/rows";
import { createHousehold } from "./fixtures";
import {
  ClerkUserEventConflictError,
  ensureLocalUser,
  syncClerkUserEvent,
} from "../../src/server/users";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";

assertDevelopmentDatabase(process.env);
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

test.after(() => db.$disconnect());
function fixture(t: TestContext) {
  const userId = `user_lifecycle_${randomUUID()}`;
  t.after(async () => {
    await db.workspace.deleteMany({
      where: { members: { some: { clerkUserId: userId } } },
    });
    await db.clerkWebhookEvent.deleteMany({ where: { clerkUserId: userId } });
    await db.user.deleteMany({ where: { clerkUserId: userId } });
  });
  return userId;
}
const api = (userId: string) =>
  createCaller({
    db,
    userId,
    headers: new Headers(),
    revision: new ObservedRevision(),
  });
void test("a local identity is idempotent and does not create a budget", async (t) => {
  const userId = fixture(t);
  const first = await ensureLocalUser(db, userId);
  assert.equal((await ensureLocalUser(db, userId)).id, first.id);
  assert.equal(first.active, true);
  assert.equal(first.clerkUpdatedAt, null);
  assert.equal(first.primaryEmail, null);
  assert.equal((await api(userId).budget.overview()).status, "new");
});
void test("a creation event fills the existing local profile without storing private metadata", async (t) => {
  const userId = fixture(t);
  const first = await ensureLocalUser(db, userId);
  assert.deepEqual(
    await syncClerkUserEvent(
      db,
      `msg_${randomUUID()}`,
      profileEvent(userId, 1000, "Created", "user.created"),
    ),
    { duplicate: false, applied: true, clerkUserId: userId },
  );
  const profile = await ensureLocalUser(db, userId);
  assert.equal(profile.id, first.id);
  assert.equal(profile.firstName, "Created");
  assert.equal(profile.primaryEmail, "primary@example.com");
  assert.equal(profile.clerkUpdatedAt, 1000n);
  assert.ok(
    !JSON.stringify(profile, (_key, value: unknown) =>
      typeof value === "bigint" ? String(value) : value,
    ).includes("never-store-this-value"),
  );
  assert.equal((await api(userId).budget.overview()).status, "new");
});
void test("older and equal profile snapshots cannot overwrite the newest profile", async (t) => {
  const userId = fixture(t);
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
  assert.equal((await ensureLocalUser(db, userId)).firstName, "Latest");
});
void test("duplicate webhook deliveries apply once and conflicting deliveries are refused", async (t) => {
  const userId = fixture(t);
  const otherId = fixture(t);
  const messageId = `msg_${randomUUID()}`;
  const event = profileEvent(userId, 3000, "Latest");
  await syncClerkUserEvent(db, messageId, event);
  assert.deepEqual(await syncClerkUserEvent(db, messageId, event), {
    duplicate: true,
    applied: false,
    clerkUserId: userId,
  });
  for (const conflicting of [
    profileEvent(userId, 4000, "Conflicting"),
    profileEvent(otherId, 4000, "Other user"),
  ])
    await assert.rejects(
      syncClerkUserEvent(db, messageId, conflicting),
      ClerkUserEventConflictError,
    );
  assert.equal((await ensureLocalUser(db, userId)).firstName, "Latest");
  assert.equal((await ensureLocalUser(db, otherId)).firstName, null);
});
void test("clearing profile fields removes previously stored personal details", async (t) => {
  const userId = fixture(t);
  await syncClerkUserEvent(
    db,
    `msg_${randomUUID()}`,
    profileEvent(userId, 1000),
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
  const clearedProfile = await ensureLocalUser(db, userId);
  assert.equal(clearedProfile.firstName, null);
  assert.equal(clearedProfile.lastName, null);
  assert.equal(clearedProfile.imageUrl, null);
  assert.equal(clearedProfile.primaryEmail, null);
});
void test("deletion disables budget access and later profile events cannot reactivate the user", async (t) => {
  const userId = fixture(t);
  await syncClerkUserEvent(
    db,
    `msg_${randomUUID()}`,
    profileEvent(userId, 3500),
  );
  await createHousehold(db, createBook(userId, "Existing budget", "2026-10"));
  assert.equal(
    (
      await syncClerkUserEvent(
        db,
        `msg_${randomUUID()}`,
        deletionEvent(userId, 2500),
      )
    ).applied,
    true,
  );
  const tombstone = await ensureLocalUser(db, userId);
  assert.equal(tombstone.active, false);
  assert.equal(tombstone.deletedAt?.getTime(), 2500);
  assert.equal(tombstone.clerkUpdatedAt, 3500n);
  assert.equal(tombstone.firstName, null);
  assert.equal(tombstone.primaryEmail, null);
  await assert.rejects(api(userId).budget.state({ month: "2026-10" }), {
    code: "FORBIDDEN",
  });
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
  assert.equal((await ensureLocalUser(db, userId)).active, false);
});
void test("a deletion received before creation remains inactive after delayed events and concurrent reads", async (t) => {
  const userId = fixture(t);
  await syncClerkUserEvent(
    db,
    `msg_${randomUUID()}`,
    deletionEvent(userId, 2000),
  );
  const deleted = await ensureLocalUser(db, userId);
  const readers = await Promise.all(
    Array.from({ length: 8 }, () => ensureLocalUser(db, userId)),
  );
  assert.ok(readers.every((user) => user.id === deleted.id && !user.active));
  for (const event of [
    profileEvent(userId, 1000, "Delayed creation", "user.created"),
    profileEvent(userId, 3000, "Delayed update"),
  ])
    assert.equal(
      (await syncClerkUserEvent(db, `msg_${randomUUID()}`, event)).applied,
      false,
    );
  assert.equal((await ensureLocalUser(db, userId)).id, deleted.id);
});
void test("concurrent identity creation and duplicate webhook delivery produce one identity and one applied event", async (t) => {
  const userId = fixture(t);
  const users = await Promise.all(
    Array.from({ length: 8 }, () => ensureLocalUser(db, userId)),
  );
  assert.equal(new Set(users.map((user) => user.id)).size, 1);
  const id = `msg_${randomUUID()}`;
  const event = profileEvent(userId, 1000, "Concurrent");
  const results = await Promise.all([
    syncClerkUserEvent(db, id, event),
    syncClerkUserEvent(db, id, event),
  ]);
  assert.equal(results.filter((result) => result.applied).length, 1);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  assert.equal((await ensureLocalUser(db, userId)).firstName, "Concurrent");
});
void test("concurrent profile updates keep the newest snapshot", async (t) => {
  const userId = fixture(t);
  await ensureLocalUser(db, userId);
  await Promise.all([
    syncClerkUserEvent(
      db,
      `msg_${randomUUID()}`,
      profileEvent(userId, 2000, "Older concurrent"),
    ),
    syncClerkUserEvent(
      db,
      `msg_${randomUUID()}`,
      profileEvent(userId, 3000, "Newest concurrent"),
    ),
  ]);
  assert.equal(
    (await ensureLocalUser(db, userId)).firstName,
    "Newest concurrent",
  );
});
void test("concurrent profile lookup cannot undo account deletion", async (t) => {
  const userId = fixture(t);
  await ensureLocalUser(db, userId);
  await Promise.all([
    ensureLocalUser(db, userId),
    syncClerkUserEvent(db, `msg_${randomUUID()}`, deletionEvent(userId, 4000)),
  ]);
  assert.equal((await ensureLocalUser(db, userId)).active, false);
});
void test("user storage retains budget rows and restricts physical deletion while they refer to the owner", async (t) => {
  const userId = fixture(t);
  await ensureLocalUser(db, userId);
  const workspaceId = await createHousehold(
    db,
    createBook(userId, "Existing budget", "2026-10"),
  );
  const rows = await loadRows(db, workspaceId);
  await syncClerkUserEvent(
    db,
    `msg_${randomUUID()}`,
    deletionEvent(userId, 2500),
  );
  assert.deepEqual(await loadRows(db, workspaceId), rows);
  await assert.rejects(
    db.user.delete({ where: { clerkUserId: userId } }),
    (error: unknown) =>
      error instanceof Error &&
      /violates RESTRICT|foreign key constraint/i.test(error.message),
  );
});
void test("webhook storage retains one hash per delivery without its private payload", async (t) => {
  const userId = fixture(t);
  const id = `msg_${randomUUID()}`;
  const event = profileEvent(userId, 1000);
  await syncClerkUserEvent(db, id, event);
  await syncClerkUserEvent(db, id, event);
  const rows = await db.clerkWebhookEvent.findMany({
    where: { clerkUserId: userId },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.payloadHash.length, 64);
  assert.ok(!("payload" in rows[0]!));
});
