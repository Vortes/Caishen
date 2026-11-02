"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import { readAmount, sameAmount } from "~/components/budget/amount";
import { newId } from "~/components/budget/format";
import type { Command } from "~/domain/engine";
import { money, type Category } from "./model";
import { AmountInput } from "~/components/ui/amount-input";
import { Button } from "~/components/ui/button";
import { Field, FormError, FormFooter } from "~/components/ui/field";
import { Popover } from "~/components/ui/popover";
import { SearchList } from "~/components/ui/search-list";
import { useShellData } from "./shell-data";
import shell from "./shell.module.css";
import styles from "./move-money.module.css";

export const READY_TO_ASSIGN = "ready-to-assign";

export type MoveMoney = {
  // Sends the move's command with a summary for its confirmation. Returns
  // why it can't be sent right now, or null once it's on its way.
  move: (command: Command, summary: string) => string | null;
  // Called with a cleanup while a move popover is open, so the shell can
  // hold its undo shortcut until it closes.
  holdOpen: () => () => void;
};

const MoveMoneyContext = createContext<MoveMoney | null>(null);

export const MoveMoneyProvider = MoveMoneyContext.Provider;

export function useMoveMoney() {
  const value = useContext(MoveMoneyContext);
  if (!value) throw new Error("useMoveMoney needs a MoveMoneyProvider.");
  return value;
}

// YNAB's move-money popover. A category with money moves it somewhere else;
// an overspent one covers the overspending from somewhere else. Ready to
// Assign can be either side.
export function MoveMoneyPopover({
  category,
  align = "center",
  children,
}: {
  category: Category;
  align?: "start" | "center" | "end";
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const cover = category.available < 0;
  const { holdOpen } = useMoveMoney();
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  return (
    <Popover
      label={
        cover
          ? `Cover ${category.name}'s overspending`
          : `Move money from ${category.name}`
      }
      trigger={children}
      open={open}
      onOpenChange={setOpen}
      align={align}
      size="form"
      arrow
    >
      <MoveForm category={category} onDone={() => setOpen(false)} />
    </Popover>
  );
}

export type Option = {
  id: string;
  name: string;
  group: string;
  available: number;
};

function MoveForm({
  category,
  onDone,
}: {
  category: Category;
  onDone: () => void;
}) {
  const { categories, readyToAssign, month } = useShellData();
  const { move } = useMoveMoney();
  const cover = category.available < 0;
  const [amount, setAmount] = useState(
    category.available === 0
      ? ""
      : (Math.abs(category.available) / 100).toFixed(2),
  );
  const [other, setOther] = useState<string | null>(null);
  const [error, setError] = useState<{
    field: "amount" | "other" | "form";
    message: string;
  } | null>(null);
  const reading = readAmount(amount);
  const cents = reading.ok ? reading.cents : NaN;

  // Covering draws only from somewhere with money; moving can go anywhere.
  const options: Option[] = [
    {
      id: READY_TO_ASSIGN,
      name: "Ready to Assign",
      group: "Inflow",
      available: readyToAssign,
    },
    ...categories
      .filter((item) => item.id !== category.id)
      .map(({ id, name, group, available }) => ({
        id,
        name,
        group,
        available,
      })),
  ].filter((option) => !cover || option.available > 0);
  const short = (option: Option) =>
    cover && cents > 0 && option.available < cents;

  const submit = (to = other) => {
    if (!reading.ok) {
      setError({ field: "amount", message: reading.message });
      return;
    }
    if (!(cents > 0)) {
      setError({ field: "amount", message: "Enter an amount above zero." });
      return;
    }
    if (!cover && cents > category.available) {
      setError({
        field: "amount",
        message: `${category.name} only has ${money(Math.max(0, category.available))} available.`,
      });
      return;
    }
    const chosen = options.find((option) => option.id === to);
    if (!chosen) {
      setError({
        field: "other",
        message: cover
          ? "Choose where to cover it from."
          : "Choose where to move it.",
      });
      return;
    }
    if (short(chosen)) {
      setError({
        field: "other",
        message: `${chosen.name} only has ${money(chosen.available)} available.`,
      });
      return;
    }
    // Ready to Assign on either side
    // is an assignment, negative when money leaves the category; two
    // categories are a cover from one to the other.
    const id = newId();
    const command: Command =
      chosen.id === READY_TO_ASSIGN
        ? {
            type: "assign",
            id,
            categoryId: category.id,
            month: month.key,
            amount: cover ? cents : -cents,
          }
        : {
            type: "cover",
            id,
            fromCategoryId: cover ? chosen.id : category.id,
            toCategoryId: cover ? category.id : chosen.id,
            month: month.key,
            amount: cents,
          };
    const [fromName, toName] = cover
      ? [chosen.name, category.name]
      : [category.name, chosen.name];
    const blocked = move(
      command,
      `Moved ${money(cents)} from ${fromName} to ${toName}`,
    );
    if (blocked) setError({ field: "form", message: blocked });
    else onDone();
  };

  const amountField = (
    <Field
      label={cover ? "Overspending to cover" : "Amount"}
      error={error?.field === "amount" ? error.message : undefined}
    >
      <AmountInput
        placeholder="0.00"
        value={amount}
        onChange={(next) => {
          if (!sameAmount(amount, next)) setError(null);
          setAmount(next);
        }}
      />
    </Field>
  );
  const destination = (
    <Destination
      label={cover ? "From" : "To"}
      options={options}
      value={other}
      short={short}
      error={error?.field === "other" ? error.message : undefined}
      onChange={(id) => {
        setOther(id);
        setError(null);
      }}
    />
  );
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          {cover ? "Cover" : "Move from"}
        </span>
        <strong className={shell.truncate}>{category.name}</strong>
        <span className={styles.balance} data-state={category.funding}>
          {money(category.available)}
        </span>
      </div>
      <div className={styles.fields}>
        {amountField}
        {destination}
        {error?.field === "form" && <FormError>{error.message}</FormError>}
      </div>
      <FormFooter
        actions={
          <>
            <Button size="sm" onClick={onDone}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit">
              {cover ? "Cover" : "Move"}
            </Button>
          </>
        }
      />
    </form>
  );
}

// The destination (or, when covering, the source): Ready to Assign and the
// plan's categories under their groups, with their balances. An option
// short of the amount shows but can't be picked.
export function Destination({
  label,
  options,
  value,
  short,
  error,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string | null;
  short: (option: Option) => boolean;
  error?: string;
  onChange: (id: string) => void;
}) {
  return (
    <Field label={label} error={error}>
      <SearchList
        value={value ?? ""}
        onChange={onChange}
        options={options.map((option) => ({
          value: option.id,
          label: option.name,
          group: option.group,
          amount: option.available,
          disabled: short(option),
        }))}
        placeholder="Choose a category"
      />
    </Field>
  );
}
