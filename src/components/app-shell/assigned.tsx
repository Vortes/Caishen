"use client";

import { groupAmountInput } from "~/components/budget/amount-input";
import { CircleAlertIcon } from "lucide-react";
import {
  createContext,
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
  // Sets the month's total for a category: it shows at once and saves in
  // the background, confirmed with the summary. Returns why it can't apply,
  // or null once it's on its way.
  assign: (command: Command, summary: string) => string | null;
  // Shows a problem in the shell's notice.
  alert: (message: string) => void;
  // Called with a cleanup while an editor is open, so the shell can hold its
  // undo shortcut until it closes.
  holdOpen: () => () => void;
};

const AssignMoneyContext = createContext<AssignMoney | null>(null);

export const AssignMoneyProvider = AssignMoneyContext.Provider;

function useAssignMoney() {
  const value = useContext(AssignMoneyContext);
  if (!value) throw new Error("useAssignMoney needs an AssignMoneyProvider.");
  return value;
}

// What an edit started from: the amount on screen in the month on screen
// when it opened.
type Base = { month: string; assigned: number };

type Editor = {
  base: Base;
  draft: string;
  error: string | null;
};

// The plan row's Assigned amount, edited in place like YNAB. It sits over
// the row's own Assigned cell, the way the Available pill does, since a
// button can't hold another. The amount typed is the month's new total.
export function AssignedCell({ category }: { category: Category }) {
  const { assign, alert, holdOpen } = useAssignMoney();
  const { month } = useShellData();
  const [editor, setEditor] = useState<Editor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Whether the field takes a commit: not once it has closed, so Enter and
  // the blur that follows can't send it twice.
  const ready = useRef(false);
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
      ready.current = false;
      setEditor(null);
    }
  }, [openMonth, month.key]);

  // A blur that fails to save leaves the field open with its error but
  // without focus, so Escape anywhere still drops the edit back to the
  // amount it opened with.
  const failed = editor?.error != null;
  useEffect(() => {
    if (!failed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (inputRef.current?.contains(event.target as Node)) return;
      ready.current = false;
      refocus.current = document.activeElement === document.body;
      setEditor(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [failed]);

  const open = () => {
    if (editing) return;
    ready.current = true;
    setEditor({
      base: { month: month.key, assigned: category.assigned },
      draft: (category.assigned / 100).toFixed(2),
      error: null,
    });
  };

  const close = (returnFocus: boolean) => {
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
    // An amount left as it opened changes nothing, even if the total moved
    // since (another tab): only what the user typed is sent.
    if (base.month !== month.key || total === base.assigned)
      return close(fromKeyboard);
    const blocked = assign(
      {
        type: "assign.set",
        id: newId(),
        categoryId: category.id,
        month: base.month,
        amount: total,
      },
      `${category.name} now has ${money(total)} assigned`,
    );
    if (blocked) return fail(blocked);
    // Focus goes back to the amount only if it's still in the field the
    // user saved from.
    const input = inputRef.current;
    close(
      fromKeyboard &&
        Boolean(input) &&
        (document.activeElement === input ||
          document.activeElement === document.body),
    );
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
                aria-invalid={editor.error ? true : undefined}
                aria-describedby={editor.error ? errorId : undefined}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  const draft = groupAmountInput(event.target);
                  setEditor((value) => value && { ...value, draft });
                }}
                onBlur={() => commit(false)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
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
            onClick={open}
          >
            {money(category.assigned)}
          </button>
        )}
      </div>
    </div>
  );
}
