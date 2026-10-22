"use client";

import { ListFilterIcon, SearchIcon, XIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "~/components/ui/icon-button";
import { usePortalContainer } from "~/components/ui/tooltip";
import type { Category, ShellData } from "../app-shell/model";
import shellStyles from "../app-shell/shell.module.css";
import { AvailablePill } from "../app-shell/views";
import styles from "./batch-4.module.css";

export type SearchBehavior = "narrow" | "jump";

// A category matches by its own name or its group's, so "home" keeps the
// whole Home group.
export function matchesQuery(category: Category, query: string) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return (
    category.name.toLowerCase().includes(text) ||
    category.group.toLowerCase().includes(text)
  );
}

export function filterGroups(groups: ShellData["groups"], query: string) {
  if (!query.trim()) return groups;
  return groups
    .map((group) => ({
      ...group,
      categories: group.categories.filter((item) => matchesQuery(item, query)),
    }))
    .filter((group) => group.categories.length);
}

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

// F, anywhere on the plan that isn't a field or a popover.
function useFKey(onPress: () => void) {
  const press = useRef(onPress);
  press.current = onPress;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "f" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTyping(event.target) ||
        (event.target instanceof Element &&
          event.target.closest('[role="dialog"], [role="menu"]'))
      )
        return;
      event.preventDefault();
      press.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

// Variant A: the Filter button opens into a search field in place and the
// plan narrows to what matches, like the register's search. It stays open
// while it holds text, so the filter is always visible.
export function NarrowSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const shown = open || query.length > 0;

  useFKey(() => {
    setOpen(true);
    requestAnimationFrame(() => input.current?.focus());
  });
  useEffect(() => {
    if (shown) {
      input.current?.focus();
      return;
    }
    if (returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus();
    }
  }, [shown]);

  if (!shown)
    return (
      <IconButton
        ref={button}
        label="Find a category"
        shortcut="F"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        <ListFilterIcon aria-hidden />
      </IconButton>
    );

  return (
    <label className={`${shellStyles.toolbarSearch} ${styles.planSearch}`}>
      <SearchIcon size={13} className={shellStyles.searchIcon} aria-hidden />
      <input
        ref={input}
        type="search"
        value={query}
        placeholder="Find a category"
        aria-label="Find a category"
        aria-keyshortcuts="F"
        aria-controls="prototype-content"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onQueryChange(event.target.value)}
        onBlur={() => {
          if (!query) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            event.preventDefault();
            // First Escape clears, the next one closes the field.
            if (query) onQueryChange("");
            else {
              returnFocus.current = true;
              setOpen(false);
            }
          } else if (event.key === "ArrowDown" || event.key === "Enter") {
            // Into the results, like Linear's filter.
            const first = document.querySelector<HTMLElement>(
              "#prototype-content [data-row]",
            );
            if (!first) return;
            event.preventDefault();
            first.focus();
            if (event.key === "Enter") first.click();
          }
        }}
      />
      <IconButton
        size="sm"
        label="Clear and close"
        onClick={() => {
          onQueryChange("");
          returnFocus.current = true;
          setOpen(false);
        }}
      >
        <XIcon aria-hidden />
      </IconButton>
    </label>
  );
}

// Variant B: the Filter button opens a finder over the plan; picking a
// category selects it and scrolls to it. The plan itself never narrows.
export function JumpSearch({
  categories,
  onPick,
}: {
  categories: Category[];
  onPick: (category: Category) => void;
}) {
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  // Opened with F it appears at once, like the shell's menus; a click
  // animates.
  const [instant, setInstant] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const matches = categories.filter((item) => matchesQuery(item, query));

  useFKey(() => {
    setInstant(true);
    setOpen(true);
  });
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (category: Category | undefined) => {
    if (!category) return;
    setOpen(false);
    setQuery("");
    setActive(0);
    onPick(category);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        Math.min(matches.length - 1, Math.max(0, index + step)),
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(matches[active]);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setInstant(false);
        if (!next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <Popover.Trigger asChild>
        <IconButton
          label="Find a category"
          shortcut="F"
          variant="secondary"
          pressed={open}
        >
          <ListFilterIcon aria-hidden />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={`${styles.popover} ${styles.finder}`}
          data-instant={instant || undefined}
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label="Find a category"
        >
          <label className={styles.finderField}>
            <SearchIcon size={13} aria-hidden />
            <input
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={
                matches[active] ? `${listId}-${matches[active].id}` : undefined
              }
              aria-label="Find a category"
              placeholder="Find a category"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </label>
          {matches.length ? (
            <ul
              ref={list}
              id={listId}
              role="listbox"
              aria-label="Categories"
              className={styles.finderList}
            >
              {matches.map((category, index) => (
                <li
                  key={category.id}
                  id={`${listId}-${category.id}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className={styles.finderOption}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(category)}
                >
                  <span className={styles.finderName}>
                    <span>{category.name}</span>
                    <span className={styles.finderGroup}>{category.group}</span>
                  </span>
                  <AvailablePill category={category} />
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.finderEmpty} role="status">
              No category is named &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
