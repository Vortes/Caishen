"use client";

import type { ReactNode } from "react";
import { Field } from "~/components/ui/field";
import styles from "./transaction-entry.module.css";

// The pieces of a register's editor row: a card that rises where the row
// stood, fields under the register's own column headers, and its actions.
// The transaction editor and the partner ledger's entry editor share them.

export function EditorForm({
  id,
  title,
  onSubmit,
  onCancel,
  children,
}: {
  id: string;
  title: string;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <form
      id={id}
      className={styles.form}
      aria-labelledby={`${id}-title`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      onKeyDown={(event) => {
        // The register moves its selection with the arrow keys; inside the
        // editor they belong to the fields.
        if (event.key === "ArrowDown" || event.key === "ArrowUp")
          event.stopPropagation();
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (event.defaultPrevented) return;
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={`${id}-title`} className="sr-only">
        {title}
      </h2>
      {children}
    </form>
  );
}

// A field in the editor row, under its column. The column header names it
// on screen; the label stays for screen readers, and shows on a phone where
// the row stacks. id is the control's when it isn't a ui input, such as a
// date or a list; it points aria-describedby at `${id}-error` itself.
export function EditorCell({
  column,
  label,
  id,
  error,
  sharedErrorId,
  children,
}: {
  column: string;
  label: string;
  id?: string;
  error?: string;
  // One message for this cell and the one beside it; see Field.
  sharedErrorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.cell} data-column={column}>
      <Field
        id={id}
        label={label}
        labelHidden
        error={error}
        sharedErrorId={sharedErrorId}
      >
        {children}
      </Field>
    </div>
  );
}

// A field the editor shows but doesn't change, as it reads in the row: its
// text stays exactly where the row's was.
export function EditorText({
  column,
  numeric = false,
  children,
}: {
  column: string;
  numeric?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`${styles.cell} ${styles.staticCell}`}
      data-column={column}
      data-numeric={numeric || undefined}
    >
      {children}
    </div>
  );
}

// Under the fields, set apart by a divider: what to know, then the actions.
export function EditorFooter({
  children,
  actions,
}: {
  children?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className={styles.rowFooter}>
      {children}
      <div className={styles.actions}>{actions}</div>
    </div>
  );
}
