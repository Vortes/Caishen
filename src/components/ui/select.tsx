"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { useFieldControl } from "./field";
import styles from "./field.module.css";
import { Popover } from "./popover";

export type SelectOption = { value: string; label: string };

// One choice from a short list, in the field's well. It opens a list on the
// Popover module as wide as the well; the current choice carries a check and
// takes focus. The arrow keys, Home, End and typing move, Enter or a click
// picks, Escape closes, and focus returns to the well. Inside a Field, which names and describes
// it; a name sends the value with the form.
export function Select({
  value,
  onChange,
  options,
  name,
  placeholder,
  disabled,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  // Sends the value with the form, through a hidden input.
  name?: string;
  // Shown while the value matches no option.
  placeholder?: string;
  disabled?: boolean;
  // For a form that focuses the select after a failed save.
  inputRef?: Ref<HTMLButtonElement>;
}) {
  const field = useFieldControl();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value);
  const pick = (next: string) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };
  // What's been typed to find an option; it clears after a pause.
  const search = useRef({ text: "", at: 0 });
  // The arrow keys, Home and End move focus from option to option; typing
  // moves it to the next option that starts with what's typed. Enter, or
  // Space when nothing is being typed, picks the focused option.
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'),
    ];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const typing = Date.now() - search.current.at < 500;
    if (!typing) search.current.text = "";
    if (event.key === "Enter" || (event.key === " " && !typing)) {
      event.preventDefault();
      if (at >= 0) pick(options[at]!.value);
      return;
    }
    let to: number | undefined;
    if (event.key === "ArrowDown") to = Math.min(at + 1, rows.length - 1);
    else if (event.key === "ArrowUp") to = Math.max(at - 1, 0);
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = rows.length - 1;
    else if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const text = search.current.text + event.key.toLowerCase();
      search.current = { text, at: Date.now() };
      // A first letter looks past the focused option, so pressing it again
      // steps through the options that start with it.
      const from = text.length === 1 ? at + 1 : Math.max(at, 0);
      const found = [...options.keys()]
        .map((offset) => (from + offset) % options.length)
        .find((index) => options[index]!.label.toLowerCase().startsWith(text));
      if (found === undefined) return;
      to = found;
    }
    if (to === undefined) return;
    if (event.key.length !== 1) search.current.text = "";
    event.preventDefault();
    rows[to]?.focus();
  };
  return (
    <>
      <Popover
        label={field.label}
        size="trigger"
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button
            ref={inputRef}
            type="button"
            role="combobox"
            id={field.id}
            className={`${styles.well} ${styles.select}`}
            disabled={disabled}
            data-disabled={disabled ? "" : undefined}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-invalid={field.invalid ? true : undefined}
            aria-describedby={field.describedBy}
            data-invalid={field.invalid ? "" : undefined}
            // As on a menu's trigger, the arrow keys open the list too.
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              setOpen(true);
            }}
          >
            <span
              className={styles.value}
              data-placeholder={chosen ? undefined : ""}
            >
              {chosen?.label ?? placeholder}
            </span>
            <ChevronDownIcon size={14} aria-hidden />
          </button>
        }
      >
        <div
          role="listbox"
          id={listId}
          aria-label={field.label}
          className={styles.list}
          onKeyDown={keys}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <div
                key={option.value}
                role="option"
                aria-selected={selected}
                // The popover focuses the one tabbable row as it opens: the
                // current choice, or the first option when there is none.
                tabIndex={selected || (!chosen && index === 0) ? 0 : -1}
                className={styles.option}
                onClick={() => pick(option.value)}
                // The highlight follows the pointer as it does the arrow keys.
                onPointerMove={(event) => event.currentTarget.focus()}
              >
                <span className={styles.check}>
                  {selected && (
                    <CheckIcon size={13} strokeWidth={2.5} aria-hidden />
                  )}
                </span>
                <span className={styles.optionLabel}>{option.label}</span>
              </div>
            );
          })}
        </div>
      </Popover>
      {name !== undefined && <input type="hidden" name={name} value={value} />}
    </>
  );
}
