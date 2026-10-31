"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import {
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { Popover } from "~/components/ui/popover";
import type { SearchListOption } from "~/components/ui/search-list";
import shell from "./shell.module.css";
import styles from "./transaction-entry.module.css";

type FieldProps = {
  id: string;
  label: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  // Moves on to the next field after a click or Enter takes an option.
  // Tab already moves on by itself.
  onPicked?: (value: string) => void;
};

// The list under a field. Focus stays in the field, which moves the active
// option.
function OptionList({
  open,
  onClose,
  listId,
  label,
  anchor,
  children,
}: {
  open: boolean;
  onClose: () => void;
  listId: string;
  label: string;
  anchor: ReactElement;
  children: ReactNode;
}) {
  // The field closes the list on Escape, so the editor around it stays open.
  return (
    <Popover
      label={label}
      size="trigger"
      anchor={anchor}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <div
        id={listId}
        role="listbox"
        aria-label={label}
        className={styles.listOptions}
        // Keeps focus in the field while the pointer picks.
        onMouseDown={(event) => event.preventDefault()}
      >
        {children}
      </div>
    </Popover>
  );
}

function Option({
  id,
  label,
  selected,
  active,
  onActivate,
  onPick,
}: {
  id: string;
  label: string;
  // Absent for a suggestion, which is never the field's current choice, so
  // its label lines up with the typed text instead of a check column.
  selected?: boolean;
  active: boolean;
  onActivate: () => void;
  onPick: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected ?? false}
      data-active={active || undefined}
      className={styles.option}
      data-suggestion={selected === undefined || undefined}
      onMouseMove={onActivate}
      onClick={onPick}
    >
      {selected !== undefined && (
        <span className={styles.check} aria-hidden>
          {selected && <CheckIcon size={13} strokeWidth={2.5} />}
        </span>
      )}
      <span className={`${shell.truncate} ${styles.optionLabel}`}>{label}</span>
    </div>
  );
}

// Free text with the budget's earlier payees as suggestions, most recent
// first. Arriving in the field opens them before anything is typed.
// Suggestions are only taken with the arrow keys or a click, so Enter on
// typed text still saves the form.
export function PayeeField({
  id,
  label,
  value,
  payees,
  destinations = [],
  selectedDestination,
  placeholder = "Who you paid or who paid you",
  describedBy,
  invalid,
  disabled,
  readOnly,
  inputRef,
  onChange,
  onPicked,
  onDestination,
}: FieldProps & {
  value: string;
  payees: string[];
  destinations?: SearchListOption[];
  selectedDestination?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onDestination?: (value: string) => void;
}) {
  const listId = `${id}-list`;
  const listRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const search = query.trim().toLowerCase();
  const transfers = destinations.filter((item) =>
    item.label.toLowerCase().includes(search),
  );
  const suggestions = payees
    .filter((payee) => payee.toLowerCase().includes(search))
    .slice(0, 8);
  const options = [
    ...transfers.map((item) => ({ ...item, group: "Payments and Transfers" })),
    ...suggestions.map((payee) => ({
      value: `payee:${payee}`,
      label: payee,
      group: "Payees",
    })),
  ];
  const open = expanded && options.length > 0 && !disabled && !readOnly;
  const current = options[active];
  const pick = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (index < transfers.length) onDestination?.(option.value);
    else onChange(option.label);
    setExpanded(false);
    setActive(-1);
    onPicked?.(option.value);
  };
  const show = () => {
    setQuery("");
    setActive(-1);
    setExpanded(true);
  };
  return (
    <OptionList
      open={open}
      onClose={() => setExpanded(false)}
      listId={listId}
      label={`${label} suggestions`}
      anchor={
        <div className={styles.well} data-invalid={invalid ? true : undefined}>
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            className={styles.input}
            autoComplete="off"
            spellCheck={false}
            maxLength={240}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={
              open && current ? `${listId}-${active}` : undefined
            }
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            value={value}
            onFocus={(event) => {
              show();
              event.currentTarget.select();
            }}
            onClick={() => {
              if (!expanded) show();
            }}
            onBlur={() => setExpanded(false)}
            onChange={(event) => {
              onChange(event.target.value);
              setQuery(event.target.value);
              setExpanded(true);
              setActive(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (!options.length) return;
                event.preventDefault();
                setExpanded(true);
                const next = open
                  ? Math.min(
                      options.length - 1,
                      Math.max(
                        0,
                        active + (event.key === "ArrowDown" ? 1 : -1),
                      ),
                    )
                  : 0;
                setActive(next);
                listRef.current
                  ?.querySelector(`[id="${listId}-${next}"]`)
                  ?.scrollIntoView({ block: "nearest" });
              } else if (event.key === "Enter" && open && current) {
                event.preventDefault();
                pick(active);
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setExpanded(false);
              }
            }}
          />
          <ChevronDownIcon size={12} className={styles.chevron} aria-hidden />
        </div>
      }
    >
      <div ref={listRef} className={styles.listScroll}>
        {options.map((option, index) => (
          <div key={option.value}>
            {option.group !== options[index - 1]?.group && (
              <p className={styles.group}>{option.group}</p>
            )}
            <Option
              id={`${listId}-${index}`}
              label={option.label}
              selected={
                option.value === selectedDestination ||
                (index >= transfers.length && option.label === value)
              }
              active={index === active}
              onActivate={() => setActive(index)}
              onPick={() => pick(index)}
            />
          </div>
        ))}
      </div>
    </OptionList>
  );
}
