import assert from "node:assert/strict";
import test from "node:test";

import {
  addMember,
  createBook,
  execute,
  projectBook,
  type Command,
} from "../../src/domain/engine";
import {
  assertTransactionDraftCurrent,
  buildTransactionDraftCommand,
  createTransactionDraft,
  READY_TO_ASSIGN,
  TransactionDraftError,
  type TransactionDraft,
} from "../../src/components/transactions/transaction-draft";

const month = "2026-10";
const date = "2026-10-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

function fixture(shared = false) {
  let book = createBook("alan", "Alan", month);
  let sequence = 0;
  const run = (command: WithoutId<Command>, actor = "alan") => {
    book = execute(book, actor, { ...command, id: `setup-${++sequence}` });
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
    date: `${month}-01`,
  });
  run({ type: "category.add", categoryId: "food", name: "Food" });
  run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  if (shared) {
    book = addMember(book, "partner", "Partner", month);
    run(
      { type: "category.add", categoryId: "partner-food", name: "Food" },
      "partner",
    );
    run({
      type: "shared.create",
      sharedCategoryId: "shared-food",
      name: "Shared food",
      participants: ["alan", "partner"],
      weights: { alan: 1, partner: 3 },
      categoryIds: { alan: "food", partner: "partner-food" },
    });
  }
  const view = () => projectBook(book, "alan", month);
  const draft = (changes: Partial<TransactionDraft> = {}) => ({
    ...createTransactionDraft(view(), month),
    date,
    payee: "Market",
    categoryId: "food",
    outflow: "25.01",
    ...changes,
  });
  const build = (
    value: TransactionDraft,
    transaction?: ReturnType<typeof view>["budget"]["transactions"][number],
  ) =>
    buildTransactionDraftCommand({
      draft: value,
      view: view(),
      transaction,
      operationId: `draft-${++sequence}`,
      entityId: `transaction-${sequence}`,
    });
  const save = (...args: Parameters<typeof build>) => {
    const command = build(...args);
    book = execute(book, "alan", command);
    return view().budget.transactions.find(
      (item) => item.id === command.transactionId,
    )!;
  };
  return {
    view,
    draft,
    build,
    save,
    run,
    get book() {
      return book;
    },
  };
}

void test("inline outflows retain exact cents in account and envelope balances", () => {
  const setup = fixture();
  setup.save(setup.draft());
  assert.equal(setup.view().cash, 97_499);
  assert.equal(setup.view().personalSpending, 2_501);
  assert.equal(
    setup.view().categories.find((item) => item.id === "food")?.available,
    7_499,
  );
  setup.save(setup.draft({ payee: "One cent", outflow: ".01" }));
  assert.equal(setup.view().cash, 97_498);
  assert.equal(setup.view().personalSpending, 2_502);
});

void test("cash income enters Ready to Assign while a categorized inflow refunds spending", () => {
  const setup = fixture();
  const income = setup.save(
    setup.draft({
      payee: "Earnings",
      outflow: "",
      inflow: "10.01",
      categoryId: READY_TO_ASSIGN,
    }),
  );
  assert.equal(income.kind, "income");
  assert.equal(setup.view().readyToAssign, 91_001);
  setup.save(setup.draft({ outflow: "10.00" }));
  const refund = setup.save(
    setup.draft({ payee: "Refund", outflow: "", inflow: "2.50" }),
  );
  assert.equal(refund.kind, "refund");
  assert.equal(setup.view().cash, 100_251);
  assert.equal(setup.view().personalSpending, 750);
  assert.equal(
    setup.view().categories.find((item) => item.id === "food")?.available,
    9_250,
  );
  assert.equal(setup.view().readyToAssign, 91_001);
});

void test("a shared override conserves the charge and creates the matching partner obligation", () => {
  const setup = fixture(true);
  const transaction = setup.save(
    setup.draft({
      outflow: "100.01",
      sharedCategoryId: "shared-food",
      ownShare: "25.00",
    }),
  );
  assert.deepEqual(transaction.shares, { alan: 2_500, partner: 7_501 });
  assert.equal(setup.view().amountPaid, 10_001);
  assert.equal(setup.view().personalSpending, 2_500);
  assert.equal(setup.view().settlement.owedToYou, 7_501);
  assert.throws(
    () =>
      setup.build(
        setup.draft({
          outflow: "10",
          sharedCategoryId: "shared-food",
          ownShare: "10.01",
        }),
      ),
    (error: unknown) =>
      error instanceof TransactionDraftError && Boolean(error.fields.ownShare),
  );
});

void test("editing preserves the original shared ratio and appends one unreviewed revision", () => {
  const setup = fixture(true);
  const original = setup.save(
    setup.draft({ outflow: "100.00", sharedCategoryId: "shared-food" }),
  );
  setup.run({ type: "transaction.approve", transactionIds: [original.id] });
  const current = setup
    .view()
    .budget.transactions.find((item) => item.id === original.id)!;
  const draft = createTransactionDraft(setup.view(), month, current);
  assert.equal(draft.ownShare, "");
  const corrected = setup.save({ ...draft, outflow: "200.00" }, current);
  assert.equal(corrected.id, original.id);
  assert.equal(corrected.revision, 2);
  assert.equal(corrected.reviewed, false);
  assert.equal(corrected.history.length, 2);
  assert.deepEqual(corrected.shares, { alan: 5_000, partner: 15_000 });
  assert.deepEqual(corrected.splitWeights, original.splitWeights);
  assert.equal(setup.view().personalSpending, 5_000);
  assert.equal(setup.view().settlement.owedToYou, 15_000);
});

void test("invalid dual, signed, zero, imprecise, and unsafe amounts never change the ledger", () => {
  const setup = fixture();
  const before = structuredClone(setup.book);
  for (const changes of [
    { inflow: "5.00" },
    { outflow: "-5.00" },
    { outflow: "0.00" },
    { outflow: "1.001" },
    { outflow: "90071992547409.92" },
  ]) {
    assert.throws(
      () => setup.build(setup.draft(changes)),
      TransactionDraftError,
    );
  }
  assert.deepEqual(setup.book, before);
});

void test("calendar and account opening dates are validated without removing future date entry", () => {
  const setup = fixture();
  assert.throws(
    () => setup.build(setup.draft({ date: "2026-02-31" })),
    TransactionDraftError,
  );
  assert.throws(
    () => setup.build(setup.draft({ date: "2026-09-30" })),
    TransactionDraftError,
  );
  setup.run({
    type: "account.add",
    accountId: "new-account",
    name: "New account",
    kind: "cash",
    openingBalance: 0,
    date: "2026-10-15",
  });
  assert.throws(
    () => setup.build(setup.draft({ accountId: "new-account" })),
    TransactionDraftError,
  );
  setup.save(setup.draft({ date: "2026-11-10" }));
  assert.equal(setup.view().cash, 100_000);
  assert.equal(projectBook(setup.book, "alan", "2026-11").cash, 97_499);
});

void test("a competing category and payee edit blocks the engine's stale no-op path", () => {
  const setup = fixture();
  const original = setup.save(setup.draft());
  const draft = {
    ...createTransactionDraft(setup.view(), month, original),
    payee: "My correction",
  };
  setup.run({ type: "category.add", categoryId: "dining", name: "Dining" });
  setup.run({
    type: "transaction.upsert",
    transactionId: original.id,
    accountId: original.accountId,
    date: original.date,
    amount: original.amount,
    status: original.status,
    categoryId: "dining",
    payee: "Concurrent merchant",
    revision: original.revision + 1,
  });
  const latest = setup
    .view()
    .budget.transactions.find((item) => item.id === original.id)!;
  const command = setup.build(draft, original);
  const unguarded = execute(setup.book, "alan", command);
  const silentlyUnchanged = projectBook(
    unguarded,
    "alan",
    month,
  ).budget.transactions.find((item) => item.id === original.id)!;
  assert.equal(command.revision, latest.revision);
  assert.equal(silentlyUnchanged.payee, "Concurrent merchant");
  assert.equal(silentlyUnchanged.categoryId, "dining");
  assert.equal(silentlyUnchanged.history.length, latest.history.length);
  assert.throws(() => assertTransactionDraftCurrent(original, latest), {
    message:
      "This transaction changed in another session. Close this editor and reopen it to review the latest values.",
  });
  assert.throws(() =>
    assertTransactionDraftCurrent(original, latest, command.id),
  );
  assert.equal(setup.view().cash, 97_499);
});

void test("only the last saved operation allows an unchanged ambiguous edit replay", () => {
  const setup = fixture();
  const original = setup.save(setup.draft());
  const command = setup.build(
    {
      ...createTransactionDraft(setup.view(), month, original),
      payee: "Corrected merchant",
    },
    original,
  );
  const committed = execute(setup.book, "alan", command);
  const latest = projectBook(committed, "alan", month).budget.transactions.find(
    (item) => item.id === original.id,
  )!;
  assert.equal(latest.revision, original.revision + 1);
  assert.doesNotThrow(() =>
    assertTransactionDraftCurrent(original, latest, command.id),
  );
  const replayed = execute(committed, "alan", command);
  assert.deepEqual(replayed, committed);
  assert.throws(() =>
    assertTransactionDraftCurrent(original, latest, "different-operation"),
  );
  const superseded = execute(committed, "alan", {
    ...command,
    id: "later-operation",
    payee: "A later correction",
    revision: latest.revision + 1,
  });
  const newer = projectBook(superseded, "alan", month).budget.transactions.find(
    (item) => item.id === original.id,
  )!;
  assert.throws(() =>
    assertTransactionDraftCurrent(original, newer, command.id),
  );
});

void test("a removed or missing edited transaction cannot be saved", () => {
  const setup = fixture();
  const original = setup.save(setup.draft());
  assert.doesNotThrow(() => assertTransactionDraftCurrent());
  assert.doesNotThrow(() => assertTransactionDraftCurrent(original, original));
  assert.throws(() => assertTransactionDraftCurrent(original));
  setup.run({ type: "transaction.remove", transactionId: original.id });
  const removed = setup
    .view()
    .budget.transactions.find((item) => item.id === original.id)!;
  assert.equal(removed.removed, true);
  assert.throws(() => assertTransactionDraftCurrent(original, removed));
  assert.throws(() =>
    assertTransactionDraftCurrent(
      original,
      removed,
      removed.history.at(-1)?.operationId,
    ),
  );
});

void test("an ambiguously committed new entry cannot fall back to its old category", () => {
  const setup = fixture();
  const draft = setup.draft();
  const originalCommand = buildTransactionDraftCommand({
    draft,
    view: setup.view(),
    operationId: "ambiguous-create",
    entityId: "new-entry",
  });
  const committed = execute(setup.book, "alan", originalCommand);
  const view = projectBook(committed, "alan", month);
  const latest = view.budget.transactions.find(
    (item) => item.id === originalCommand.transactionId,
  )!;
  assert.doesNotThrow(() => assertTransactionDraftCurrent());
  assert.doesNotThrow(() =>
    assertTransactionDraftCurrent(undefined, latest, originalCommand.id),
  );
  assert.deepEqual(execute(committed, "alan", originalCommand), committed);

  const changedCommand = buildTransactionDraftCommand({
    draft: {
      ...draft,
      payee: "Earnings",
      categoryId: READY_TO_ASSIGN,
      outflow: "",
      inflow: "100.00",
    },
    view,
    operationId: "changed-create",
    entityId: originalCommand.transactionId,
  });
  const unguarded = execute(committed, "alan", changedCommand);
  const incorrect = projectBook(
    unguarded,
    "alan",
    month,
  ).budget.transactions.find((item) => item.id === latest.id)!;
  assert.equal(changedCommand.categoryId, undefined);
  assert.equal(incorrect.kind, "refund");
  assert.equal(incorrect.categoryId, "food");
  assert.throws(() => assertTransactionDraftCurrent(undefined, latest), {
    message:
      "This transaction was already saved. Close this editor and reopen it to review the latest values.",
  });
  assert.throws(() =>
    assertTransactionDraftCurrent(undefined, latest, changedCommand.id),
  );
  assert.equal(view.readyToAssign, 90_000);
  assert.equal(latest.amount, -2_501);
});

void test("a removed newly created entry never permits an ambiguous create retry", () => {
  const setup = fixture();
  const created = setup.save(setup.draft());
  setup.run({ type: "transaction.remove", transactionId: created.id });
  const removed = setup
    .view()
    .budget.transactions.find((item) => item.id === created.id)!;
  assert.equal(removed.removed, true);
  assert.throws(() =>
    assertTransactionDraftCurrent(
      undefined,
      removed,
      created.history.at(-1)?.operationId,
    ),
  );
  assert.throws(() =>
    assertTransactionDraftCurrent(
      undefined,
      removed,
      removed.history.at(-1)?.operationId,
    ),
  );
});
