"use client";

import { ChevronDownIcon, PlusIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { newId } from "~/components/budget/format";
import type { Command } from "~/domain/engine";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { Tooltip } from "~/components/ui/tooltip";
import { FieldError } from "./move-money";
import { useShellData } from "./shell-data";
import { Popover } from "~/components/ui/popover";
// The move-money popover's form fields.
import styles from "./move-money.module.css";

// What was just added, for the plan to bring into view.
export type Added =
  { type: "group"; name: string } | { type: "category"; id: string };

export type AddCategory = {
  // Sends the new group's or category's command with a summary for its
  // confirmation. Returns why it can't be sent right now, or null once it's
  // on its way, then settles with whether it saved.
  add: (
    command: Command,
    summary: string,
    settled?: (saved: boolean) => void,
  ) => string | null;
  // Shows what was added once it's on the plan.
  reveal: (added: Added) => void;
  // Called with a cleanup while a form is open, so the shell can hold its
  // undo shortcut until it closes.
  holdOpen: () => () => void;
};

const AddCategoryContext = createContext<AddCategory | null>(null);

export const AddCategoryProvider = AddCategoryContext.Provider;

export function useAddCategory() {
  const value = useContext(AddCategoryContext);
  if (!value) throw new Error("useAddCategory needs an AddCategoryProvider.");
  return value;
}

// The engine's limit for names.
const MAX_LENGTH = 120;

// A group of card or loan payment categories, which Caishen makes with their
// card or loan. Everyday categories don't go there.
// A group the system keeps, like card payments or People, which takes no
// categories of the user's own.
export function isSystemGroup(group: {
  categories: { pays?: unknown; pairs?: unknown }[];
}) {
  return (
    group.categories.length > 0 &&
    group.categories.every((item) => item.pays ?? item.pairs)
  );
}

// A one-field form anchored to whatever opened it. Without a group it adds a
// category group, the folder categories sit in; with one, it adds a category
// to that group.
function AddPopover({
  group,
  open,
  onOpenChange,
  align = "center",
  tooltip,
  children,
}: {
  group?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  align?: "start" | "center" | "end";
  tooltip?: { label: string; shortcut?: string };
  children: ReactElement;
}) {
  const { holdOpen, reveal } = useAddCategory();
  // Where focus goes once the form closes: what it added, after an add,
  // otherwise back to the button that opened it.
  const added = useRef<Added | null>(null);
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  return (
    <Popover
      label={group ? `Add a category to ${group}` : "Add a category group"}
      trigger={
        tooltip && !open ? (
          <Tooltip label={tooltip.label} shortcut={tooltip.shortcut}>
            {children}
          </Tooltip>
        ) : (
          // While the form is open its trigger has no tooltip, which, left
          // open under the pointer that clicked it, would take the form's
          // Escape.
          children
        )
      }
      open={open}
      onOpenChange={onOpenChange}
      align={align}
      size="form"
      onCloseAutoFocus={(event) => {
        const next = added.current;
        added.current = null;
        if (!next) return;
        event.preventDefault();
        reveal(next);
      }}
    >
      <NameForm
        group={group}
        onAdded={(next) => {
          added.current = next;
          onOpenChange(false);
        }}
        onCancel={() => onOpenChange(false)}
      />
    </Popover>
  );
}

// A category made from somewhere other than the plan, like a transaction's
// Category field, with the name and group it was given.
export type NewCategory = { id: string; name: string; group: string };

// Names a new category group, or a category in one. With a group the
// category goes there; with a choice, the form asks which group, starting
// from the one given.
function NameForm({
  group,
  choice,
  onAdded,
  onSettled,
  onCancel,
}: {
  group?: string;
  choice?: { name: string; group: string };
  onAdded: (added: Added, category?: NewCategory) => void;
  onCancel: () => void;
  // Whether the new category saved, once the server answers.
  onSettled?: (category: NewCategory, saved: boolean) => void;
}) {
  const { groups } = useShellData();
  const { add } = useAddCategory();
  const [name, setName] = useState(choice?.name ?? "");
  const [chosen, setChosen] = useState(choice?.group ?? "");
  const [error, setError] = useState<{
    field: "name" | "form";
    message: string;
  } | null>(null);
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const target = choice ? chosen : group;
  const choices = groups.filter((item) => !isSystemGroup(item));

  const fail = (message: string) => {
    setError({ field: "name", message });
    inputRef.current?.focus();
  };

  const submit = () => {
    const trimmed = name.trim();
    const same = (other: string) =>
      other.toLowerCase() === trimmed.toLowerCase();
    let command: Command;
    let summary: string;
    let added: Added;
    let category: NewCategory | undefined;
    if (target) {
      if (!trimmed) return fail("Enter a name for the category.");
      const duplicate = groups
        .find((item) => item.name === target)
        ?.categories.find((item) => same(item.name));
      if (duplicate) return fail(`${target} already has ${duplicate.name}.`);
      const categoryId = newId();
      command = {
        type: "category.add",
        id: newId(),
        categoryId,
        name: trimmed,
        group: target,
      };
      summary = `Added ${trimmed} to ${target}`;
      added = { type: "category", id: categoryId };
      category = { id: categoryId, name: trimmed, group: target };
    } else {
      if (!trimmed) return fail("Enter a name for the group.");
      const duplicate = groups.find((item) => same(item.name));
      if (duplicate)
        return fail(`You already have a group called ${duplicate.name}.`);
      command = { type: "group.add", id: newId(), name: trimmed };
      summary = `Added the ${trimmed} group`;
      added = { type: "group", name: trimmed };
    }
    const blocked = add(
      command,
      summary,
      category && onSettled && ((saved) => onSettled(category, saved)),
    );
    if (blocked) setError({ field: "form", message: blocked });
    else onAdded(added, category);
  };

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // A portal's events still reach the forms around its trigger, like
        // the transaction editor's.
        event.stopPropagation();
        submit();
      }}
    >
      <div className={styles.field}>
        <label htmlFor={id}>{target ? "Category name" : "Group name"}</label>
        <div
          className={styles.search}
          data-expanded
          data-invalid={error?.field === "name" || undefined}
        >
          <input
            ref={inputRef}
            id={id}
            autoComplete="off"
            maxLength={MAX_LENGTH}
            placeholder={target ? "Groceries" : "Bills"}
            value={name}
            aria-invalid={error?.field === "name" || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </div>
        {error?.field === "name" && (
          <FieldError id={`${id}-error`} message={error.message} />
        )}
      </div>
      {choice && (
        <div className={styles.field}>
          <label htmlFor={`${id}-group`}>Category group</label>
          <div className={styles.select}>
            <select
              id={`${id}-group`}
              value={chosen}
              onChange={(event) => {
                setChosen(event.target.value);
                setError(null);
              }}
            >
              {choices.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
            <ChevronDownIcon size={12} aria-hidden />
          </div>
        </div>
      )}
      {error?.field === "form" && (
        <div className={styles.formError}>
          <FieldError id={`${id}-error`} message={error.message} />
        </div>
      )}
      <div className={styles.footer}>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit">
          {target ? "Add category" : "Add category group"}
        </Button>
      </div>
    </form>
  );
}

// Adds a category from a transaction's Category field, anchored under it,
// with what was typed there as its name. The group starts as the one the
// field's current category is in, so a related category lands beside it.
export function NewCategoryPopover({
  open,
  name,
  group,
  onOpenChange,
  onAdded,
  onSettled,
  onClosed,
  children,
}: {
  open: boolean;
  name: string;
  group?: string;
  onOpenChange: (open: boolean) => void;
  onAdded: (category: NewCategory) => void;
  onSettled: (category: NewCategory, saved: boolean) => void;
  // Takes focus once the form closes, with what it added, if anything.
  onClosed: (category: NewCategory | null) => void;
  children: ReactElement;
}) {
  const added = useRef<NewCategory | null>(null);
  const { groups } = useShellData();
  const choices = groups.filter((item) => !isSystemGroup(item));
  const start =
    choices.find((item) => item.name === group)?.name ?? choices[0]?.name;
  return (
    <Popover
      label="Add a category"
      size="form"
      anchor={children}
      open={open}
      onOpenChange={onOpenChange}
      autoFocus
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onClosed(added.current);
        added.current = null;
      }}
    >
      <div
        onKeyDown={(event) => {
          // Escape closes this, not the editor around the field.
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        {start ? (
          <NameForm
            choice={{ name, group: start }}
            onAdded={(_, category) => {
              if (!category) return;
              added.current = category;
              onAdded(category);
              onOpenChange(false);
            }}
            onSettled={onSettled}
            onCancel={() => onOpenChange(false)}
          />
        ) : (
          <p className={styles.empty}>
            Add a category group on the plan first.
          </p>
        )}
      </div>
    </Popover>
  );
}

// The plan toolbar's Add category group, opened by the shell (N) as well as
// by its button.
export function AddGroupButton({
  open,
  onOpenChange,
  compact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // A phone's toolbar has room for a word, not three.
  compact: boolean;
}) {
  return (
    <AddPopover
      open={open}
      onOpenChange={onOpenChange}
      align="end"
      tooltip={{ label: "Add a category group", shortcut: "N" }}
    >
      <Button size="sm" aria-label={compact ? "Add category group" : undefined}>
        <PlusIcon aria-hidden />
        {compact ? "Group" : "Add category group"}
      </Button>
    </AddPopover>
  );
}

// The empty plan's way in: a category group comes first, and its categories
// go in it.
export function FirstGroupButton() {
  const [open, setOpen] = useState(false);
  return (
    <AddPopover open={open} onOpenChange={setOpen}>
      <Button variant="primary">
        <PlusIcon aria-hidden />
        Add a category group
      </Button>
    </AddPopover>
  );
}

// The + on a group's header, shown while the pointer or focus is on it.
export function AddToGroupButton({ group }: { group: string }) {
  const [open, setOpen] = useState(false);
  return (
    <AddPopover group={group} open={open} onOpenChange={setOpen} align="start">
      <IconButton size="sm" label={`Add a category to ${group}`}>
        <PlusIcon aria-hidden />
      </IconButton>
    </AddPopover>
  );
}
