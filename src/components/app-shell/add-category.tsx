"use client";

import { PlusIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { newId } from "~/components/budget/format";
import type { Command } from "~/domain/engine";
import { Button } from "~/components/ui/button";
import { Field, FormError } from "~/components/ui/field";
import { IconButton } from "~/components/ui/icon-button";
import { Tooltip } from "~/components/ui/tooltip";
import { useShellData } from "./shell-data";
import { Popover } from "~/components/ui/popover";
import { SearchList } from "~/components/ui/search-list";
import { TextInput } from "~/components/ui/text-input";
// The move-money popover's form fields.
import styles from "./move-money.module.css";

// What was just added, for the plan to bring into view.
export type Added =
  { type: "group"; name: string } | { type: "category"; id: string };

export type AddCategory = {
  // Sends a plan command (add, move, rename or delete a group or category)
  // with a summary for its confirmation. Returns why it can't be sent right
  // now, or null once it's on its way, then settles with whether it saved.
  send: (
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
// from the one given, and a new group can be named there, made with the
// category.
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
  const { send } = useAddCategory();
  const choices = groups.filter((item) => !isSystemGroup(item));
  const [name, setName] = useState(choice?.name ?? "");
  const [chosen, setChosen] = useState(choice?.group ?? "");
  // The new group's name while one is named in place of a choice. With no
  // groups to choose from, the form starts there.
  const [newGroup, setNewGroup] = useState<string | null>(
    choice && choices.length === 0 ? "" : null,
  );
  const [error, setError] = useState<{
    field: "name" | "group" | "form";
    message: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLInputElement>(null);
  // Focus follows the switch between the group list and a new group's
  // name, but stays on the category's name as the form opens.
  const switching = useRef(false);
  const listRef = useCallback((input: HTMLInputElement | null) => {
    if (!input || !switching.current) return;
    switching.current = false;
    input.focus();
  }, []);
  const newGroupRef = useCallback((input: HTMLInputElement | null) => {
    groupRef.current = input;
    if (!input || !switching.current) return;
    switching.current = false;
    input.focus();
  }, []);
  // Where the category goes; empty for a form that adds a group.
  const target = choice ? (newGroup?.trim() ?? chosen) : (group ?? "");

  const fail = (field: "name" | "group", message: string) => {
    setError({ field, message });
    (field === "group" ? groupRef : inputRef).current?.focus();
  };

  const submit = () => {
    const trimmed = name.trim();
    const same = (one: string, other: string) =>
      one.toLowerCase() === other.toLowerCase();
    let command: Command;
    let summary: string;
    let added: Added;
    let category: NewCategory | undefined;
    if (choice ?? group) {
      if (newGroup !== null) {
        if (!target) return fail("group", "Enter a name for the group.");
        const duplicate = groups.find((item) => same(item.name, target));
        if (duplicate)
          return fail(
            "group",
            `You already have a group called ${duplicate.name}.`,
          );
      }
      if (!trimmed) return fail("name", "Enter a name for the category.");
      const duplicate = groups
        .find((item) => item.name === target)
        ?.categories.find((item) => same(item.name, trimmed));
      if (duplicate)
        return fail("name", `${target} already has ${duplicate.name}.`);
      const categoryId = newId();
      // A group the plan doesn't have yet is made with its first category.
      command = {
        type: "category.add",
        id: newId(),
        categoryId,
        name: trimmed,
        group: target,
      };
      summary =
        newGroup !== null
          ? `Added the ${target} group with ${trimmed}`
          : `Added ${trimmed} to ${target}`;
      added = { type: "category", id: categoryId };
      category = { id: categoryId, name: trimmed, group: target };
    } else {
      if (!trimmed) return fail("name", "Enter a name for the group.");
      const duplicate = groups.find((item) => same(item.name, trimmed));
      if (duplicate)
        return fail(
          "name",
          `You already have a group called ${duplicate.name}.`,
        );
      command = { type: "group.add", id: newId(), name: trimmed };
      summary = `Added the ${trimmed} group`;
      added = { type: "group", name: trimmed };
    }
    const blocked = send(
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
      <div className={styles.fieldSlot}>
        <Field
          label={(choice ?? group) ? "Category name" : "Group name"}
          error={error?.field === "name" ? error.message : undefined}
        >
          <TextInput
            inputRef={inputRef}
            maxLength={MAX_LENGTH}
            placeholder={(choice ?? group) ? "Groceries" : "Bills"}
            value={name}
            onChange={(next) => {
              setName(next);
              setError(null);
            }}
          />
        </Field>
      </div>
      {choice && (
        <div className={styles.fieldSlot}>
          {newGroup === null ? (
            <Field label="Category group">
              <SearchList
                inputRef={listRef}
                value={chosen}
                onChange={(next) => {
                  setChosen(next);
                  setError(null);
                }}
                options={choices.map((item) => ({
                  value: item.name,
                  label: item.name,
                }))}
                onCreate={{
                  noun: "group",
                  create: (typed) => {
                    switching.current = true;
                    setNewGroup(typed);
                    setError(null);
                  },
                }}
              />
            </Field>
          ) : (
            <Field
              label="New group"
              error={error?.field === "group" ? error.message : undefined}
            >
              <TextInput
                inputRef={newGroupRef}
                maxLength={MAX_LENGTH}
                placeholder="Bills"
                value={newGroup}
                onChange={(next) => {
                  setNewGroup(next);
                  setError(null);
                }}
                clear={
                  choices.length > 0
                    ? {
                        label: "Back to existing groups",
                        onClear: () => {
                          switching.current = true;
                          setNewGroup(null);
                          setError(null);
                        },
                      }
                    : undefined
                }
              />
            </Field>
          )}
        </div>
      )}
      {error?.field === "form" && (
        <div className={styles.formError}>
          <FormError>{error.message}</FormError>
        </div>
      )}
      <div className={styles.footer}>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit">
          {!(choice ?? group)
            ? "Add category group"
            : newGroup !== null
              ? "Add group and category"
              : "Add category"}
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
        {/* With no group yet, the form starts on naming one. */}
        <NameForm
          choice={{ name, group: start ?? "" }}
          onAdded={(_, category) => {
            if (!category) return;
            added.current = category;
            onAdded(category);
            onOpenChange(false);
          }}
          onSettled={onSettled}
          onCancel={() => onOpenChange(false)}
        />
      </div>
    </Popover>
  );
}

// The + beside the plan's Category header, opened by the shell (N) as well as
// by its button.
export function AddGroupButton({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AddPopover open={open} onOpenChange={onOpenChange} align="start">
      <IconButton size="sm" label="Add category group" shortcut="N">
        <PlusIcon aria-hidden />
      </IconButton>
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
