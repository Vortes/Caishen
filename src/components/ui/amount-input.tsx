"use client";

import { useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { readAmount } from "~/components/budget/amount";
import {
  caretAfterSameDigit,
  groupThousands,
} from "~/components/budget/format";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { useFieldControl } from "./field";
import styles from "./field.module.css";
import { usePortalContainer } from "./surface";
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
  align,
  negative = false,
}: Omit<
  TextInputProps,
  | "prefix"
  | "suffix"
  | "inputMode"
  | "type"
  | "autoComplete"
  | "required"
  | "minLength"
  | "maxLength"
> & {
  // Right-aligned, under a register's amount column.
  align?: "start" | "end";
  // The amount takes money out, as a ledger's negative figures do: "-$".
  negative?: boolean;
}) {
  const { report } = useFieldControl();
  const input = useRef<HTMLInputElement>(null);
  // Where the caret goes once the grouped text renders.
  const caret = useRef<number | null>(null);
  // Once it has said the text can't be read, it rechecks as you type and
  // clears the message as soon as the text reads.
  const unreadable = useRef(false);
  const coarse = useMediaQuery("(pointer: coarse)");
  const [focused, setFocused] = useState(false);
  const flag = (message: string | null) => {
    unreadable.current = message !== null;
    report(message);
  };
  useLayoutEffect(() => {
    if (caret.current === null) return;
    input.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  // Typing and the operator keys both come through here: `at` is where the
  // caret sits in the text as typed.
  const type = (text: string, at = input.current?.selectionStart) => {
    const grouped = groupThousands(text);
    caret.current = caretAfterSameDigit(text, at ?? text.length, grouped);
    if (unreadable.current && (!grouped.trim() || readAmount(grouped).ok))
      flag(null);
    onChange(grouped);
  };

  return (
    <>
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
        prefix={negative ? "-$" : "$"}
        align={align}
        inputMode="decimal"
        onChange={type}
        onFocus={(event) => {
          setFocused(true);
          event.currentTarget.select();
        }}
        onBlur={() => {
          setFocused(false);
          // An empty field is the screen's to judge when it submits.
          if (readOnly || !value.trim()) return;
          const reading = readAmount(value);
          if (!reading.ok) flag(reading.message);
          // A plain amount is already what will be saved; only a
          // calculation, or digits past the cent, become the result.
          else if (!plainAmount.test(value))
            onChange(groupThousands(dollars(reading.cents)));
        }}
      />
      {coarse && focused && !readOnly && (
        <OperatorRow
          onKey={(key) => {
            const start = input.current?.selectionStart ?? value.length;
            const end = input.current?.selectionEnd ?? start;
            type(
              value.slice(0, start) + key + value.slice(end),
              start + key.length,
            );
          }}
        />
      )}
    </>
  );
}

const operators = [
  { key: "+", name: "Plus" },
  { key: "−", name: "Minus" },
  { key: "×", name: "Times" },
  { key: "÷", name: "Divide by" },
  { key: "^", name: "To the power of" },
  { key: "(", name: "Open parenthesis" },
  { key: ")", name: "Close parenthesis" },
];

// Keys a decimal keypad doesn't have, over the on-screen keyboard. The
// keyboard shrinks the visual viewport, not the layout viewport fixed
// elements sit in, so the row follows the visual viewport's bottom edge.
function OperatorRow({ onKey }: { onKey: (key: string) => void }) {
  const container = usePortalContainer();
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const follow = () => {
      const style = row.current?.style;
      if (!style) return;
      const layout = document.documentElement;
      const below = layout.clientHeight - viewport.offsetTop - viewport.height;
      const right = layout.clientWidth - viewport.offsetLeft - viewport.width;
      style.bottom = `${Math.max(0, below)}px`;
      style.left = `${viewport.offsetLeft}px`;
      style.right = `${Math.max(0, right)}px`;
    };
    follow();
    viewport.addEventListener("resize", follow);
    viewport.addEventListener("scroll", follow);
    return () => {
      viewport.removeEventListener("resize", follow);
      viewport.removeEventListener("scroll", follow);
    };
  }, []);
  return createPortal(
    <div ref={row} className={styles.operators}>
      {operators.map(({ key, name }) => (
        <button
          key={key}
          type="button"
          tabIndex={-1}
          className={styles.operator}
          aria-label={name}
          // The input keeps focus, so the keyboard stays up.
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onKey(key)}
        >
          {key}
        </button>
      ))}
    </div>,
    container ?? document.body,
  );
}

function assign<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

// An amount as a person writes one: no operators, at most two decimals.
const plainAmount = /^\s*-?\$?(?:[\d,]+(?:\.\d{0,2})?|\.\d{1,2})\s*$/;

// Cents as the text a person would type: "-1234.50".
function dollars(cents: number) {
  const size = Math.abs(cents);
  const fraction = String(size % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${Math.floor(size / 100)}.${fraction}`;
}
