"use client";

import { CheckIcon, PlusIcon } from "lucide-react";
import { Popover } from "radix-ui";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { newId } from "~/components/budget/format";
import type { Command } from "~/domain/engine";
import { Button } from "~/components/ui/button";
import { Tooltip, usePortalContainer } from "~/components/ui/tooltip";
import { FieldError, usePointerModality } from "./move-money";
import { useShellData } from "./shell-data";
import shell from "./shell.module.css";
// The move-money popover's form surface, fields, and list.
import styles from "./move-money.module.css";

export type AddCategory = {
  // Sends the new category's command with a summary for its confirmation.
  // Returns why it can't be sent right now, or null once it's on its way.
  add: (command: Command, summary: string) => string | null;
  // Shows the category once it's on the plan.
  reveal: (categoryId: string) => void;
  // Called with a cleanup while the form is open, so the shell can hold its
  // undo shortcut until it closes.
  holdOpen: () => () => void;
};

const AddCategoryContext = createContext<AddCategory | null>(null);

export const AddCategoryProvider = AddCategoryContext.Provider;

function useAddCategory() {
  const value = useContext(AddCategoryContext);
  if (!value) throw new Error("useAddCategory needs an AddCategoryProvider.");
  return value;
}

// The engine's limit for names and groups.
const MAX_LENGTH = 120;

// A small form anchored to whatever opened it: the plan toolbar's Add
// category, or the empty plan's first-category button.
export function AddCategoryPopover({
  open,
  onOpenChange,
  defaultGroup,
  align = "center",
  shortcut,
  children,
}: {
  // Shown in the trigger's tooltip.
  shortcut?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The group the form starts in; the user can change it.
  defaultGroup: string;
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  const container = usePortalContainer();
  const { holdOpen, reveal } = useAddCategory();
  const listOpen = useRef(false);
  // Where focus goes once the form closes: the new category's row after an
  // add, otherwise back to the button that opened it.
  const added = useRef<string | null>(null);
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {shortcut && !open ? (
        <Tooltip label="Add a category" shortcut={shortcut}>
          <Popover.Trigger asChild>{children}</Popover.Trigger>
        </Tooltip>
      ) : (
        // While the form is open its trigger has no tooltip, which, left open
        // under the pointer that clicked it, would take the form's Escape.
        <Popover.Trigger asChild>{children}</Popover.Trigger>
      )}
      <Popover.Portal container={container}>
        <Popover.Content
          className={styles.popover}
          side="bottom"
          align={align}
          sideOffset={6}
          collisionPadding={12}
          aria-label="Add a category"
          // Escape closes an open group list before the form.
          onEscapeKeyDown={(event) => {
            if (listOpen.current) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            const id = added.current;
            added.current = null;
            if (!id) return;
            event.preventDefault();
            reveal(id);
          }}
        >
          <CategoryForm
            defaultGroup={defaultGroup}
            listOpen={listOpen}
            onAdded={(id) => {
              added.current = id;
              onOpenChange(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// The empty plan's way in: the same form, anchored to its own button. With
// no groups yet it starts in Everyday, the engine's default, so the first
// category needs only a name.
export function FirstCategoryButton() {
  const [open, setOpen] = useState(false);
  return (
    <AddCategoryPopover
      open={open}
      onOpenChange={setOpen}
      defaultGroup="Everyday"
    >
      <Button variant="primary">
        <PlusIcon aria-hidden />
        Add your first category
      </Button>
    </AddCategoryPopover>
  );
}

// A group of card or loan payment categories, which Caishen makes with
// their card or loan. Everyday categories don't go there.
export function isPaymentGroup(group: { categories: { pays?: unknown }[] }) {
  return group.categories.every((item) => item.pays);
}

type FieldName = "name" | "group" | "form";

function CategoryForm({
  defaultGroup,
  listOpen,
  onAdded,
}: {
  defaultGroup: string;
  listOpen: { current: boolean };
  onAdded: (categoryId: string) => void;
}) {
  const { groups } = useShellData();
  const { add } = useAddCategory();
  const [name, setName] = useState("");
  const [group, setGroup] = useState(defaultGroup);
  const [error, setError] = useState<{
    field: FieldName;
    message: string;
  } | null>(null);
  const nameId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLInputElement>(null);

  const fail = (field: FieldName, message: string) => {
    setError({ field, message });
    if (field === "name") nameRef.current?.focus();
    if (field === "group") groupRef.current?.focus();
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return fail("name", "Enter a name for the category.");
    const groupText = group.trim();
    if (!groupText)
      return fail(
        "group",
        groups.length
          ? "Choose a group or type a new one."
          : "Type a name for the group.",
      );
    // An existing group keeps its own spelling, so "everyday" joins
    // Everyday instead of starting a second group.
    const existing = groups.find(
      (item) => item.name.toLowerCase() === groupText.toLowerCase(),
    );
    const groupName = existing?.name ?? groupText;
    if (existing && isPaymentGroup(existing))
      return fail(
        "group",
        `${groupName} only holds payment categories. Choose another group.`,
      );
    const duplicate = existing?.categories.find(
      (item) => item.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate)
      return fail("name", `${groupName} already has ${duplicate.name}.`);
    const categoryId = newId();
    const blocked = add(
      {
        type: "category.add",
        id: newId(),
        categoryId,
        name: trimmed,
        group: groupName,
      },
      `Added ${trimmed} to ${groupName}`,
    );
    if (blocked) setError({ field: "form", message: blocked });
    else onAdded(categoryId);
  };

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={styles.field}>
        <label htmlFor={nameId}>Name</label>
        <div
          className={styles.search}
          data-expanded
          data-invalid={error?.field === "name" || undefined}
        >
          <input
            ref={nameRef}
            id={nameId}
            autoComplete="off"
            maxLength={MAX_LENGTH}
            placeholder="Groceries"
            value={name}
            aria-invalid={error?.field === "name" || undefined}
            aria-describedby={
              error?.field === "name" ? `${nameId}-error` : undefined
            }
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </div>
        {error?.field === "name" && (
          <FieldError id={`${nameId}-error`} message={error.message} />
        )}
      </div>
      <GroupField
        inputRef={groupRef}
        groups={groups
          .filter((item) => !isPaymentGroup(item))
          .map((item) => item.name)}
        value={group}
        error={error?.field === "group" ? error.message : undefined}
        listOpen={listOpen}
        onChange={(next) => {
          setGroup(next);
          setError(null);
        }}
      />
      {error?.field === "form" && (
        <div className={styles.formError}>
          <FieldError id={`${nameId}-form-error`} message={error.message} />
        </div>
      )}
      <div className={styles.footer}>
        <Popover.Close asChild>
          <Button size="sm">Cancel</Button>
        </Popover.Close>
        <Button variant="primary" size="sm" type="submit">
          Add category
        </Button>
      </div>
    </form>
  );
}

// The group is free text with the plan's groups as suggestions. A group
// exists only through its categories, so typing a new name is how a new
// group starts.
function GroupField({
  inputRef,
  groups,
  value,
  error,
  listOpen,
  onChange,
}: {
  inputRef: { current: HTMLInputElement | null };
  groups: string[];
  value: string;
  error?: string;
  listOpen: { current: boolean };
  onChange: (value: string) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const listRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  // Suggestions narrow only once the user types; the starting group shows
  // every group.
  const [typed, setTyped] = useState(false);
  // Nothing is highlighted until an arrow key picks it, so Enter after
  // typing a new group submits instead of taking the closest match.
  const [active, setActive] = useState<string | null>(null);
  const [instant, setInstant] = useState(false);
  const pointer = usePointerModality();
  useEffect(() => {
    listOpen.current = expanded;
  }, [listOpen, expanded]);

  const query = value.trim().toLowerCase();
  const visible =
    typed && query
      ? groups.filter((group) => group.toLowerCase().includes(query))
      : groups;
  const isNew =
    Boolean(query) && !groups.some((g) => g.toLowerCase() === query);
  const show = expanded && visible.length > 0;

  const open = () => {
    if (expanded) return;
    setInstant(!pointer.current);
    setTyped(false);
    setActive(null);
    setExpanded(true);
  };
  const close = () => {
    setInstant(!pointer.current);
    setExpanded(false);
  };
  const pick = (group: string) => {
    onChange(group);
    close();
  };
  const step = (by: number) => {
    const index = active ? visible.indexOf(active) : -1;
    const next =
      visible[
        index === -1
          ? by > 0
            ? 0
            : visible.length - 1
          : Math.min(visible.length - 1, Math.max(0, index + by))
      ];
    if (!next) return;
    setActive(next);
    listRef.current
      ?.querySelector(`[data-group="${CSS.escape(next)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className={styles.field}>
      <label htmlFor={id}>Group</label>
      <div
        className={styles.search}
        data-expanded
        data-invalid={error ? "" : undefined}
      >
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          autoComplete="off"
          maxLength={MAX_LENGTH}
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            show && active ? `${listId}-${visible.indexOf(active)}` : undefined
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? `${id}-error` : isNew && !show ? `${id}-hint` : undefined
          }
          placeholder={groups.length ? "Choose or type a group" : "Group name"}
          value={value}
          onFocus={open}
          onClick={open}
          onBlur={close}
          onChange={(event) => {
            open();
            setTyped(true);
            setActive(null);
            onChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!expanded) open();
              step(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Enter" && show && active) {
              event.preventDefault();
              pick(active);
            } else if (event.key === "Escape" && show) {
              close();
            }
          }}
        />
      </div>
      {error ? (
        <FieldError id={`${id}-error`} message={error} />
      ) : (
        isNew &&
        !show && (
          <p className={styles.hint} id={`${id}-hint`}>
            Starts a new group
          </p>
        )
      )}
      <div
        className={styles.listFrame}
        data-open={show || undefined}
        data-instant={instant || undefined}
        aria-hidden={!show || undefined}
        inert={!show}
      >
        <div className={styles.listClip}>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Groups"
            className={styles.list}
            // Keeps focus in the field while the pointer picks.
            onMouseDown={(event) => event.preventDefault()}
          >
            {visible.map((group, index) => (
              <div
                key={group}
                id={`${listId}-${index}`}
                data-group={group}
                role="option"
                aria-selected={group.toLowerCase() === query}
                data-active={group === active || undefined}
                className={styles.option}
                onMouseEnter={() => setActive(group)}
                onClick={() => pick(group)}
              >
                <span className={styles.check} aria-hidden>
                  {group.toLowerCase() === query && (
                    <CheckIcon size={13} strokeWidth={2.5} />
                  )}
                </span>
                <span className={shell.truncate}>{group}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
