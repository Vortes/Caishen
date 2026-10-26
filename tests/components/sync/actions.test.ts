import { expect, test } from "vitest";
import { createBudgetClient } from "~/components/sync/budget-client";
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
    for (let repeat = 0; repeat < 2; repeat++) {
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
  } finally {
    client.dispose();
  }
});
