import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunJournal, cleanupRun, type CleanupServices } from "../e2e/cleanup";

void test("cleanup recovers an identity created before its response was recorded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "caishen-cleanup-"));
  try {
    const journal = await RunJournal.create(directory);
    const email = await journal.reserveIdentity();
    assert.ok(
      email.split("@")[0]!.length <= 64,
      "Clerk email local part must fit",
    );
    const removed: string[] = [];
    const services: CleanupServices = {
      findIdentity: async () => [
        { id: "user_orphan", email, runId: journal.runId },
      ],
      assertOwnedData: async () => undefined,
      deleteIdentity: async (id) => {
        removed.push(`identity:${id}`);
      },
      clearData: async (id) => {
        removed.push(`data:${id}`);
      },
    };
    // Reopen from disk, as a fresh maintenance process would after a crash.
    await cleanupRun(await RunJournal.open(directory, journal.runId), services);
    assert.deepEqual(removed, ["identity:user_orphan", "data:user_orphan"]);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("failed identity deletion retains recovery data and still cleans the other identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "caishen-cleanup-"));
  try {
    const journal = await RunJournal.create(directory);
    const first = await journal.reserveIdentity();
    const second = await journal.reserveIdentity();
    const identities = new Map([
      [first, { id: "user_first", email: first, runId: journal.runId }],
      [second, { id: "user_second", email: second, runId: journal.runId }],
    ]);
    const cleared: string[] = [];
    let unavailable = true;
    const services: CleanupServices = {
      findIdentity: async (email) =>
        identities.has(email) ? [identities.get(email)!] : [],
      assertOwnedData: async () => undefined,
      deleteIdentity: async (id) => {
        if (id === "user_first" && unavailable)
          throw new Error("Clerk unavailable");
        identities.delete(id === "user_first" ? first : second);
      },
      clearData: async (id) => {
        cleared.push(id);
      },
    };
    await assert.rejects(cleanupRun(journal, services), AggregateError);
    assert.deepEqual(cleared, ["user_second"]);
    assert.deepEqual(await readdir(directory), [`${journal.runId}.json`]);
    unavailable = false;
    await cleanupRun(await RunJournal.open(directory, journal.runId), services);
    assert.ok(cleared.includes("user_first"));
    assert.equal(identities.size, 0);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("database cleanup can resume after Clerk deletion has already succeeded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "caishen-cleanup-"));
  try {
    const journal = await RunJournal.create(directory);
    const email = await journal.reserveIdentity();
    let identityExists = true;
    let unavailable = true;
    const cleared: string[] = [];
    const services: CleanupServices = {
      findIdentity: async () =>
        identityExists
          ? [{ id: "user_retry", email, runId: journal.runId }]
          : [],
      assertOwnedData: async () => undefined,
      deleteIdentity: async () => {
        identityExists = false;
      },
      clearData: async (id) => {
        if (unavailable) throw new Error("Database unavailable");
        cleared.push(id);
      },
    };
    await assert.rejects(cleanupRun(journal, services), AggregateError);
    assert.equal(identityExists, false);
    unavailable = false;
    await cleanupRun(await RunJournal.open(directory, journal.runId), services);
    assert.deepEqual(cleared, ["user_retry"]);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("cleanup refuses mismatched ownership and shared data before deleting an identity", async () => {
  for (const unsafe of [
    "metadata",
    "email",
    "id",
    "ambiguous",
    "shared-workspace",
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "caishen-cleanup-"));
    try {
      const journal = await RunJournal.create(directory);
      const email = await journal.reserveIdentity();
      await journal.recordIdentity(email, "user_owned");
      const removed: string[] = [];
      const identity = {
        id: unsafe === "id" ? "user_other" : "user_owned",
        email: unsafe === "email" ? "unrelated@example.com" : email,
        runId: unsafe === "metadata" ? "another-run" : journal.runId,
      };
      await assert.rejects(
        cleanupRun(journal, {
          findIdentity: async () =>
            unsafe === "ambiguous" ? [identity, identity] : [identity],
          assertOwnedData: async () => {
            if (unsafe === "shared-workspace")
              throw new Error("Unrelated workspace member");
          },
          deleteIdentity: async (id) => {
            removed.push(`identity:${id}`);
          },
          clearData: async (id) => {
            removed.push(`data:${id}`);
          },
        }),
        AggregateError,
      );
      assert.deepEqual(removed, [], unsafe);
      assert.deepEqual(await readdir(directory), [`${journal.runId}.json`]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

void test("an unresolved creation retains its reservation instead of assuming no identity was created", async () => {
  const directory = await mkdtemp(join(tmpdir(), "caishen-cleanup-"));
  try {
    const journal = await RunJournal.create(directory);
    await journal.reserveIdentity();
    await assert.rejects(
      cleanupRun(journal, {
        findIdentity: async () => [],
        assertOwnedData: async () => {
          assert.fail("No known identity to inspect");
        },
        deleteIdentity: async () => {
          assert.fail("No known identity to delete");
        },
        clearData: async () => {
          assert.fail("No known identity to clean");
        },
      }),
      AggregateError,
    );
    assert.deepEqual(await readdir(directory), [`${journal.runId}.json`]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("cleanup retries a rolled-back serialization conflict with a bounded attempt count", async () => {
  for (const conflicts of [1, 3]) {
    const directory = await mkdtemp(join(tmpdir(), "caishen-cleanup-"));
    try {
      const journal = await RunJournal.create(directory);
      const email = await journal.reserveIdentity();
      await journal.recordIdentity(email, "user_deleted");
      let attempts = 0;
      const result = cleanupRun(journal, {
        findIdentity: async () => [],
        assertOwnedData: async () => undefined,
        deleteIdentity: async () => {
          assert.fail("Identity already deleted");
        },
        clearData: async () => {
          attempts++;
          if (attempts <= conflicts)
            throw Object.assign(new Error("Transaction rolled back"), {
              code: "P2034",
            });
        },
      });
      if (conflicts === 1) {
        await result;
        assert.equal(attempts, 2);
        assert.deepEqual(await readdir(directory), []);
      } else {
        await assert.rejects(result, AggregateError);
        assert.equal(attempts, 3);
        assert.deepEqual(await readdir(directory), [`${journal.runId}.json`]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
