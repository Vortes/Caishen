"use client";

import { createContext, useContext, useRef, useState } from "react";
import {
  TODAY,
  day,
  importedEvent,
  initialReimbursements,
  initialTransactions,
  money,
  outstanding,
  type AccountId,
  type HistoryEvent,
  type MatchCandidate,
  type Reimbursement,
  type Transaction,
} from "./data";

export type Book = {
  transactions: Transaction[];
  reimbursements: Reimbursement[];
};

// The genuine design choices on this page. Each moves one variable.
export type Variants = {
  // Where a transaction's history opens.
  history: "editor" | "popover";
  // How a bank import finds the transaction it duplicates.
  match: "suggest" | "select";
  // Where "Expect money back" starts.
  expect: "editor" | "island";
};

export const defaultVariants: Variants = {
  history: "editor",
  match: "suggest",
  expect: "editor",
};

export type Notice = { id: number; message: string; undo?: Book };

const fresh = (): Book => ({
  transactions: initialTransactions(),
  reimbursements: initialReimbursements(),
});

const now = () => `${TODAY}T${new Date().toTimeString().slice(0, 5)}`;

export function useBookState() {
  const [book, setBook] = useState<Book>(fresh);
  const [notice, setNotice] = useState<Notice | null>(null);
  const counter = useRef(0);
  const next = (prefix: string) => `${prefix}-${++counter.current}`;
  const event = (
    kind: HistoryEvent["kind"],
    text: string,
    extra: Partial<HistoryEvent> = {},
  ): HistoryEvent => ({
    id: next("h"),
    at: now(),
    actor: "you",
    kind,
    text,
    ...extra,
  });
  const say = (message: string, undo?: Book) =>
    setNotice({ id: ++counter.current, message, undo });
  const change = (
    transactions: Transaction[],
    id: string,
    update: (item: Transaction) => Transaction,
  ) => transactions.map((item) => (item.id === id ? update(item) : item));

  const actions = {
    reset() {
      setBook(fresh());
      setNotice(null);
    },
    undo(snapshot: Book) {
      setBook(snapshot);
      setNotice({ id: ++counter.current, message: "Action undone." });
    },
    dismissNotice() {
      setNotice(null);
    },

    // YNAB keeps the bank's amount and the person's date, payee, and
    // category. A reimbursement match records the receipt instead.
    match(importId: string, candidate: MatchCandidate) {
      const before = book;
      const item = book.transactions.find((entry) => entry.id === importId)!;
      const rest = book.transactions.filter((entry) => entry.id !== importId);
      if (candidate.type === "transaction") {
        const target = candidate.transaction;
        const changed = target.amount !== item.amount;
        setBook({
          ...book,
          transactions: change(rest, target.id, (entry) => ({
            ...entry,
            amount: item.amount,
            status: item.status,
            bankPayee: item.bankPayee,
            matched: {
              importId: item.id,
              bankPayee: item.bankPayee ?? item.payee,
              bankDate: item.date,
              bankAmount: item.amount,
              enteredAmount: entry.amount,
              automatic: false,
            },
            history: [
              ...entry.history,
              ...item.history,
              event(
                "matched",
                `You matched it with the ${day(item.date)} bank import. Your date and payee were kept`,
              ),
              ...(changed
                ? [
                    event("amount", "The bank’s amount replaced yours", {
                      actor: "bank",
                      from: money(Math.abs(entry.amount)),
                      to: money(Math.abs(item.amount)),
                    }),
                  ]
                : []),
            ],
          })),
        });
        say(
          changed
            ? `Matched ${target.payee}. It now uses the bank’s ${money(Math.abs(item.amount))}.`
            : `Matched ${target.payee} with the bank import.`,
          before,
        );
        return;
      }
      const { claim, purchase } = candidate;
      const receipt: Transaction = {
        id: next("t-receipt"),
        accountId: item.accountId,
        date: item.date,
        payee: claim.from,
        bankPayee: item.bankPayee,
        amount: item.amount,
        status: item.status,
        category: "Reimbursement",
        needsReview: false,
        source: "budget",
        history: [
          ...item.history,
          event(
            "received",
            `You matched it to ${claim.from} paying back ${purchase.payee}`,
          ),
        ],
      };
      setBook({
        transactions: change([receipt, ...rest], purchase.id, (entry) => ({
          ...entry,
          history: [
            ...entry.history,
            event("received", `${claim.from} paid back ${money(item.amount)}`, {
              actor: "bank",
              to: `${money(outstanding(claim) - item.amount)} still expected`,
            }),
          ],
        })),
        reimbursements: book.reimbursements.map((entry) =>
          entry.id === claim.id
            ? {
                ...entry,
                receipts: [
                  ...entry.receipts,
                  {
                    id: receipt.id,
                    date: item.date,
                    amount: item.amount,
                    accountId: item.accountId,
                    importId: item.id,
                  },
                ],
              }
            : entry,
        ),
      });
      say(
        `Recorded ${money(item.amount)} from ${claim.from} for ${purchase.payee}.`,
        before,
      );
    },

    unmatch(transactionId: string) {
      const before = book;
      const target = book.transactions.find(
        (entry) => entry.id === transactionId,
      )!;
      const matched = target.matched!;
      const restored: Transaction = {
        id: matched.importId,
        accountId: target.accountId,
        date: matched.bankDate,
        payee: matched.bankPayee,
        bankPayee: matched.bankPayee,
        amount: matched.bankAmount,
        status: "posted",
        category: "",
        needsReview: true,
        source: "bank",
        notWith: [transactionId],
        history: [],
      };
      restored.history = [importedEvent(restored)];
      setBook({
        ...book,
        transactions: [
          restored,
          ...change(book.transactions, transactionId, (entry) => ({
            ...entry,
            amount: matched.enteredAmount,
            bankPayee: undefined,
            matched: undefined,
            history: [
              ...entry.history,
              event(
                "unmatched",
                "You unmatched it. The bank import went back to To review",
                matched.enteredAmount === matched.bankAmount
                  ? {}
                  : {
                      from: money(Math.abs(matched.bankAmount)),
                      to: money(Math.abs(matched.enteredAmount)),
                    },
              ),
            ],
          })),
        ],
      });
      say("Unmatched. The bank import is back in To review.", before);
    },

    // YNAB's Reject: the import is gone and won't import again.
    reject(ids: string[]) {
      const before = book;
      const items = book.transactions.filter((entry) => ids.includes(entry.id));
      setBook({
        ...book,
        transactions: book.transactions.filter(
          (entry) => !ids.includes(entry.id),
        ),
      });
      const removed = items.every((item) => item.removedByBank);
      say(
        removed
          ? `Dismissed ${items.length === 1 ? items[0]!.payee : `${items.length} imports`}.`
          : `Rejected ${items.length === 1 ? items[0]!.payee : `${items.length} bank imports`}. ${items.length === 1 ? "It" : "They"} won’t import again.`,
        before,
      );
    },

    approve(ids: string[]) {
      setBook({
        ...book,
        transactions: book.transactions.map((entry) =>
          ids.includes(entry.id)
            ? {
                ...entry,
                needsReview: false,
                history: [
                  ...entry.history,
                  event("approved", "You approved it"),
                ],
              }
            : entry,
        ),
      });
    },

    // Saves the editor: a renamed payee, a new category, a new amount.
    save(
      id: string,
      draft: { payee: string; category: string; amount: number },
      claim?: { from: string; amount: number },
    ) {
      const item = book.transactions.find((entry) => entry.id === id)!;
      const events: HistoryEvent[] = [];
      if (item.source === "bank")
        events.push(event("approved", "You confirmed it as a new transaction"));
      if (draft.payee !== item.payee)
        events.push(
          event("renamed", "You renamed the payee", {
            from: item.payee,
            to: draft.payee,
          }),
        );
      if (draft.category !== item.category && draft.category)
        events.push(
          event("categorized", "You changed the category", {
            from: item.category || undefined,
            to: draft.category,
          }),
        );
      if (draft.amount !== item.amount)
        events.push(
          event("amount", "You changed the amount", {
            from: money(Math.abs(item.amount)),
            to: money(Math.abs(draft.amount)),
          }),
        );
      if (claim)
        events.push(
          event("expected", `You expect ${claim.from} to pay you back`, {
            to: money(claim.amount),
          }),
        );
      setBook({
        transactions: change(book.transactions, id, (entry) => ({
          ...entry,
          ...draft,
          source: "budget",
          needsReview: false,
          history: [...entry.history, ...events],
        })),
        reimbursements: claim
          ? [
              ...book.reimbursements,
              {
                id: next("r"),
                transactionId: id,
                from: claim.from,
                amount: claim.amount,
                receipts: [],
              },
            ]
          : book.reimbursements,
      });
    },

    expect(transactionId: string, from: string, amount: number) {
      setBook({
        transactions: change(book.transactions, transactionId, (entry) => ({
          ...entry,
          history: [
            ...entry.history,
            event("expected", `You expect ${from} to pay you back`, {
              to: money(amount),
            }),
          ],
        })),
        reimbursements: [
          ...book.reimbursements,
          { id: next("r"), transactionId, from, amount, receipts: [] },
        ],
      });
    },

    stopExpecting(claimId: string) {
      const before = book;
      const claim = book.reimbursements.find((entry) => entry.id === claimId)!;
      setBook({
        transactions: change(
          book.transactions,
          claim.transactionId,
          (entry) => ({
            ...entry,
            history: [
              ...entry.history,
              event(
                "expected",
                `You stopped expecting money from ${claim.from}`,
                {
                  from: money(outstanding(claim)),
                },
              ),
            ],
          }),
        ),
        reimbursements: book.reimbursements.filter(
          (entry) => entry.id !== claimId,
        ),
      });
      say(`No longer expecting money from ${claim.from}.`, before);
    },

    // Cash that arrived without a bank import, like a Venmo transfer
    // moved into checking by hand.
    receive(
      claimId: string,
      accountId: AccountId,
      amount: number,
      date: string,
    ) {
      const before = book;
      const claim = book.reimbursements.find((entry) => entry.id === claimId)!;
      const receiptId = next("t-receipt");
      const purchase = book.transactions.find(
        (entry) => entry.id === claim.transactionId,
      );
      const receipt: Transaction = {
        id: receiptId,
        accountId,
        date,
        payee: claim.from,
        amount,
        status: "posted",
        category: "Reimbursement",
        needsReview: false,
        source: "budget",
        history: [
          event(
            "received",
            `You recorded ${claim.from} paying back ${purchase?.payee ?? "a purchase"}`,
            { to: money(amount) },
          ),
        ],
      };
      setBook({
        transactions: change(
          [receipt, ...book.transactions],
          claim.transactionId,
          (entry) => ({
            ...entry,
            history: [
              ...entry.history,
              event("received", `${claim.from} paid back ${money(amount)}`, {
                to:
                  outstanding(claim) - amount > 0
                    ? `${money(outstanding(claim) - amount)} still expected`
                    : "Paid back in full",
              }),
            ],
          }),
        ),
        reimbursements: book.reimbursements.map((entry) =>
          entry.id === claimId
            ? {
                ...entry,
                receipts: [
                  ...entry.receipts,
                  { id: receiptId, date, amount, accountId },
                ],
              }
            : entry,
        ),
      });
      say(`${money(amount)} from ${claim.from} is in Ready to Assign.`, before);
    },
  };
  return { book, notice, actions };
}

export type BookState = ReturnType<typeof useBookState>;

const BookContext = createContext<(BookState & { variants: Variants }) | null>(
  null,
);

export const BookProvider = BookContext.Provider;

export function useBook() {
  const value = useContext(BookContext);
  if (!value) throw new Error("useBook needs a BookProvider.");
  return value;
}
