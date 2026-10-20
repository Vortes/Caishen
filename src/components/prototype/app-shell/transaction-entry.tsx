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

// Where the transaction editor opens: in place of the register row, or in
// the details panel. The prototype offers both so they can be compared.
export type TransactionPlacement = "register" | "inspector";

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
  detailsOpen: boolean;
};

type FocusTarget = DraftField | "placement" | "error";
type FocusRequest = { id: number; target: FocusTarget; auto: boolean };

const editableKinds: Transaction["kind"][] = ["purchase", "refund", "income"];
const detailFields: DraftField[] = [
  "expenseMonth",
  "sharedCategoryId",
  "ownShare",
];

// Why a recorded transaction isn't edited here, by kind.
const otherAction: Partial<Record<Transaction["kind"], string>> = {
  "card-payment": "Card payments are changed from the card payment action.",
  "loan-payment": "Loan payments are changed from the loan's payment action.",
  reimbursement: "Reimbursements are changed from the reimbursement they pay.",
  settlement: "Settlements are changed from the shared balance.",
  "statement-credit": "Statement credits are changed from the card's credits.",
};

export function editGuidance(transaction: Transaction) {
  return editableKinds.includes(transaction.kind)
    ? null
    : (otherAction[transaction.kind] ??
        "This transaction is changed from its own action.");
}

function hasDetails(draft: TransactionDraft) {
  return (
    Boolean(draft.sharedCategoryId) ||
    draft.expenseMonth !== draft.date.slice(0, 7)
  );
}

export function useTransactionEntryController({
  saver,
  placement,
  onPlacementChange,
  reveal,
}: {
  saver: TransactionSaver;
  placement: TransactionPlacement;
  onPlacementChange: (placement: TransactionPlacement) => void;
  // Shows the editor's placement when it opens or moves, and puts the panels
  // back when it closes (null).
  reveal: (placement: TransactionPlacement | null) => void;
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
  // same action where it now renders.
  const returning = useRef(false);
  useEffect(() => {
    if (open || !returning.current) return;
    returning.current = false;
    const target = opener.current;
    opener.current = null;
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
    if (saving.current) return;
    setSession(null);
    attempt.current = null;
    reveal(null);
    returning.current = restore;
    if (!restore) opener.current = null;
  };

  // Opens a new transaction, or an existing one by id. Refused while another
  // editor is open or a change is still saving.
  const start = ({
    transactionId,
    accountId,
  }: {
    transactionId?: string;
    accountId?: string | null;
  }) => {
    if (session || saver.busy || !view.accounts.length) return false;
    const transaction = transactionId
      ? view.budget.transactions.find(
          (item) => item.id === transactionId && !item.removed,
        )
      : undefined;
    if (transactionId && (!transaction || editGuidance(transaction)))
      return false;
    const draft = createTransactionDraft(
      view,
      view.month,
      transaction,
      accountId ?? undefined,
    );
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
      detailsOpen: hasDetails(draft),
    });
    reveal(placement);
    focus(transaction ? "categoryId" : "payee", true);
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
        const keys = Object.keys(failure.fields) as DraftField[];
        patch({
          fields: failure.fields,
          error: "",
          detailsOpen:
            session.detailsOpen ||
            keys.some((key) => detailFields.includes(key)),
        });
        focus(keys[0] ?? "payee");
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
                detailsOpen: current.detailsOpen && hasDetails(next),
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

  const setPlacement = (next: TransactionPlacement) => {
    if (next === placement) return;
    onPlacementChange(next);
    if (session) {
      reveal(next);
      focus("placement");
    }
  };

  // Leaving the register would hide unsaved work, so it waits for Save or
  // Cancel. An untouched editor just closes. Returns whether to stay.
  const holdForDraft = () => {
    if (!session) return false;
    if (dirty || submitting || saving.current) {
      patch({ error: "Save or cancel this transaction first." });
      reveal(placement);
      focus("error");
      return true;
    }
    close(false);
    return false;
  };

  return {
    view,
    busy: saver.busy,
    placement,
    setPlacement,
    session,
    latest,
    removed,
    dirty,
    submitting,
    start,
    change,
    setDetailsOpen: (detailsOpen: boolean) => patch({ detailsOpen }),
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
