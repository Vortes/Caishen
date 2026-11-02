"use client";

import { CheckIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isLinked } from "~/components/app-shell/people";
import { formatMoney } from "~/components/budget/format";
import { FormError } from "~/components/ui/field";
import field from "~/components/ui/field.module.css";
import list from "~/components/ui/search-list.module.css";
import moveStyles from "~/components/app-shell/move-money.module.css";
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
import styles from "./inline.module.css";

// Inline: the people list is the whole popover, and a person opens in place
// to show what their share would be. One person is open at a time. Focus
// stays in the search box; the arrows walk people and the open person's
// amounts as one list, ArrowRight opens a person and ArrowLeft closes them.

const tone = (cents: number) =>
  cents < 0 ? "negative" : cents > 0 ? "positive" : "zero";
const OPTION = "\u0000option:";

export function Inline(props: VariantProps) {
  const model = useShareModel(props);
  const { people, options, current, error, setError } = model;
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(model.initialPerson || null);
  const chosenOf = (id: string | null) =>
    id && id !== NEW_PERSON ? model.chosenFor(id) : null;
  const firstOption = (id: string | null) => {
    const chosen = chosenOf(id);
    const option =
      options.find((item) => item.id === chosen) ??
      options.find((item) => !item.disabled);
    return option ? `${OPTION}${option.id}` : (id ?? "");
  };
  const [active, setActive] = useState(() =>
    current === "mine" || !open ? (open ?? "") : firstOption(open),
  );
  const [form, setForm] = useState<string | null>(
    current === "amount" ? model.initialPerson : null,
  );
  const input = useRef<HTMLInputElement>(null);
  // The height it opened at is the least it keeps, so narrowing the list
  // doesn't pull the bottom edge up under the pointer.
  const root = useRef<HTMLDivElement>(null);
  const [floor, setFloor] = useState<number>();
  useLayoutEffect(() => setFloor(root.current?.offsetHeight), []);

  const { matches, offerNew } = model.filter(query);
  const typed = query.trim();
  const openName =
    open === NEW_PERSON
      ? typed
      : people.find((item) => item.id === open)?.name;
  // Arrow order: people, the open one's amounts under them, New, Just mine.
  const optionKeys = options
    .filter((option) => !option.disabled)
    .map((option) => `${OPTION}${option.id}`);
  const rows = [
    ...matches.flatMap((item) =>
      item.id === open ? [item.id, ...optionKeys] : [item.id],
    ),
    NEW_PERSON,
    ...(open === NEW_PERSON && typed ? optionKeys : []),
    MINE,
  ];
  const optionId = (key: string) => `${listId}-${rows.indexOf(key)}`;
  useEffect(() => {
    if (!active) return;
    document
      .getElementById(optionId(active))
      ?.scrollIntoView({ block: "nearest" });
    // optionId only changes with rows, which active follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  const narrow = (text: string) => {
    setQuery(text);
    setError("");
    setForm(null);
    if (!text.trim()) return;
    // The top match opens, so its amounts are a keystroke away.
    const next = model.filter(text).matches[0]?.id ?? NEW_PERSON;
    setOpen(next === NEW_PERSON ? (text.trim() ? NEW_PERSON : null) : next);
    setActive(next);
  };
  const expand = (id: string) => {
    if (id === NEW_PERSON && !typed) {
      input.current?.focus();
      setActive(NEW_PERSON);
      return;
    }
    setOpen(id);
    setForm(null);
    setActive(firstOption(id));
  };
  const choose = (preset: Preset) => {
    if (!open) return;
    if (preset === "amount") return setForm(open);
    model.applyPreset(open, typed, preset);
  };
  const enter = (key: string) => {
    if (key === MINE) return model.pick(null);
    if (key.startsWith(OPTION)) return choose(key.slice(OPTION.length) as Preset);
    expand(key);
  };

  const shared = props.share?.amount ? props.share.accountId : null;
  const check = <CheckIcon size={13} strokeWidth={2.5} />;
  const amounts = (personId: string, name: string) => {
    const chosen = chosenOf(personId);
    const person = people.find((item) => item.id === personId);
    const note =
      personId === NEW_PERSON
        ? "Joins People once shared. Only you see them."
        : person && isLinked(person)
          ? `Shows in ${name}’s budget too.`
          : undefined;
    return (
      <div
        className={styles.nested}
        role="group"
        aria-label={possessive(name)}
      >
        {options.map((option) => {
          const key = `${OPTION}${option.id}`;
          return (
            <div
              key={key}
              id={option.disabled ? undefined : optionId(key)}
              role="treeitem"
              aria-selected={option.id === chosen}
              aria-disabled={option.disabled || undefined}
              data-active={key === active || undefined}
              className={`${list.option} ${styles.nestedOption}`}
              onMouseMove={option.disabled ? undefined : () => setActive(key)}
              onClick={option.disabled ? undefined : () => choose(option.id)}
            >
              <span className={list.icon} aria-hidden>
                {option.id === chosen && check}
              </span>
              <span className={list.label}>{option.label}</span>
              {option.detail && (
                <span className={list.amount} data-tone="zero">
                  {option.detail}
                </span>
              )}
            </div>
          );
        })}
        {form === personId && (
          <div className={styles.amount}>
            <AmountForm
              label={`${possessive(name)}${model.multiple ? " per transaction" : ""}`}
              amount={model.amount}
              initial={chosen === "amount" ? props.share!.amount : model.half}
              onApply={(cents) => model.apply(personId, typed, cents, "fixed")}
            />
          </div>
        )}
        {note && <p className={styles.note}>{note}</p>}
      </div>
    );
  };

  const personRow = (id: string, label: string, balance?: number) => (
    <div
      id={optionId(id)}
      role="treeitem"
      aria-selected={id === shared}
      aria-expanded={id === open}
      data-active={id === active || undefined}
      data-open={id === open || undefined}
      className={`${list.option} ${styles.person}`}
      onMouseMove={() => setActive(id)}
      onClick={() => {
        if (open === id) {
          setOpen(null);
          setActive(id);
        } else expand(id);
      }}
    >
      <span className={list.icon} aria-hidden>
        {id === shared && check}
      </span>
      <span className={list.label}>{label}</span>
      {balance !== undefined && (
        <span className={list.amount} data-tone={tone(balance)}>
          {formatMoney(balance)}
        </span>
      )}
      <ChevronRightIcon size={12} className={styles.caret} aria-hidden />
    </div>
  );

  return (
    <div ref={root} className={styles.root} style={{ minHeight: floor }}>
      <div className={moveStyles.header}>
        <strong>Who is this for?</strong>
      </div>
      <div className={styles.search}>
        <div className={field.well} data-well="">
          <input
            ref={input}
            role="combobox"
            aria-label="Who this is for"
            // Always showing; this also keeps Escape here, to clear the
            // search before it closes the popover.
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-haspopup="tree"
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
              const caret = el.selectionStart === el.selectionEnd;
              const atEnd = caret && el.selectionEnd === el.value.length;
              const atStart = caret && el.selectionStart === 0;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const index = rows.indexOf(active);
                const by = event.key === "ArrowDown" ? 1 : -1;
                const next =
                  index < 0
                    ? rows[by > 0 ? 0 : rows.length - 1]
                    : rows[Math.min(rows.length - 1, Math.max(0, index + by))];
                if (next) setActive(next);
              } else if (
                event.key === "ArrowRight" &&
                atEnd &&
                active &&
                !active.startsWith(OPTION) &&
                active !== MINE
              ) {
                event.preventDefault();
                expand(active);
              } else if (event.key === "ArrowLeft" && atStart && active) {
                if (active.startsWith(OPTION) && open) {
                  event.preventDefault();
                  setActive(open);
                } else if (active === open) {
                  event.preventDefault();
                  setOpen(null);
                }
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (active) enter(active);
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
        role="tree"
        aria-label="People"
        className={styles.list}
        // Keeps focus in the box while the pointer picks; the amount field
        // takes its own focus.
        onMouseDown={(event) => {
          if (!(event.target as Element).closest("form"))
            event.preventDefault();
        }}
      >
        <div className={styles.scroll}>
          {matches.length === 0 && (
            <p className={list.empty}>
              {typed
                ? `No one called “${typed}” yet`
                : "You haven’t shared with anyone yet"}
            </p>
          )}
          {matches.map((item, index) => (
            <Fragment key={item.id}>
              {(index === 0 ||
                isLinked(matches[index - 1]!) !== isLinked(item)) && (
                <p className={list.group} aria-hidden>
                  {isLinked(item) ? "On Caishen" : "People"}
                </p>
              )}
              {personRow(item.id, item.name, item.balance)}
              {item.id === open && amounts(item.id, item.name)}
            </Fragment>
          ))}
        </div>
        <div className={styles.pinned}>
          <div
            id={optionId(NEW_PERSON)}
            role="treeitem"
            aria-selected={false}
            aria-expanded={open === NEW_PERSON && Boolean(typed)}
            data-active={active === NEW_PERSON || undefined}
            data-pinned
            className={list.option}
            onMouseMove={() => setActive(NEW_PERSON)}
            onClick={() => expand(NEW_PERSON)}
          >
            <span className={list.icon} aria-hidden>
              <PlusIcon size={13} strokeWidth={2.5} />
            </span>
            <span className={list.label}>
              {offerNew ? `New person “${typed}”` : "New person"}
            </span>
          </div>
          {open === NEW_PERSON && typed && openName && amounts(NEW_PERSON, openName)}
          <div
            id={optionId(MINE)}
            role="treeitem"
            aria-selected={current === "mine"}
            data-active={active === MINE || undefined}
            className={list.option}
            onMouseMove={() => setActive(MINE)}
            onClick={() => model.pick(null)}
          >
            <span className={list.icon} aria-hidden>
              {current === "mine" && check}
            </span>
            <span className={list.label}>Just mine</span>
            <span className={list.amount} data-tone="zero">
              Nothing shared
            </span>
          </div>
        </div>
      </div>
      {error && (
        <div className={styles.error}>
          <FormError>{error}</FormError>
        </div>
      )}
    </div>
  );
}
