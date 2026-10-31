"use client";

import type { FocusEvent, HTMLAttributes, Ref } from "react";
import { useFieldControl } from "./field";
import styles from "./field.module.css";

export type TextInputProps = {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  // "password" hides what's typed. Never a number: see fields.md.
  type?: "text" | "email" | "password";
  // For what the browser and password managers should offer. Off, the
  // default, also keeps 1Password out.
  autoComplete?:
    | "off"
    | "name"
    | "email"
    | "username"
    | "current-password"
    | "new-password"
    | "one-time-code";
  // Short text in the well, before or after the value: "$", "%", "years".
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
  readOnly?: boolean;
  inputRef?: Ref<HTMLInputElement>;
};

// One line of text in the field's well, named and described by the Field
// around it.
export function TextInput(props: TextInputProps) {
  return <WellInput {...props} />;
}

// The well itself, for the ui inputs built on it (AmountInput). Screens use
// TextInput or AmountInput.
export function WellInput({
  value,
  onChange,
  name,
  placeholder,
  required,
  minLength,
  maxLength,
  inputMode,
  type = "text",
  autoComplete = "off",
  prefix,
  suffix,
  disabled,
  readOnly,
  inputRef,
  align = "start",
  onFocus,
  onBlur,
}: TextInputProps & {
  // Where the value sits in the well; amounts in a register's columns end
  // where the column's figures do.
  align?: "start" | "end";
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  const field = useFieldControl();
  return (
    <div
      className={styles.well}
      data-well=""
      data-invalid={field.invalid ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      data-align={align}
    >
      {prefix && (
        <span className={styles.affix} aria-hidden>
          {prefix}
        </span>
      )}
      <input
        ref={inputRef}
        id={field.id}
        name={name}
        type={type}
        className={styles.input}
        value={value}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        inputMode={inputMode}
        disabled={disabled}
        readOnly={readOnly}
        autoComplete={autoComplete}
        data-1p-ignore={autoComplete === "off" ? "" : undefined}
        spellCheck={false}
        aria-labelledby={field.labelledBy}
        aria-invalid={field.invalid ? true : undefined}
        aria-describedby={field.describedBy}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {suffix && (
        <span className={styles.affix} aria-hidden>
          {suffix}
        </span>
      )}
    </div>
  );
}
