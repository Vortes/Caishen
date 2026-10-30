"use client";

import type { FocusEvent, HTMLAttributes, Ref } from "react";
import { useFieldControl } from "./field";
import styles from "./field.module.css";

export type TextInputProps = {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  placeholder?: string;
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
  placeholder,
  inputMode,
  prefix,
  suffix,
  disabled,
  readOnly,
  inputRef,
  onFocus,
  onBlur,
}: TextInputProps & {
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  const field = useFieldControl();
  return (
    <div
      className={styles.well}
      data-invalid={field.invalid ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
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
        className={styles.input}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        disabled={disabled}
        readOnly={readOnly}
        autoComplete="off"
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
