import assert from "node:assert/strict";
import test from "node:test";
import {
  QueryClient,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import type { State } from "../../src/components/budget/types";
import {
  previewBudgetCommand,
  rollbackBudgetCommand,
} from "../../src/components/workspace/optimistic-cache";
import { createBook, execute, projectBook } from "../../src/domain/engine";

const queryKey = [["budget", "state"]] as const;
const monthKey = (month: string) => [
  ...queryKey,
  { input: { month }, type: "query" },
];

function observe(client: QueryClient, key: QueryKey) {
  const observer = new QueryObserver<State>(client, {
    queryKey: key,
    staleTime: Infinity,
  });
  return observer.subscribe(() => undefined);
}

function fixture(month = "2026-10", revision = 3): State {
  let book = createBook("owner", "Personal", "2026-10");
  book = execute(book, "owner", {
    type: "account.add",
    id: "account",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
    date: "2026-10-01",
  });
  book = execute(book, "owner", {
    type: "category.add",
    id: "category",
    categoryId: "groceries",
    name: "Groceries",
  });
  return {
    view: projectBook(book, "owner", month),
    revision,
    history: { undo: "Add category", redo: null },
    services: [],
    connections: [],
    imports: [],
    evidence: [],
  };
}

const assignment = {
  type: "assign" as const,
  id: "assign-groceries",
  categoryId: "groceries",
  month: "2026-10",
  amount: 5000,
};

void test("previews active month views without recalculating inactive or stale cached months", async () => {
  const client = new QueryClient();
  const october = monthKey("2026-10");
  const november = monthKey("2026-11");
  const oldMonth = monthKey("2026-12");
  const unrelated = ["other"];
  client.setQueryData(october, fixture(), { updatedAt: 123 });
  client.setQueryData(november, fixture("2026-11"));
  client.setQueryData(oldMonth, fixture("2026-12", 1));
  client.setQueryData(unrelated, { untouched: true });
  const before = client.getQueryData<State>(october)!;
  const previousNovember = client.getQueryData(november);
  const oldData = client.getQueryData(oldMonth);
  const unrelatedData = client.getQueryData(unrelated);
  const unsubscribe = observe(client, october);
  const unsubscribeOld = observe(client, oldMonth);

  const snapshots = await previewBudgetCommand(client, queryKey, assignment, 3);
  const preview = client.getQueryData<State>(october)!;
  assert.equal(snapshots.length, 1);
  assert.equal(preview.view!.categories[0]!.assigned, 5000);
  assert.equal(preview.view!.readyToAssign, 95_000);
  assert.strictEqual(client.getQueryData(november), previousNovember);
  assert.equal(preview.revision, 3);
  assert.strictEqual(preview.history, before.history);
  assert.strictEqual(preview.view!.accounts, before.view!.accounts);
  assert.strictEqual(
    preview.view!.budget.transactions,
    before.view!.budget.transactions,
  );
  assert.strictEqual(client.getQueryData(oldMonth), oldData);
  assert.strictEqual(client.getQueryData(unrelated), unrelatedData);

  rollbackBudgetCommand(client, snapshots);
  assert.deepEqual(client.getQueryData(october), before);
  assert.deepEqual(client.getQueryData(november), previousNovember);
  assert.equal(client.getQueryState(october)!.dataUpdatedAt, 123);
  unsubscribe();
  unsubscribeOld();
  client.clear();
});

void test("rollback never overwrites a newer server response or recreates cleared queries", async () => {
  const client = new QueryClient();
  const key = monthKey("2026-10");
  client.setQueryData(key, fixture());
  const unsubscribe = observe(client, key);
  const snapshots = await previewBudgetCommand(client, queryKey, assignment, 3);
  const confirmed = { ...fixture(), revision: 4 };
  client.setQueryData(key, confirmed);
  const authoritative = client.getQueryData(key);
  rollbackBudgetCommand(client, snapshots);
  assert.strictEqual(client.getQueryData(key), authoritative);

  unsubscribe();
  client.clear();
  rollbackBudgetCommand(client, snapshots);
  assert.equal(client.getQueryData(key), undefined);
});

void test("cancels an in-flight read so its old response cannot erase the preview", async () => {
  const client = new QueryClient();
  const key = monthKey("2026-10");
  const before = fixture();
  client.setQueryData(key, before);
  const unsubscribe = observe(client, key);
  let release!: (value: State) => void;
  let aborted = false;
  const fetch = client
    .fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise<State>((resolve) => {
          release = resolve;
        });
      },
    })
    .catch(() => undefined);

  const snapshots = await previewBudgetCommand(client, queryKey, assignment, 3);
  assert.equal(aborted, true);
  release(before);
  await fetch;
  assert.equal(client.getQueryData<State>(key)!.view!.readyToAssign, 95_000);
  rollbackBudgetCommand(client, snapshots);
  assert.equal(client.getQueryData<State>(key)!.view!.readyToAssign, 100_000);
  unsubscribe();
  client.clear();
});

void test("unsupported previews leave the cache untouched and do not create empty entries", async () => {
  const client = new QueryClient();
  assert.deepEqual(
    await previewBudgetCommand(client, queryKey, assignment, 3),
    [],
  );
  const key = monthKey("2026-10");
  client.setQueryData(key, fixture());
  const unsubscribe = observe(client, key);
  const before = client.getQueryData(key);
  const snapshots = await previewBudgetCommand(
    client,
    queryKey,
    { ...assignment, amount: 200_000 },
    3,
  );
  assert.deepEqual(snapshots, []);
  assert.strictEqual(client.getQueryData(key), before);
  rollbackBudgetCommand(client, undefined);
  unsubscribe();
  client.clear();
});
