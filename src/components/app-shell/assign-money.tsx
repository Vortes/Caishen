"use client";

import { groupAmountInput } from "~/components/budget/amount-input";
import { ZapIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { newId } from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { usePortalContainer } from "~/components/ui/tooltip";
import { usePopoverMotion } from "~/components/ui/popover-motion";
import { POPOVER_GAP } from "~/components/ui/tokens";
import {
  planAutoAssign,
  optionAmount,
  type AutoAssignOption,
} from "~/domain/auto-assign";
import type { Command } from "~/domain/engine";
import { money, type Category } from "./model";
import {
  Destination,
  FieldError,
  parseAmount,
  READY_TO_ASSIGN,
  useMoveMoney,
  type Option,
} from "./move-money";
import { useShellData } from "./shell-data";
import moveStyles from "./move-money.module.css";
import styles from "./assign-money.module.css";

// YNAB's Assign popover on the Ready to Assign card. Manual moves an amount
// between Ready to Assign and a category, or between two categories; Auto
// runs an Auto-Assign option over the whole month. When Ready to Assign is
// negative, the same form pulls money back from a category to fix it.
export function AssignMoneyPopover({ children }: { children: ReactNode }) {
  const container = usePortalContainer();
  const { readyToAssign } = useShellData();
  const [open, setOpen] = useState(
    () => new URLSearchParams(window.location.search).get("assign") === "1",
  );
  const motion = usePopoverMotion(open);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("assign")) {
      url.searchParams.delete("assign");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);
  const { holdOpen } = useMoveMoney();
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          {...motion}
          className={moveStyles.popover}
          side="bottom"
          align="center"
          sideOffset={POPOVER_GAP}
          collisionPadding={12}
          aria-label={
            readyToAssign < 0 ? "Fix overassigned money" : "Assign money"
          }
          // Escape closes an open category list before the popover.
          onEscapeKeyDown={(event) => {
            const focused = document.activeElement;
            if (
              focused?.getAttribute("role") === "combobox" &&
              focused.getAttribute("aria-expanded") === "true"
            )
              event.preventDefault();
          }}
        >
          <Tabs defaultValue="manual">
            <div className={styles.tabs}>
              <TabsList aria-label="How to assign">
                <TabsTrigger value="auto">
                  <ZapIcon size={13} aria-hidden className={styles.tabIcon} />
                  Auto
                </TabsTrigger>
                <TabsTrigger value="manual">Manual</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="auto">
              <AutoAssign onDone={() => setOpen(false)} />
            </TabsContent>
            <TabsContent value="manual">
              <ManualForm onDone={() => setOpen(false)} />
            </TabsContent>
          </Tabs>
          <Popover.Arrow className={moveStyles.arrow} width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ManualForm({ onDone }: { onDone: () => void }) {
  const { categories, readyToAssign, month } = useShellData();
  const { move } = useMoveMoney();
  const over = readyToAssign < 0;
  // Assigning starts from Ready to Assign with all of it; fixing starts with
  // the overassigned amount going back to Ready to Assign.
  const [amount, setAmount] = useState(
    readyToAssign === 0 ? "" : (Math.abs(readyToAssign) / 100).toFixed(2),
  );
  const [from, setFrom] = useState<string | null>(
    over ? null : READY_TO_ASSIGN,
  );
  const [to, setTo] = useState<string | null>(over ? READY_TO_ASSIGN : null);
  const [error, setError] = useState<{
    field: "amount" | "from" | "to" | "form";
    message: string;
  } | null>(null);
  const fromOpen = useRef(false);
  const toOpen = useRef(false);
  const amountId = useId();
  const cents = parseAmount(amount);

  const all: Option[] = [
    {
      id: READY_TO_ASSIGN,
      name: "Ready to Assign",
      group: "Inflow",
      available: readyToAssign,
    },
    ...categories.map(({ id, name, group, available }) => ({
      id,
      name,
      group,
      available,
    })),
  ];
  // Money can only come from somewhere that holds it.
  const fromOptions = all.filter(
    (option) =>
      option.id !== to &&
      (option.id === READY_TO_ASSIGN || option.available > 0),
  );
  const toOptions = all.filter((option) => option.id !== from);
  const short = (option: Option) => cents > 0 && option.available < cents;
  const named = (id: string | null) => all.find((option) => option.id === id);

  const submit = () => {
    if (!(cents > 0)) {
      setError({ field: "amount", message: "Enter an amount above zero." });
      return;
    }
    const source = named(from);
    if (!source) {
      setError({
        field: "from",
        message: "Choose where the money comes from.",
      });
      return;
    }
    const target = named(to);
    if (!target) {
      setError({ field: "to", message: "Choose where the money goes." });
      return;
    }
    if (short(source)) {
      setError({
        field: "from",
        message:
          source.id === READY_TO_ASSIGN
            ? `Only ${money(Math.max(0, source.available))} is ready to assign.`
            : `${source.name} only has ${money(source.available)} available.`,
      });
      return;
    }
    // Ready to Assign on either side is
    // an assignment, negative when money goes back; two categories are a
    // cover from one to the other.
    const id = newId();
    const command: Command =
      source.id === READY_TO_ASSIGN
        ? {
            type: "assign",
            id,
            categoryId: target.id,
            month: month.key,
            amount: cents,
          }
        : target.id === READY_TO_ASSIGN
          ? {
              type: "assign",
              id,
              categoryId: source.id,
              month: month.key,
              amount: -cents,
            }
          : {
              type: "cover",
              id,
              fromCategoryId: source.id,
              toCategoryId: target.id,
              month: month.key,
              amount: cents,
            };
    const blocked = move(
      command,
      source.id === READY_TO_ASSIGN
        ? `Assigned ${money(cents)} to ${target.name}`
        : `Moved ${money(cents)} from ${source.name} to ${target.name}`,
    );
    if (blocked) setError({ field: "form", message: blocked });
    else onDone();
  };

  const pick = (set: (id: string) => void) => (id: string) => {
    set(id);
    setError(null);
  };
  return (
    <form
      className={moveStyles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={moveStyles.field}>
        <label htmlFor={amountId}>Amount</label>
        <div
          className={moveStyles.amountInput}
          data-invalid={error?.field === "amount" || undefined}
        >
          <span aria-hidden>$</span>
          <input
            id={amountId}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            aria-invalid={error?.field === "amount" || undefined}
            aria-describedby={
              error?.field === "amount" ? `${amountId}-error` : undefined
            }
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setAmount(groupAmountInput(event.target));
              setError(null);
            }}
          />
        </div>
        {error?.field === "amount" && (
          <FieldError id={`${amountId}-error`} message={error.message} />
        )}
      </div>
      <Destination
        label="From"
        options={fromOptions}
        value={from}
        short={short}
        error={error?.field === "from" ? error.message : undefined}
        listOpen={fromOpen}
        onChange={pick(setFrom)}
      />
      <Destination
        label="To"
        options={toOptions}
        value={to}
        short={() => false}
        error={error?.field === "to" ? error.message : undefined}
        listOpen={toOpen}
        onChange={pick(setTo)}
      />
      {error?.field === "form" && (
        <div className={moveStyles.formError}>
          <FieldError id={`${amountId}-form-error`} message={error.message} />
        </div>
      )}
      <div className={moveStyles.footer}>
        <Popover.Close asChild>
          <Button size="sm">Cancel</Button>
        </Popover.Close>
        <Button variant="primary" size="sm" type="submit">
          {from === READY_TO_ASSIGN ? "Assign" : "Move"}
        </Button>
      </div>
    </form>
  );
}

// YNAB's grouping: what's needed, what history suggests, and what frees
// money up.
const autoGroups: [AutoAssignOption, string][][] = [
  [["underfunded", "Underfunded"]],
  [
    ["assigned-last-month", "Assigned last month"],
    ["spent-last-month", "Spent last month"],
    ["average-assigned", "Average assigned"],
    ["average-spent", "Average spent"],
  ],
  [
    ["reduce-overfunding", "Reduce overfunding"],
    ["reset-available", "Reset available amounts"],
    ["reset-assigned", "Reset assigned amounts"],
  ],
];

// Plans and runs Auto-Assign options over the given categories as one
// assign.batch move. The toast that follows offers Undo. run returns why the
// move can't be sent right now, or null once it's on its way.
export function useAutoAssign(categories: Category[]) {
  const { readyToAssign, month } = useShellData();
  const { move } = useMoveMoney();
  const scope = categories.map((item) => item.autoAssign);
  const plan = (option: AutoAssignOption) =>
    planAutoAssign({ option, scope, readyToAssign, month: month.key });

  const run = (option: AutoAssignOption) => {
    const { changes } = plan(option);
    const net = changes.reduce((total, change) => total + change.amount, 0);
    // One category is named; more are counted.
    const named =
      changes.length === 1
        ? categories.find((item) => item.id === changes[0]!.categoryId)?.name
        : undefined;
    const count =
      named ??
      `${changes.length} ${changes.length === 1 ? "category" : "categories"}`;
    return move(
      { type: "assign.batch", id: newId(), month: month.key, changes },
      changes.every((change) => change.amount > 0)
        ? `Assigned ${money(net)} to ${count}`
        : changes.every((change) => change.amount < 0)
          ? `Moved ${money(-net)} from ${count} to Ready to Assign`
          : `Updated ${count}`,
    );
  };
  return { scope, plan, run };
}

// Runs an option over every category this month at once, like YNAB.
function AutoAssign({ onDone }: { onDone: () => void }) {
  const { categories, readyToAssign, month } = useShellData();
  const [error, setError] = useState<string | null>(null);
  const { scope, plan, run: runOption } = useAutoAssign(categories);
  const need = optionAmount("underfunded", scope);

  const run = (option: AutoAssignOption) => {
    const blocked = runOption(option);
    if (blocked) setError(blocked);
    else onDone();
  };

  return (
    <div className={styles.auto}>
      {autoGroups.map((group, index) => (
        <ul key={index} className={styles.group}>
          {group.map(([option, label]) => (
            <li key={option}>
              <button
                type="button"
                className={styles.option}
                disabled={plan(option).changes.length === 0}
                onClick={() => run(option)}
              >
                <span>{label}</span>
                <span className={styles.amount}>
                  {money(optionAmount(option, scope))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ))}
      {readyToAssign <= 0 ? (
        <p className={styles.hint}>
          Nothing is ready to assign, so only options that free up money can
          run.
        </p>
      ) : (
        need > readyToAssign && (
          <p className={styles.hint}>
            Only {money(readyToAssign)} is ready to assign. Underfunded covers
            overspending first, then targets by due date, until it runs out.
          </p>
        )
      )}
      {error && (
        <div className={styles.error}>
          <FieldError id={`${month.key}-auto-error`} message={error} />
        </div>
      )}
    </div>
  );
}
