"use client";

import { CheckIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { formatMoney } from "~/components/budget/format";
import { useFieldControl } from "./field";
import field from "./field.module.css";
import { Popover } from "./popover";
import styles from "./search-list.module.css";
import { Tag } from "./tag";

export type SearchListOption = {
  value: string;
  label: string;
  group?: string;
  // A balance shown beside the option in the open list, in cents.
  amount?: number;
  // A short neutral label beside the name, for the one option that stands
  // apart, such as the person also on Caishen.
  tag?: string;
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
  maxLength,
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
  // The longest name onCreate can take.
  maxLength?: number;
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
            data-holds-escape={open ? "" : undefined}
            disabled={disabled}
            readOnly={readOnly}
            maxLength={maxLength}
            placeholder={placeholder}
            value={open ? query : (chosen?.label ?? displayValue ?? "")}
            onChange={(event) => show(event.target.value)}
            onFocus={(event) => {
              if (!open && arrivedByKeyboard()) show();
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
              tag={option.tag}
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

// Whether the keyboard, not a pointer, was used last. Arriving by Tab opens
// the list; focus a click put there (on the label, or on a button that
// opened the form) leaves it closed until the well itself is clicked.
let pointerLast = false;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => (pointerLast = true), true);
  document.addEventListener("keydown", () => (pointerLast = false), true);
}
const arrivedByKeyboard = () => !pointerLast;

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
  tag,
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
  tag?: string;
  active: boolean;
  // New or the action, above the options.
  pinned?: boolean;
  // Sized to its label, so the row beside it keeps the room.
  compact?: boolean;
  onActivate: (event: MouseEvent) => void;
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
      {tag && (
        <span className={styles.tag}>
          <Tag>{tag}</Tag>
        </span>
      )}
      {amount !== undefined && (
        <span className={styles.amount} data-tone={tone(amount)}>
          {formatMoney(amount)}
        </span>
      )}
    </div>
  );
}

export type SearchListHighlight =
  | { kind: "option"; option: SearchListOption }
  // The New row, with the name typed for it.
  | { kind: "create"; name: string };

// A pointer moving toward the detail waits this long before the rows it
// crosses on the way take the highlight (scale.md, Motion).
const HOVER_INTENT = 140;

const normalize = (text: string) => text.trim().replace(/\s+/g, " ");

// What a search shows: the options holding the typed text, whether the New
// row is due, and the order the arrow keys walk.
function narrowed(
  options: readonly SearchListOption[],
  query: string,
  createNoun: string | undefined,
) {
  const search = normalize(query).toLowerCase();
  const visible = search
    ? options.filter((option) => option.label.toLowerCase().includes(search))
    : options;
  const creatable =
    createNoun !== undefined &&
    search !== "" &&
    !options.some((option) => normalize(option.label).toLowerCase() === search);
  const rows = [
    ...(creatable ? [CREATE] : []),
    ...visible.filter((option) => !option.disabled).map((o) => o.value),
  ];
  return { visible, creatable, rows };
}

// Its height at open is the least it keeps, so a search that narrows the
// list doesn't pull the edge up under the pointer (rows.md, Nothing moves).
function lockHeight(element: HTMLDivElement | null) {
  if (element && !element.style.minHeight)
    element.style.minHeight = `${element.offsetHeight}px`;
}

// A search over a list that is always open, with the highlighted row's
// detail beside it: who on the left, what for them on the right. Focus stays
// in the search while the arrow keys or the pointer move the highlight, and
// the detail follows. Enter, a click, or ArrowRight at the end of the text
// crosses into the detail's choices (DetailOption); there the arrow keys move
// between them, and ArrowLeft or a letter comes back to the search. Escape
// clears the search, then closes the popover around it. It stands alone in a
// popover, not in a Field: label names the search and the list.
export function SearchListDetail({
  label,
  options,
  value,
  defaultHighlight,
  createNoun,
  placeholder,
  maxLength,
  inputRef,
  empty,
  detail,
}: {
  label: string;
  options: readonly SearchListOption[];
  // The chosen option's value, checked in the list; "" for none.
  value: string;
  // The option highlighted at open. Without one, nothing is, and the detail
  // waits for a choice.
  defaultHighlight?: string;
  // Offers a New row for a typed name that matches no option. It only
  // highlights: the detail decides what taking it does.
  createNoun?: string;
  placeholder?: string;
  maxLength?: number;
  inputRef?: Ref<HTMLInputElement>;
  // What the list says when there are no options and nothing is typed.
  empty?: string;
  // The detail for the highlighted row, or for none: its accessible name, the
  // title over it, lined up with the search, and its DetailOptions.
  detail: (highlight: SearchListHighlight | null) => {
    label: string;
    title: string;
    children: ReactNode;
  };
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(defaultHighlight ?? null);
  // Bumped to cross into the detail once it shows the new highlight.
  const [crossing, setCrossing] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const { visible, creatable, rows } = narrowed(options, query, createNoun);
  const current = active !== null && rows.includes(active) ? active : null;
  const highlightOption = options.find((option) => option.value === current);
  const highlight: SearchListHighlight | null =
    current === CREATE
      ? { kind: "create", name: normalize(query) }
      : highlightOption
        ? { kind: "option", option: highlightOption }
        : null;
  const optionId = (id: string) =>
    id === CREATE
      ? `${listId}-create`
      : `${listId}-${options.findIndex((option) => option.value === id)}`;

  // The highlight at open may be far down a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector("[data-active]")
      ?.scrollIntoView({ block: "nearest" });
  }, []);
  const choices = () => [
    ...(paneRef.current?.querySelectorAll<HTMLButtonElement>(
      "[data-detail-option]:not(:disabled)",
    ) ?? []),
  ];
  useEffect(() => {
    if (!crossing) return;
    const buttons = choices();
    (
      buttons.find(
        (button) => button.getAttribute("aria-pressed") === "true",
      ) ?? buttons[0]
    )?.focus();
  }, [crossing]);
  const cross = (id = current) => {
    // A pending pointer highlight would change the detail under the choice.
    window.clearTimeout(wait.current);
    if (id === null) return;
    setActive(id);
    setCrossing((count) => count + 1);
  };
  const back = (text = query) => {
    const element = input.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(text.length, text.length);
  };

  // Hover intent: a pointer moving right, toward the detail, doesn't
  // highlight every row it crosses. The highlight waits until the pointer
  // rests or moves along the list.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const wait = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(wait.current), []);
  // Typing narrows the list: the highlight takes the first match, or New
  // once nothing matches. Clearing the text keeps it where it was.
  const narrow = (text: string) => {
    window.clearTimeout(wait.current);
    setQuery(text);
    if (!normalize(text)) return;
    // The first match takes the highlight, so the list starts at the top.
    if (listRef.current) listRef.current.scrollTop = 0;
    const next = narrowed(options, text, createNoun);
    setActive(next.rows.find((id) => id !== CREATE) ?? next.rows[0] ?? null);
  };
  const step = (by: number) => {
    window.clearTimeout(wait.current);
    const index = current === null ? -1 : rows.indexOf(current);
    const next =
      index < 0
        ? rows[by > 0 ? 0 : rows.length - 1]
        : rows[Math.min(rows.length - 1, Math.max(0, index + by))];
    if (next === undefined) return;
    setActive(next);
    listRef.current?.parentElement
      ?.querySelector(`[id="${optionId(next)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const hover = (id: string, event: MouseEvent) => {
    const last = pointer.current;
    pointer.current = { x: event.clientX, y: event.clientY };
    window.clearTimeout(wait.current);
    if (id === current) return;
    const dx = last ? event.clientX - last.x : 0;
    const dy = last ? event.clientY - last.y : 0;
    if (dx > 0 && dx * 2 >= Math.abs(dy))
      wait.current = window.setTimeout(() => setActive(id), HOVER_INTENT);
    else setActive(id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const element = event.currentTarget;
    const atEnd =
      element.selectionStart === element.value.length &&
      element.selectionEnd === element.value.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      step(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" || (event.key === "ArrowRight" && atEnd)) {
      event.preventDefault();
      cross();
    } else if (event.key === "Escape" && query) {
      // data-holds-escape keeps the popover open for this one.
      event.preventDefault();
      event.stopPropagation();
      narrow("");
    }
  };
  const onPaneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      back();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const buttons = choices();
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      const by = event.key === "ArrowDown" ? 1 : -1;
      buttons[(index + by + buttons.length) % buttons.length]?.focus();
    } else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      // A letter typed in the detail searches again, from the end.
      event.preventDefault();
      const text =
        maxLength !== undefined && query.length >= maxLength
          ? query
          : query + event.key;
      narrow(text);
      back(text);
    }
  };

  const pane = detail(highlight);
  return (
    <div className={styles.detailFrame}>
      <div ref={lockHeight} className={styles.detailRoot}>
        <div className={styles.rail}>
          <div className={styles.railSearch}>
            <div className={field.well} data-well="">
              <input
                ref={(element) => {
                  input.current = element;
                  if (typeof inputRef === "function") inputRef(element);
                  else if (inputRef) inputRef.current = element;
                }}
                role="combobox"
                aria-label={label}
                // The list is always showing.
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={
                  current !== null ? optionId(current) : undefined
                }
                data-holds-escape={query ? "" : undefined}
                className={`${field.input} ${styles.input}`}
                autoComplete="off"
                spellCheck={false}
                maxLength={maxLength}
                placeholder={placeholder}
                value={query}
                onChange={(event) => narrow(event.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            className={styles.railList}
            // Keeps focus in the search while the pointer picks.
            onMouseDown={(event) => event.preventDefault()}
          >
            {creatable && (
              <>
                <div className={styles.pinned}>
                  <Row
                    id={optionId(CREATE)}
                    icon={<PlusIcon size={13} strokeWidth={2.5} />}
                    label={`New ${createNoun} “${normalize(query)}”`}
                    pinned
                    active={current === CREATE}
                    onActivate={(event) => hover(CREATE, event)}
                    onPick={() => cross(CREATE)}
                  />
                </div>
                {visible.length > 0 && (
                  <hr className={styles.divider} aria-hidden />
                )}
              </>
            )}
            <div ref={listRef} className={styles.scroll}>
              {visible.length === 0 && !creatable && (
                <p className={styles.empty}>
                  {normalize(query)
                    ? `No matches for “${normalize(query)}”`
                    : empty}
                </p>
              )}
              {visible.map((option) => (
                <Row
                  key={option.value}
                  id={optionId(option.value)}
                  icon={
                    option.value === value && (
                      <CheckIcon size={13} strokeWidth={2.5} />
                    )
                  }
                  label={option.label}
                  selected={option.value === value}
                  disabled={option.disabled}
                  amount={option.amount}
                  tag={option.tag}
                  active={option.value === current}
                  onActivate={(event) => hover(option.value, event)}
                  onPick={() => cross(option.value)}
                />
              ))}
            </div>
          </div>
        </div>
        <div
          ref={paneRef}
          role="group"
          aria-label={pane.label}
          className={styles.pane}
          onKeyDown={onPaneKeyDown}
          onMouseMove={() => window.clearTimeout(wait.current)}
        >
          <p
            className={styles.paneTitle}
            data-placeholder={highlight ? undefined : ""}
          >
            {pane.title}
          </p>
          <div className={styles.paneBody}>{pane.children}</div>
        </div>
      </div>
    </div>
  );
}

// One choice in a SearchListDetail's detail: a title, an optional figure,
// and a check while it is the choice as it stands (pressed). The detail's
// arrow keys move between these; the first one Enter crosses to is the
// pressed one.
export function DetailOption({
  title,
  detail,
  pressed = false,
  disabled,
  onClick,
}: {
  title: string;
  detail?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      data-detail-option=""
      className={styles.choice}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={styles.icon} aria-hidden>
        {pressed && <CheckIcon size={13} strokeWidth={2.5} />}
      </span>
      <span className={styles.label}>{title}</span>
      {detail && <span className={styles.choiceDetail}>{detail}</span>}
    </button>
  );
}

// Sets a choice that undoes the others apart from them.
export function DetailSeparator() {
  return <hr className={styles.divider} aria-hidden />;
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
            data-holds-escape={open ? "" : undefined}
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
              if (arrivedByKeyboard()) show();
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
