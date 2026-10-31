"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { newId } from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import { Field, FormError, FormFooter } from "~/components/ui/field";
import { Popover } from "~/components/ui/popover";
import { TextInput } from "~/components/ui/text-input";
import type { Command } from "~/domain/engine";
import { useAddCategory } from "./add-category";
import { FundingBar } from "./funding-bar";
import type { Category } from "./model";
import { Destination } from "./move-money";
import { PopoverSteps } from "./popover-steps";
import { useShellData } from "./shell-data";
import shell from "./shell.module.css";
// The move-money form's layout, which this form shares.
import move from "./move-money.module.css";
import styles from "./category-edit.module.css";

// The engine's limit for names.
const MAX_LENGTH = 120;

export type Editing =
  | { type: "category"; category: Category }
  | { type: "group"; name: string; categories: Category[] };

// Caishen names the categories it pairs with a card, a loan, or a person, and
// keeps the groups that hold only those.
export const editableCategory = (category: Category) =>
  !category.pays && !category.pairs;
// A group is renamed or deleted with its categories, so one that holds any
// of Caishen's can't be. That covers the groups Caishen keeps (isSystemGroup
// in add-category.tsx), which still take no new categories, and a mixed one,
// which still takes them.
export const editableGroup = (group: { categories: Category[] }) =>
  group.categories.every(editableCategory);

// Over a plan row: the category's name, which opens its popover.
export function CategoryNameCell({
  category,
  open,
  onOpenChange,
  onPointerDown,
  onDeleted,
}: {
  category: Category;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Starts a drag, as the row does: the name is a handle too.
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onDeleted: (ids: string[]) => void;
}) {
  if (!editableCategory(category)) return null;
  return (
    // The overlay covers the row, so a drag measures from the row's top.
    <div
      className={`${shell.columns} ${styles.overlay}`}
      onPointerDown={onPointerDown}
    >
      <span className={shell.rowName}>
        <FundingBar category={category}>
          <EditNamePopover
            editing={{ type: "category", category }}
            open={open}
            onOpenChange={onOpenChange}
            onDeleted={onDeleted}
          >
            <button
              type="button"
              className={styles.name}
              aria-label={`Edit ${category.name}`}
            >
              <span className={shell.truncate}>{category.name}</span>
            </button>
          </EditNamePopover>
        </FundingBar>
      </span>
    </div>
  );
}

// Renames or deletes a category or group, from a click on its name, like
// YNAB. Deleting one with transactions or assigned money first asks which
// category takes them over.
export function EditNamePopover({
  editing,
  open,
  onOpenChange: setOpen,
  onDeleted,
  children,
}: {
  editing: Editing;
  // The plan holds it open, so a right-click anywhere on the row can open
  // it from the name.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The categories that went with it, which the plan stops selecting.
  onDeleted: (ids: string[]) => void;
  children: ReactElement;
}) {
  const { holdOpen } = useAddCategory();
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  const name =
    editing.type === "category" ? editing.category.name : editing.name;
  return (
    <Popover
      label={`Edit ${name}`}
      trigger={children}
      open={open}
      onOpenChange={setOpen}
      size="form"
      arrow
      autoFocus={false}
    >
      <EditForm
        editing={editing}
        onDone={() => setOpen(false)}
        onDeleted={onDeleted}
      />
    </Popover>
  );
}

function EditForm({
  editing,
  onDone,
  onDeleted,
}: {
  editing: Editing;
  onDone: () => void;
  onDeleted: (ids: string[]) => void;
}) {
  const { groups, categories } = useShellData();
  const { send: run } = useAddCategory();
  const group = editing.type === "group";
  const current =
    editing.type === "category" ? editing.category.name : editing.name;
  const doomed =
    editing.type === "category" ? [editing.category] : editing.categories;
  const used = doomed.some((category) => category.used);
  const [step, setStep] = useState<"name" | "move">("name");
  const [name, setName] = useState(current);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [error, setError] = useState<{
    field: "name" | "move" | "form";
    message: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const moveRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // Typing replaces the name, as in YNAB's rename.
    if (step === "name") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    // The move step lands on the form, not the well, so its list stays shut
    // until the person opens it.
    else moveRef.current?.focus({ preventScroll: true });
  }, [step]);

  const send = (command: Command, summary: string) => {
    const blocked = run(command, summary);
    if (blocked) {
      setError({ field: "form", message: blocked });
      return false;
    }
    onDone();
    return true;
  };

  const rename = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError({
        field: "name",
        message: group
          ? "Enter a name for the group."
          : "Enter a name for the category.",
      });
      return;
    }
    if (trimmed === current) {
      onDone();
      return;
    }
    const same = (other: string) =>
      other.toLowerCase() === trimmed.toLowerCase();
    if (editing.type === "category") {
      const { category } = editing;
      const taken = groups
        .find((item) => item.name === category.group)
        ?.categories.find((item) => item !== category && same(item.name));
      if (taken) {
        setError({
          field: "name",
          message: `${category.group} already has ${taken.name}.`,
        });
        return;
      }
      send(
        {
          type: "category.rename",
          id: newId(),
          categoryId: category.id,
          name: trimmed,
        },
        `Renamed ${category.name} to ${trimmed}`,
      );
    } else {
      const taken = groups.find(
        (item) => item.name !== editing.name && same(item.name),
      );
      if (taken) {
        setError({
          field: "name",
          message: `You already have a group called ${taken.name}.`,
        });
        return;
      }
      send(
        {
          type: "group.rename",
          id: newId(),
          group: editing.name,
          name: trimmed,
        },
        `Renamed the ${editing.name} group to ${trimmed}`,
      );
    }
  };

  const remove = (to?: string) => {
    const ids = doomed.map((category) => category.id);
    const moved = to && categories.find((item) => item.id === to);
    const into = moved ? ` and moved its money to ${moved.name}` : "";
    const sent =
      editing.type === "category"
        ? send(
            {
              type: "category.delete",
              id: newId(),
              categoryId: editing.category.id,
              ...(to ? { moveTo: to } : {}),
            },
            `Deleted ${editing.category.name}${into}`,
          )
        : send(
            {
              type: "group.delete",
              id: newId(),
              group: editing.name,
              ...(to ? { moveTo: to } : {}),
            },
            `Deleted the ${editing.name} group${into}`,
          );
    if (sent) onDeleted(ids);
  };

  const footerError = error?.field === "form" && (
    <FormError>{error.message}</FormError>
  );

  if (step === "move") {
    const options = categories
      .filter(
        (item) =>
          editableCategory(item) && !doomed.some((gone) => gone.id === item.id),
      )
      .map(({ id, name, group, available }) => ({
        id,
        name,
        group,
        available,
      }));
    return (
      <PopoverSteps step={step}>
        <form
          ref={moveRef}
          tabIndex={-1}
          aria-label={`Delete ${current}`}
          className={move.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!moveTo) {
              setError({
                field: "move",
                message: "Choose a category to move them to.",
              });
              return;
            }
            remove(moveTo);
          }}
        >
          <div className={move.fields}>
            <p className={styles.note}>
              {group
                ? `Categories in ${current} have transactions or assigned money. Choose a category to take them over.`
                : `${current} has transactions or assigned money. Choose a category to take them over.`}
            </p>
            <Destination
              label="Move to"
              options={options}
              value={moveTo}
              short={() => false}
              error={error?.field === "move" ? error.message : undefined}
              onChange={(id) => {
                setMoveTo(id);
                setError(null);
              }}
            />
            {footerError}
          </div>
          <FormFooter
            actions={
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    setStep("name");
                    setError(null);
                  }}
                >
                  Back
                </Button>
                <Button variant="primary" size="sm" type="submit">
                  {group ? "Delete group" : "Delete category"}
                </Button>
              </>
            }
          />
        </form>
      </PopoverSteps>
    );
  }

  return (
    <PopoverSteps step={step}>
      <form
        className={move.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // A portal's events still reach the forms around its trigger.
          event.stopPropagation();
          rename();
        }}
      >
        <div className={move.fields}>
          <Field
            label={group ? "Group name" : "Category name"}
            error={error?.field === "name" ? error.message : undefined}
          >
            <TextInput
              inputRef={inputRef}
              maxLength={MAX_LENGTH}
              value={name}
              onChange={(next) => {
                setName(next);
                setError(null);
              }}
            />
          </Field>
          {footerError}
        </div>
        <FormFooter
          leading={
            <Button
              size="sm"
              onClick={() => {
                setError(null);
                if (used) setStep("move");
                else remove();
              }}
            >
              Delete
            </Button>
          }
          actions={
            <>
              <Button size="sm" onClick={onDone}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit">
                Save
              </Button>
            </>
          }
        />
      </form>
    </PopoverSteps>
  );
}
