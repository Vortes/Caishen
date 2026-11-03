import {
  classifyRegisterEntry,
  type Capability,
} from "../../src/domain/register-entry";
import { partnerLedgerRows } from "../../src/domain/partner-ledger";
import {
  buildTransactionDraftCommand,
  createTransactionDraft,
} from "../../src/components/transactions/transaction-draft";
import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountingError,
  addMember,
  createBook,
  execute,
  personalLedger,
  executeWithChanges,
  projectBook,
  type Command,
} from "../../src/domain/engine";
import { withPeople } from "../../src/domain/people";
import { linkedPersonId, personId, withPerson } from "./fixtures/people";

void test("F1: the non-payer and household refuse a share reduction without the payer's purpose category", () => {
  let book = withPeople(
    addMember(createBook("a", "A", "2026-10"), "b", "B", "2026-10"),
  );
  book = execute(book, "a", {
    type: "account.add",
    id: "account",
    accountId: "cash",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  book = execute(book, "a", {
    type: "transaction.upsert",
    id: "purchase",
    transactionId: "purchase",
    accountId: "cash",
    date: "2026-10-10",
    payee: "Shared dinner",
    amount: -5000,
    counterpartyShare: { accountId: linkedPersonId(book, "a"), amount: 5000 },
    recordedAt: "2026-10-10T12:00:00Z",
  });
  const command = {
    type: "partner.edit",
    id: "reduce",
    entryId: book.partnerEntries![0]!.id,
    share: 2500,
    recordedAt: "2026-10-11T12:00:00Z",
  } as const;
  for (const state of [personalLedger(book, "b"), book])
    assert.throws(() => execute(state, "b", command), {
      name: AccountingError.name,
      message: "Choose a purpose category for your part of it",
    });
});

type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;
function agreementBook() {
  let book = withPeople(
    addMember(createBook("a", "A", "2026-10"), "b", "B", "2026-10"),
  );
  for (const actor of ["a", "b"]) book = withPerson(book, actor, "Employer");
  let sequence = 0;
  const run = (actor: string, command: WithoutId<Command>) => {
    book = execute(book, actor, { ...command, id: `matrix-${++sequence}` });
  };
  for (const actor of ["a", "b"]) {
    for (const [accountId, kind, openingBalance] of [
      ["cash", "cash", 1_000_000],
      ["savings", "cash", 100_000],
      ["card", "credit", -100_000],
      ["tracking", "tracking", 100_000],
    ] as const)
      run(actor, {
        type: "account.add",
        accountId,
        name: accountId,
        kind,
        openingBalance,
      });
    for (const categoryId of ["food", "other"])
      run(actor, { type: "category.add", categoryId, name: categoryId });
    run(actor, {
      type: "loan.add",
      loanId: "loan",
      categoryId: "loan-category",
      name: "Car",
      principal: 100_000,
      annualRateBps: 500,
      minimumPayment: 5000,
      variable: false,
      effectiveDate: "2026-10-01",
    });
    const base = {
      type: "transaction.upsert",
      accountId: "cash",
      date: "2026-10-10",
      payee: "Market",
      amount: -2000,
      categoryId: "food",
      reviewed: false,
      recordedAt: "2026-10-10T12:00:00Z",
    } as const;
    run(actor, { ...base, transactionId: "purchase" });
    run(actor, { ...base, transactionId: "pending", status: "pending" });
    run(actor, {
      ...base,
      transactionId: "income",
      amount: 1000,
      categoryId: undefined,
    });
    run(actor, {
      ...base,
      transactionId: "tracking-income",
      accountId: "tracking",
      amount: 1000,
      categoryId: undefined,
    });
    run(actor, { ...base, transactionId: "refund", amount: 500 });
    run(actor, {
      ...base,
      transactionId: "partial",
      counterpartyShare: {
        accountId: linkedPersonId(book, actor),
        amount: 1000,
      },
    });
    for (const [transactionId, categoryId] of [
      ["full", undefined],
      ["full-category-input", "food"],
    ] as const)
      run(actor, {
        ...base,
        transactionId,
        categoryId,
        counterpartyShare: {
          accountId: linkedPersonId(book, actor),
          amount: 2000,
        },
      });
    run(actor, {
      ...base,
      transactionId: "split",
      categoryId: undefined,
      lines: [
        { lineId: "personal", categoryId: "food", amount: -1000 },
        {
          lineId: "shared",
          amount: -1000,
          counterpartyShare: {
            accountId: linkedPersonId(book, actor),
            amount: 1000,
          },
        },
      ],
    });
    run(actor, {
      ...base,
      transactionId: "transfer",
      categoryId: undefined,
      transferAccountId: "savings",
    });
    run(actor, {
      ...base,
      transactionId: "boundary-transfer",
      transferAccountId: "tracking",
    });
    run(actor, {
      ...base,
      transactionId: "card-payment",
      categoryId: undefined,
      transferAccountId: "card",
      amount: -5000,
    });
    run(actor, {
      ...base,
      transactionId: "loan-payment",
      loanId: "loan",
      interest: 1000,
      categoryId: "loan-category",
      amount: -5000,
    });
    run(actor, {
      ...base,
      transactionId: "statement-credit",
      accountId: "card",
      amount: 1000,
      categoryId: undefined,
    });
    run(actor, {
      ...base,
      transactionId: "reimbursable",
      counterpartyShare: {
        accountId: personId("Employer"),
        amount: 1000,
      },
    });
    run(actor, {
      type: "counterparty.receive",
      counterpartyAccountId: personId("Employer"),
      cashAccountId: "cash",
      amount: 500,
      date: "2026-10-11",
      recordedAt: "2026-10-11T12:00:00Z",
    });
    const balance = projectBook(book, actor, "2026-10").accounts.find(
      (account) => account.id === "savings",
    )!.cleared;
    run(actor, {
      type: "account.reconcile",
      accountId: "savings",
      date: "2026-10-20",
      balance: balance + 100,
      adjustmentId: "adjustment",
    });
  }
  const beforeReconciliation = book;
  for (const actor of ["a", "b"])
    for (const accountId of ["cash", "card", "tracking"]) {
      const balance = projectBook(book, actor, "2026-10").accounts.find(
        (account) => account.id === accountId,
      )!.cleared;
      run(actor, {
        type: "account.reconcile",
        accountId,
        date: "2026-10-20",
        balance,
      });
    }
  return [beforeReconciliation, book];
}

void test("register capabilities and UI commands agree across both members' PersonalLedgers and the Book", () => {
  const shapes = new Set<string>();
  let comparisons = 0;
  for (const book of agreementBook())
    for (const actor of ["a", "b"]) {
      const ledger = personalLedger(book, actor);
      const view = projectBook(book, actor, "2026-10");
      const agree = (
        command: Command,
        capability: Capability,
        context: string,
      ) => {
        for (const state of [ledger, book]) {
          if (capability.ok)
            assert.doesNotThrow(
              () => executeWithChanges(state, actor, command),
              context,
            );
          else
            assert.throws(
              () => executeWithChanges(state, actor, command),
              { name: "AccountingError", message: capability.reason },
              context,
            );
        }
        comparisons++;
      };
      for (const transaction of ledger.budget.transactions) {
        const entry = classifyRegisterEntry(ledger.budget, transaction);
        shapes.add(entry.shape.kind);
        const id = `${actor}:${transaction.id}`;
        const common = { id, recordedAt: "2026-10-20T12:00:00Z" };
        const edit = entry.capabilities.edit.ok
          ? buildTransactionDraftCommand({
              view,
              draft: createTransactionDraft(view, "2026-10", transaction),
              transaction,
              operationId: `${id}:edit`,
              entityId: "unused",
            })
          : {
              ...common,
              accountId: transaction.accountId,
              date: transaction.date,
              amount: transaction.amount,
              payee: transaction.payee,
              status: transaction.status,
              type: "transaction.upsert" as const,
              transactionId: transaction.id,
              revision: transaction.revision + 1,
            };
        agree(
          { ...edit, recordedAt: common.recordedAt },
          entry.capabilities.edit,
          `${id}:edit`,
        );
        agree(
          {
            ...common,
            type: "transaction.approve",
            transactionIds: [transaction.id],
          },
          entry.capabilities.approve,
          `${id}:approve`,
        );
        agree(
          {
            ...common,
            type: "transaction.reject",
            transactionIds: [transaction.id],
          },
          entry.capabilities.reject,
          `${id}:reject`,
        );
        agree(
          {
            ...common,
            type: "transaction.categorize.batch",
            transactionIds: [transaction.id],
            categoryId: "other",
          },
          entry.capabilities.categorize,
          `${id}:categorize`,
        );
        if (entry.capabilities.share.mode === "edit") {
          const share =
            transaction.counterpartyShare ??
            transaction.lines?.find((line) => line.counterpartyShare)
              ?.counterpartyShare;
          const shared = share ?? {
            accountId: linkedPersonId(book, actor),
            amount: Math.floor(Math.abs(transaction.amount) / 2),
          };
          const lines = transaction.lines?.map((line) => ({
            lineId: line.id,
            amount: line.amount,
            categoryId: line.categoryId,
            counterpartyShare: line.counterpartyShare,
          }));
          agree(
            {
              ...common,
              type: "transaction.upsert",
              transactionId: transaction.id,
              accountId: transaction.accountId,
              date: transaction.date,
              amount: transaction.amount,
              payee: transaction.payee,
              categoryId: transaction.categoryId,
              counterpartyShare: lines ? undefined : shared,
              lines,
              revision: transaction.revision + 1,
              status: transaction.status,
            },
            { ok: true },
            `${id}:share`,
          );
        }
      }
      for (const row of partnerLedgerRows(
        ledger.budget,
        ledger.partnerEntries,
        "2026-10-31",
      )) {
        if (!row.entryId) continue;
        const mode = row.shareMode;
        agree(
          {
            type: "partner.edit",
            id: `${actor}:${row.id}:share`,
            entryId: row.entryId,
            share: row.payerId === actor ? row.partner : row.you,
            recordedAt: "2026-10-20T12:00:00Z",
          },
          mode.mode === "edit"
            ? { ok: true }
            : { ok: false, reason: mode.reason },
          `${actor}:${row.id}:partner-share`,
        );
      }
      assert.equal(
        ledger.budget.transactions.find(
          (item) => item.id === "full-category-input",
        )!.categoryId,
        undefined,
      );
      assert.ok(ledger.budget.transactions.some((item) => item.reconciled));
    }
  assert.deepEqual([...shapes].sort(), [
    "adjustment",
    "card-payment",
    "income",
    "loan-payment",
    "purchase",
    "refund",
    "reimbursement",
    "statement-credit",
    "transfer",
  ]);
  assert.ok(comparisons > 350);
});

void test("source line facts follow a non-payer's full-share edit before the next preview", () => {
  let book = withPeople(
    addMember(createBook("a", "A", "2026-10"), "b", "B", "2026-10"),
  );
  book = execute(book, "a", {
    type: "account.add",
    id: "cash",
    accountId: "cash",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  book = execute(book, "a", {
    type: "category.add",
    id: "food",
    categoryId: "food",
    name: "Food",
  });
  book = execute(book, "a", {
    type: "transaction.upsert",
    id: "purchase",
    transactionId: "purchase",
    accountId: "cash",
    date: "2026-10-10",
    payee: "Shared dinner",
    amount: -5000,
    categoryId: "food",
    counterpartyShare: { accountId: linkedPersonId(book, "a"), amount: 2500 },
    recordedAt: "2026-10-10T12:00:00Z",
  });
  const command = {
    type: "partner.edit",
    id: "full",
    entryId: book.partnerEntries![0]!.id,
    share: 5000,
    recordedAt: "2026-10-11T12:00:00Z",
  } as const;
  const browser = execute(personalLedger(book, "b"), "b", command);
  const server = execute(book, "b", command);
  assert.deepEqual(
    browser.partnerEntries![0]!.source,
    server.partnerEntries![0]!.source,
  );
  assert.equal(browser.partnerEntries![0]!.source!.hasPurposeCategory, false);
  for (const state of [browser, server])
    assert.throws(
      () => execute(state, "b", { ...command, id: "reduce", share: 2500 }),
      {
        name: "AccountingError",
        message: "Choose a purpose category for your part of it",
      },
    );
});
