"use client";

import { useLayoutEffect, useRef, type Ref } from "react";
import { readAmount } from "~/components/budget/amount";
import { groupThousands } from "~/components/budget/format";
import { useFieldControl } from "./field";
import { WellInput, type TextInputProps } from "./text-input";

// Money in a Field: "$" in front, thousands grouped as you type, the whole
// amount selected on focus. A calculation becomes its result when you leave
// the field; text it can't read stays, and its Field says why. The screen
// reads cents on submit with readAmount(value).
export function AmountInput({
  value,
  onChange,
  name,
  placeholder,
  disabled,
  readOnly,
  inputRef,
}: Omit<TextInputProps, "prefix" | "suffix" | "inputMode">) {
  const { report } = useFieldControl();
  const input = useRef<HTMLInputElement>(null);
  // Where the caret goes once the grouped text renders.
  const caret = useRef<number | null>(null);
  // Once it has said the text can't be read, it rechecks as you type and
  // clears the message as soon as the text reads.
  const unreadable = useRef(false);
  const flag = (message: string | null) => {
    unreadable.current = message !== null;
    report(message);
  };
  useLayoutEffect(() => {
    if (caret.current === null) return;
    input.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  const type = (text: string) => {
    const grouped = groupThousands(text);
    caret.current = caretAfterSameDigit(
      text,
      input.current?.selectionStart ?? text.length,
      grouped,
    );
    if (unreadable.current && (!grouped.trim() || readAmount(grouped).ok))
      flag(null);
    onChange(grouped);
  };

  return (
    <WellInput
      inputRef={(element) => {
        input.current = element;
        assign(inputRef, element);
      }}
      value={value}
      name={name}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      prefix="$"
      inputMode="decimal"
      onChange={type}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => {
        // An empty field is the screen's to judge when it submits.
        if (readOnly || !value.trim()) return;
        const reading = readAmount(value);
        if (reading.ok) onChange(groupThousands(dollars(reading.cents)));
        else flag(reading.message);
      }}
    />
  );
}

function assign<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

// The caret's place in the grouped text: after as many characters other
// than separators as it had before it.
function caretAfterSameDigit(text: string, at: number, grouped: string) {
  const before = text.slice(0, at).replace(/,/g, "").length;
  let caret = 0;
  for (let seen = 0; caret < grouped.length && seen < before; caret++)
    if (grouped[caret] !== ",") seen++;
  return caret;
}

// Cents as the text a person would type: "-1234.50".
function dollars(cents: number) {
  const size = Math.abs(cents);
  const fraction = String(size % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${Math.floor(size / 100)}.${fraction}`;
}
