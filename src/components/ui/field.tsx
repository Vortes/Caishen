"use client";

import { CircleAlertIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import styles from "./field.module.css";

type FieldContextValue = {
  id: string;
  // The label's text, for a control that names a list it opens (Select).
  label: string;
  // The label's id, for a control named by its label and its value
  // (FieldButton).
  labelId: string;
  describedBy?: string;
  invalid: boolean;
  // An input's own message about what was typed, such as an amount it
  // can't read; null clears it. The screen's error wins over it.
  report: (message: string | null) => void;
};

const FieldContext = createContext<FieldContextValue | null>(null);

// A label over its input, with an optional hint and an error under it. The
// ui inputs inside take their id, description and invalid state from it.
// The error is read when someone reaches the input; it is not announced.
export function Field({
  id: givenId,
  label,
  labelHidden = false,
  hint,
  error,
  sharedErrorId,
  children,
}: {
  // A known id in place of a generated one. Its error is `${id}-error`, so
  // a field beside it can name that error as its sharedErrorId (a target's
  // due month and year).
  id?: string;
  label: string;
  // Read by screen readers but not shown, where something else on screen
  // names the field, such as a register's column header.
  labelHidden?: boolean;
  hint?: string;
  error?: string;
  // The id of one error shown for this field and the ones beside it, such
  // as a register row's outflow and inflow: the field reads as invalid and
  // is described by it.
  sharedErrorId?: string;
  children: ReactNode;
}) {
  const generated = useId();
  const id = givenId ?? generated;
  const [reported, report] = useState<string | null>(null);
  const shown = error ?? reported;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const labelId = `${id}-label`;
  const describedBy =
    [shown ? errorId : sharedErrorId, hint && hintId]
      .filter(Boolean)
      .join(" ") || undefined;
  const invalid = Boolean(shown) || sharedErrorId !== undefined;
  return (
    <FieldContext.Provider
      value={{ id, label, labelId, describedBy, invalid, report }}
    >
      <div className={styles.field}>
        <label
          id={labelId}
          htmlFor={id}
          className={styles.label}
          data-hidden={labelHidden ? "" : undefined}
          // A click on it focuses a plain text field, but never reaches a
          // control that opens something (a list, a calendar, a menu):
          // only the well itself does that.
          onClick={(event) => {
            const control = document.getElementById(id);
            if (
              !(control instanceof HTMLInputElement) ||
              control.getAttribute("role") === "combobox"
            )
              event.preventDefault();
          }}
        >
          {label}
        </label>
        {children}
        {shown && (
          <p id={errorId} className={styles.error}>
            <CircleAlertIcon size={13} aria-hidden />
            {shown}
          </p>
        )}
        {hint && (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

// For the ui inputs inside a Field.
export function useFieldControl() {
  const field = useContext(FieldContext);
  if (!field) throw new Error("A field's input needs a Field around it.");
  return field;
}

// For a control that also stands alone (SegmentedControl): the Field around
// it, if there is one.
export function useOptionalFieldControl() {
  return useContext(FieldContext);
}

// One error under a row of fields that each point at it with sharedErrorId,
// so a narrow field's message isn't squeezed into its own column. Read when
// someone reaches a field; never announced.
export function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className={styles.error}>
      <CircleAlertIcon size={13} aria-hidden />
      {children}
    </p>
  );
}

// Why the form couldn't be sent, above its footer. The one error that is
// announced as it appears.
export function FormError({ children }: { children: string }) {
  return (
    <p className={styles.error} role="alert">
      <CircleAlertIcon size={13} aria-hidden />
      {children}
    </p>
  );
}

// Under a form's fields, set apart by a divider: what to know, then the
// actions at the end.
export function FormFooter({
  actions,
  children,
}: {
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.footer}>
      {children && <div className={styles.note}>{children}</div>}
      <div className={styles.actions}>{actions}</div>
    </div>
  );
}
