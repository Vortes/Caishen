"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";
import { money } from "../app-shell/model";
import { FieldError } from "../app-shell/move-money";
import { DateField } from "../app-shell/transaction-date";
// The shell's field wells and the target editor's layout, so every editor
// in the inspector looks the same.
import entry from "../app-shell/transaction-entry.module.css";
import target from "../app-shell/target-editor.module.css";
import { cashAccounts, TODAY } from "./data";

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

export function Select({
  id,
  value,
  onChange,
  children,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className={entry.well}>
      <select
        id={id}
        className={`${entry.input} ${target.select}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDownIcon size={14} className={target.chevron} aria-hidden />
    </div>
  );
}

export function AccountSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select id={id} value={value} onChange={onChange}>
      {cashAccounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name} · {money(account.balance)}
        </option>
      ))}
    </Select>
  );
}

// A number in a well with a prefix or suffix, like the target's amount.
export function NumberWell({
  id,
  value,
  prefix,
  suffix,
  error,
  hint,
  inputRef,
  onChange,
}: {
  id: string;
  value: string;
  prefix?: string;
  suffix?: string;
  error?: string;
  hint?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
}) {
  return (
    <div className={entry.well} data-invalid={error ? true : undefined}>
      {prefix && (
        <span className={target.prefix} aria-hidden>
          {prefix}
        </span>
      )}
      <input
        ref={inputRef}
        id={id}
        className={entry.input}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => onChange(event.target.value)}
      />
      {suffix && (
        <span className={target.prefix} aria-hidden>
          {suffix}
        </span>
      )}
    </div>
  );
}

export function DateInput({
  id,
  label,
  value,
  min,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DateField
      id={id}
      label={label}
      value={value}
      min={min}
      max={TODAY}
      today={TODAY}
      open={open}
      invalid={Boolean(error)}
      describedBy={error ? `${id}-error` : undefined}
      onOpenChange={setOpen}
      onChange={onChange}
      onPicked={() => undefined}
      onAdvance={() => undefined}
    />
  );
}

// Dollars typed as text, in cents; null when it isn't an amount.
export function parseCents(text: string) {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d*(\.\d{0,2})?$/.test(clean) || clean === "" || clean === ".")
    return null;
  return Math.round(Number(clean) * 100);
}

export const centsText = (cents: number) => (cents / 100).toFixed(2);

export const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
