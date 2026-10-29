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
  draftAmount,
  lineField,
  type DraftFieldKey,
  type TransactionDraft,
  type TransactionDraftFields,
  type PreparedTransactionChange,
} from "~/components/transactions/transaction-draft";
import type { Command, CounterpartyShare } from "~/domain/engine";
import { isFullShare } from "~/domain/counterparty";
import {
  prepareTransactionShares,
  type ShareChoice,
} from "~/components/transactions/transaction-share";
import { prepareTransactionCategories } from "~/components/transactions/transaction-category";
import {
  rememberedCategory,
  rememberedCounterpartyShare,
  reimbursementShareForPayee,
} from "~/domain/payee-memory";
import {
  createImportDraft,
  importRowId,
  type BankImport,
  type PartnerImportMatch,
} from "~/components/transactions/import-draft";
import { transactionActions } from "~/components/transactions/transaction-actions";

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
  // Previews supported commands while the server checks the bank record.
  saveImport: (
    item: BankImport,
    command: Command,
    summary: string,
    refused?: () => void,
  ) => string | null;
  saveSelection: (
    changes: PreparedTransactionChange[],
    action: "share" | "categorize",
    refused: (rowId: string) => void,
  ) => { queuedIds: string[]; error?: string };
  // Holds the undo shortcut while the editor is open.
  holdOpen: () => () => void;
  // Says why a change made outside the editor couldn't apply.
  alert: (message: string) => void;
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
    (next ?? document.getElementById("app-content"))?.focus({
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
    counterpartyShare,
    shareLineId,
  }: {
    transactionId?: string;
    accountId?: string | null;
    field?: DraftField;
    // A share picked before the editor opened, such as from the register's
    // Share cell on a row that still needs its category.
    counterpartyShare?: CounterpartyShare | null;
    shareLineId?: string;
  }) => {
    if (session || !view.accounts.length) return false;
    const transaction = transactionId
      ? view.budget.transactions.find(
          (item) => item.id === transactionId && !item.removed,
        )
      : undefined;
    const imported = transactionId
      ? saver.imports.find((item) => importRowId(item) === transactionId)
      : undefined;
    const existing = imported ?? transaction;
    if (
      transactionId &&
      (!existing || transactionActions(view, existing).edit !== "transaction")
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
              ...(shareLineId && draft.lines.length
                ? {
                    lines: draft.lines.map((line) =>
                      line.lineId === shareLineId
                        ? {
                            ...line,
                            counterpartyShare: counterpartyShare && {
                              ...counterpartyShare,
                              amount: (counterpartyShare.amount / 100).toFixed(
                                2,
                              ),
                            },
                          }
                        : line,
                    ),
                  }
                : {
                    counterpartyShare: counterpartyShare && {
                      ...counterpartyShare,
                      amount: (counterpartyShare.amount / 100).toFixed(2),
                    },
                  }),
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
      const carryFullShare = <
        T extends Pick<
          TransactionDraft,
          "categoryId" | "counterpartyShare" | "outflow" | "inflow"
        >,
      >(
        before: T,
        after: T,
      ): T => {
        const share = before.counterpartyShare;
        if (
          share &&
          share === after.counterpartyShare &&
          Math.abs(draftAmount(before) ?? 0) ===
            Math.abs(draftAmount({ outflow: share.amount, inflow: "" }) ?? 0) &&
          (before.outflow !== after.outflow || before.inflow !== after.inflow)
        )
          after = {
            ...after,
            counterpartyShare: {
              ...share,
              amount: (Math.abs(draftAmount(after) ?? 0) / 100).toFixed(2),
            },
          };
        if (
          after.counterpartyShare &&
          Math.abs(draftAmount(after) ?? 0) ===
            Math.abs(
              draftAmount({
                outflow: after.counterpartyShare.amount,
                inflow: "",
              }) ?? 0,
            )
        )
          after = { ...after, categoryId: "" };
        return after;
      };
      Object.assign(draft, carryFullShare(current.draft, draft));
      draft.lines = draft.lines.map((line) =>
        carryFullShare(
          current.draft.lines.find((before) => before.lineId === line.lineId) ??
            line,
          line,
        ),
      );
      const shareChosen =
        Boolean(current.shareChosen) ||
        "counterpartyShare" in next ||
        "lines" in next;
      if (
        !shareChosen &&
        (!current.initial ||
          (current.initial.kind === "purchase" &&
            !current.initial.categoryId &&
            !current.initial.counterpartyShare &&
            !current.initial.lines?.length)) &&
        !draft.lines.length &&
        ["payee", "accountId", "outflow", "inflow"].some((key) => key in next)
      ) {
        const share = (
          current.initial
            ? reimbursementShareForPayee
            : rememberedCounterpartyShare
        )(view.budget, {
          payee: draft.payee,
          accountId: draft.accountId,
          amount:
            draft.outflow || draft.inflow ? draftAmount(draft) : undefined,
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
            amount:
              draft.outflow || draft.inflow ? draftAmount(draft) : undefined,
          }) ?? unremembered;
      if (
        draft.counterpartyShare &&
        Math.abs(draftAmount(draft) ?? 0) ===
          Math.abs(
            draftAmount({
              outflow: draft.counterpartyShare.amount,
              inflow: "",
            }) ?? 0,
          )
      )
        draft.categoryId = "";
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
    const refused = reopenOnRefusal(session);
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

  // The editor closes as the change shows. If the server turns it down,
  // the draft comes back with what went wrong, unless another editor is
  // open by then.
  const reopenOnRefusal = (sent: TransactionSession) => () => {
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

  // Saves the open bank import as the purchase a partner recorded before
  // it arrived, with the category the editor shows for the payer's part.
  const matchImport = (match: PartnerImportMatch) => {
    const imported = session?.imported;
    if (!session || !imported?.accountId || removed) return;
    const categoryId = session.draft.lines.length
      ? ""
      : session.draft.categoryId || (match.categoryId ?? "");
    if (
      match.share !== Math.abs(imported.amount) &&
      (!categoryId || categoryId === READY_TO_ASSIGN)
    ) {
      patch({
        fields: { categoryId: "Choose a category for your part of it." },
        error: "",
      });
      focus("categoryId");
      return;
    }
    const blocked = saver.saveImport(
      imported,
      {
        type: "partner.match",
        id: newId(),
        recordedAt: new Date().toISOString(),
        entryId: match.entryId,
        transactionId: session.entityId,
        accountId: imported.accountId,
        date: imported.date,
        amount: imported.amount,
        status: imported.pending ? "pending" : "posted",
        categoryId:
          match.share === Math.abs(imported.amount) ? undefined : categoryId,
      },
      `Matched your import to ${match.payee}`,
      reopenOnRefusal(session),
    );
    if (blocked) {
      patch({ fields: {}, error: blocked });
      focus("error");
      return;
    }
    close();
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
    if (transactionActions(view, transaction).share !== "edit")
      return "This transaction cannot be shared.";
    const draft = createTransactionDraft(view, view.month, transaction);
    const line =
      transaction.lines?.find((item) => item.id === lineId) ?? transaction;
    if (
      !line.categoryId &&
      !isFullShare({ amount: line.amount, counterpartyShare: share })
    )
      return start({
        transactionId,
        field: draft.lines.length
          ? lineField(lineId, "categoryId")
          : "categoryId",
        counterpartyShare: share,
        shareLineId: lineId,
      })
        ? null
        : "Save or cancel the open transaction first.";
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

  // Flips a transaction between cleared and uncleared from the register's
  // C column, as the editor would with nothing else changed. A bank import
  // is recorded with the new status and still waits for review.
  const toggleCleared = (rowId: string) => {
    const transaction = view.budget.transactions.find(
      (item) => item.id === rowId && !item.removed,
    );
    const imported = transaction
      ? undefined
      : saver.imports.find((item) => importRowId(item) === rowId);
    const existing = transaction ?? imported;
    if (!existing || transactionActions(view, existing).edit !== "transaction")
      return;
    const before = imported
      ? createImportDraft(view, imported)
      : createTransactionDraft(view, view.month, transaction);
    const cleared = !before.cleared;
    const summary = `Marked ${before.payee.trim()} ${cleared ? "cleared" : "uncleared"}`;
    let blocked: string | null;
    try {
      const command = buildTransactionDraftCommand({
        draft: { ...before, cleared },
        view,
        transaction,
        operationId: newId(),
        entityId: transaction?.id ?? newId(),
      });
      blocked = imported
        ? saver.saveImport(
            imported,
            command.type === "transaction.upsert"
              ? { ...command, reviewed: false }
              : command,
            summary,
          )
        : saver.save(command, summary);
    } catch (failure) {
      blocked =
        failure instanceof Error
          ? failure.message
          : "This transaction couldn't be saved. Try again.";
    }
    if (blocked) saver.alert(blocked);
  };

  return {
    view,
    holdOpen,
    saveCommand: saver.save,
    categorizeSelection: (
      ids: string[],
      categoryId: string,
      refused: (rowId: string) => void,
    ) => {
      if (session)
        return {
          queuedIds: [],
          error: "Save or cancel the open transaction first.",
        };
      try {
        return saver.saveSelection(
          prepareTransactionCategories(view, saver.imports, ids, categoryId),
          "categorize",
          refused,
        );
      } catch (failure) {
        return {
          queuedIds: [],
          error:
            failure instanceof Error
              ? failure.message
              : "These categories couldn't be saved. Try again.",
        };
      }
    },
    saveShare,
    toggleCleared,
    shareSelection: (
      ids: string[],
      choice: ShareChoice,
      categoryId: string,
      refused: (rowId: string) => void,
    ) => {
      if (session)
        return {
          queuedIds: [],
          error: "Save or cancel the open transaction first.",
        };
      try {
        return saver.saveSelection(
          prepareTransactionShares(
            view,
            saver.imports,
            ids,
            choice,
            categoryId,
          ),
          "share",
          refused,
        );
      } catch (failure) {
        return {
          queuedIds: [],
          error:
            failure instanceof Error
              ? failure.message
              : "These shares couldn't be saved. Try again.",
        };
      }
    },
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
    matchImport,
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
