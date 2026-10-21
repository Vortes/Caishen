"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { newId } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import {
  TransactionDraftError,
  assertTransactionDraftCurrent,
  buildTransactionDraftCommand,
  createTransactionDraft,
  type TransactionDraft,
  type TransactionDraftFields,
} from "~/components/transactions/transaction-draft";
import type { Command } from "~/domain/engine";

type Transaction = View["budget"]["transactions"][number];
export type DraftField = keyof TransactionDraft;

// What the live workspace lends the shell for saving transactions: the
// budget on screen and the production command path.
export type TransactionSaver = {
  view: View;
  // A save, a month load, or a failed refresh is in the way.
  busy: boolean;
  // Why a save can't be sent right now, or null.
  blocked: () => string | null;
  // Sends the command against the revision on screen; settles with the save.
  save: (command: Command, summary: string) => Promise<void>;
  // Holds the undo shortcut while the editor is open.
  holdOpen: () => () => void;
};

export type TransactionSession = {
  key: string;
  // The transaction as it was when editing began; absent for a new one.
  initial?: Transaction;
  // The id a new transaction saves under, kept across retries.
  entityId: string;
  draft: TransactionDraft;
  pristine: TransactionDraft;
  fields: TransactionDraftFields;
  error: string;
  // The date's calendar, open from the start on a new transaction.
  calendarOpen: boolean;
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
// The row's fields as they read on screen, so a failed save focuses the
// first problem the user sees.
const screenOrder: DraftField[] = [
  "accountId",
  "date",
  "payee",
  "categoryId",
  "outflow",
  "inflow",
  "interest",
];

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
  const [submitting, setSubmitting] = useState(false);
  const [request, setRequest] = useState<FocusRequest | null>(null);
  const handled = useRef(0);
  // Synchronous, so a second press can't send before the first re-renders.
  const saving = useRef(false);
  // The last command sent for this draft. A retry of the same draft sends
  // the same command id, so a save that reached the server isn't repeated.
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
  const removed = Boolean(session?.initial && (!latest || latest.removed));
  const dirty =
    session !== null &&
    JSON.stringify(session.draft) !== JSON.stringify(session.pristine);

  const focus = (target: FocusTarget, auto = false) =>
    setRequest((current) => ({ id: (current?.id ?? 0) + 1, target, auto }));
  const patch = (next: Partial<TransactionSession>) =>
    setSession((current) => (current ? { ...current, ...next } : current));

  // Once the editor is gone, focus goes back to what opened it, or to the
  // same action where it now renders. Openers stay disabled until the save
  // settles, which can be a render after the editor closes, so the return
  // waits for that.
  const returning = useRef(false);
  useEffect(() => {
    if (open || !returning.current || saver.busy) return;
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
  }, [open, saver.busy]);

  const close = (restore = true) => {
    if (saving.current) return;
    setSession(null);
    attempt.current = null;
    returning.current = restore;
    if (!restore) opener.current = null;
  };

  // Opens a new transaction, or an existing one by id. Refused while another
  // editor is open or a change is still saving.
  const start = ({
    transactionId,
    accountId,
    field,
  }: {
    transactionId?: string;
    accountId?: string | null;
    field?: DraftField;
  }) => {
    if (session || saver.busy || !view.accounts.length) return false;
    const transaction = transactionId
      ? view.budget.transactions.find(
          (item) => item.id === transactionId && !item.removed,
        )
      : undefined;
    if (transactionId && (!transaction || !canEditTransaction(transaction)))
      return false;
    const draft = createTransactionDraft(
      view,
      view.month,
      transaction,
      accountId ?? undefined,
    );
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
      entityId: newId(),
      draft,
      pristine: draft,
      fields: {},
      error: "",
      calendarOpen: field === "date" || (!transaction && Boolean(accountId)),
    });
    reveal();
    // A new transaction starts on its first column. In one account's
    // register that's the date, whose calendar never opens a touch keyboard;
    // All accounts starts on the account.
    focus(
      field ?? (transaction ? editField : accountId ? "calendar" : "accountId"),
      !field,
    );
    return true;
  };

  // Correcting a field clears its error; the rest wait for the next save.
  const change = (next: Partial<TransactionDraft>) => {
    setSession((current) => {
      if (!current) return current;
      const fields = { ...current.fields };
      for (const key of Object.keys(next) as DraftField[]) delete fields[key];
      if ("outflow" in next || "inflow" in next) {
        delete fields.outflow;
        delete fields.inflow;
      }
      return {
        ...current,
        draft: { ...current.draft, ...next },
        fields,
        error: "",
      };
    });
  };

  const submit = async (another: boolean) => {
    if (!session || saving.current || removed) return;
    const reason = saver.blocked();
    if (reason) {
      patch({ error: reason });
      focus("error");
      return;
    }
    const { draft, initial, entityId } = session;
    let command: Command;
    try {
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
        const first = screenOrder.find((key) => failure.fields[key]);
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

    saving.current = true;
    setSubmitting(true);
    patch({ fields: {}, error: "" });
    const payee = draft.payee.trim();
    try {
      await saver.save(command, initial ? `Saved ${payee}` : `Added ${payee}`);
      attempt.current = null;
      saving.current = false;
      if (another && !initial) {
        const next = {
          ...createTransactionDraft(
            view,
            view.month,
            undefined,
            draft.accountId,
          ),
          date: draft.date,
          status: draft.status,
        };
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
              }
            : current,
        );
        focus("payee", true);
      } else close();
    } catch {
      patch({
        error: "Not saved. Your changes are still here, so you can try again.",
      });
      focus("error");
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  };

  // Leaving the register would hide unsaved work, so it waits for Save or
  // Cancel. An untouched editor just closes. Returns whether to stay.
  const holdForDraft = () => {
    if (!session) return false;
    if (dirty || submitting || saving.current) {
      patch({ error: "Save or cancel this transaction first." });
      reveal();
      focus("error");
      return true;
    }
    close(false);
    return false;
  };

  return {
    view,
    holdOpen,
    addAccount: async (command: Extract<Command, { type: "account.add" }>) => {
      const reason = saver.blocked();
      if (reason) throw new Error(reason);
      await saver.save(command, `Added ${command.name}`);
    },
    busy: saver.busy,
    session,
    latest,
    removed,
    dirty,
    submitting,
    start,
    change,
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
