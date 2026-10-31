"use client";

import { CheckIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { formatMoney } from "~/components/budget/format";
import { useFieldControl } from "./field";
import field from "./field.module.css";
import { Popover } from "./popover";
import styles from "./search-list.module.css";

export type SearchListOption = {
  value: string;
  label: string;
  group?: string;
  // A balance shown beside the option in the open list, in cents.
  amount?: number;
  disabled?: boolean;
};

// One option from a list the person searches by typing, in the field's
// well. Arriving opens the list under the well with the chosen name
// selected, so typing replaces it and filters by group and label. The arrow
// keys move, Enter or a click picks, Tab takes the highlighted match once
// something is typed or chosen, and Escape closes only the list. Focus
// stays in the field. Inside a Field, which names and describes it.
export function SearchList({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  readOnly,
  inputRef,
  onPicked,
  onCreate,
  action,
  displayValue,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SearchListOption[];
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  // Moves on to the next field after a click or Enter takes an option.
  onPicked?: (value: string) => void;
  // A New row pinned above the options, like YNAB's New Category. It
  // carries a typed name that matches no option exactly, and Enter takes
  // it once nothing else matches.
  onCreate?: { noun: string; create: (name: string) => void };
  // An action that shares the New row, like Split, so neither costs the
  // options any height.
  action?: { label: string; icon: ReactNode; onSelect: () => void };
  // Shown in the closed field for a value that isn't an option, such as a
  // register entry's Split.
  displayValue?: string;
}) {
  const control = useFieldControl();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  // The field's text while the list is open: the chosen name until typing
  // replaces it, which is when it starts filtering.
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState(false);
  // The option the arrow keys or the pointer moved to; until then, the
  // chosen one, or the first match once something is typed.
  const [active, setActive] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const open = expanded && !disabled && !readOnly;
  const chosen = options.find((option) => option.value === value);
  const search = typed ? query.trim().toLowerCase() : "";
  const visible = options.filter((option) =>
    `${option.group ?? ""} ${option.label}`.toLowerCase().includes(search),
  );
  const named =
    search && !options.some((option) => option.label.toLowerCase() === search);
  const creatable = onCreate
    ? { value: CREATE, label: named ? query.trim() : "" }
    : undefined;
  const acting = action ? { value: ACTION, label: action.label } : undefined;
  const pinned = [creatable, acting].filter((option) => option !== undefined);
  const pickable = [...pinned, ...visible.filter((option) => !option.disabled)];
  const current =
    pickable.find((option) => option.value === active) ??
    (search ? undefined : pickable.find((option) => option.value === value)) ??
    pickable.find((option) => !pinned.includes(option)) ??
    creatable;
  const optionId = (option: SearchListOption) =>
    option === creatable
      ? `${listId}-create`
      : option === acting
        ? `${listId}-action`
        : `${listId}-${visible.indexOf(option)}`;

  const show = (text?: string) => {
    setQuery(text ?? chosen?.label ?? displayValue ?? "");
    setTyped(text !== undefined);
    setActive(null);
    setExpanded(true);
  };
  // A click or Enter moves on to the next field through onPicked; Tab
  // already moves on by itself.
  const pick = (option: SearchListOption, advance = true) => {
    if (option.disabled) return;
    setExpanded(false);
    if (option === creatable) onCreate?.create(option.label);
    else if (option === acting) action?.onSelect();
    else {
      onChange(option.value);
      if (advance) onPicked?.(option.value);
    }
  };
  const step = (by: number) => {
    const index = current ? pickable.indexOf(current) : -1;
    const next =
      pickable[Math.min(pickable.length - 1, Math.max(0, index + by))];
    if (!next) return;
    setActive(next.value);
    listRef.current
      ?.querySelector(`[id="${optionId(next)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show();
      else step(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (current) pick(current);
    } else if (event.key === "Escape" && open) {
      // Only the list closes; the editor or popover around it stays open.
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    } else if (
      event.key === "Tab" &&
      open &&
      (search.length > 0 || chosen !== undefined) &&
      current &&
      !pinned.includes(current)
    ) {
      pick(current, false);
    }
  };
  return (
    <Popover
      label={control.label}
      size="trigger"
      open={open}
      onOpenChange={(next) => {
        if (!next) setExpanded(false);
      }}
      anchor={
        <div
          className={field.well}
          data-well=""
          data-invalid={control.invalid ? "" : undefined}
          data-disabled={disabled ? "" : undefined}
        >
          <input
            ref={inputRef}
            id={control.id}
            role="combobox"
            className={`${field.input} ${styles.input}`}
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={
              open && current ? optionId(current) : undefined
            }
            aria-invalid={control.invalid ? true : undefined}
            aria-describedby={control.describedBy}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            value={open ? query : (chosen?.label ?? displayValue ?? "")}
            onChange={(event) => show(event.target.value)}
            onFocus={(event) => {
              if (!open) show();
              event.currentTarget.select();
            }}
            onClick={() => {
              if (!open) show();
            }}
            onBlur={() => setExpanded(false)}
            onKeyDown={onKeyDown}
          />
          <ChevronDownIcon size={14} className={styles.chevron} aria-hidden />
        </div>
      }
    >
      <div
        id={listId}
        role="listbox"
        aria-label={control.label}
        className={styles.list}
        // Keeps focus in the field while the pointer picks.
        onMouseDown={(event) => event.preventDefault()}
      >
        {pinned.length > 0 && (
          <>
            <div className={styles.pinned}>
              {creatable && onCreate && (
                <Row
                  id={optionId(creatable)}
                  icon={<PlusIcon size={13} strokeWidth={2.5} />}
                  label={`New ${onCreate.noun}${creatable.label && ` “${creatable.label}”`}`}
                  pinned
                  active={creatable === current}
                  onActivate={() => setActive(CREATE)}
                  onPick={() => pick(creatable)}
                />
              )}
              {acting && action && (
                <Row
                  id={optionId(acting)}
                  icon={action.icon}
                  label={action.label}
                  pinned
                  active={acting === current}
                  compact={creatable !== undefined}
                  onActivate={() => setActive(ACTION)}
                  onPick={() => pick(acting)}
                />
              )}
            </div>
            {(visible.length > 0 || !creatable?.label) && (
              <hr className={styles.divider} aria-hidden />
            )}
          </>
        )}
        <div ref={listRef} className={styles.scroll}>
          {/* The New row already offers what was typed. */}
          {visible.length === 0 && !creatable?.label && (
            <p className={styles.empty}>No matches for “{query.trim()}”</p>
          )}
          {visible.map((option, index) => [
            option.group && option.group !== visible[index - 1]?.group && (
              <p
                key={`group-${option.group}`}
                className={styles.group}
                aria-hidden
              >
                {option.group}
              </p>
            ),
            <Row
              key={option.value}
              id={optionId(option)}
              icon={
                option.value === value && (
                  <CheckIcon size={13} strokeWidth={2.5} />
                )
              }
              label={option.label}
              selected={option.value === value}
              disabled={option.disabled}
              amount={option.amount}
              active={option === current}
              onActivate={() => setActive(option.value)}
              onPick={() => pick(option)}
            />,
          ])}
        </div>
      </div>
    </Popover>
  );
}

function tone(cents: number) {
  return cents < 0 ? "negative" : cents > 0 ? "positive" : "zero";
}

// Stand for the New row and the action beside it, never for options.
const CREATE = "\u0000create";
const ACTION = "\u0000action";
// Keeps a suggestion's key apart from a destination's value.
const SUGGESTION = "\u0000suggestion:";

function Row({
  id,
  icon,
  label,
  selected = false,
  disabled,
  amount,
  active,
  pinned,
  compact,
  onActivate,
  onPick,
}: {
  id: string;
  // Absent for a suggestion, whose label lines up with the typed text
  // instead of a check column.
  icon?: ReactNode;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  amount?: number;
  active: boolean;
  // New or the action, above the options.
  pinned?: boolean;
  // Sized to its label, so the row beside it keeps the room.
  compact?: boolean;
  onActivate: () => void;
  onPick: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled ? true : undefined}
      data-active={active || undefined}
      data-pinned={pinned ? true : undefined}
      data-compact={compact ? true : undefined}
      className={styles.option}
      onMouseMove={disabled ? undefined : onActivate}
      onClick={disabled ? undefined : onPick}
    >
      <span className={styles.icon} aria-hidden>
        {icon}
      </span>
      <span className={styles.label}>{label}</span>
      {amount !== undefined && (
        <span className={styles.amount} data-tone={tone(amount)}>
          {formatMoney(amount)}
        </span>
      )}
    </div>
  );
}

// Free text, with earlier names suggested under the well, such as a
// payee. Whatever is typed reaches onChange. Arriving opens the
// suggestions, most recent first, and typing filters them; destinations,
// such as a register's transfers, come first under their own group. A
// suggestion is taken only with the arrow keys or a click, so Enter on
// typed text still sends the form. Escape closes only the list. Inside a
// Field, which names and describes it.
export function SearchSuggestions({
  value,
  onChange,
  suggestions,
  destinations = [],
  destination,
  onDestination,
  placeholder,
  disabled,
  readOnly,
  maxLength,
  inputRef,
  onPicked,
}: {
  value: string;
  onChange: (value: string) => void;
  // Most recent first; up to eight that match what's typed show.
  suggestions: readonly string[];
  // Options that aren't free text, each with its group, listed before the
  // suggestions. destination is the chosen one's value.
  destinations?: readonly SearchListOption[];
  destination?: string;
  onDestination?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  inputRef?: Ref<HTMLInputElement>;
  // Moves on to the next field after a suggestion or destination is taken.
  onPicked?: (value: string) => void;
}) {
  const control = useFieldControl();
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  // What's typed since arriving: arriving shows every suggestion.
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const search = query.trim().toLowerCase();
  const shown = destinations.filter((option) =>
    option.label.toLowerCase().includes(search),
  );
  const options: SearchListOption[] = [
    ...shown,
    ...suggestions
      .filter((suggestion) => suggestion.toLowerCase().includes(search))
      .slice(0, 8)
      .map((suggestion) => ({
        value: `${SUGGESTION}${suggestion}`,
        label: suggestion,
        // Headed only beside destinations, by the field's own name.
        group: shown.length > 0 ? control.label : undefined,
      })),
  ];
  const open = expanded && options.length > 0 && !disabled && !readOnly;
  const current = options[active];
  const optionId = (index: number) => `${listId}-${index}`;

  const show = () => {
    setQuery("");
    setActive(-1);
    setExpanded(true);
  };
  const pick = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (index < shown.length) onDestination?.(option.value);
    else onChange(option.label);
    setExpanded(false);
    setActive(-1);
    onPicked?.(option.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      setExpanded(true);
      const next = open
        ? Math.min(
            options.length - 1,
            Math.max(0, active + (event.key === "ArrowDown" ? 1 : -1)),
          )
        : 0;
      setActive(next);
      listRef.current
        ?.querySelector(`[id="${optionId(next)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && open && current) {
      // Only a suggestion the arrows moved to; otherwise the form sends.
      event.preventDefault();
      pick(active);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    }
  };
  return (
    <Popover
      label={`${control.label} suggestions`}
      size="trigger"
      open={open}
      onOpenChange={(next) => {
        if (!next) setExpanded(false);
      }}
      anchor={
        <div
          className={field.well}
          data-well=""
          data-invalid={control.invalid ? "" : undefined}
          data-disabled={disabled ? "" : undefined}
        >
          <input
            ref={inputRef}
            id={control.id}
            role="combobox"
            className={`${field.input} ${styles.input}`}
            autoComplete="off"
            spellCheck={false}
            maxLength={maxLength}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={
              open && current ? optionId(active) : undefined
            }
            aria-invalid={control.invalid ? true : undefined}
            aria-describedby={control.describedBy}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setQuery(event.target.value);
              setActive(-1);
              setExpanded(true);
            }}
            onFocus={(event) => {
              show();
              event.currentTarget.select();
            }}
            onClick={() => {
              if (!expanded) show();
            }}
            onBlur={() => setExpanded(false)}
            onKeyDown={onKeyDown}
          />
          <ChevronDownIcon size={14} className={styles.chevron} aria-hidden />
        </div>
      }
    >
      <div
        id={listId}
        role="listbox"
        aria-label={`${control.label} suggestions`}
        className={styles.list}
        // Keeps focus in the field while the pointer picks.
        onMouseDown={(event) => event.preventDefault()}
      >
        <div ref={listRef} className={styles.scroll}>
          {options.map((option, index) => [
            option.group && option.group !== options[index - 1]?.group && (
              <p
                key={`group-${option.group}`}
                className={styles.group}
                aria-hidden
              >
                {option.group}
              </p>
            ),
            <Row
              key={option.value}
              id={optionId(index)}
              icon={
                (index < shown.length
                  ? option.value === destination
                  : option.label === value) && (
                  <CheckIcon size={13} strokeWidth={2.5} />
                )
              }
              label={option.label}
              selected={
                index < shown.length
                  ? option.value === destination
                  : option.label === value
              }
              active={index === active}
              onActivate={() => setActive(index)}
              onPick={() => pick(index)}
            />,
          ])}
        </div>
      </div>
    </Popover>
  );
}
