"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  HandCoinsIcon,
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
  outstanding,
  type MatchCandidate,
  type Reimbursement,
  type Transaction,
} from "./data";
import { TransactionHistory } from "./history";
import { useBook } from "./state";
import styles from "./batch-5.module.css";

export type RegisterUi = {
  checked: string[];
  selectedId: string | null;
  editing: { id: string; history: boolean; expect: boolean } | null;
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

function claimsOn(id: string, reimbursements: Reimbursement[]) {
  return reimbursements.filter((claim) => claim.transactionId === id);
}

function candidateLabel(candidate: MatchCandidate) {
  return candidate.type === "transaction"
    ? candidate.transaction.payee
    : candidate.claim.from;
}

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
  const { transactions, reimbursements } = book;
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
      editing: { id, history: false, expect: false },
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
        variants.match === "suggest"
          ? candidatesFor(item, transactions, reimbursements)
          : [];
      if (candidates.length)
        return (
          <span className={styles.suggestion}>
            {candidates[0]!.type === "reimbursement" ? (
              <HandCoinsIcon size={13} aria-label="Money you expect back" />
            ) : (
              <Link2Icon size={13} aria-label="Already entered" />
            )}
            <span className={shell.truncate}>
              Could be {candidateLabel(candidates[0]!)}
              {candidates.length > 1 && (
                <span className={shell.faint}> +{candidates.length - 1}</span>
              )}
            </span>
          </span>
        );
      if (!item.category) return <Tag tone="attention">Needs category</Tag>;
    }
    const claims = claimsOn(item.id, reimbursements);
    const owed = claims.reduce((sum, claim) => sum + outstanding(claim), 0);
    return (
      <>
        <span className={shell.muted}>{item.category}</span>
        {claims.length > 0 && (
          <span className={shell.faint}>
            {owed > 0 ? ` · ${money(owed)} expected back` : " · paid back"}
          </span>
        )}
      </>
    );
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
  const { book, actions, variants } = useBook();
  const formId = useId();
  const [payee, setPayee] = useState(item.payee);
  const [category, setCategory] = useState(item.category);
  const [outflow, setOutflow] = useState(
    item.amount < 0 ? (-item.amount / 100).toFixed(2) : "",
  );
  const [inflow, setInflow] = useState(
    item.amount > 0 ? (item.amount / 100).toFixed(2) : "",
  );
  const claims = claimsOn(item.id, book.reimbursements);
  const expect = useExpectDraft(item, claims);
  const purchase = item.amount < 0 && item.source === "budget";
  const showExpect = variants.expect === "editor" && purchase;
  const historyCount = item.history.length;
  const save = () => {
    const amount = outflow ? -parseAmount(outflow) : parseAmount(inflow);
    let claim: { from: string; amount: number } | undefined;
    if (state.expect) {
      const result = expect.validate();
      if (!result) return;
      claim = result;
    }
    actions.save(item.id, { payee, category, amount }, claim);
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
      {showExpect && state.expect && (
        <section className={styles.editorSection} aria-label="Money back">
          <ExpectFields draft={expect} purchase={item} claims={claims} />
        </section>
      )}
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
          {showExpect && (
            <Button
              variant="quiet"
              size="sm"
              aria-expanded={state.expect}
              onClick={() => onState({ ...state, expect: !state.expect })}
            >
              <HandCoinsIcon aria-hidden />
              {claims.length ? "Money back" : "Expect money back"}
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

// ---------- Expect money back ----------

function useExpectDraft(purchase: Transaction, claims: Reimbursement[]) {
  const claimed = claims.reduce((sum, claim) => sum + claim.amount, 0);
  const room = -purchase.amount - claimed;
  const [from, setFrom] = useState("");
  const [amount, setAmount] = useState(room > 0 ? (room / 100).toFixed(2) : "");
  const [errors, setErrors] = useState<{ from?: string; amount?: string }>({});
  return {
    from,
    amount,
    errors,
    room,
    setFrom: (value: string) => {
      setFrom(value);
      setErrors((current) => ({ ...current, from: undefined }));
    },
    setAmount: (value: string) => {
      setAmount(value);
      setErrors((current) => ({ ...current, amount: undefined }));
    },
    validate() {
      const cents = parseAmount(amount);
      const next = {
        from: from.trim() ? undefined : "Enter who’s paying you back.",
        amount: !(cents > 0)
          ? "Enter an amount above zero."
          : cents > room
            ? `You can expect up to ${money(room)} back for this purchase.`
            : undefined,
      };
      setErrors(next);
      return next.from || next.amount
        ? null
        : { from: from.trim(), amount: cents };
    },
  };
}

function ExpectFields({
  draft,
  purchase,
  claims,
}: {
  draft: ReturnType<typeof useExpectDraft>;
  purchase: Transaction;
  claims: Reimbursement[];
}) {
  const id = useId();
  const { actions } = useBook();
  return (
    <div className={styles.expect}>
      {claims.length > 0 && (
        <ul className={styles.claimList}>
          {claims.map((claim) => (
            <li key={claim.id}>
              <span>
                {outstanding(claim) > 0
                  ? `${money(outstanding(claim))} expected from ${claim.from}`
                  : `${claim.from} paid back ${money(claim.amount)}`}
              </span>
              {claim.receipts.length === 0 && (
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => actions.stopExpecting(claim.id)}
                >
                  Stop expecting
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {draft.room > 0 ? (
        <div className={styles.expectFields}>
          <div className={styles.field}>
            <label htmlFor={`${id}-from`}>Who’s paying you back</label>
            <div
              className={entry.well}
              data-invalid={draft.errors.from ? "" : undefined}
            >
              <input
                id={`${id}-from`}
                className={entry.input}
                value={draft.from}
                placeholder="Cedar Labs, Sam, Amex Offer…"
                autoComplete="off"
                aria-invalid={Boolean(draft.errors.from) || undefined}
                aria-describedby={
                  draft.errors.from ? `${id}-from-error` : undefined
                }
                onChange={(event) => draft.setFrom(event.target.value)}
              />
            </div>
            {draft.errors.from && (
              <p id={`${id}-from-error`} className={entry.fieldError}>
                <CircleAlertIcon size={13} aria-hidden />
                {draft.errors.from}
              </p>
            )}
          </div>
          <div className={styles.field} data-amount>
            <label htmlFor={`${id}-amount`}>Amount</label>
            <div
              className={entry.well}
              data-amount
              data-invalid={draft.errors.amount ? "" : undefined}
            >
              <span className={entry.prefix} aria-hidden>
                $
              </span>
              <input
                id={`${id}-amount`}
                className={entry.input}
                inputMode="decimal"
                value={draft.amount}
                autoComplete="off"
                aria-invalid={Boolean(draft.errors.amount) || undefined}
                aria-describedby={
                  draft.errors.amount ? `${id}-amount-error` : `${id}-hint`
                }
                onChange={(event) => draft.setAmount(event.target.value)}
              />
            </div>
            {draft.errors.amount && (
              <p id={`${id}-amount-error`} className={entry.fieldError}>
                <CircleAlertIcon size={13} aria-hidden />
                {draft.errors.amount}
              </p>
            )}
          </div>
          <p id={`${id}-hint`} className={styles.hint}>
            It isn’t spendable until it arrives. When the deposit or card credit
            imports, it’s suggested as the match.
          </p>
        </div>
      ) : (
        <p className={styles.hint}>
          The whole {money(-purchase.amount)} is already expected back.
        </p>
      )}
    </div>
  );
}

function ExpectAction({ purchase }: { purchase: Transaction }) {
  const { book, actions } = useBook();
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  const claims = claimsOn(purchase.id, book.reimbursements);
  const draft = useExpectDraft(purchase, claims);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button size="sm">
          <HandCoinsIcon aria-hidden />
          Expect money back
        </Button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={`${review.categoryPopover} ${styles.expectPopover}`}
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <form
            className={review.categoryForm}
            aria-label="Expect money back"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const claim = draft.validate();
              if (!claim) return;
              actions.expect(purchase.id, claim.from, claim.amount);
              setOpen(false);
            }}
          >
            <ExpectFields draft={draft} purchase={purchase} claims={claims} />
            <div className={review.actions}>
              <Button size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              {draft.room > 0 && (
                <Button size="sm" variant="primary" type="submit">
                  Expect {draft.amount ? `$${draft.amount}` : "it"}
                </Button>
              )}
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
      ? candidatesFor(imports[0]!, book.transactions, book.reimbursements)
      : [];
  // Select both (YNAB): one import and the transaction it duplicates.
  let pair: { candidate?: MatchCandidate; hint?: string } | null = null;
  if (
    variants.match === "select" &&
    imports.length === 1 &&
    budget.length === 1
  ) {
    const item = imports[0]!;
    const other = budget[0]!;
    const open = claimsOn(other.id, book.reimbursements).find(
      (claim) => outstanding(claim) >= item.amount,
    );
    if (other.accountId !== item.accountId && !(item.amount > 0 && open))
      pair = { hint: "Pick two in the same account to match." };
    else if (other.matched)
      pair = { hint: `${other.payee} is already matched.` };
    else if (item.amount > 0 && other.amount < 0 && open)
      pair = {
        candidate: { type: "reimbursement", claim: open, purchase: other },
      };
    else if (Math.sign(item.amount) !== Math.sign(other.amount))
      pair = { hint: "An inflow can’t match an outflow." };
    else
      pair = {
        candidate: { type: "transaction", transaction: other },
        hint:
          other.amount !== item.amount
            ? `Keeps the bank’s ${money(Math.abs(item.amount))}.`
            : undefined,
      };
  }
  const single = selected.length === 1 ? selected[0]! : null;
  const unmatchable = single?.matched ? single : null;
  const expectable =
    variants.expect === "island" &&
    single?.source === "budget" &&
    single.amount < 0
      ? single
      : null;
  const match = (candidate: MatchCandidate) => {
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
              {pair.candidate.type === "reimbursement"
                ? "Match as money back"
                : "Match"}
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
          {expectable && <ExpectAction purchase={expectable} />}
        </div>
      </div>
    </div>
  );
}

function MatchChooser({
  candidates,
  onMatch,
}: {
  candidates: MatchCandidate[];
  onMatch: (candidate: MatchCandidate) => void;
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
              <li
                key={
                  candidate.type === "transaction"
                    ? candidate.transaction.id
                    : candidate.claim.id
                }
              >
                <button
                  type="button"
                  className={`${shell.actionItem} ${styles.choice}`}
                  onClick={() => onMatch(candidate)}
                >
                  {candidate.type === "reimbursement" ? (
                    <HandCoinsIcon size={13} aria-hidden />
                  ) : (
                    <Link2Icon size={13} aria-hidden />
                  )}
                  <span className={styles.choiceText}>
                    <span>
                      {candidate.type === "reimbursement"
                        ? candidate.claim.from
                        : candidate.transaction.payee}
                    </span>
                    <span className={shell.faint}>
                      {candidate.type === "reimbursement"
                        ? `For ${candidate.purchase.payee}, ${day(candidate.purchase.date)}`
                        : `Entered ${day(candidate.transaction.date)}`}
                    </span>
                  </span>
                  <span className={shell.numeric}>
                    {candidate.type === "reimbursement"
                      ? `${money(outstanding(candidate.claim))} expected`
                      : money(Math.abs(candidate.transaction.amount))}
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
