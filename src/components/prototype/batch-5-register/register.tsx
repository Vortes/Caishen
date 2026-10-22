"use client";

import {
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  HistoryIcon,
  Link2Icon,
  Unlink2Icon,
  XIcon,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { IconButton } from "~/components/ui/icon-button";
import { Tag } from "~/components/ui/tag";
import { usePortalContainer } from "~/components/ui/tooltip";
import {
  ChoiceField,
  type ChoiceOption,
} from "~/components/prototype/app-shell/transaction-fields";
import shell from "~/components/prototype/app-shell/shell.module.css";
import entry from "~/components/prototype/app-shell/transaction-entry.module.css";
import review from "~/components/prototype/app-shell/transaction-review.module.css";
import {
  accountName,
  candidatesFor,
  categoryNames,
  day,
  money,
  type Transaction,
} from "./data";
import { TransactionHistory } from "./history";
import { useBook } from "./state";
import styles from "./batch-5.module.css";

export type RegisterUi = {
  checked: string[];
  selectedId: string | null;
  editing: { id: string; history: boolean } | null;
};

export const emptyUi: RegisterUi = {
  checked: [],
  selectedId: null,
  editing: null,
};

const statusIcon = {
  pending: { icon: Clock3Icon, label: "Pending" },
  posted: { icon: CircleCheckIcon, label: "Cleared" },
};

export function RegisterView({
  accountId,
  reviewOnly,
  query,
  ui,
  setUi,
}: {
  accountId: string | null;
  reviewOnly: boolean;
  query: string;
  ui: RegisterUi;
  setUi: (update: (ui: RegisterUi) => RegisterUi) => void;
}) {
  const { book, variants } = useBook();
  const { transactions } = book;
  const listRef = useRef<HTMLDivElement>(null);
  const search = query.trim().toLowerCase();
  const rows = transactions
    .filter(
      (item) =>
        (!accountId || item.accountId === accountId) &&
        (!reviewOnly || item.needsReview) &&
        (!search ||
          [item.payee, item.category, item.bankPayee ?? ""].some((value) =>
            value.toLowerCase().includes(search),
          )),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const pending = rows.filter((item) => item.status === "pending");
  const cleared = rows.filter((item) => item.status !== "pending");
  const accountColumn = !accountId;
  const checked = rows.filter((item) => ui.checked.includes(item.id));

  const selectOnly = (id: string) =>
    setUi((value) => ({
      ...value,
      selectedId: id,
      checked: [id],
      editing: value.editing?.id === id ? value.editing : null,
    }));
  const toggle = (id: string) =>
    setUi((value) => ({
      ...value,
      checked: value.checked.includes(id)
        ? value.checked.filter((item) => item !== id)
        : [...value.checked, id],
    }));
  const edit = (id: string) =>
    setUi((value) => ({
      ...value,
      selectedId: id,
      checked: [id],
      editing: { id, history: false },
    }));

  useEffect(() => {
    if (!ui.selectedId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-transaction-row="${ui.selectedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [ui.selectedId]);

  const categoryCell = (item: Transaction) => {
    if (item.removedByBank) return <Tag tone="attention">Removed by bank</Tag>;
    if (item.source === "bank") {
      const candidates =
        variants.match === "suggest" ? candidatesFor(item, transactions) : [];
      if (candidates.length)
        return (
          <span className={styles.suggestion}>
            <Link2Icon size={13} aria-label="Already entered" />
            <span className={shell.truncate}>
              Could be {candidates[0]!.payee}
              {candidates.length > 1 && (
                <span className={shell.faint}> +{candidates.length - 1}</span>
              )}
            </span>
          </span>
        );
      if (!item.category) return <Tag tone="attention">Needs category</Tag>;
    }
    return <span className={shell.muted}>{item.category}</span>;
  };

  const row = (item: Transaction) => {
    if (ui.editing?.id === item.id)
      return (
        <EditorCard
          key={item.id}
          item={item}
          accountColumn={accountColumn}
          state={ui.editing}
          onState={(editing) => setUi((value) => ({ ...value, editing }))}
          onClose={() => setUi((value) => ({ ...value, editing: null }))}
        />
      );
    const isChecked = ui.checked.includes(item.id);
    const status = statusIcon[item.status];
    const editable = !item.removedByBank;
    const historyButton = variants.history === "popover" && (
      <div className={`${shell.txColumns} ${shell.rowActions}`}>
        <span className={`${shell.counterpartAction} ${styles.reveal}`}>
          <HistoryPopover item={item} />
        </span>
      </div>
    );
    return (
      <div
        key={item.id}
        className={`${shell.rowWrap} ${review.checkable} ${styles.rowHost}`}
        data-checked={isChecked || undefined}
      >
        <label className={shell.checkboxSlot}>
          <Checkbox
            aria-label={`Select ${item.payee}`}
            checked={isChecked}
            onCheckedChange={() => toggle(item.id)}
          />
        </label>
        <button
          type="button"
          data-row
          data-id={item.id}
          data-transaction-row={item.id}
          data-pending={item.status === "pending" || undefined}
          className={`${shell.txColumns} ${shell.row}`}
          aria-current={ui.selectedId === item.id ? "true" : undefined}
          onClick={() => {
            if (editable && isChecked && ui.checked.length === 1) edit(item.id);
            else selectOnly(item.id);
          }}
        >
          {accountColumn && (
            <span className={shell.rowName} data-column="account" data-optional>
              <ReviewDot on={item.needsReview} />
              <span className={`${shell.truncate} ${shell.faint}`}>
                {accountName(item.accountId)}
              </span>
            </span>
          )}
          <span className={shell.rowName} data-column="date" data-optional>
            {!accountColumn && <ReviewDot on={item.needsReview} />}
            <span className={`${shell.truncate} ${shell.muted}`}>
              {day(item.date)}
            </span>
          </span>
          <span
            className={shell.rowName}
            data-column="payee"
            data-jump={variants.history === "popover" || undefined}
          >
            <span className={shell.truncate}>
              {item.source === "bank" ? (
                <span className={styles.bankName}>{item.bankPayee}</span>
              ) : (
                item.payee
              )}
            </span>
            {item.matched && (
              <Link2Icon
                size={12}
                className={shell.inlineIcon}
                aria-label="Matched with a bank import"
              />
            )}
          </span>
          <span className={shell.truncate} data-column="category">
            {categoryCell(item)}
          </span>
          <span
            className={shell.numeric}
            data-column="outflow"
            data-empty={item.amount < 0 ? undefined : true}
          >
            {item.amount < 0 && money(-item.amount)}
          </span>
          <span
            className={shell.numeric}
            data-column="inflow"
            data-empty={item.amount > 0 ? undefined : true}
            data-inflow={item.amount > 0 || undefined}
          >
            {item.amount > 0 && money(item.amount)}
          </span>
          <span className={shell.statusCell} data-column="status">
            <status.icon
              size={14}
              className={shell.statusIcon}
              data-status={item.status}
              aria-label={status.label}
            />
          </span>
        </button>
        {historyButton}
      </div>
    );
  };

  if (!rows.length)
    return (
      <div className={shell.empty} data-tone={reviewOnly ? "done" : undefined}>
        <CircleCheckIcon size={18} aria-hidden />
        <div className={shell.emptyBody}>
          <strong>
            {reviewOnly ? "Everything here is reviewed." : "No transactions."}
          </strong>
          <p>New bank imports will show up as they arrive.</p>
        </div>
      </div>
    );

  return (
    <div
      ref={listRef}
      className={`${shell.list} ${shell.register} ${review.register}`}
      data-accounts={accountColumn || undefined}
      role="group"
      aria-label="Transactions"
      data-selecting={checked.length > 0 || undefined}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        const id =
          document.activeElement instanceof HTMLElement
            ? document.activeElement.dataset.id
            : undefined;
        if (event.key === "x" && id) {
          event.preventDefault();
          toggle(id);
        } else if (event.key === "e" && ui.selectedId && !ui.editing) {
          event.preventDefault();
          edit(ui.selectedId);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "[data-row]",
            ),
          ];
          const index = buttons.findIndex(
            (button) => button === document.activeElement,
          );
          const next =
            buttons[
              Math.min(
                buttons.length - 1,
                Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)),
              )
            ];
          if (!next) return;
          event.preventDefault();
          next.focus();
          selectOnly(next.dataset.id!);
        }
      }}
    >
      <div className={`${shell.txColumns} ${shell.columnHeader}`}>
        <label className={shell.checkboxSlot}>
          <Checkbox
            aria-label="Select all"
            checked={
              checked.length === 0
                ? false
                : checked.length === rows.length
                  ? true
                  : "indeterminate"
            }
            onCheckedChange={(value) =>
              setUi((ui) => ({
                ...ui,
                checked: value === true ? rows.map((item) => item.id) : [],
              }))
            }
          />
        </label>
        {accountColumn && (
          <span data-column="account" data-optional aria-hidden>
            Account
          </span>
        )}
        <span data-column="date" data-optional aria-hidden>
          Date
        </span>
        <span data-column="payee" aria-hidden>
          Payee
        </span>
        <span data-column="category" aria-hidden>
          Category
        </span>
        <span
          className={shell.numeric}
          data-column="outflow"
          data-wide
          aria-hidden
        >
          Outflow
        </span>
        <span
          className={shell.numeric}
          data-column="inflow"
          data-wide
          aria-hidden
        >
          Inflow
        </span>
        <span className={shell.numeric} data-narrow aria-hidden>
          Amount
        </span>
        <span data-column="status" />
      </div>
      {pending.length > 0 && (
        <div
          role="group"
          aria-label="Pending transactions"
          className={shell.pendingGroup}
        >
          <div
            className={`${shell.dayRow} ${shell.groupRow} ${shell.pendingHeader}`}
          >
            <span>Pending</span>
            <span className={shell.groupCount}>{pending.length}</span>
          </div>
          {pending.map(row)}
        </div>
      )}
      {cleared.map(row)}
      <SelectionBar
        selected={checked}
        onClear={() => setUi((value) => ({ ...value, checked: [] }))}
        onDone={() => setUi(() => emptyUi)}
      />
    </div>
  );
}

function ReviewDot({ on }: { on: boolean }) {
  return (
    <span className={shell.reviewDot} data-on={on ? "" : undefined}>
      {on && <span className="sr-only">Needs review</span>}
    </span>
  );
}

// ---------- History popover (variant: popover) ----------

function HistoryPopover({ item }: { item: Transaction }) {
  const { actions } = useBook();
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton label="History" size="sm" pressed={open}>
          <HistoryIcon aria-hidden />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={styles.historyPopover}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label={`History of ${item.payee}`}
        >
          <p className={styles.popoverTitle}>
            {item.source === "bank" ? item.bankPayee : item.payee}
            <span>{money(item.amount)}</span>
          </p>
          <TransactionHistory
            transaction={item}
            onUnmatch={
              item.matched
                ? () => {
                    setOpen(false);
                    actions.unmatch(item.id);
                  }
                : undefined
            }
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------- The lifted editor card ----------

function parseAmount(text: string) {
  const value = Math.round(Number(text.replace(/[$,\s]/g, "")) * 100);
  return Number.isFinite(value) ? value : NaN;
}

const categoryOptions: ChoiceOption[] = categoryNames.map((name) => ({
  value: name,
  label: name,
}));

function EditorCard({
  item,
  accountColumn,
  state,
  onState,
  onClose,
}: {
  item: Transaction;
  accountColumn: boolean;
  state: NonNullable<RegisterUi["editing"]>;
  onState: (state: NonNullable<RegisterUi["editing"]>) => void;
  onClose: () => void;
}) {
  const { actions, variants } = useBook();
  const formId = useId();
  const [payee, setPayee] = useState(item.payee);
  const [category, setCategory] = useState(item.category);
  const [outflow, setOutflow] = useState(
    item.amount < 0 ? (-item.amount / 100).toFixed(2) : "",
  );
  const [inflow, setInflow] = useState(
    item.amount > 0 ? (item.amount / 100).toFixed(2) : "",
  );
  const historyCount = item.history.length;
  const save = () => {
    const amount = outflow ? -parseAmount(outflow) : parseAmount(inflow);
    actions.save(item.id, { payee, category, amount });
    onClose();
  };
  const cell = (column: string, label: string, control: ReactNode) => (
    <div className={entry.cell} data-column={column}>
      <label htmlFor={`${formId}-${column}`} className={entry.cellLabel}>
        {label}
      </label>
      {control}
    </div>
  );
  const text = (
    column: string,
    value: string,
    onChange: (value: string) => void,
    amount = false,
  ) => (
    <div className={entry.well} data-amount={amount || undefined}>
      {amount && (
        <span className={entry.prefix} aria-hidden>
          $
        </span>
      )}
      <input
        id={`${formId}-${column}`}
        className={entry.input}
        value={value}
        inputMode={amount ? "decimal" : undefined}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
  return (
    <form
      className={entry.form}
      data-transaction-row={item.id}
      aria-label="Edit transaction"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp")
          event.stopPropagation();
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className={`${shell.txColumns} ${entry.entryRow}`}
        data-accounts={accountColumn || undefined}
      >
        {accountColumn &&
          cell(
            "account",
            "Account",
            <div className={entry.well} data-disabled>
              <input
                id={`${formId}-account`}
                className={entry.input}
                value={accountName(item.accountId)}
                disabled
              />
            </div>,
          )}
        {cell(
          "date",
          "Date",
          <div className={entry.well} data-disabled>
            <input
              id={`${formId}-date`}
              className={entry.input}
              value={day(item.date)}
              disabled
            />
          </div>,
        )}
        {cell("payee", "Payee", text("payee", payee, setPayee))}
        {cell(
          "category",
          "Category",
          <ChoiceField
            id={`${formId}-category`}
            label="Category"
            value={category}
            options={
              item.amount > 0
                ? [
                    { value: "Ready to Assign", label: "Ready to Assign" },
                    ...categoryOptions,
                  ]
                : categoryOptions
            }
            placeholder="Category"
            onChange={setCategory}
          />,
        )}
        {cell("outflow", "Outflow", text("outflow", outflow, setOutflow, true))}
        {cell("inflow", "Inflow", text("inflow", inflow, setInflow, true))}
        <span data-column="status" aria-hidden />
      </div>
      {variants.history === "editor" && state.history && (
        <section className={styles.editorSection} aria-label="History">
          <TransactionHistory
            transaction={item}
            onUnmatch={
              item.matched
                ? () => {
                    onClose();
                    actions.unmatch(item.id);
                  }
                : undefined
            }
          />
        </section>
      )}
      <div className={entry.rowFooter}>
        <div className={styles.footerTools}>
          {variants.history === "editor" && (
            <Button
              variant="quiet"
              size="sm"
              aria-expanded={state.history}
              onClick={() => onState({ ...state, history: !state.history })}
            >
              <HistoryIcon aria-hidden />
              History
              <span className={styles.count}>{historyCount}</span>
            </Button>
          )}
        </div>
        <div className={entry.actions}>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit">
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------- The selection bar ----------

function SelectionBar({
  selected,
  onClear,
  onDone,
}: {
  selected: Transaction[];
  onClear: () => void;
  onDone: () => void;
}) {
  const { book, actions, variants } = useBook();
  if (!selected.length) return null;
  const imports = selected.filter((item) => item.source === "bank");
  const budget = selected.filter((item) => item.source === "budget");
  const approvable = budget.filter((item) => item.needsReview);
  const removed = imports.filter((item) => item.removedByBank);

  // Suggest: one import, matched to what it could be.
  const suggested =
    variants.match === "suggest" && imports.length === 1 && !budget.length
      ? candidatesFor(imports[0]!, book.transactions)
      : [];
  // Select both (YNAB): one import and the transaction it duplicates.
  let pair: { candidate?: Transaction; hint?: string } | null = null;
  if (
    variants.match === "select" &&
    imports.length === 1 &&
    budget.length === 1
  ) {
    const item = imports[0]!;
    const other = budget[0]!;
    if (other.accountId !== item.accountId)
      pair = { hint: "Pick two in the same account to match." };
    else if (other.matched)
      pair = { hint: `${other.payee} is already matched.` };
    else if (Math.sign(item.amount) !== Math.sign(other.amount))
      pair = { hint: "An inflow can’t match an outflow." };
    else
      pair = {
        candidate: other,
        hint:
          other.amount !== item.amount
            ? `Keeps the bank’s ${money(Math.abs(item.amount))}.`
            : undefined,
      };
  }
  const single = selected.length === 1 ? selected[0]! : null;
  const unmatchable = single?.matched ? single : null;
  const match = (candidate: Transaction) => {
    actions.match(imports[0]!.id, candidate);
    onDone();
  };

  return (
    <div className={review.islandSlot}>
      <div
        className={review.island}
        role="toolbar"
        aria-label="Selected transactions"
      >
        <IconButton
          size="sm"
          label="Clear selection"
          shortcut="Esc"
          onClick={onClear}
        >
          <XIcon aria-hidden />
        </IconButton>
        <span className={review.summary} aria-live="polite">
          <span className={review.count}>
            {selected.length}{" "}
            {selected.length === 1 ? "transaction" : "transactions"}
          </span>
          {pair?.hint && <span className={styles.islandHint}>{pair.hint}</span>}
        </span>
        <span className={review.divider} aria-hidden />
        <div className={review.actions}>
          {suggested.length === 1 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => match(suggested[0]!)}
            >
              <Link2Icon aria-hidden />
              Match
            </Button>
          )}
          {suggested.length > 1 && (
            <MatchChooser candidates={suggested} onMatch={match} />
          )}
          {pair?.candidate && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => match(pair.candidate!)}
            >
              <Link2Icon aria-hidden />
              Match
            </Button>
          )}
          {approvable.length > 0 && imports.length === 0 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                actions.approve(approvable.map((item) => item.id));
                onDone();
              }}
            >
              <CircleCheckIcon aria-hidden />
              Approve ({approvable.length})
            </Button>
          )}
          {imports.length > 0 && budget.length === 0 && (
            <Button
              size="sm"
              onClick={() => {
                actions.reject(imports.map((item) => item.id));
                onDone();
              }}
            >
              <CircleXIcon aria-hidden />
              {removed.length === imports.length ? "Dismiss" : "Reject"}
            </Button>
          )}
          {unmatchable && (
            <Button
              size="sm"
              onClick={() => {
                actions.unmatch(unmatchable.id);
                onDone();
              }}
            >
              <Unlink2Icon aria-hidden />
              Unmatch
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchChooser({
  candidates,
  onMatch,
}: {
  candidates: Transaction[];
  onMatch: (candidate: Transaction) => void;
}) {
  const container = usePortalContainer();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="primary" size="sm">
          <Link2Icon aria-hidden />
          Match…
        </Button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={review.categoryPopover}
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <p className={styles.popoverTitle}>Match with</p>
          <ul className={shell.actionList}>
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  className={`${shell.actionItem} ${styles.choice}`}
                  onClick={() => onMatch(candidate)}
                >
                  <Link2Icon size={13} aria-hidden />
                  <span className={styles.choiceText}>
                    <span>{candidate.payee}</span>
                    <span className={shell.faint}>
                      Entered {day(candidate.date)}
                    </span>
                  </span>
                  <span className={shell.numeric}>
                    {money(Math.abs(candidate.amount))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
