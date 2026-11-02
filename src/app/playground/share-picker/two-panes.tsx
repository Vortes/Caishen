"use client";

import { CheckIcon, PlusIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { money } from "~/components/app-shell/model";
import { isLinked } from "~/components/app-shell/people";
import { formatMoney } from "~/components/budget/format";
import { FormError } from "~/components/ui/field";
import field from "~/components/ui/field.module.css";
import list from "~/components/ui/search-list.module.css";
import {
  AmountForm,
  MINE,
  NEW_PERSON,
  PERSON_NAME_MAX,
  possessive,
  useShareModel,
  type Preset,
  type VariantProps,
} from "./shared";
import styles from "./two-panes.module.css";

// Two panes, like a model picker: who on the left, how much on the right.
// The left rail is one list searched from the box above it; whoever is
// highlighted there, by the arrows or the pointer, shows their amounts on
// the right. Focus stays in the box while moving through people; Enter or
// ArrowRight crosses to the amounts, and Enter or a click there applies.

const tone = (cents: number) =>
  cents < 0 ? "negative" : cents > 0 ? "positive" : "zero";

function balanceLine(balance: number) {
  if (balance > 0) return `Owes you ${money(balance)}`;
  if (balance < 0) return `You owe ${money(-balance)}`;
  return "Even";
}

export function TwoPanes(props: VariantProps) {
  const model = useShareModel(props);
  const { people, options, current, error, setError } = model;
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(model.initialPerson);
  // The person whose amount field is open.
  const [form, setForm] = useState<string | null>(
    current === "amount" ? model.initialPerson : null,
  );
  const input = useRef<HTMLInputElement>(null);
  // The height it opened at is the least it keeps, so narrowing the list
  // doesn't pull the bottom edge up under the pointer.
  const root = useRef<HTMLDivElement>(null);
  const [floor, setFloor] = useState<number>();
  useLayoutEffect(() => setFloor(root.current?.offsetHeight), []);
  const pane = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);

  const { matches, offerNew } = model.filter(query);
  const typed = query.trim();
  // Arrow order: the matches, then the pinned New and Just mine.
  const rows = [...matches.map((item) => item.id), NEW_PERSON, MINE];
  const shown =
    active === NEW_PERSON
      ? { id: NEW_PERSON, name: typed }
      : people.find((item) => item.id === active);
  // Typing narrows the list: the highlight follows the first match, or New
  // once nothing matches.
  const narrow = (text: string) => {
    setQuery(text);
    setError("");
    const next = model.filter(text);
    if (!text.trim()) return;
    setActive(next.matches[0]?.id ?? NEW_PERSON);
  };

  const optionId = (id: string) => `${listId}-${rows.indexOf(id)}`;
  useEffect(() => {
    if (!active) return;
    document
      .getElementById(optionId(active))
      ?.scrollIntoView({ block: "nearest" });
    // optionId only changes with rows, which active follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // The amounts on the right, in order, skipping what can't be picked.
  const paneButtons = () => [
    ...(pane.current?.querySelectorAll<HTMLButtonElement>(
      "[data-pane-option]:not(:disabled)",
    ) ?? []),
  ];
  const crossRight = () => {
    if (active === NEW_PERSON && !typed) return;
    const buttons = paneButtons();
    (buttons.find((button) => button.dataset.chosen) ?? buttons[0])?.focus();
  };
  const backToList = () => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };

  // Pointer intent: moving right, toward the amounts, doesn't repreview
  // every row it crosses on the way. The highlight waits until the pointer
  // rests or moves along the list.
  const last = useRef({ x: 0, y: 0 });
  const wait = useRef<number | undefined>(undefined);
  const hover = (id: string, x: number, y: number) => {
    const dx = x - last.current.x;
    const dy = y - last.current.y;
    last.current = { x, y };
    window.clearTimeout(wait.current);
    if (id === active) return;
    if (dx > 0 && dx * 2 >= Math.abs(dy))
      wait.current = window.setTimeout(() => setActive(id), 140);
    else setActive(id);
  };
  useEffect(() => () => window.clearTimeout(wait.current), []);

  const applyPreset = (preset: Preset) => {
    if (!shown) return;
    if (preset === "amount") return setForm(shown.id);
    model.applyPreset(shown.id, typed, preset);
  };

  const row = ({
    id,
    label,
    icon,
    amount,
    detail,
    pinned,
    selected = false,
    onPick,
  }: {
    id: string;
    label: string;
    icon?: ReactNode;
    amount?: number;
    detail?: string;
    pinned?: boolean;
    // The share as it stands, not the highlight: a search list gives the
    // chosen row its weight, and the highlight never changes weight.
    selected?: boolean;
    onPick: () => void;
  }) => (
    <div
      key={id}
      id={optionId(id)}
      role="option"
      aria-selected={selected}
      data-active={id === active || undefined}
      data-pinned={pinned ? true : undefined}
      className={list.option}
      onMouseMove={(event) => hover(id, event.clientX, event.clientY)}
      onClick={() => {
        window.clearTimeout(wait.current);
        setActive(id);
        onPick();
      }}
    >
      <span className={list.icon} aria-hidden>
        {icon}
      </span>
      <span className={list.label}>{label}</span>
      {amount !== undefined && (
        <span className={list.amount} data-tone={tone(amount)}>
          {formatMoney(amount)}
        </span>
      )}
      {detail && (
        <span className={list.amount} data-tone="zero">
          {detail}
        </span>
      )}
    </div>
  );

  const shared = props.share?.amount ? props.share.accountId : null;
  const check = <CheckIcon size={13} strokeWidth={2.5} />;
  const personRows = matches.map((item, index) => [
    (index === 0 || isLinked(matches[index - 1]!) !== isLinked(item)) && (
      <p key={`group-${isLinked(item)}`} className={list.group} aria-hidden>
        {isLinked(item) ? "On Caishen" : "People"}
      </p>
    ),
    row({
      id: item.id,
      label: item.name,
      icon: item.id === shared && check,
      selected: item.id === shared,
      amount: item.balance,
      onPick: () => requestAnimationFrame(crossRight),
    }),
  ]);

  const chosen = shown && shown.id !== NEW_PERSON ? model.chosenFor(shown.id) : null;
  const paneOption = (
    id: Preset | "mine",
    label: string,
    detail: string,
    disabled: boolean,
    picked: boolean,
    onClick?: () => void,
  ) => (
    <button
      key={id}
      type="button"
      data-pane-option
      data-chosen={picked || undefined}
      className={styles.option}
      disabled={disabled}
      aria-pressed={picked}
      onClick={onClick}
    >
      <span className={styles.check} aria-hidden>
        {picked && check}
      </span>
      <span className={styles.optionLabel}>{label}</span>
      {detail && <span className={styles.optionDetail}>{detail}</span>}
    </button>
  );

  let heading: ReactNode;
  let body: ReactNode;
  let note: string | undefined;
  if (active === MINE) {
    heading = <Heading title="Just mine" detail="Nothing shared" />;
    body = paneOption(
      "mine",
      model.multiple ? "Keep every line" : "Keep it all",
      model.multiple ? "" : money(model.amount),
      false,
      current === "mine",
      () => model.pick(null),
    );
  } else if (shown && (shown.id !== NEW_PERSON || typed)) {
    const person = people.find((item) => item.id === shown.id);
    heading = (
      <Heading
        title={shown.name}
        detail={person ? balanceLine(person.balance) : "New person"}
      />
    );
    body = options.map((option) =>
      paneOption(
        option.id,
        option.label,
        option.detail,
        option.disabled,
        option.id === chosen,
        () => applyPreset(option.id),
      ),
    );
    note =
      shown.id === NEW_PERSON
        ? "Joins People once shared. Only you see them."
        : person && isLinked(person)
          ? `Shows in ${person.name}’s budget too.`
          : undefined;
  } else {
    heading = (
      <Heading
        title={active === NEW_PERSON ? "New person" : "How much is theirs"}
        detail={
          active === NEW_PERSON
            ? "Type their name to the left"
            : "Choose someone to the left"
        }
      />
    );
    body = options.map((option) =>
      paneOption(option.id, option.label, option.detail, true, false),
    );
  }

  return (
    <div ref={root} className={styles.root} style={{ minHeight: floor }}>
      <div className={styles.rail}>
        <div className={styles.search}>
          <div className={field.well} data-well="">
            <input
              ref={input}
              role="combobox"
              aria-label="Who this is for"
              // The list is always showing; this also keeps Escape here, to
              // clear the search before it closes the popover.
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active ? optionId(active) : undefined}
              className={`${field.input} ${list.input}`}
              autoComplete="off"
              spellCheck={false}
              maxLength={PERSON_NAME_MAX}
              placeholder={
                people.length === 0 || active === NEW_PERSON
                  ? "Their name or company"
                  : "Find or add a person"
              }
              value={query}
              onChange={(event) => narrow(event.target.value)}
              onKeyDown={(event) => {
                const el = event.currentTarget;
                const atEnd =
                  el.selectionStart === el.value.length &&
                  el.selectionEnd === el.value.length;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const index = rows.indexOf(active);
                  const by = event.key === "ArrowDown" ? 1 : -1;
                  const next =
                    index < 0
                      ? rows[by > 0 ? 0 : rows.length - 1]
                      : rows[Math.min(rows.length - 1, Math.max(0, index + by))];
                  if (next) setActive(next);
                } else if (event.key === "ArrowRight" && atEnd) {
                  event.preventDefault();
                  crossRight();
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (active === MINE) model.pick(null);
                  else crossRight();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (query) narrow("");
                  else props.onClose();
                }
              }}
            />
          </div>
        </div>
        <div
          id={listId}
          role="listbox"
          aria-label="People"
          className={styles.list}
          // Keeps focus in the box while the pointer picks.
          onMouseDown={(event) => event.preventDefault()}
        >
          <div ref={scroll} className={styles.scroll}>
            {matches.length === 0 && (
              <p className={list.empty}>
                {typed
                  ? `No one called “${typed}” yet`
                  : "You haven’t shared with anyone yet"}
              </p>
            )}
            {personRows}
          </div>
          <div className={styles.pinned}>
            {row({
              id: NEW_PERSON,
              label: offerNew ? `New person “${typed}”` : "New person",
              icon: <PlusIcon size={13} strokeWidth={2.5} />,
              pinned: true,
              onPick: () =>
                offerNew
                  ? requestAnimationFrame(crossRight)
                  : input.current?.focus(),
            })}
            {row({
              id: MINE,
              label: "Just mine",
              icon: current === "mine" && check,
              selected: current === "mine",
              detail: "Nothing shared",
              onPick: () => model.pick(null),
            })}
          </div>
        </div>
      </div>
      <div
        ref={pane}
        className={styles.pane}
        role="group"
        aria-label={shown?.name ? possessive(shown.name) : "How much"}
        onMouseMove={() => window.clearTimeout(wait.current)}
        onKeyDown={(event) => {
          if (event.target instanceof HTMLInputElement) return;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            backToList();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const buttons = paneButtons();
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const by = event.key === "ArrowDown" ? 1 : -1;
            buttons[(index + by + buttons.length) % buttons.length]?.focus();
          } else if (
            event.key.length === 1 &&
            event.key !== " " &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            // Typing anywhere searches people.
            backToList();
          }
        }}
      >
        <div className={styles.paneHeader}>{heading}</div>
        <div className={styles.options}>{body}</div>
        {form && form === shown?.id && (
          <div className={styles.amount}>
            <AmountForm
              key={form}
              label={`${possessive(shown.name)}${model.multiple ? " per transaction" : ""}`}
              amount={model.amount}
              initial={
                chosen === "amount" ? props.share!.amount : model.half
              }
              onApply={(cents) => model.apply(shown.id, typed, cents, "fixed")}
            />
          </div>
        )}
        {note && <p className={styles.note}>{note}</p>}
        {error && (
          <div className={styles.error}>
            <FormError>{error}</FormError>
          </div>
        )}
      </div>
    </div>
  );
}

function Heading({ title, detail }: { title: string; detail: string }) {
  return (
    <>
      <strong className={styles.title}>{title}</strong>
      <span className={styles.detail}>{detail}</span>
    </>
  );
}
