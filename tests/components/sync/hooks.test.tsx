import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { createBudgetClient } from "~/components/sync/budget-client";
import {
  BudgetClientProvider,
  useBudgetMonth,
  useBudgetSelector,
  useCommand,
} from "~/components/sync/hooks";
import type { BudgetSnapshot } from "~/components/sync/budget-store";
import { FakeConnection, FakeServer, household } from "./fake-server";

const pendingCount = (snapshot: BudgetSnapshot) => snapshot.pending.length;

test("components re-render once per change and share one projection per month", async () => {
  const server = new FakeServer(household());
  const connection = new FakeConnection(server, "alex");
  const client = createBudgetClient({
    userId: "alex",
    transport: connection,
    clientBuild: "test",
  });
  await client.ready;
  const renders: string[] = [];
  const projections = new Set<unknown>();
  function Food({ month }: { month: string }) {
    const view = useBudgetMonth(month);
    const pending = useBudgetSelector(pendingCount);
    const { run } = useCommand();
    projections.add(view);
    const food = view?.categories.find((item) => item.id === "food");
    renders.push(month);
    return (
      <button
        onClick={() => {
          run(
            {
              type: "assign",
              id: "a1",
              categoryId: "food",
              month,
              amount: 4_200,
            },
            { summary: "Assigned" },
          );
          run(
            {
              type: "assign",
              id: "a2",
              categoryId: "food",
              month,
              amount: 100,
            },
            { summary: "Assigned" },
          );
        }}
      >
        {food?.assigned} {pending}
      </button>
    );
  }
  connection.holding = true;
  render(
    <BudgetClientProvider client={client}>
      <Food month="2026-10" />
      <Food month="2026-10" />
    </BudgetClientProvider>,
  );
  expect(projections.size).toBe(1);
  renders.length = 0;
  projections.clear();

  await act(async () => screen.getAllByRole("button")[0]!.click());
  // Two commands, one publish, one render each, one projection between them.
  expect(renders).toEqual(["2026-10", "2026-10"]);
  expect(projections.size).toBe(1);
  expect(screen.getAllByRole("button")[0]!.textContent).toBe("4300 2");

  connection.holding = false;
  await act(async () => {
    connection.releaseAll();
    await client.idle();
  });
  expect(screen.getAllByRole("button")[0]!.textContent).toBe("4300 0");
  client.dispose();
});
