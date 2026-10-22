"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";
import { FieldError } from "../app-shell/move-money";
import { DateField } from "../app-shell/transaction-date";
import entry from "../app-shell/transaction-entry.module.css";
import target from "../app-shell/target-editor.module.css";
import { TODAY } from "./data";

// The shell's form fields, as the target editor lays them out in the
// inspector: a label above a filled well, an error under it, then a hint.
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={target.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <FieldError id={`${id}-error`} message={error} />}
      {hint && (
        <p className={target.hint} id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function describedBy(id: string, error?: string, hint?: boolean) {
  return (
    [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") ||
    undefined
  );
}

export function Well({
  id,
  value,
  prefix,
  suffix,
  placeholder,
  error,
  hint,
  inputRef,
  align,
  readOnly,
  onChange,
}: {
  id: string;
  value: string;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  error?: string;
  hint?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  align?: "end";
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className={entry.well}
      data-invalid={error ? "" : undefined}
      data-amount={align === "end" || undefined}
      data-disabled={readOnly ? "" : undefined}
    >
      {prefix && (
        <span className={entry.prefix} aria-hidden>
          {prefix}
        </span>
      )}
      <input
        ref={inputRef}
        id={id}
        className={entry.input}
        inputMode={prefix || suffix ? "decimal" : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        onFocus={(event) => {
          if (prefix || suffix) event.currentTarget.select();
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      {suffix && (
        <span className={entry.prefix} aria-hidden>
          {suffix}
        </span>
      )}
    </div>
  );
}

// A native select in the shell's field well, like the target editor's.
export function Select({
  id,
  value,
  error,
  onChange,
  children,
}: {
  id: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className={entry.well} data-invalid={error ? "" : undefined}>
      <select
        id={id}
        className={`${entry.input} ${target.select}`}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error)}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDownIcon size={14} className={target.chevron} aria-hidden />
    </div>
  );
}

// The shell's date field with its calendar, holding its own open state.
export function DayField({
  id,
  label,
  value,
  min,
  error,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: string;
  error?: string;
  hint?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DateField
      id={id}
      label={label}
      value={value}
      min={min}
      today={TODAY}
      open={open}
      invalid={Boolean(error)}
      describedBy={describedBy(id, error, hint)}
      onOpenChange={setOpen}
      onChange={onChange}
      onPicked={() => undefined}
      onAdvance={() => undefined}
    />
  );
}

export type Errors<T extends string> = Partial<Record<T, string>>;

// Focuses the first field with an error, in the form's order.
export function focusFirst(form: HTMLElement | null, ids: string[]) {
  for (const id of ids) {
    const element = form?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (element) {
      element.focus();
      return;
    }
  }
}
