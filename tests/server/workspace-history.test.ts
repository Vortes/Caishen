import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  addMember,
  createBook,
  execute,
  parseBook,
  projectBook,
  type Command,
} from "../../src/domain/engine";
import {
  Prisma,
  type BudgetOperation,
  type Workspace,
} from "../../src/generated/prisma";
import {
  commandHash,
  jsonValue,
  operationHash,
} from "../../src/server/services/safety";
import {
  changeWorkspaceHistory,
  mutateWorkspace,
  type Database,
} from "../../src/server/services/workspace";
import {
  historySummary,
  recordWorkspaceHistory,
  restoreWorkspaceHistory,
} from "../../src/server/services/workspace-history";

const now = new Date("2026-10-19T12:00:00Z");
type SavedOperation = Omit<BudgetOperation, "id" | "createdAt">;

function fixture() {
  let book = addMember(
    createBook("alice", "Alice", "2026-10"),
    "bob",
    "Bob",
    "2026-10",
  );
  book = execute(book, "alice", {
    id: "initial-account",
    type: "account.add",
    accountId: "cash",
    kind: "cash",
    name: "Checking",
    openingBalance: 10000,
    date: "2026-10-19",
  });
  return execute(book, "alice", {
    id: "initial-category",
    type: "category.add",
    categoryId: "groceries",
    name: "Groceries",
  });
}

function harness() {
  let workspace: Workspace = {
    id: "workspace",
    revision: 0,
    book: jsonValue(fixture()) as Prisma.JsonValue,
    history: {},
    createdAt: now,
    updatedAt: now,
  };
  let operations: SavedOperation[] = [];
  const failures = {
    compareAndSwap: false,
    operationWrite: false,
    serialization: 0,
  };
  let attempts = 0;
  const raw = {
    async $transaction<T>(
      run: (tx: Database) => Promise<T>,
      options: { isolationLevel: string },
    ) {
      attempts++;
      assert.equal(
        options.isolationLevel,
        Prisma.TransactionIsolationLevel.Serializable,
      );
      if (failures.serialization > 0) {
        failures.serialization--;
        throw new Prisma.PrismaClientKnownRequestError(
          "Serialization failure",
          {
            code: "P2034",
            clientVersion: "test",
          },
        );
      }
      const draft = structuredClone(workspace);
      const saved = structuredClone(operations);
      const tx = {
        workspaceMember: {
          async findUnique(args: { where: { clerkUserId: string } }) {
            return ["alice", "bob"].includes(args.where.clerkUserId)
              ? { workspace: draft }
              : null;
          },
        },
        budgetOperation: {
          async findMany(args: { where: { operationId: { in: string[] } } }) {
            return saved.filter((row) =>
              args.where.operationId.in.includes(row.operationId),
            );
          },
          async createMany(args: { data: SavedOperation[] }) {
            if (failures.operationWrite)
              throw new Error("Operation write failed");
            saved.push(...args.data);
          },
        },
        workspace: {
          async updateMany(args: {
            where: { id: string; revision: number };
            data: {
              book: Prisma.JsonValue;
              history: Prisma.JsonValue;
              revision: { increment: number };
            };
          }) {
            if (
              failures.compareAndSwap ||
              args.where.revision !== draft.revision
            )
              return { count: 0 };
            draft.book = args.data.book;
            draft.history = args.data.history;
            draft.revision += args.data.revision.increment;
            return { count: 1 };
          },
        },
      };
      const result = await run(tx as unknown as Database);
      workspace = draft;
      operations = saved;
      return result;
    },
  };
  return {
    db: raw as unknown as Database,
    failures,
    get workspace() {
      return workspace;
    },
    get operations() {
      return operations;
    },
    get attempts() {
      return attempts;
    },
    get book() {
      return parseBook(workspace.book);
    },
    summary(actorId = "alice") {
      return historySummary(workspace.history, actorId, workspace.revision);
    },
    save(command: Command, actorId = "alice", revision = workspace.revision) {
      return mutateWorkspace(
        raw as unknown as Database,
        actorId,
        revision,
        [command],
        "user",
        (state, fresh) =>
          fresh.reduce(
            (book, operation) => execute(book, actorId, operation),
            state,
          ),
      );
    },
    history(
      direction: "undo" | "redo",
      operationId: string,
      actorId = "alice",
      expectedRevision = workspace.revision,
    ) {
      return changeWorkspaceHistory(raw as unknown as Database, actorId, {
        direction,
        operationId,
        expectedRevision,
      });
    },
  };
}

const rename = (id: string, name: string): Command => ({
  type: "settings.update",
  id,
  name,
});
const errorCode = (code: TRPCError["code"]) => (error: unknown) =>
  error instanceof TRPCError && error.code === code;

void test("undo and redo restore accounting state while preserving audit and the other member's budget", async () => {
  const h = harness();
  const partner = h.book.budgets.bob;
  const command: Command = {
    id: "assign",
    type: "assign",
    categoryId: "groceries",
    month: "2026-10",
    amount: 2500,
  };
  await h.save(command);
  const after = h.book;
  assert.equal(projectBook(after, "alice", "2026-10").readyToAssign, 7500);
  assert.deepEqual(h.summary(), { undo: "Assign money", redo: null });
  await h.history("undo", "undo-assign");
  assert.equal(projectBook(h.book, "alice", "2026-10").readyToAssign, 10000);
  assert.deepEqual(h.book.audit.slice(0, -1), after.audit);
  assert.equal(h.book.audit.at(-1)!.type, "history.undo");
  assert.deepEqual(h.book.budgets.bob, partner);
  assert.deepEqual(h.summary(), { undo: null, redo: "Assign money" });
  await h.history("redo", "redo-assign");
  assert.deepEqual(h.book, { ...after, audit: h.book.audit });
  assert.equal(h.book.audit.at(-1)!.type, "history.redo");
  assert.equal(h.operations.at(-1)!.type, "history.redo");
});

void test("retries of original actions and history requests remain idempotent after undo", async () => {
  const h = harness();
  const command = rename("rename", "New name");
  await h.save(command);
  await h.history("undo", "undo");
  const undone = structuredClone(h.workspace);
  assert.deepEqual(await h.save(command, "alice", 0), { revision: 2 });
  assert.deepEqual(await h.history("undo", "undo", "alice", 1), {
    revision: 2,
  });
  assert.deepEqual(h.workspace, undone);
  await h.history("redo", "redo");
  assert.deepEqual(await h.history("redo", "redo", "alice", 2), {
    revision: 3,
  });
  assert.equal(h.book.budgets.alice!.name, "New name");
  assert.equal(h.operations.length, 3);
});

void test("a new edit after undo discards redo while no-op edits preserve the branch", async () => {
  const h = harness();
  await h.save(rename("first", "First"));
  await h.save(rename("second", "Second"));
  await h.history("undo", "undo-second");
  await h.save(rename("noop", "First"));
  assert.equal(h.summary().redo, "Update budget settings");
  await h.save(rename("third", "Third"));
  assert.equal(h.summary().redo, null);
  await assert.rejects(h.history("redo", "no-redo"), /nothing to redo/);
  await h.history("undo", "undo-third");
  assert.equal(h.book.budgets.alice!.name, "First");
  await h.history("undo", "undo-first");
  assert.equal(h.book.budgets.alice!.name, "Alice");
});

void test("a grouped mutation has one labeled undo entry", async () => {
  const h = harness();
  const commands: Command[] = [
    rename("rename", "Renamed"),
    { type: "income.expect", id: "income", month: "2026-10", amount: 2000 },
  ];
  await mutateWorkspace(
    h.db,
    "alice",
    0,
    commands,
    "user",
    (state, fresh) =>
      fresh.reduce(
        (book, operation) => execute(book, "alice", operation),
        state,
      ),
    { label: "Update budget plan" },
  );
  assert.equal(h.summary().undo, "Update budget plan");
  await h.history("undo", "undo-group");
  assert.equal(h.book.budgets.alice!.name, "Alice");
  assert.deepEqual(h.book.budgets.alice!.expectedIncome, {});
  assert.equal(h.summary().undo, null);
});

void test("only the author can consume history and a partner's edit begins a new chain", async () => {
  const h = harness();
  await h.save(rename("alice-rename", "Alice renamed"));
  assert.deepEqual(h.summary("bob"), { undo: null, redo: null });
  await assert.rejects(h.history("undo", "bob-undo", "bob"), /nothing to undo/);
  await h.save(rename("bob-rename", "Bob renamed"), "bob");
  assert.deepEqual(h.summary(), { undo: null, redo: null });
  await h.history("undo", "bob-undo-own", "bob");
  assert.equal(h.book.budgets.bob!.name, "Bob");
  assert.equal(h.book.budgets.alice!.name, "Alice renamed");
});

void test("an external workspace revision invalidates history before the next user action", async () => {
  const h = harness();
  await h.save(rename("first", "First"));
  h.workspace.revision++;
  assert.deepEqual(h.summary(), { undo: null, redo: null });
  await assert.rejects(h.history("undo", "stale-undo"), /nothing to undo/);
  await h.save(rename("second", "Second"));
  await h.history("undo", "undo-second");
  assert.equal(h.book.budgets.alice!.name, "First");
  assert.equal(h.summary().undo, null);
});

void test("non-user mutations create a history barrier", async () => {
  const h = harness();
  await h.save(rename("first", "First"));
  await mutateWorkspace(
    h.db,
    "alice",
    1,
    [{ id: "sync", type: "provider.sync" }],
    "provider",
    (value) => value,
  );
  assert.deepEqual(h.summary(), { undo: null, redo: null });
});

void test("history requests require membership, current revision, and unused operation details", async () => {
  const h = harness();
  await h.save(rename("rename", "Renamed"));
  await assert.rejects(
    h.history("undo", "unauthorized", "outsider"),
    errorCode("NOT_FOUND"),
  );
  await assert.rejects(
    h.history("undo", "stale", "alice", 0),
    errorCode("CONFLICT"),
  );
  await assert.rejects(h.history("undo", "rename"), errorCode("CONFLICT"));
  await h.history("undo", "undo");
  await assert.rejects(h.history("redo", "undo"), errorCode("CONFLICT"));
  await assert.rejects(h.history("undo", "undo", "bob"), errorCode("CONFLICT"));
});

void test("failed validation, compare-and-swap and operation persistence leave state and stacks unchanged", async () => {
  const h = harness();
  await h.save(rename("rename", "Renamed"));
  const before = structuredClone(h.workspace);
  const saved = structuredClone(h.operations);
  await assert.rejects(
    h.save({
      type: "assign",
      id: "invalid",
      categoryId: "missing",
      month: "2026-10",
      amount: 100,
    }),
    errorCode("BAD_REQUEST"),
  );
  h.failures.compareAndSwap = true;
  await assert.rejects(h.history("undo", "cas"), errorCode("CONFLICT"));
  h.failures.compareAndSwap = false;
  h.failures.operationWrite = true;
  await assert.rejects(h.history("undo", "write"), /Operation write failed/);
  assert.deepEqual(h.workspace, before);
  assert.deepEqual(h.operations, saved);
});

void test("serialization failures retry at most three times", async () => {
  const h = harness();
  await h.save(rename("rename", "Renamed"));
  h.failures.serialization = 2;
  await h.history("undo", "undo");
  assert.equal(h.attempts, 4);
  assert.equal(h.workspace.revision, 2);
  h.failures.serialization = 3;
  await assert.rejects(h.history("redo", "redo"), errorCode("CONFLICT"));
  assert.equal(h.attempts, 7);
  assert.equal(h.workspace.revision, 2);
  assert.equal(h.summary().redo, "Update budget settings");
});

void test("history retains the latest 50 entries and excludes audit records and unchanged book data", () => {
  let book = fixture();
  let history: unknown = {};
  for (let revision = 0; revision < 55; revision++) {
    const next = execute(
      book,
      "alice",
      rename(`name-${revision}`, `Name ${revision}`),
    );
    history = recordWorkspaceHistory(
      history,
      "alice",
      revision,
      book,
      next,
      `Edit ${revision}`,
    );
    book = next;
  }
  for (let index = 0; index < 50; index++) {
    const restored = restoreWorkspaceHistory(
      history,
      "alice",
      55 + index,
      book,
      "undo",
      `undo-${index}`,
    );
    history = restored.history;
    book = restored.book;
  }
  assert.equal(book.budgets.alice!.name, "Name 4");
  assert.equal(historySummary(history, "alice", 105).undo, null);
  const serialized = JSON.stringify(history);
  assert.ok(!serialized.includes("/audit"));
  assert.ok(!serialized.includes("/accounts"));
  assert.ok(!serialized.includes("/budgets/bob"));
});

void test("oversized edits create a barrier instead of persisting unbounded history", () => {
  const book = fixture();
  const next = structuredClone(book);
  next.budgets.alice!.name = "x".repeat(2 * 1024 * 1024);
  const history = recordWorkspaceHistory(
    {},
    "alice",
    0,
    book,
    next,
    "Large import",
  );
  assert.deepEqual(historySummary(history, "alice", 1), {
    undo: null,
    redo: null,
  });
  assert.ok(JSON.stringify(history).length < 1000);
});

void test("normalization handles optional undefined fields and guarded patches reject changed data", () => {
  const book = fixture();
  book.budgets.alice!.categories[0]!.target = undefined;
  const next = execute(book, "alice", rename("name", "Changed"));
  const history = recordWorkspaceHistory({}, "alice", 0, book, next, "Rename");
  const restored = restoreWorkspaceHistory(
    history,
    "alice",
    1,
    next,
    "undo",
    "undo",
  );
  assert.equal(restored.book.budgets.alice!.name, "Alice");
  next.budgets.alice!.name = "Unexpected change";
  assert.throws(() =>
    restoreWorkspaceHistory(history, "alice", 1, next, "undo", "unexpected"),
  );
  assert.equal(historySummary(history, "alice", 1).undo, "Rename");
});

void test("invalid or outdated stored history yields no available actions", () => {
  for (const history of [
    null,
    {},
    { actorId: "alice", revision: 0, past: [{}], future: [] },
  ])
    assert.deepEqual(historySummary(history, "alice", 0), {
      undo: null,
      redo: null,
    });
  const book = fixture();
  const after = execute(book, "alice", rename("name", "Changed"));
  const history = recordWorkspaceHistory({}, "alice", 0, book, after, "Rename");
  assert.deepEqual(historySummary(history, "alice", 2), {
    undo: null,
    redo: null,
  });
  assert.deepEqual(historySummary(history, "bob", 1), {
    undo: null,
    redo: null,
  });
});

const purchase = (
  id: string,
  transactionId: string,
  amount = -1000,
): Extract<Command, { type: "transaction.upsert" }> => ({
  type: "transaction.upsert",
  id,
  transactionId,
  accountId: "cash",
  categoryId: "groceries",
  date: "2026-10-19",
  amount,
  payee: "Market",
});

void test("undoing transaction creation retains its record and appends history across repeated cycles", async () => {
  const h = harness();
  await h.save(purchase("create", "purchase"));
  const created = h.book.budgets.alice!.transactions[0]!;
  await h.history("undo", "undo-create");
  let transaction = h.book.budgets.alice!.transactions[0]!;
  assert.equal(transaction.removed, true);
  assert.equal(transaction.revision, 2);
  assert.deepEqual(transaction.history[0], created.history[0]);
  assert.deepEqual(
    transaction.history.map((entry) => entry.reason),
    ["created", "undone"],
  );
  assert.equal(
    projectBook(h.book, "alice", "2026-10").accounts[0]!.balance,
    10000,
  );
  await h.history("redo", "redo-create");
  transaction = h.book.budgets.alice!.transactions[0]!;
  assert.ok(!transaction.removed);
  assert.equal(transaction.revision, 3);
  assert.equal(
    projectBook(h.book, "alice", "2026-10").accounts[0]!.balance,
    9000,
  );
  await h.history("undo", "undo-again");
  await h.history("redo", "redo-again");
  transaction = h.book.budgets.alice!.transactions[0]!;
  assert.equal(transaction.revision, 5);
  assert.deepEqual(
    transaction.history.map((entry) => entry.reason),
    ["created", "undone", "redone", "undone", "redone"],
  );
  assert.deepEqual(
    transaction.history.map((entry) => entry.operationId),
    ["create", "undo-create", "redo-create", "undo-again", "redo-again"],
  );
  assert.deepEqual(
    h.book.audit.slice(-4).map((entry) => entry.type),
    ["history.undo", "history.redo", "history.undo", "history.redo"],
  );
});

void test("undoing and redoing transaction edits preserve every recorded amount and monotonic revisions", async () => {
  const h = harness();
  await h.save(purchase("create", "purchase"));
  await h.save(purchase("edit", "purchase", -2000));
  const editedHistory = h.book.budgets.alice!.transactions[0]!.history;
  await h.history("undo", "undo-edit");
  let transaction = h.book.budgets.alice!.transactions[0]!;
  assert.equal(transaction.amount, -1000);
  assert.deepEqual(transaction.history.slice(0, 2), editedHistory);
  assert.equal(transaction.history.at(-1)!.reason, "undone");
  await h.history("redo", "redo-edit");
  transaction = h.book.budgets.alice!.transactions[0]!;
  assert.equal(transaction.amount, -2000);
  assert.deepEqual(
    transaction.history.map((entry) => entry.amount),
    [-1000, -2000, -1000, -2000],
  );
  assert.deepEqual(
    transaction.history.map((entry) => entry.revision),
    [1, 2, 3, 4],
  );
});

void test("undoing deletion restores a transaction without losing its removal history", async () => {
  const h = harness();
  await h.save(purchase("create", "purchase"));
  await h.save({
    type: "transaction.remove",
    id: "remove",
    transactionId: "purchase",
  });
  const removedHistory = h.book.budgets.alice!.transactions[0]!.history;
  await h.history("undo", "undo-remove");
  let transaction = h.book.budgets.alice!.transactions[0]!;
  assert.ok(!transaction.removed);
  assert.deepEqual(transaction.history.slice(0, 2), removedHistory);
  await h.history("redo", "redo-remove");
  transaction = h.book.budgets.alice!.transactions[0]!;
  assert.equal(transaction.removed, true);
  assert.equal(transaction.revision, 4);
  assert.deepEqual(
    transaction.history.map((entry) => entry.reason),
    ["created", "removed", "undone", "redone"],
  );
});

void test("undoing merges retains combined history while reviving and removing the duplicate", async () => {
  const h = harness();
  await h.save(purchase("create-target", "target"));
  await h.save(purchase("create-duplicate", "duplicate"));
  await h.save({
    type: "transaction.merge",
    id: "merge",
    transactionId: "target",
    duplicateId: "duplicate",
  });
  const mergedHistory = h.book.budgets.alice!.transactions.find(
    (transaction) => transaction.id === "target",
  )!.history;
  assert.equal(mergedHistory.at(-1)!.combinedId, "duplicate");
  await h.history("undo", "undo-merge");
  let transactions = h.book.budgets.alice!.transactions;
  assert.equal(
    transactions.filter((transaction) => !transaction.removed).length,
    2,
  );
  assert.deepEqual(
    transactions.find((transaction) => transaction.id === "target")!.history,
    mergedHistory,
  );
  assert.equal(
    transactions
      .find((transaction) => transaction.id === "duplicate")!
      .history.at(-1)!.reason,
    "undone",
  );
  await h.history("redo", "redo-merge");
  transactions = h.book.budgets.alice!.transactions;
  assert.equal(
    transactions.filter((transaction) => !transaction.removed).length,
    1,
  );
  assert.deepEqual(
    transactions.find((transaction) => transaction.id === "target")!.history,
    mergedHistory,
  );
  const duplicate = transactions.find(
    (transaction) => transaction.id === "duplicate",
  )!;
  assert.equal(duplicate.removed, true);
  assert.deepEqual(
    duplicate.history.map((entry) => entry.reason),
    ["created", "undone", "redone"],
  );
});

void test("retained transaction records allow cascading undo and redo of their account and category", async () => {
  const h = harness();
  await h.save({
    type: "account.add",
    id: "add-account",
    accountId: "extra",
    name: "Extra checking",
    kind: "cash",
    openingBalance: 5000,
    date: "2026-10-19",
  });
  await h.save({
    type: "category.add",
    id: "add-category",
    categoryId: "extra-category",
    name: "Extra category",
  });
  await h.save({
    ...purchase("create", "purchase"),
    accountId: "extra",
    categoryId: "extra-category",
  });
  await h.history("undo", "undo-create");
  await h.history("undo", "undo-category");
  await h.history("undo", "undo-account");
  let budget = h.book.budgets.alice!;
  assert.ok(!budget.accounts.some((account) => account.id === "extra"));
  assert.ok(
    !budget.categories.some((category) => category.id === "extra-category"),
  );
  assert.equal(budget.transactions[0]!.removed, true);
  await h.history("redo", "redo-account");
  await h.history("redo", "redo-category");
  await h.history("redo", "redo-create");
  budget = h.book.budgets.alice!;
  assert.ok(budget.accounts.some((account) => account.id === "extra"));
  assert.ok(
    budget.categories.some((category) => category.id === "extra-category"),
  );
  assert.ok(!budget.transactions[0]!.removed);
  assert.equal(budget.transactions[0]!.revision, 3);
  assert.deepEqual(
    budget.transactions[0]!.history.map((entry) => entry.reason),
    ["created", "undone", "redone"],
  );
});

void test("a retry is recognized by its submitted input after a release changes how it validates", async () => {
  const h = harness();
  const submitted = rename("rename-retry", "Renamed");
  const save = (validated: Command, sent: unknown = submitted) =>
    mutateWorkspace(
      h.db,
      "alice",
      0,
      [validated],
      "user",
      (value, fresh) =>
        fresh.reduce(
          (book, operation) => execute(book, "alice", operation, "user", sent),
          parseBook(value),
        ),
      { submitted: [sent] },
    );
  assert.deepEqual(await save(submitted), { revision: 1 });
  // A newer release's validation fills in a default the submission left out.
  const revalidated = { ...submitted, emailEnabled: true } as Command;
  assert.deepEqual(await save(revalidated), { revision: 1 });
  assert.equal(h.operations.length, 1);
  assert.equal(h.operations[0]!.commandHash, operationHash(submitted));
  await assert.rejects(
    save(revalidated, { ...submitted, name: "Other" }),
    errorCode("CONFLICT"),
  );
});

void test("operations saved with a hash of their validated form still recognize retries", async () => {
  const h = harness();
  const command = rename("legacy-retry", "Renamed");
  await h.save(command);
  h.operations[0]!.commandHash = commandHash(command);
  assert.deepEqual(await h.save(command, "alice", 0), { revision: 1 });
  await assert.rejects(
    h.save(rename("legacy-retry", "Other"), "alice", 0),
    errorCode("CONFLICT"),
  );
});
