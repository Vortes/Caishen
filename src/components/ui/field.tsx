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
  hint,
  error,
  children,
}: {
  // Only for a control that isn't a ui input yet, such as a combobox or a
  // date field: it takes this id and points aria-describedby at
  // `${id}-error` and `${id}-hint` itself.
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const generated = useId();
  const id = givenId ?? generated;
  const [reported, report] = useState<string | null>(null);
  const shown = error ?? reported;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [shown && errorId, hint && hintId].filter(Boolean).join(" ") || undefined;
  return (
    <FieldContext.Provider
      value={{ id, describedBy, invalid: !!shown, report }}
    >
      <div className={styles.field}>
        <label htmlFor={id} className={styles.label}>
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
