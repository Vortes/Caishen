import { expect, test } from "vitest";
import { createBudgetClient } from "~/components/sync/budget-client";
import { rejectImportChange } from "~/domain/bank-import-rejection";
import { SyncError } from "~/components/sync/transport";
import { FakeConnection, FakeServer, household } from "./fake-server";

test("one action can be undone and redone repeatedly before its saves answer", async () => {
  const server = new FakeServer(household());
  const connection = new FakeConnection(server, "alex");
  let sequence = 0;
  const client = createBudgetClient({
    userId: "alex",
    clientBuild: "test",
    transport: connection,
    newId: () => `travel-${++sequence}`,
  });
  try {
    await client.ready;
    connection.holding = true;
    for (const [id, amount] of [
      ["first", 1000],
      ["second", 2000],
    ] as const)
      client.run(
        { type: "assign", id, categoryId: "food", month: "2026-10", amount },
        { summary: "Assigned to Food", action: "selection" },
      );
    const assigned = () =>
      client.store
        .month("2026-10")!
        .categories.find((item) => item.id === "food")!.assigned;
    await Promise.resolve();
    expect(assigned()).toBe(3000);
    for (let repeat = 0; repeat < 3; repeat++) {
      expect(client.undo()?.ok).toBe(true);
      await Promise.resolve();
      expect(assigned()).toBe(0);
      expect(client.redo()?.ok).toBe(true);
      await Promise.resolve();
      expect(assigned()).toBe(3000);
    }
    connection.holding = false;
    connection.releaseAll();
    await client.idle();
    expect(assigned()).toBe(3000);
    const reloaded = createBudgetClient({
      userId: "alex",
      clientBuild: "test",
      transport: new FakeConnection(server, "alex"),
    });
    try {
      await reloaded.ready;
      expect(
        reloaded.store
          .month("2026-10")!
          .categories.find((item) => item.id === "food")!.assigned,
      ).toBe(3000);
    } finally {
      reloaded.dispose();
    }
  } finally {
    client.dispose();
  }
});

test("a lost rejection response retries once, and a refused batch member leaves the others undoable", async () => {
  const server = new FakeServer(household());
  server.seedImports(
    "alex",
    ["coffee", "lunch"].map((logicalId) => ({
      connectionId: "bank",
      logicalId,
    })),
  );
  const client = createBudgetClient({
    userId: "alex",
    clientBuild: "test",
    transport: new FakeConnection(server, "alex"),
  });
  let attempts = 0;
  try {
    await client.ready;
    for (const logicalId of ["coffee", "lunch"]) {
      const input = {
        connectionId: "bank",
        logicalId,
        operationId: `reject-${logicalId}`,
        expectedFingerprint: "a".repeat(64),
        decidedAt: "2026-10-20T12:00:00.000Z",
      };
      expect(
        client.runChange(
          (rows) => ({
            ...rejectImportChange(
              rows,
              "alex",
              "bank",
              logicalId,
              input.expectedFingerprint,
              input.decidedAt,
            ),
            operationId: input.operationId,
          }),
          {
            summary: "Rejected 2 transactions",
            action: "batch",
            send: async () => {
              if (logicalId === "lunch")
                throw new SyncError("conflict", "Lunch changed at the bank.");
              const result = server.rejectImport("alex", input);
              if (++attempts === 1)
                throw new TypeError("Response lost after saving");
              return result;
            },
          },
        ).ok,
      ).toBe(true);
    }
    client.undo();
    client.redo();
    await Promise.resolve();
    expect(
      client.store.getSnapshot().importState("bank", "coffee")
        ?.resolvedFingerprint,
    ).toBe("a".repeat(64));
    await client.idle();
    expect(attempts).toBe(2);
    expect(
      client.store.getSnapshot().importState("bank", "coffee")
        ?.resolvedFingerprint,
    ).toBe("a".repeat(64));
    expect(
      client.store.getSnapshot().importState("bank", "lunch")
        ?.resolvedFingerprint,
    ).toBeNull();
    expect(client.store.getSnapshot().undo?.actionId).toBe("batch");
    expect(client.undo()?.ok).toBe(true);
    await client.idle();
    expect(
      client.store.getSnapshot().importState("bank", "coffee")
        ?.resolvedFingerprint,
    ).toBeNull();
    expect(
      client.store.getSnapshot().importState("bank", "lunch")
        ?.resolvedFingerprint,
    ).toBeNull();
    const reloaded = createBudgetClient({
      userId: "alex",
      clientBuild: "test",
      transport: new FakeConnection(server, "alex"),
    });
    try {
      await reloaded.ready;
      expect(
        reloaded.store.getSnapshot().importState("bank", "coffee")
          ?.resolvedFingerprint,
      ).toBeNull();
      expect(
        reloaded.store.getSnapshot().importState("bank", "lunch")
          ?.resolvedFingerprint,
      ).toBeNull();
    } finally {
      reloaded.dispose();
    }
  } finally {
    client.dispose();
  }
});
