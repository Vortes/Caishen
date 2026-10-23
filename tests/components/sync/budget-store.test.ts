import { describe, expect, test, vi } from "vitest";
import { createBudgetClient } from "~/components/sync/budget-client";
import type { BudgetStore, Notice } from "~/components/sync/budget-store";
import { applyChangeSet, rowsIn, toRowSet } from "~/domain/change-sets";
import { executeWithChanges, projectBook, type Command } from "~/domain/engine";
import {
  bookToRows,
  rowsToPersonalLedger,
  rowVisibleTo,
  sameJson,
} from "~/domain/rows";
import { buildCommandCorpus } from "../../domain/fixtures/command-corpus";
import { SyncError } from "~/components/sync/transport";
import { FakeConnection, FakeServer, household } from "./fake-server";

const month = "2026-10";

function setup({ build = "test" } = {}) {
  const server = new FakeServer(household());
  const connection = new FakeConnection(server, "alex");
  let sequence = 0;
  const client = createBudgetClient({
    userId: "alex",
    transport: connection,
    clientBuild: build,
    clientId: "tab-1",
    newId: () => `undo-${++sequence}`,
  });
  const notices: Notice[] = [];
  client.store.onNotice((notice) => notices.push(notice));
  return { server, connection, client, store: client.store, notices };
}

const assign = (id: string, categoryId: string, amount: number): Command => ({
  type: "assign",
  id,
  categoryId,
  month,
  amount,
});

// The microtask that publishes the store's changes.
const published = () => Promise.resolve();

function assigned(store: BudgetStore, categoryId: string) {
  return store.month(month)!.categories.find((item) => item.id === categoryId)!
    .assigned;
}

/** What the server holds, as Alex's browser should show it. */
function serverMonth(server: FakeServer) {
  const ledger = rowsToPersonalLedger(rowsIn(server.rows), "alex");
  return projectBook(ledger, "alex", month, month);
}

describe("BudgetStore", () => {
  test("shows a command at once and keeps the same budget when the server confirms it", async () => {
    const { client, store, server, connection } = setup();
    await client.ready;
    expect(store.getSnapshot()).toMatchObject({ status: "ready", revision: 0 });

    const publishes = vi.fn();
    store.subscribe(publishes);
    const settled = vi.fn();
    connection.holding = true;
    expect(
      client.run(assign("a1", "food", 10_000), {
        summary: "Assigned $100.00 to Food",
        onSettled: settled,
      }),
    ).toEqual({ ok: true, operationId: "a1" });
    await published();
    expect(publishes).toHaveBeenCalledTimes(1);
    expect(assigned(store, "food")).toBe(10_000);
    expect(store.getSnapshot().pending).toEqual([
      {
        operationId: "a1",
        summary: "Assigned $100.00 to Food",
        previewed: true,
      },
    ]);
    const shown = store.getSnapshot().ledger;
    const projection = store.month(month);

    connection.holding = false;
    connection.releaseAll();
    await client.idle();
    expect(settled).toHaveBeenCalledExactlyOnceWith({ ok: true, revision: 1 });
    expect(store.getSnapshot()).toMatchObject({ revision: 1, pending: [] });
    // The server wrote what the browser previewed, so nothing is rebuilt.
    expect(store.getSnapshot().ledger).toBe(shown);
    expect(store.month(month)).toBe(projection);
    expect(store.month(month)).toEqual(serverMonth(server));
  });

  test("confirming a queue in order keeps what each command previewed", async () => {
    const { client, store, server, connection } = setup();
    await client.ready;
    connection.holding = true;
    client.run(assign("a1", "food", 1_000), { summary: "Assigned" });
    client.run(assign("a2", "rent", 2_000), { summary: "Assigned" });
    client.undo();
    client.run(assign("a3", "dining", 3_000), { summary: "Assigned" });
    await published();
    const shown = store.getSnapshot().ledger;
    connection.holding = false;
    connection.releaseAll();
    await client.idle();
    expect(store.getSnapshot()).toMatchObject({ revision: 4, pending: [] });
    expect(store.getSnapshot().ledger).toBe(shown);
    expect(store.month(month)).toEqual(serverMonth(server));
    expect(assigned(store, "rent")).toBe(0);
  });

  test("refuses a command the engine refuses here without sending it", async () => {
    const { client, store, server } = setup();
    await client.ready;
    expect(
      client.run(assign("a1", "missing", 100), { summary: "Assigned" }),
    ).toEqual({ ok: false, message: expect.any(String) as string });
    await client.idle();
    expect(server.executed).toEqual([]);
    expect(store.getSnapshot().pending).toEqual([]);
    expect(store.getSnapshot().undo).toBeNull();
  });

  test("pulls what it missed when the server answers from a later revision", async () => {
    const { client, store, server } = setup();
    await client.ready;
    // Another tab assigned to Rent first.
    server.act("alex", assign("other-tab", "rent", 5_000));
    client.run(assign("a1", "food", 10_000), { summary: "Assigned" });
    await client.idle();
    expect(server.executed[0]!.input.baseRevision).toBe(0);
    expect(store.getSnapshot()).toMatchObject({ revision: 2, pending: [] });
    expect(assigned(store, "rent")).toBe(5_000);
    expect(assigned(store, "food")).toBe(10_000);
    expect(server.pulls.map((pull) => pull.input.since)).toEqual([null, 0]);
    expect(store.month(month)).toEqual(serverMonth(server));
  });

  test("still sends a command that no longer applies here, and the server decides", async () => {
    const { client, store, server, connection } = setup();
    await client.ready;
    // Another tab removed the purchase this tab is about to recategorize.
    server.act("alex", {
      type: "transaction.remove",
      id: "other-tab",
      transactionId: "cafe",
    });
    connection.holding = true;
    client.run(assign("a1", "food", 10_000), { summary: "Assigned" });
    client.run(
      {
        type: "transaction.categorize",
        id: "move",
        transactionId: "cafe",
        categoryId: "dining",
      },
      { summary: "Moved to Dining" },
    );
    await published();
    expect(store.getSnapshot().pending.map((op) => op.previewed)).toEqual([
      true,
      true,
    ]);

    // The first answer is from a later revision; the pull shows the removal
    // and the second command's preview is skipped, not dropped.
    connection.releaseAll();
    await vi.waitFor(() => expect(connection.held).toHaveLength(1));
    connection.releaseAll();
    await vi.waitFor(() =>
      expect(store.getSnapshot().pending).toEqual([
        { operationId: "move", summary: "Moved to Dining", previewed: false },
      ]),
    );
    connection.holding = false;
    connection.releaseAll();
    await client.idle();
    expect(server.executed.map((item) => item.input.command.id)).toEqual([
      "a1",
      "move",
    ]);
    expect(store.getSnapshot().pending).toEqual([]);
    expect(store.month(month)).toEqual(serverMonth(server));
  });

  test("an answer that arrives after a pull already confirmed the command changes nothing", async () => {
    const { client, store, connection } = setup();
    await client.ready;
    const settled = vi.fn();
    connection.holding = true;
    client.run(assign("a1", "food", 10_000), {
      summary: "Assigned",
      onSettled: settled,
    });
    await vi.waitFor(() => expect(connection.held).toHaveLength(1));
    const refreshed = client.refresh();
    await vi.waitFor(() => expect(connection.held).toHaveLength(2));
    // The pull's answer arrives first.
    connection.held.splice(1, 1)[0]!.release();
    await refreshed;
    expect(store.getSnapshot()).toMatchObject({ revision: 1, pending: [] });
    const shown = store.getSnapshot().ledger;

    connection.holding = false;
    connection.releaseAll();
    await client.idle();
    expect(settled).toHaveBeenCalledExactlyOnceWith({ ok: true, revision: 1 });
    expect(store.getSnapshot().ledger).toBe(shown);
    expect(assigned(store, "food")).toBe(10_000);
  });

  test("takes a catch-up in whole, in one publish", async () => {
    const { client, store, server } = setup();
    await client.ready;
    for (const [index, category] of ["rent", "food", "dining"].entries())
      server.act(
        "alex",
        assign(`other-${index}`, category, 1_000 * (index + 1)),
      );
    const ledgers: unknown[] = [];
    store.subscribe(() => ledgers.push(store.getSnapshot().ledger));
    const before = store.getSnapshot().ledger;
    client.signal.emit();
    await client.idle();
    const changed = ledgers.filter((ledger, index) =>
      index === 0 ? ledger !== before : ledger !== ledgers[index - 1],
    );
    expect(changed).toHaveLength(1);
    expect(store.getSnapshot()).toMatchObject({ revision: 3 });
    expect(store.month(month)).toEqual(serverMonth(server));
  });

  test("pulls in pages and starts over when the server resets it", async () => {
    const { client, store, server } = setup();
    server.pageSize = 4;
    await client.ready;
    expect(server.pulls.length).toBeGreaterThan(2);
    expect(store.month(month)).toEqual(serverMonth(server));

    server.act("alex", assign("other", "rent", 1_000));
    server.oldestDelta = 1;
    server.pulls.length = 0;
    await client.refresh();
    expect(server.pulls[0]!.input.since).toBe(0);
    expect(store.getSnapshot().revision).toBe(1);
    expect(store.month(month)).toEqual(serverMonth(server));
  });

  test("a pull whose pages race a change shows the budget whole, never with rows missing", async () => {
    const { client, store, server } = setup();
    server.pageSize = 1;
    // Alex's settings change after the first page: the later pages leave
    // the settings row out, and the rows sent hold a budget without them.
    let changed = false;
    server.onPull = (input) => {
      if (!input.cursor || changed) return;
      changed = true;
      server.act("alex", {
        type: "settings.update",
        id: "rename",
        name: "Alex renamed",
      });
    };
    const shown: (string | null)[] = [];
    store.subscribe(() => {
      const snapshot = store.getSnapshot();
      shown.push(snapshot.status);
      if (snapshot.status === "ready")
        expect(store.month(month)).toEqual(serverMonth(server));
    });
    await client.ready;
    await client.idle();
    expect(changed).toBe(true);
    expect(shown).not.toContain("empty");
    expect(store.getSnapshot()).toMatchObject({ status: "ready", revision: 1 });
    expect(store.getSnapshot().ledger!.budget.name).toBe("Alex renamed");
    expect(store.month(month)).toEqual(serverMonth(server));
  });

  test("an operation only the server can apply waits for its rows", async () => {
    const { client, store, server } = setup();
    await client.ready;
    const settled = vi.fn();
    client.runOnServer(
      "import-1",
      async () => {
        const changeSet = server.act("alex", assign("import-1", "food", 700));
        return { revision: server.revision, changeSet, rebased: false };
      },
      { summary: "Imported", onSettled: settled },
    );
    await published();
    expect(store.getSnapshot().pending).toEqual([
      { operationId: "import-1", summary: "Imported", previewed: false },
    ]);
    expect(assigned(store, "food")).toBe(0);
    await client.idle();
    expect(settled).toHaveBeenCalledWith({ ok: true, revision: 1 });
    expect(assigned(store, "food")).toBe(700);
  });

  test("asks for a reload when the server needs a newer app", async () => {
    const { client, store, server } = setup({ build: "old" });
    server.requiredBuild = "new";
    await client.ready;
    expect(store.getSnapshot()).toMatchObject({
      status: "loading",
      staleClient: true,
    });
  });
});

describe("Outbox retries", () => {
  test("retries with the same operation id and says saving is paused after three failures", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout"],
      now: new Date("2026-10-20T19:00:00Z"),
    });
    const { client, store, server, connection } = setup();
    await vi.advanceTimersByTimeAsync(0);
    await client.ready;
    const sends = vi.spyOn(connection, "execute");
    for (let attempt = 0; attempt < 3; attempt++)
      connection.failNext("execute");
    client.run(assign("a1", "food", 10_000), { summary: "Assigned" });
    await vi.advanceTimersByTimeAsync(0);
    expect(sends).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sends).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().savingPaused).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sends).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().savingPaused).toBe(true);
    // Still shown while it waits.
    expect(assigned(store, "food")).toBe(10_000);

    client.retrySaving();
    await vi.advanceTimersByTimeAsync(0);
    expect(sends).toHaveBeenCalledTimes(4);
    expect(
      new Set(sends.mock.calls.map(([input]) => input.command.id)),
    ).toEqual(new Set(["a1"]));
    expect(store.getSnapshot()).toMatchObject({
      savingPaused: false,
      revision: 1,
      pending: [],
    });
    expect(server.operations.size).toBe(1);
  });

  test("a command applied before its answer was lost is confirmed by the next pull", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout"],
      now: new Date("2026-10-20T19:00:00Z"),
    });
    const { client, store, server, connection } = setup();
    await vi.advanceTimersByTimeAsync(0);
    await client.ready;
    const settled = vi.fn();
    connection.failNext("execute", true);
    client.run(assign("a1", "food", 10_000), {
      summary: "Assigned",
      onSettled: settled,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(server.operations.has("a1")).toBe(true);
    expect(store.getSnapshot().pending).toHaveLength(1);

    // The tab regains focus before the retry.
    client.signal.emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledExactlyOnceWith({ ok: true, revision: 1 });
    expect(store.getSnapshot()).toMatchObject({ revision: 1, pending: [] });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.executed).toHaveLength(1);
    expect(assigned(store, "food")).toBe(10_000);
  });

  test("a failed refresh is retried and reported after three failures", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout"],
      now: new Date("2026-10-20T19:00:00Z"),
    });
    const { client, store, server, connection } = setup();
    await vi.advanceTimersByTimeAsync(0);
    await client.ready;
    server.act("alex", assign("other", "rent", 1_000));
    for (let attempt = 0; attempt < 3; attempt++) connection.failNext("pull");
    client.signal.emit();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(store.getSnapshot().refreshFailed).toBe(true);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(store.getSnapshot()).toMatchObject({
      refreshFailed: false,
      revision: 1,
    });
  });
});

describe("Sync that can't go on", () => {
  const timers = () =>
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout"],
      now: new Date("2026-10-20T19:00:00Z"),
    });

  test("a command the server can never accept is dropped and rolled back, not retried", async () => {
    timers();
    const { client, store, server, connection, notices } = setup();
    await vi.advanceTimersByTimeAsync(0);
    await client.ready;
    const settled = vi.fn();
    connection.failNext(
      "execute",
      false,
      new SyncError("rejected", "Caishen couldn’t read this change."),
    );
    client.run(assign("a1", "food", 10_000), {
      summary: "Assigned",
      onSettled: settled,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      kind: "rejected",
      message: "Caishen couldn’t read this change.",
    });
    expect(notices).toMatchObject([
      { kind: "refused", operationId: "a1", reason: "rejected" },
    ]);
    expect(server.executed).toEqual([]);
    expect(store.getSnapshot()).toMatchObject({
      pending: [],
      undo: null,
      savingPaused: false,
    });
    expect(assigned(store, "food")).toBe(0);
  });

  test("signing out stops saving and refreshing, and keeps unsaved changes on screen", async () => {
    timers();
    const { client, store, server, connection } = setup();
    await vi.advanceTimersByTimeAsync(0);
    await client.ready;
    const sends = vi.spyOn(connection, "execute");
    const pulls = vi.spyOn(connection, "pull");
    connection.failNext(
      "execute",
      false,
      new SyncError("signedOut", "Sign in to keep saving your changes."),
    );
    client.run(assign("a1", "food", 10_000), { summary: "Assigned" });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).toMatchObject({
      signedOut: true,
      savingPaused: false,
      pending: [{ operationId: "a1" }],
    });
    expect(assigned(store, "food")).toBe(10_000);

    // Nothing more goes out: not on a timer, a hint, or Try again.
    server.act("jordan", assign("j1", "rent", 1_000));
    client.signal.emit({ revision: 1 });
    client.retrySaving();
    await client.refresh();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(pulls).not.toHaveBeenCalled();
    expect(server.executed).toEqual([]);
  });

  test("a refresh that finds the user signed out stops syncing", async () => {
    timers();
    const { client, store, connection } = setup();
    await vi.advanceTimersByTimeAsync(0);
    await client.ready;
    const pulls = vi.spyOn(connection, "pull");
    connection.failNext(
      "pull",
      false,
      new SyncError("signedOut", "Sign in to keep saving your changes."),
    );
    client.signal.emit();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(pulls).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      signedOut: true,
      refreshFailed: false,
    });
  });

  test("someone without a budget isn't polled, and their budget shows once they make one", async () => {
    timers();
    const { client, store, server } = setup();
    server.withoutBudget.add("alex");
    await vi.advanceTimersByTimeAsync(0);
    await client.ready;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(server.pulls).toHaveLength(1);
    expect(store.getSnapshot()).toMatchObject({
      status: "empty",
      refreshFailed: false,
    });
    expect(
      client.run(assign("a1", "food", 100), { summary: "Assigned" }),
    ).toEqual({
      ok: false,
      message: expect.any(String) as string,
    });

    // They create a budget elsewhere and come back to the tab.
    server.withoutBudget.delete("alex");
    client.signal.emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.pulls).toHaveLength(2);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", revision: 0 });
    expect(store.month(month)).toEqual(serverMonth(server));
  });
});

describe("Undo and redo", () => {
  test("undo and redo are reverts the server confirms", async () => {
    const { client, store, server } = setup();
    await client.ready;
    client.run(assign("a1", "food", 10_000), { summary: "Assigned to Food" });
    await client.idle();
    expect(store.getSnapshot().undo).toEqual({
      operationId: "a1",
      label: "Assigned to Food",
    });

    expect(client.undo()).toEqual({ ok: true, operationId: "undo-1" });
    await published();
    expect(assigned(store, "food")).toBe(0);
    expect(store.getSnapshot()).toMatchObject({
      undo: null,
      redo: { operationId: "undo-1", label: "Assigned to Food" },
    });
    await client.idle();
    expect(store.month(month)).toEqual(serverMonth(server));

    expect(client.redo()).toEqual({ ok: true, operationId: "undo-2" });
    await client.idle();
    expect(assigned(store, "food")).toBe(10_000);
    expect(store.month(month)).toEqual(serverMonth(server));
    expect(store.getSnapshot()).toMatchObject({
      undo: { operationId: "undo-2" },
      redo: null,
    });
    // A new command clears what could be redone.
    client.undo();
    client.run(assign("a2", "rent", 1), { summary: "Assigned" });
    await published();
    expect(store.getSnapshot().redo).toBeNull();
  });

  test("undoing a command the server hasn't confirmed queues behind it", async () => {
    const { client, store, server, connection } = setup();
    await client.ready;
    connection.holding = true;
    client.run(assign("a1", "food", 10_000), { summary: "Assigned" });
    client.undo();
    await published();
    expect(assigned(store, "food")).toBe(0);
    expect(store.getSnapshot().pending.map((op) => op.operationId)).toEqual([
      "a1",
      "undo-1",
    ]);
    connection.holding = false;
    connection.releaseAll();
    await client.idle();
    expect(server.executed.map((item) => item.input.command.id)).toEqual([
      "a1",
      "undo-1",
    ]);
    expect(store.getSnapshot()).toMatchObject({ revision: 2, pending: [] });
    expect(assigned(store, "food")).toBe(0);
    expect(store.month(month)).toEqual(serverMonth(server));
  });

  test("an entry goes when another tab changes what it would restore", async () => {
    const { client, store, server, notices } = setup();
    await client.ready;
    client.run(assign("a1", "food", 10_000), { summary: "Assigned" });
    await client.idle();
    server.act("alex", assign("other-tab", "food", 500));
    client.signal.emit();
    await client.idle();
    expect(store.getSnapshot().undo).toBeNull();
    expect(notices).toEqual([{ kind: "historyExpired", operationId: "a1" }]);
    expect(client.undo()).toBeNull();
  });

  test("an undo the server refuses is rolled back and the change that blocked it shown", async () => {
    const { client, store, server, notices } = setup();
    await client.ready;
    client.run(assign("a1", "food", 10_000), { summary: "Assigned" });
    await client.idle();
    server.act("alex", assign("other-tab", "food", 500));
    client.undo();
    await client.idle();
    expect(notices).toMatchObject([
      { kind: "refused", operationId: "undo-1", reason: "revertRefused" },
    ]);
    expect(assigned(store, "food")).toBe(10_500);
    expect(store.getSnapshot()).toMatchObject({
      revision: 2,
      pending: [],
      undo: null,
      redo: null,
    });
  });
});

test("a ledger the browser computes equals the one built from the rows it changed", () => {
  // The store keeps its own result when the server's change set matches, so
  // the two must project the same for every command it can preview.
  let checked = 0;
  for (const step of buildCommandCorpus().steps) {
    const rows = toRowSet(
      bookToRows(step.before).filter((row) => rowVisibleTo(row, step.actorId)),
    );
    const ledger = rowsToPersonalLedger(rowsIn(rows), step.actorId);
    let result;
    try {
      result = executeWithChanges(ledger, step.actorId, step.command);
    } catch {
      continue;
    }
    result.book.audit = [];
    const rebuilt = rowsToPersonalLedger(
      rowsIn(applyChangeSet(rows, result.changeSet)),
      step.actorId,
    );
    for (const shown of ["2026-01", "2026-02", "2026-03"])
      expect(
        sameJson(
          projectBook(result.book, step.actorId, shown, "2026-03"),
          projectBook(rebuilt, step.actorId, shown, "2026-03"),
        ),
        `${step.command.type} (${step.command.id}) in ${shown}`,
      ).toBe(true);
    checked++;
  }
  expect(checked).toBeGreaterThan(50);
});
