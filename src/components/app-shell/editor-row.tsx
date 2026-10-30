"use client";

import { CircleAlertIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { groupAmountInput } from "~/components/budget/amount-input";
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

export function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className={styles.fieldError}>
      <CircleAlertIcon size={13} aria-hidden />
      {children}
    </p>
  );
}

// A field in the editor row, under its column. The column header names it
// on screen; the label stays for screen readers, and shows on a phone where
// the row stacks.
export function EditorCell({
  column,
  label,
  htmlFor,
  error,
  children,
}: {
  column: string;
  label: string;
  htmlFor: string;
  // Shown under the field; FieldError, or nothing.
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.cell} data-column={column}>
      <label htmlFor={htmlFor} className={styles.cellLabel}>
        {label}
      </label>
      {children}
      {error}
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

// An amount's well: right-aligned, with its sign in front.
export function AmountInput({
  id,
  name,
  value,
  placeholder,
  prefix = "$",
  invalid,
  describedBy,
  inputRef,
  onChange,
}: {
  id: string;
  name?: string;
  value: string;
  placeholder?: string;
  prefix?: string;
  invalid: boolean;
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className={styles.well}
      data-invalid={invalid ? "" : undefined}
      data-amount
    >
      <span className={styles.prefix} aria-hidden>
        {prefix}
      </span>
      <input
        ref={inputRef}
        id={id}
        name={name}
        className={styles.input}
        inputMode="decimal"
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => onChange(groupAmountInput(event.target))}
      />
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
