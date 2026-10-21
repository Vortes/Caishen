"use client";

import { PlusIcon } from "lucide-react";
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
import { IconButton } from "~/components/ui/icon-button";
import { Tooltip, usePortalContainer } from "~/components/ui/tooltip";
import { FieldError } from "./move-money";
import { useShellData } from "./shell-data";
import shell from "./shell.module.css";
// The move-money popover's form surface and fields.
import styles from "./move-money.module.css";

// What was just added, for the plan to bring into view.
export type Added =
  { type: "group"; name: string } | { type: "category"; id: string };

export type AddCategory = {
  // Sends the new group's or category's command with a summary for its
  // confirmation. Returns why it can't be sent right now, or null once it's
  // on its way.
  add: (command: Command, summary: string) => string | null;
  // Shows what was added once it's on the plan.
  reveal: (added: Added) => void;
  // Called with a cleanup while a form is open, so the shell can hold its
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

// The engine's limit for names.
const MAX_LENGTH = 120;

// A group of card or loan payment categories, which Caishen makes with their
// card or loan. Everyday categories don't go there.
export function isPaymentGroup(group: { categories: { pays?: unknown }[] }) {
  return (
    group.categories.length > 0 && group.categories.every((item) => item.pays)
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
  children: ReactNode;
}) {
  const container = usePortalContainer();
  const { holdOpen, reveal } = useAddCategory();
  // Where focus goes once the form closes: what it added, after an add,
  // otherwise back to the button that opened it.
  const added = useRef<Added | null>(null);
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  const trigger = <Popover.Trigger asChild>{children}</Popover.Trigger>;
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {tooltip && !open ? (
        <Tooltip label={tooltip.label} shortcut={tooltip.shortcut}>
          {trigger}
        </Tooltip>
      ) : (
        // While the form is open its trigger has no tooltip, which, left open
        // under the pointer that clicked it, would take the form's Escape.
        trigger
      )}
      <Popover.Portal container={container}>
        <Popover.Content
          className={styles.popover}
          side="bottom"
          align={align}
          sideOffset={6}
          collisionPadding={12}
          aria-label={
            group ? `Add a category to ${group}` : "Add a category group"
          }
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
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NameForm({
  group,
  onAdded,
}: {
  group?: string;
  onAdded: (added: Added) => void;
}) {
  const { groups } = useShellData();
  const { add } = useAddCategory();
  const [name, setName] = useState("");
  const [error, setError] = useState<{
    field: "name" | "form";
    message: string;
  } | null>(null);
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (group) {
      if (!trimmed) return fail("Enter a name for the category.");
      const duplicate = groups
        .find((item) => item.name === group)
        ?.categories.find((item) => same(item.name));
      if (duplicate) return fail(`${group} already has ${duplicate.name}.`);
      const categoryId = newId();
      command = {
        type: "category.add",
        id: newId(),
        categoryId,
        name: trimmed,
        group,
      };
      summary = `Added ${trimmed} to ${group}`;
      added = { type: "category", id: categoryId };
    } else {
      if (!trimmed) return fail("Enter a name for the group.");
      const duplicate = groups.find((item) => same(item.name));
      if (duplicate)
        return fail(`You already have a group called ${duplicate.name}.`);
      command = { type: "group.add", id: newId(), name: trimmed };
      summary = `Added the ${trimmed} group`;
      added = { type: "group", name: trimmed };
    }
    const blocked = add(command, summary);
    if (blocked) setError({ field: "form", message: blocked });
    else onAdded(added);
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
      {group && (
        <div className={styles.header}>
          <span className={styles.headerLabel}>New category in</span>
          <strong className={shell.truncate}>{group}</strong>
        </div>
      )}
      <div className={styles.field}>
        <label htmlFor={id}>{group ? "Category name" : "Group name"}</label>
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
            placeholder={group ? "Groceries" : "Bills"}
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
      {error?.field === "form" && (
        <div className={styles.formError}>
          <FieldError id={`${id}-error`} message={error.message} />
        </div>
      )}
      <div className={styles.footer}>
        <Popover.Close asChild>
          <Button size="sm">Cancel</Button>
        </Popover.Close>
        <Button variant="primary" size="sm" type="submit">
          {group ? "Add category" : "Add group"}
        </Button>
      </div>
    </form>
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

// The row under a group with no categories yet.
export function EmptyGroupButton({ group }: { group: string }) {
  const [open, setOpen] = useState(false);
  return (
    <AddPopover group={group} open={open} onOpenChange={setOpen} align="start">
      <Button variant="quiet" size="sm" data-add-category={group}>
        <PlusIcon aria-hidden />
        Add category
      </Button>
    </AddPopover>
  );
}
