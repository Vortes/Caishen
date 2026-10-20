"use client";

import { CircleAlertIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { parseAssignedAmount } from "~/components/budget/assigned-amount";
import { newId } from "~/components/budget/format";
import type { Command } from "~/domain/engine";
import { money, type Category } from "./model";
import { useShellData } from "./shell-data";
import shell from "./shell.module.css";
import styles from "./assigned.module.css";

export type AssignMoney = {
  // The saved revision on screen. An edit is checked against the revision it
  // was opened under, so it never changes an amount the user hasn't seen.
  revision: number;
  // A change is saving, the month is loading, or the budget couldn't
  // refresh, so nothing can be saved yet.
  busy: boolean;
  // Sends the assignment with a summary for its confirmation, calling
  // settled with whether the server saved it. Returns why it can't be sent
  // right now, or null once it's on its way.
  assign: (
    command: Command,
    summary: string,
    settled: (saved: boolean) => void,
  ) => string | null;
  // The operation id for an intended total, from useAssignAttempts.
  attemptId: (intent: Intent) => string;
  // Shows a problem in the shell's notice.
  alert: (message: string) => void;
  // Called with a cleanup while an editor is open, so the shell can hold its
  // undo shortcut until it closes.
  holdOpen: () => () => void;
};

const AssignMoneyContext = createContext<AssignMoney | null>(null);

export const AssignMoneyProvider = AssignMoneyContext.Provider;

// A total someone meant to assign, from the saved revision it was typed over.
type Intent = {
  categoryId: string;
  month: string;
  revision: number;
  total: number;
};

// Gives each intended total one operation id, like the legacy plan's
// assignment attempts. Retrying any total from the same revision reuses its
// id, even after another total was tried or the row was hidden, so the
// server can't apply it twice. Held by the workspace, not the row.
export function useAssignAttempts(revision: number) {
  const attempts = useRef(new Map<string, string>());
  useEffect(() => {
    attempts.current.clear();
  }, [revision]);
  return useCallback((intent: Intent) => {
    const key = `${intent.revision}:${intent.month}:${intent.categoryId}:${intent.total}`;
    const id = attempts.current.get(key) ?? newId();
    attempts.current.set(key, id);
    return id;
  }, []);
}

function useAssignMoney() {
  const value = useContext(AssignMoneyContext);
  if (!value) throw new Error("useAssignMoney needs an AssignMoneyProvider.");
  return value;
}

// What an edit started from: the amount on screen, in the month and
// revision on screen when it opened.
type Base = { month: string; revision: number; assigned: number };

type Editor = {
  base: Base;
  draft: string;
  error: string | null;
  saving: boolean;
};

// The plan row's Assigned amount, edited in place like YNAB. It sits over
// the row's own Assigned cell, the way the Available pill does, since a
// button can't hold another. The amount typed is the new total; the change
// from what was assigned is sent as the legacy plan's assign command.
export function AssignedCell({ category }: { category: Category }) {
  const { busy, revision, assign, attemptId, alert, holdOpen } =
    useAssignMoney();
  const { month } = useShellData();
  const [editor, setEditor] = useState<Editor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Whether the field takes a commit: not once it has closed, and not from
  // the moment a save is sent until it settles, so Enter and the blur that
  // follows, or a second Enter, can't send it twice.
  const ready = useRef(false);
  // Each save's turn; a save that settles after its editor closed is ignored.
  const turn = useRef(0);
  const refocus = useRef(false);
  const errorId = useId();
  const editing = editor !== null;
  useEffect(() => (editing ? holdOpen() : undefined), [editing, holdOpen]);

  useLayoutEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    buttonRef.current?.focus();
  }, [editing]);

  // An edit belongs to the month it was opened in. Moving to another month
  // drops it unsaved rather than assigning there.
  const openMonth = editor?.base.month;
  useEffect(() => {
    if (openMonth && openMonth !== month.key) {
      turn.current++;
      ready.current = false;
      setEditor(null);
    }
  }, [openMonth, month.key]);

  const open = () => {
    if (busy || editing) return;
    ready.current = true;
    setEditor({
      base: { month: month.key, revision, assigned: category.assigned },
      draft: (category.assigned / 100).toFixed(2),
      error: null,
      saving: false,
    });
  };

  const close = (returnFocus: boolean) => {
    turn.current++;
    ready.current = false;
    refocus.current = returnFocus;
    setEditor(null);
  };

  const fail = (message: string) =>
    setEditor((value) => value && { ...value, error: message });

  const commit = (fromKeyboard: boolean) => {
    if (!editor || !ready.current) return;
    let total: number;
    try {
      total = parseAssignedAmount(editor.draft);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Enter a dollar amount.";
      fail(message);
      alert(message);
      return;
    }
    const { base } = editor;
    if (base.month !== month.key) return close(fromKeyboard);
    if (base.revision !== revision) {
      // Someone else's change arrived while this was open. Start again from
      // the amount it left, and let the user confirm the total.
      setEditor({
        ...editor,
        base: { ...base, revision, assigned: category.assigned },
        error: `Assigned changed to ${money(category.assigned)} while you were editing. Save again to make it ${money(total)}.`,
      });
      return;
    }
    const amount = total - base.assigned;
    if (!Number.isSafeInteger(amount)) {
      fail("That amount is too large.");
      return;
    }
    if (amount === 0) return close(fromKeyboard);

    const id = attemptId({
      categoryId: category.id,
      month: base.month,
      revision: base.revision,
      total,
    });
    ready.current = false;
    const mine = ++turn.current;
    const blocked = assign(
      {
        type: "assign",
        id,
        categoryId: category.id,
        month: base.month,
        amount,
      },
      `${category.name} now has ${money(total)} assigned`,
      (saved) => {
        if (turn.current !== mine) return;
        if (saved) {
          // Focus goes back to the amount only if it's still in the field
          // the user saved from.
          const input = inputRef.current;
          close(
            fromKeyboard &&
              Boolean(input) &&
              (document.activeElement === input ||
                document.activeElement === document.body),
          );
        } else {
          ready.current = true;
          setEditor(
            (value) =>
              value && {
                ...value,
                saving: false,
                error: "This amount couldn’t be saved. Try again.",
              },
          );
        }
      },
    );
    if (blocked) {
      ready.current = true;
      fail(blocked);
      return;
    }
    setEditor({ ...editor, error: null, saving: true });
  };

  return (
    <div
      className={`${shell.columns} ${styles.overlay}`}
      data-editing={editing || undefined}
    >
      <div className={styles.cell} data-optional>
        {editor ? (
          <form
            className={styles.form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              commit(true);
            }}
            // Keeps the plan's arrow-key and x shortcuts out of the field.
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div
              className={styles.field}
              data-invalid={editor.error ? "" : undefined}
            >
              <input
                ref={inputRef}
                // Opened by a click or a key on the amount, so focus follows.
                autoFocus
                aria-label={`Assigned amount for ${category.name}`}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                data-1p-ignore
                value={editor.draft}
                readOnly={editor.saving}
                aria-busy={editor.saving || undefined}
                aria-invalid={editor.error ? true : undefined}
                aria-describedby={editor.error ? errorId : undefined}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  const draft = event.target.value;
                  setEditor((value) => value && { ...value, draft });
                }}
                onBlur={() => commit(false)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  // A save on its way can't be called back.
                  if (editor.saving) return;
                  close(true);
                }}
              />
            </div>
            {editor.error && (
              <p className={styles.error} id={errorId} role="alert">
                <CircleAlertIcon size={13} aria-hidden />
                {editor.error}
              </p>
            )}
          </form>
        ) : (
          <button
            ref={buttonRef}
            type="button"
            className={styles.amount}
            aria-label={`${money(category.assigned)} assigned to ${category.name}. Edit assigned amount`}
            aria-disabled={busy || undefined}
            onClick={open}
          >
            {money(category.assigned)}
          </button>
        )}
      </div>
    </div>
  );
}
