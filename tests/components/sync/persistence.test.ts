import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  openBudgetClient,
  type BudgetClient,
} from "~/components/sync/budget-client";
import {
  budgetDatabaseName,
  deleteStoredBudgets,
  IndexedDbPersistence,
  openPersistence,
  STORE_SCHEMA_VERSION,
} from "~/components/sync/indexed-db";
import { MemoryPersistence } from "~/components/sync/persistence";
import { rowsIn, toRowSet } from "~/domain/change-sets";
import { projectBook, type Command } from "~/domain/engine";
import { rowsToPersonalLedger, type WireRow } from "~/domain/rows";
import { FakeConnection, FakeServer, household } from "./fake-server";

const month = "2026-10";
const clients: BudgetClient[] = [];

beforeEach(() => {
  // A fresh browser profile for every test.
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose();
  await deleteStoredBudgets();
});

function tab(server: FakeServer, userId = "alex") {
  const connection = new FakeConnection(server, userId);
  const client = openBudgetClient({
    userId,
    transport: connection,
    clientBuild: "test",
  });
  clients.push(client);
  return { client, connection, store: client.store };
}

const assign = (id: string, categoryId: string, amount: number): Command => ({
  type: "assign",
  id,
  categoryId,
  month,
  amount,
});

function serverMonth(server: FakeServer) {
  const ledger = rowsToPersonalLedger(rowsIn(server.rows), "alex");
  return projectBook(ledger, "alex", month, month);
}

async function stored(userId = "alex") {
  const persistence = await IndexedDbPersistence.open(userId, "test");
  const result = await persistence.load();
  persistence.close();
  return result;
}

test("a new tab shows the stored rows at once and pulls only what changed since", async () => {
  const server = new FakeServer(household());
  const first = tab(server);
  await first.client.ready;
  first.client.run(assign("a1", "food", 10_000), { summary: "Assigned" });
  await first.client.idle();
  expect((await stored())?.revision).toBe(1);

  server.act("alex", assign("elsewhere", "rent", 1_000));
  const second = tab(server);
  second.connection.holding = true;
  await vi.waitFor(() =>
    expect(second.store.getSnapshot()).toMatchObject({
      status: "ready",
      revision: 1,
      updating: true,
    }),
  );
  expect(
    second.store.month(month)!.categories.find((item) => item.id === "food")!
      .assigned,
  ).toBe(10_000);
  second.connection.holding = false;
  second.connection.releaseAll();
  await second.client.ready;
  expect(server.pulls.at(-1)!.input.since).toBe(1);
  expect(second.store.getSnapshot()).toMatchObject({
    revision: 2,
    updating: false,
  });
  expect(second.store.month(month)).toEqual(serverMonth(server));
  await second.client.idle();
  expect((await stored())?.revision).toBe(2);
});

test("two tabs share one database and hear each other's confirmed changes", async () => {
  const server = new FakeServer(household());
  const first = tab(server);
  const second = tab(server);
  await Promise.all([first.client.ready, second.client.ready]);
  const pulls = server.pulls.length;

  first.client.run(assign("a1", "food", 10_000), { summary: "Assigned" });
  await first.client.idle();
  // The second tab applies the change set it was sent, without pulling.
  await vi.waitFor(() => expect(second.store.getSnapshot().revision).toBe(1));
  expect(server.pulls.length).toBe(pulls);
  expect(second.store.month(month)).toEqual(serverMonth(server));
  // Each tab keeps its own history.
  expect(first.store.getSnapshot().undo?.operationId).toBe("a1");
  expect(second.store.getSnapshot().undo).toBeNull();

  // A tab that missed a revision pulls instead.
  server.act("alex", assign("elsewhere", "rent", 1_000));
  second.client.run(assign("b1", "dining", 500), { summary: "Assigned" });
  await second.client.idle();
  await vi.waitFor(() => expect(first.store.getSnapshot().revision).toBe(3));
  expect(first.store.month(month)).toEqual(serverMonth(server));
  await first.client.idle();
  expect((await stored())?.revision).toBe(3);
});

test("storage never moves backward and takes every row when it is behind", async () => {
  const server = new FakeServer(household());
  const all = rowsIn(server.rows);
  const persistence = await IndexedDbPersistence.open("alex", "test");
  const commit = (
    since: number | null,
    revision: number,
    rows: WireRow[],
    snapshot = all,
  ) =>
    persistence.write({
      since,
      revision,
      rows,
      snapshot: toRowSet(snapshot),
      source: "server",
    });
  await commit(null, 5, all);
  const changed = { ...all[0]!, revision: 6 };
  await commit(5, 6, [changed]);
  // An older tab's commit is skipped.
  await commit(3, 4, [{ ...all[0]!, revision: 4 }]);
  let loaded = await persistence.load();
  expect(loaded?.revision).toBe(6);
  expect(
    loaded?.rows.find(
      (row) => row.table === changed.table && row.id === changed.id,
    )?.revision,
  ).toBe(6);

  // A commit on top of a revision storage doesn't have yet replaces it all.
  const snapshot = all.slice(1).map((row) => ({ ...row, revision: 9 }));
  await commit(8, 9, [snapshot[0]!], snapshot);
  loaded = await persistence.load();
  expect(loaded?.revision).toBe(9);
  expect(loaded?.rows).toHaveLength(snapshot.length);
  persistence.close();
});

test("rows stored by an older storage schema are dropped", async () => {
  const db = await openDB(budgetDatabaseName("alex"), 1, {
    upgrade(database) {
      database.createObjectStore("rows", { keyPath: ["table", "id"] });
      database.createObjectStore("meta");
    },
  });
  await db.put(
    "meta",
    { revision: 4, storeSchemaVersion: STORE_SCHEMA_VERSION - 1, build: "old" },
    "meta",
  );
  await db.put("rows", { table: "account", id: "x", revision: 4 });
  db.close();
  expect(await stored()).toBeNull();
  const reopened = await openDB(budgetDatabaseName("alex"), 1);
  expect(await reopened.count("rows")).toBe(0);
  reopened.close();
});

test("falls back to memory where IndexedDB is missing or won't open", async () => {
  vi.stubGlobal("indexedDB", undefined);
  expect(await openPersistence("alex", "test")).toBeInstanceOf(
    MemoryPersistence,
  );
  const broken = new IDBFactory();
  broken.open = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.stubGlobal("indexedDB", broken);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(await openPersistence("alex", "test")).toBeInstanceOf(
    MemoryPersistence,
  );

  // The client works the same, keeping rows for the tab only.
  vi.stubGlobal("indexedDB", undefined);
  const server = new FakeServer(household());
  const { client, store } = tab(server);
  await client.ready;
  client.run(assign("a1", "food", 10_000), { summary: "Assigned" });
  await client.idle();
  expect(store.month(month)).toEqual(serverMonth(server));
});

test("signing out deletes stored budgets, and another user's are deleted on sign-in", async () => {
  const server = new FakeServer(household());
  const alex = tab(server);
  await alex.client.ready;
  await alex.client.idle();
  expect(await stored()).not.toBeNull();

  // Jordan signs in on this browser: Alex's rows go.
  const jordan = tab(server, "jordan");
  await jordan.client.ready;
  await jordan.client.idle();
  const names = async () =>
    (await indexedDB.databases()).map((database) => database.name);
  expect(await names()).toEqual([budgetDatabaseName("jordan")]);

  // Signing out deletes everything, closing open tabs' connections.
  await deleteStoredBudgets();
  expect(await names()).toEqual([]);
});
