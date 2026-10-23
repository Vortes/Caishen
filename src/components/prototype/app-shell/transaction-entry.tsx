"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { newId } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import {
  READY_TO_ASSIGN,
  TransactionDraftError,
  assertTransactionDraftCurrent,
  buildTransactionDraftCommand,
  createTransactionDraft,
  lineField,
  type DraftFieldKey,
  type TransactionDraft,
  type TransactionDraftFields,
} from "~/components/transactions/transaction-draft";
import type { Command, CounterpartyShare } from "~/domain/engine";
import {
  rememberedCategory,
  rememberedCounterpartyShare,
} from "~/domain/payee-memory";
import {
  canEditImport,
  createImportDraft,
  importRowId,
  type BankImport,
} from "~/components/transactions/import-draft";

type Transaction = View["budget"]["transactions"][number];
export type DraftField = DraftFieldKey;

// What the live workspace lends the shell for saving transactions: the
// budget on screen and its command path. A save shows at once and goes to
// the server in the background; each returns why it can't apply, or null
// once it's on its way, and calls `refused` if the server turns it down.
export type TransactionSaver = {
  view: View;
  imports: BankImport[];
  save: (
    command: Command,
    summary: string,
    refused?: () => void,
  ) => string | null;
  // A bank import is saved by the server; it changes once the server has it.
  saveImport: (
    item: BankImport,
    command: Command,
    summary: string,
    refused?: () => void,
  ) => string | null;
  // Holds the undo shortcut while the editor is open.
  holdOpen: () => () => void;
};

export type TransactionSession = {
  key: string;
  // The transaction as it was when editing began; absent for a new one.
  initial?: Transaction;
  imported?: BankImport;
  rowId?: string;
  // The id a new transaction saves under, kept across retries.
  entityId: string;
  draft: TransactionDraft;
  pristine: TransactionDraft;
  fields: TransactionDraftFields;
  error: string;
  // The date's calendar, open from the start on a new transaction.
  calendarOpen: boolean;
  // Until the user chooses a category, a new transaction's category follows
  // its payee's memory; this is what it has when the payee has none.
  unremembered?: string;
  shareChosen?: boolean;
};

type FocusTarget = DraftField | "calendar" | "error";
type FocusRequest = { id: number; target: FocusTarget; auto: boolean };

const editableKinds: Transaction["kind"][] = [
  "purchase",
  "refund",
  "income",
  "transfer",
  "card-payment",
  "loan-payment",
];
// The row's fields as they read on screen, then its split lines', so a
// failed save focuses the first problem the user sees.
const screenOrder = (draft: TransactionDraft): DraftField[] => [
  "accountId",
  "date",
  "payee",
  "categoryId",
  "counterpartyShare",
  "outflow",
  "inflow",
  ...draft.lines.flatMap((line) =>
    (["categoryId", "counterpartyShare", "outflow", "inflow"] as const).map(
      (field) => lineField(line.lineId, field),
    ),
  ),
  "remaining",
  "interest",
];

// The draft's signed amount once one is entered: inflow positive.
function draftAmount(draft: TransactionDraft) {
  const inflow = Number.parseFloat(draft.inflow);
  if (draft.inflow.trim() && inflow) return inflow;
  const outflow = Number.parseFloat(draft.outflow);
  if (draft.outflow.trim() && outflow) return -outflow;
  return undefined;
}

export function canEditTransaction(transaction: Transaction) {
  return editableKinds.includes(transaction.kind);
}

export function useTransactionEntryController({
  saver,
  reveal,
}: {
  saver: TransactionSaver;
  // Brings the register's editor row into view.
  reveal: () => void;
}) {
  const { view, holdOpen } = saver;
  const [session, setSession] = useState<TransactionSession | null>(null);
  const [request, setRequest] = useState<FocusRequest | null>(null);
  const handled = useRef(0);
  // The command built for this draft, kept while the draft is unchanged.
  const attempt = useRef<{ fingerprint: string; command: Command } | null>(
    null,
  );
  const opener = useRef<{ element: HTMLElement | null; key: string } | null>(
    null,
  );

  const open = session !== null;
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);

  const latest = session?.initial
    ? view.budget.transactions.find((item) => item.id === session.initial!.id)
    : undefined;
  const latestImport = session?.imported
    ? saver.imports.find((item) => importRowId(item) === session.rowId)
    : undefined;
  const removed = Boolean(
    session?.initial
      ? !latest || latest.removed
      : session?.imported &&
          !latestImport &&
          !view.budget.transactions.some(
            (item) => item.id === session.entityId && !item.removed,
          ),
  );
  const dirty =
    session !== null &&
    JSON.stringify(session.draft) !== JSON.stringify(session.pristine);

  const focus = (target: FocusTarget, auto = false) =>
    setRequest((current) => ({ id: (current?.id ?? 0) + 1, target, auto }));
  const patch = (next: Partial<TransactionSession>) =>
    setSession((current) => (current ? { ...current, ...next } : current));

  // Once the editor is gone, focus goes back to what opened it, or to the
  // same action where it now renders.
  const returning = useRef(false);
  useEffect(() => {
    if (open || !returning.current) return;
    returning.current = false;
    const target = opener.current;
    opener.current = null;
    // Focus the user moved on their own in the meantime stays where it is.
    if (document.activeElement && document.activeElement !== document.body)
      return;
    const key = CSS.escape(target?.key ?? "new");
    const candidates = [
      target?.element,
      ...document.querySelectorAll<HTMLElement>(
        `[data-transaction-opener="${key}"]`,
      ),
      ...document.querySelectorAll<HTMLElement>(
        `[data-transaction-row="${key}"]`,
      ),
      ...document.querySelectorAll<HTMLElement>(
        '[data-transaction-opener="new"]',
      ),
    ];
    const next = candidates.find(
      (element) =>
        element?.isConnected &&
        !element.closest("[inert]") &&
        !element.matches(":disabled"),
    );
    (next ?? document.getElementById("prototype-content"))?.focus({
      preventScroll: true,
    });
  }, [open]);

  const close = (restore = true) => {
    setSession(null);
    attempt.current = null;
    returning.current = restore;
    if (!restore) opener.current = null;
  };

  // Opens a new transaction, or an existing one by id. Refused while another
  // editor is open.
  const start = ({
    transactionId,
    accountId,
    field,
    refundOfTransactionId,
    counterpartyShare,
  }: {
    transactionId?: string;
    refundOfTransactionId?: string;
    accountId?: string | null;
    field?: DraftField;
    // A share picked before the editor opened, such as from the register's
    // Share cell on a row that still needs its category.
    counterpartyShare?: CounterpartyShare | null;
  }) => {
    if (session || !view.accounts.length) return false;
    const transaction = transactionId
      ? view.budget.transactions.find(
          (item) => item.id === transactionId && !item.removed,
        )
      : undefined;
    const imported = transactionId
      ? saver.imports.find(
          (item) => importRowId(item) === transactionId && canEditImport(item),
        )
      : undefined;
    if (
      transactionId &&
      !imported &&
      (!transaction || !canEditTransaction(transaction))
    )
      return false;
    const draft = imported
      ? createImportDraft(view, imported)
      : createTransactionDraft(
          view,
          view.month,
          transaction,
          accountId ?? undefined,
        );
    if (refundOfTransactionId) {
      const original = view.budget.transactions.find(
        (item) => item.id === refundOfTransactionId && !item.removed,
      );
      if (!original || original.amount >= 0) return false;
      draft.refundOfTransactionId = original.id;
      draft.payee = original.payee;
      draft.categoryId =
        original.categoryId ?? original.lines?.[0]?.categoryId ?? "";
      draft.outflow = "";
      draft.inflow = (Math.abs(original.amount) / 100).toFixed(2);
      draft.counterpartyShare = undefined;
      draft.lines = [];
    }
    const unremembered = transaction
      ? undefined
      : imported
        ? imported.categoryId
          ? undefined
          : imported.amount > 0
            ? READY_TO_ASSIGN
            : ""
        : draft.categoryId;
    const editField =
      draft.transferAccountId ||
      draft.loanId ||
      view.accounts.find((item) => item.id === draft.accountId)?.kind ===
        "tracking"
        ? "payee"
        : "categoryId";
    opener.current = {
      element:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      key: transactionId ?? "new",
    };
    attempt.current = null;
    setSession({
      key: newId(),
      initial: transaction,
      imported,
      rowId: transactionId,
      entityId: newId(),
      draft:
        counterpartyShare === undefined
          ? draft
          : {
              ...draft,
              counterpartyShare: counterpartyShare && {
                ...counterpartyShare,
                amount: (counterpartyShare.amount / 100).toFixed(2),
              },
            },
      pristine: draft,
      fields: {},
      error: "",
      calendarOpen: field === "date" || (!transactionId && Boolean(accountId)),
      unremembered,
      shareChosen: counterpartyShare !== undefined,
    });
    reveal();
    // A new transaction starts on its first column. In one account's
    // register that's the date, whose calendar never opens a touch keyboard;
    // All accounts starts on the account.
    focus(
      field ??
        (transactionId ? editField : accountId ? "calendar" : "accountId"),
      !field,
    );
    return true;
  };

  // Correcting a field clears its error; the rest wait for the next save.
  const change = (next: Partial<TransactionDraft>, chosen = false) => {
    setSession((current) => {
      if (!current) return current;
      const fields = { ...current.fields };
      for (const key of Object.keys(next) as DraftField[]) delete fields[key];
      if ("outflow" in next || "inflow" in next) {
        delete fields.outflow;
        delete fields.inflow;
      }
      // A line's change clears its own errors and what the lines leave.
      if ("lines" in next || "outflow" in next || "inflow" in next) {
        delete fields.remaining;
        for (const line of next.lines ?? []) {
          const before = current.draft.lines.find(
            (item) => item.lineId === line.lineId,
          );
          if (before?.counterpartyShare !== line.counterpartyShare)
            delete fields[lineField(line.lineId, "counterpartyShare")];
          for (const field of ["categoryId", "outflow", "inflow"] as const)
            if (before?.[field] !== line[field]) {
              delete fields[lineField(line.lineId, field)];
              if (field !== "categoryId") {
                delete fields[lineField(line.lineId, "outflow")];
                delete fields[lineField(line.lineId, "inflow")];
              }
            }
        }
      }
      const draft = { ...current.draft, ...next };
      const shareChosen =
        Boolean(current.shareChosen) ||
        "counterpartyShare" in next ||
        "lines" in next;
      if (
        !shareChosen &&
        !current.initial &&
        !draft.lines.length &&
        ["payee", "accountId", "outflow", "inflow"].some((key) => key in next)
      ) {
        const share = rememberedCounterpartyShare(view.budget, {
          payee: draft.payee,
          accountId: draft.accountId,
          amount:
            draftAmount(draft) === undefined
              ? undefined
              : Math.round(draftAmount(draft)! * 100),
        });
        // A written-off share remembers nothing to prefill.
        draft.counterpartyShare = share?.amount
          ? { ...share, amount: (share.amount / 100).toFixed(2) }
          : undefined;
      }
      const unremembered = chosen ? undefined : current.unremembered;
      if (
        unremembered !== undefined &&
        !draft.lines.length &&
        !draft.transferAccountId &&
        !draft.loanId &&
        ["payee", "accountId", "outflow", "inflow"].some((key) => key in next)
      )
        draft.categoryId =
          rememberedCategory(view.budget, {
            payee: draft.payee,
            accountId: draft.accountId,
            amount: draftAmount(draft),
          }) ?? unremembered;
      return {
        ...current,
        draft,
        fields,
        error: "",
        unremembered,
        shareChosen,
      };
    });
  };

  const submit = (another: boolean) => {
    if (!session || removed) return;
    const { draft, initial, entityId } = session;
    let command: Command;
    try {
      if (
        session.imported &&
        latestImport &&
        session.imported.fingerprint !== latestImport.fingerprint
      )
        throw new Error(
          "Your bank updated this transaction. Reopen it before saving.",
        );
      const fingerprint = JSON.stringify(
        buildTransactionDraftCommand({
          draft,
          view,
          transaction: initial,
          operationId: "draft",
          entityId: "draft",
        }),
      );
      assertTransactionDraftCurrent(
        initial,
        initial
          ? latest
          : view.budget.transactions.find((item) => item.id === entityId),
        attempt.current?.fingerprint === fingerprint
          ? attempt.current.command.id
          : undefined,
      );
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = {
          fingerprint,
          command: buildTransactionDraftCommand({
            draft,
            view,
            transaction: initial,
            operationId: newId(),
            entityId,
          }),
        };
      command = attempt.current.command;
    } catch (failure) {
      if (failure instanceof TransactionDraftError) {
        const first = screenOrder(draft).find((key) => failure.fields[key]);
        patch({ fields: failure.fields, error: "", calendarOpen: false });
        focus(first ?? "payee");
      } else {
        patch({
          error:
            failure instanceof Error
              ? failure.message
              : "This transaction couldn't be saved. Try again.",
        });
        focus("error");
      }
      return;
    }

    const payee = draft.payee.trim();
    const summary = session.rowId ? `Saved ${payee}` : `Added ${payee}`;
    // The editor closes as the change shows. If the server turns it down,
    // the draft comes back with what went wrong, unless another editor is
    // open by then.
    const sent = session;
    const refused = () => {
      setSession(
        (current) =>
          current ?? {
            ...sent,
            key: newId(),
            fields: {},
            error:
              "Not saved. Your changes are still here, so you can try again.",
            calendarOpen: false,
          },
      );
      focus("error");
    };
    const blocked = session.imported
      ? saver.saveImport(session.imported, command, summary, refused)
      : saver.save(command, summary, refused);
    if (blocked) {
      patch({ fields: {}, error: blocked });
      focus("error");
      return;
    }
    attempt.current = null;
    if (another && !session.rowId) {
      const next = {
        ...createTransactionDraft(view, view.month, undefined, draft.accountId),
        date: draft.date,
        status: draft.status,
      };
      const unremembered = next.categoryId;
      setSession((current) =>
        current
          ? {
              ...current,
              key: newId(),
              entityId: newId(),
              draft: next,
              pristine: next,
              fields: {},
              error: "",
              calendarOpen: false,
              unremembered,
            }
          : current,
      );
      focus("payee", true);
    } else close();
  };

  // Leaving the register would hide unsaved work, so it waits for Save or
  // Cancel. An untouched editor just closes. Returns whether to stay.
  const holdForDraft = () => {
    if (!session) return false;
    if (dirty) {
      patch({ error: "Save or cancel this transaction first." });
      reveal();
      focus("error");
      return true;
    }
    close(false);
    return false;
  };

  // Saves one line's share straight from the register, as the editor would
  // with nothing else changed. lineId is the transaction's own id when it
  // has no split. Returns why it can't save, or null once it's on its way.
  const saveShare = (
    transactionId: string,
    lineId: string,
    share: CounterpartyShare | null,
    summary: string,
  ) => {
    const transaction = view.budget.transactions.find(
      (item) => item.id === transactionId && !item.removed,
    );
    if (!transaction) return "This transaction was deleted.";
    const draft = createTransactionDraft(view, view.month, transaction);
    const next = share && { ...share, amount: (share.amount / 100).toFixed(2) };
    if (draft.lines.length)
      draft.lines = draft.lines.map((line) =>
        line.lineId === lineId ? { ...line, counterpartyShare: next } : line,
      );
    else draft.counterpartyShare = next;
    try {
      return saver.save(
        buildTransactionDraftCommand({
          draft,
          view,
          transaction,
          operationId: newId(),
          entityId: transaction.id,
        }),
        summary,
      );
    } catch (failure) {
      return failure instanceof Error
        ? failure.message
        : "This share couldn't be saved. Try again.";
    }
  };

  return {
    view,
    holdOpen,
    saveCommand: saver.save,
    saveShare,
    // Returns why the account can't be added, or null once it's on its way.
    addAccount: (command: Extract<Command, { type: "account.add" }>) =>
      saver.save(command, `Added ${command.name}`),
    session,
    latest,
    removed,
    dirty,
    start,
    change,
    focus,
    // The user's own choice of category, which the payee's memory then
    // leaves alone.
    chooseCategory: (categoryId: string) =>
      change({ categoryId, lines: [] }, true),
    setCalendarOpen: (calendarOpen: boolean) => patch({ calendarOpen }),
    submit,
    cancel: () => close(),
    holdForDraft,
    // The pending focus move, taken once by whichever editor is showing.
    takeFocus: () => {
      if (!request || request.id === handled.current) return null;
      handled.current = request.id;
      return request;
    },
    focusRequest: request?.id ?? 0,
  };
}

export type TransactionEntry = ReturnType<typeof useTransactionEntryController>;

const TransactionEntryContext = createContext<TransactionEntry | null>(null);

export const TransactionEntryProvider = TransactionEntryContext.Provider;

export function useTransactionEntry() {
  const value = useContext(TransactionEntryContext);
  if (!value)
    throw new Error("useTransactionEntry needs a TransactionEntryProvider.");
  return value;
}
