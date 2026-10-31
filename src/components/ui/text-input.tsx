"use client";

import type { FocusEvent, HTMLAttributes, Ref } from "react";
import { useFieldControl } from "./field";
import styles from "./field.module.css";

export type TextInputProps = {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  // Never "number": it rejects "1,000" and shows spinners.
  type?: "text" | "email" | "password";
  placeholder?: string;
  // What the browser may fill in: "name", "email", "one-time-code",
  // "current-password". Off, the default, also keeps 1Password out.
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
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
  type = "text",
  placeholder,
  autoComplete = "off",
  required,
  minLength,
  maxLength,
  inputMode,
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
