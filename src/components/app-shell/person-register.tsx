"use client";

import {
  CheckIcon,
  CopyIcon,
  LinkIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { newId, today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { readAmount, sameAmount } from "~/components/budget/amount";
import { AmountInput } from "~/components/ui/amount-input";
import { Button } from "~/components/ui/button";
import { Field, FormError } from "~/components/ui/field";
import { Tag } from "~/components/ui/tag";
import { useRowSelection } from "~/components/ui/use-row-selection";
import selectionStyles from "~/components/ui/row-selection.module.css";
import { Popover } from "~/components/ui/popover";
import { SearchList, type SearchListOption } from "~/components/ui/search-list";
import { counterpartyRegisterEntries } from "~/domain/counterparty";
import { money, shortDay, type Account } from "./model";
import { RecordPurchase } from "./partner-record";
import { isLinked, owedSentence } from "./people";
import { RecordRepayment } from "./record-repayment";
import moveStyles from "./move-money.module.css";
import { useShellData } from "./shell-data";
import { useTransactionEntry } from "./transaction-entry";
import { EditorCell, EditorFooter, EditorForm, EditorText } from "./editor-row";
import {
  CategorizeAction,
  SelectAll,
  SelectionBar,
  type Way,
} from "./transaction-review";
import { Empty, moveSelection, RowCheckbox } from "./views";
import styles from "./shell.module.css";
import share from "./share.module.css";
import local from "./person-register.module.css";
import editorStyles from "./transaction-entry.module.css";
import reviewStyles from "./transaction-review.module.css";

type Row = View["partnerLedger"][number];

// A person's account: what's owed either way, live, and the envelope beside
// it that holds money against it. The partner, also on Caishen, settles up
// through both budgets' bank imports; anyone else pays you back by hand or
// in an import of yours. A former partner's reads as it stood when it
// closed.
export function PersonSummary({ account }: { account: Account }) {
  const { categories } = useShellData();
  const { view } = useTransactionEntry();
  const envelope = categories.find(
    (category) => category.pairs?.accountId === account.id,
  );
  const linked = isLinked(account);
  const request = linked ? view.partnerRequest : undefined;
  const asker =
    request?.requesterId === view.budget.userId ? "You" : account.name;
  const balance = account.balance;
  return (
    <>
      <div className={styles.accountSummary}>
        <dl className={styles.balances}>
          <div data-total>
            <dt>
              {!account.closed
                ? owedSentence(account.name, balance)
                : balance > 0
                  ? `${account.name} owed you`
                  : balance < 0
                    ? `You owed ${account.name}`
                    : `You and ${account.name} were even`}
            </dt>
            <dd className={local.owed}>{money(Math.abs(balance))}</dd>
          </div>
          {request && (
            <div>
              <dt>
                {asker} asked for {money(request.amount)} on{" "}
                {shortDay(request.date)}
              </dt>
              <dd>
                {request.left > 0
                  ? `${money(request.left)} left`
                  : "Paid in full"}
              </dd>
            </div>
          )}
          {envelope && !account.closed && (
            <div>
              <dt>
                {envelope.name} envelope
                {envelope.assigned > 0 &&
                  ` · ${money(envelope.assigned)} float`}
              </dt>
              <dd className={local.envelope} data-state={envelope.funding}>
                {money(envelope.available)}
              </dd>
            </div>
          )}
        </dl>
        <div className={styles.summaryActions}>
          {account.closed ? (
            <span className={styles.reconciledLabel}>
              Closed {shortDay(account.closed.at.slice(0, 10))} · frozen as it
              stood
            </span>
          ) : linked ? (
            <>
              <span className={styles.reconciledLabel}>
                On Caishen · shared with {account.name}
              </span>
              <RecordPurchase account={account} />
              {balance > 0 ? (
                <RequestPopover account={account} />
              ) : balance < 0 ? (
                <PayPopover account={account} />
              ) : null}
            </>
          ) : (
            <>
              <span className={styles.reconciledLabel}>
                Only you see {account.name}.
              </span>
              <RecordRepayment account={account} />
            </>
          )}
        </div>
      </div>
      {request && request.left > 0 && (
        <RequestProgress
          request={request}
          asker={asker === "You" ? "you" : asker}
          today={today(view.budget.settings.timezone)}
        />
      )}
    </>
  );
}

// A request is a record, not a reminder: how much, when, and what's been
// paid toward it since.
function RequestProgress({
  request,
  asker,
  today,
}: {
  request: NonNullable<View["partnerRequest"]>;
  asker: string;
  today: string;
}) {
  const ratio = Math.min(1, request.paid / request.amount);
  const days = Math.round(
    (Date.parse(`${today}T12:00:00Z`) -
      Date.parse(`${request.date}T12:00:00Z`)) /
      86_400_000,
  );
  return (
    <div className={local.requestStrip}>
      <span className={local.requestTrack} aria-hidden>
        <span style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <span>
        {money(request.paid)} of {money(request.amount)} paid since {asker}{" "}
        asked{" "}
        {days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}
      </span>
    </div>
  );
}

// Asking the partner to pay: an amount, dated today. Settlements from them
// count toward it until it's paid.
function RequestPopover({ account }: { account: Account }) {
  const { view, saveCommand } = useTransactionEntry();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  return (
    <Popover
      label={`Request money from ${account.name}`}
      trigger={
        <Button size="sm" variant="primary">
          Request money
        </Button>
      }
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setText((account.balance / 100).toFixed(2));
        setError("");
      }}
      align="end"
      size="form"
      arrow
    >
      <form
        className={moveStyles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const reading = readAmount(text);
          if (!reading.ok) return setError(reading.message);
          const cents = reading.cents;
          if (cents <= 0) return setError("Enter an amount, like 250.00.");
          const failure = saveCommand(
            {
              type: "partner.request",
              id: newId(),
              requestId: newId(),
              date: today(view.budget.settings.timezone),
              amount: cents,
            },
            `Asked ${account.name} for ${money(cents)}. It’s on both ledgers.`,
          );
          if (failure) return setError(failure);
          setOpen(false);
        }}
      >
        <div className={moveStyles.header}>
          <strong>Request from {account.name}</strong>
        </div>
        <div className={moveStyles.fieldSlot}>
          <Field
            label="Amount"
            error={error || undefined}
            hint={`${account.name} sees it on the ledger with today’s date. Settlements count toward it until it’s paid. No deadline, no reminders.`}
          >
            <AmountInput
              value={text}
              onChange={(value) => {
                if (!sameAmount(text, value)) setError("");
                setText(value);
              }}
            />
          </Field>
        </div>
        <div className={moveStyles.footer}>
          <Button size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Request
          </Button>
        </div>
      </form>
    </Popover>
  );
}

// Paying the partner happens in your bank. This says how it'll be
// recognized, and copies the amount to send.
function PayPopover({ account }: { account: Account }) {
  const { view } = useTransactionEntry();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const amount = -account.balance;
  const request = view.partnerRequest;
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Popover
      label={`Pay ${account.name}`}
      trigger={
        <Button size="sm" variant="primary">
          Pay {account.name}
        </Button>
      }
      open={open}
      onOpenChange={setOpen}
      align="end"
      size="form"
      arrow
    >
      <div className={moveStyles.form}>
        <div className={moveStyles.header}>
          <strong>Pay {account.name}</strong>
          <span className={moveStyles.balance}>{money(amount)}</span>
        </div>
        <div className={local.popoverBody}>
          <p>
            Send it from your bank, by Zelle or a transfer, in any amount. When
            it imports to both budgets, it&rsquo;s matched by amount, date, and
            direction, and the balance updates for you both.
          </p>
          {request &&
            request.requesterId !== view.budget.userId &&
            request.left > 0 && (
              <p className={styles.faint}>
                {account.name} asked for {money(request.amount)} on{" "}
                {shortDay(request.date)}. {money(request.left)} is left.
              </p>
            )}
          <p className={styles.faint}>
            The {money(amount)} is already held in your {account.name} envelope,
            so paying won&rsquo;t touch any other category.
          </p>
        </div>
        <div className={moveStyles.footer}>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText((amount / 100).toFixed(2));
              setCopied(true);
            }}
          >
            {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            {copied ? "Copied" : "Copy amount"}
          </Button>
          <Button size="sm" variant="primary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </div>
    </Popover>
  );
}

// Whether you can give an entry your own category: your side of what your
// partner paid, or of what you paid before its import arrives. A matched
// import of yours carries its own category.
function categorizable(row: Row, you: string, closed: boolean) {
  return (
    !closed &&
    Boolean(row.entryId) &&
    (row.payerId !== you || Boolean(row.awaitingImport))
  );
}

type EditorField = "category" | "amount";

// An unlinked person's entries as ledger rows, newest first, so every
// person reads through one register: your shares of what you paid for
// them, refunds of those, and what they paid you back.
function personLedger(view: View, account: Account): Row[] {
  let balance = 0;
  return counterpartyRegisterEntries(view.budget, { accountId: account.id })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry): Row => {
      const transaction = view.budget.transactions.find(
        (item) => item.id === entry.transactionId,
      );
      const line =
        transaction?.lines?.find((item) => item.id === entry.lineId) ??
        transaction;
      const repayment = entry.kind === "repayment";
      const theirs = Math.abs(entry.amount);
      const shared = repayment ? theirs : Math.abs(line?.amount ?? theirs);
      balance += entry.amount;
      return {
        id: entry.id,
        kind: repayment
          ? "repayment"
          : entry.kind === "refund"
            ? "refund"
            : "purchase",
        date: entry.date,
        payee: entry.payee,
        status: transaction?.status ?? "posted",
        // They paid you back; you paid for everything else.
        payerId: repayment ? account.id : view.budget.userId,
        shared,
        you: repayment ? 0 : shared - theirs,
        partner: theirs,
        change: entry.amount,
        balance,
        categoryId: repayment ? undefined : line?.categoryId,
        needsCategory: false,
        transactionId: entry.transactionId,
        lineId: repayment ? undefined : entry.lineId,
        awaitingImport: false,
        // A repayment from a bank import waits for your review.
        confirmed:
          repayment && transaction?.reviewed === false ? false : undefined,
        shareMode: { mode: "edit" },
        history: [],
      };
    })
    .reverse();
}

// A person's ledger, as a register: clicking an entry selects it, and
// clicking it again opens it at the field clicked. The
// partner's entries you can categorize can be checked and categorized
// together.
export function PersonRegister({
  account,
  query,
  selectedId,
  onSelect,
  checked,
  onCheck,
  onJump,
}: {
  account: Account;
  query: string;
  // Opens a transaction in its own account's register.
  onJump: (transaction: {
    id: string;
    accountId: string;
    date: string;
  }) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  checked: string[];
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const entry = useTransactionEntry();
  const { view } = entry;
  const you = view.budget.userId;
  const register = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{
    id: string;
    field: EditorField;
  } | null>(null);
  const selectionStyle = useRowSelection(checked);
  // Shift-click checks, or clears, every entry from the last one clicked to
  // this one, like the other registers.
  const anchor = useRef<string | null>(null);
  // A former partner's ledger reads as it stood when it closed.
  const closed = Boolean(account.closed);
  const linked = isLinked(account);
  const ledger = closed
    ? (view.formerPartnerLedgers[account.id] ?? [])
    : linked
      ? view.partnerLedger
      : personLedger(view, account);
  const name = (id: string | undefined) =>
    view.categories.find((item) => item.id === id)?.name;
  const search = query.trim().toLowerCase();
  const payee = (row: Row) => settlementPayee(row, view, account.name);
  const rows = ledger.filter(
    (row) =>
      !search ||
      [payee(row), name(row.categoryId), money(row.shared), money(row.change)]
        .join(" ")
        .toLowerCase()
        .includes(search),
  );
  const selectable = rows.filter((row) => categorizable(row, you, closed));
  const selected = selectable.filter((row) => checked.includes(row.id));
  const order = selectable.map((row) => row.id);
  const checkTo = (id: string, value: boolean) => {
    const from = order.indexOf(anchor.current ?? selectedId ?? "");
    const to = order.indexOf(id);
    onCheck(
      from < 0 ? [id] : order.slice(Math.min(from, to), Math.max(from, to) + 1),
      value,
    );
    anchor.current = id;
  };
  const closeEditor = (id: string) => {
    setEditing(null);
    requestAnimationFrame(() =>
      register.current
        ?.querySelector<HTMLButtonElement>(
          `[data-entry-row="${CSS.escape(id)}"]`,
        )
        ?.focus(),
    );
  };
  // The one selected entry you paid traces back to its transaction, in its
  // own account's register.
  const wayToTransaction = (): Way | null => {
    if (checked.length > 1 || (checked[0] && checked[0] !== selectedId))
      return null;
    const row = rows.find((item) => item.id === selectedId);
    const transaction = view.budget.transactions.find(
      (item) => item.id === row?.transactionId && !item.removed,
    );
    const name = view.accounts.find(
      (item) => item.id === transaction?.accountId,
    )?.name;
    if (!transaction || !name) return null;
    return {
      name,
      label: `Open in ${name}`,
      forward: true,
      onGo: () => onJump(transaction),
    };
  };
  if (!ledger.length)
    return closed ? (
      <Empty title="Nothing was shared." icon={UsersIcon}>
        You and {account.name} didn’t share a cost before they parted.
      </Empty>
    ) : (
      <Empty title="Nothing owed yet." icon={UsersIcon}>
        {linked
          ? `When you and ${account.name} share a cost, what one of you owes the other shows here, in both budgets.`
          : `When you pay for ${account.name}, give the expense a share and what they owe you shows here. Only you see it.`}
      </Empty>
    );
  if (!rows.length)
    return (
      <Empty title={`No entries match “${query.trim()}”.`} icon={SearchIcon}>
        Search looks at payees, categories, and amounts.
      </Empty>
    );
  return (
    <div
      ref={register}
      className={`${styles.list} ${styles.register} ${local.register} ${reviewStyles.register} ${selectionStyles.list}`}
      {...selectionStyle.listProps}
      role="group"
      aria-label={`${account.name} ledger`}
      data-selecting={selected.length > 0 || undefined}
      onKeyDown={(event) => {
        // x toggles the focused entry's checkbox, like the other registers.
        const id =
          document.activeElement instanceof HTMLElement
            ? document.activeElement.dataset.id
            : undefined;
        if (event.key === "x" && id) {
          event.preventDefault();
          anchor.current = id;
          onCheck([id], !checked.includes(id));
          return;
        }
        // e opens the selected entry at its amount.
        const row = rows.find((item) => item.id === selectedId);
        if (
          event.key === "e" &&
          !editing &&
          row &&
          document.activeElement instanceof HTMLElement &&
          document.activeElement.dataset.entryRow === row.id &&
          (row.entryId || row.settlementId)
        ) {
          event.preventDefault();
          setEditing({ id: row.id, field: "amount" });
          return;
        }
        moveSelection(event);
      }}
    >
      <div className={`${styles.txColumns} ${styles.columnHeader}`}>
        <SelectAll selection={{ selectable, selected }} onCheck={onCheck} />
        <span data-optional aria-hidden>
          Date
        </span>
        <span aria-hidden>Payee</span>
        <span data-optional aria-hidden>
          Paid by
        </span>
        <span aria-hidden>Your category</span>
        <span className={styles.numeric} data-optional aria-hidden>
          Amount
        </span>
        <span className={styles.numeric} aria-hidden>
          Owed
        </span>
        <span className={styles.numeric} aria-hidden>
          Balance
        </span>
        <span aria-hidden />
      </div>
      {rows.map((row) => {
        const isSelected = selectedId === row.id;
        const checkable = categorizable(row, you, closed);
        const isChecked = checkable && checked.includes(row.id);
        const settlement = Boolean(row.settlementId);
        const unconfirmed = row.confirmed === false;
        const opens = Boolean(row.entryId ?? row.lineId ?? row.settlementId);
        const paidBy = row.payerId === you ? "You" : account.name;
        const cells: RowCells = {
          date: (
            <>
              <span
                className={styles.reviewDot}
                data-on={row.needsCategory || unconfirmed ? "" : undefined}
              >
                {(row.needsCategory || unconfirmed) && (
                  <span className="sr-only">
                    {unconfirmed ? "Needs confirming" : "Needs a category"}
                  </span>
                )}
              </span>
              <span className={`${styles.truncate} ${styles.muted}`}>
                {shortDay(row.date)}
              </span>
            </>
          ),
          payee: (
            <>
              <span className={`${styles.truncate} ${local.payeeName}`}>
                {payee(row)}
              </span>
              {row.awaitingImport && (
                <LinkIcon
                  size={12}
                  className={styles.inlineIcon}
                  role="img"
                  aria-label="Waiting for a bank import to match"
                />
              )}
            </>
          ),
          category: row.needsCategory ? (
            <Tag tone="attention">Needs category</Tag>
          ) : settlement ? (
            unconfirmed ? (
              <Tag tone="attention">Confirm</Tag>
            ) : (
              <span className={styles.faint}>Settlement</span>
            )
          ) : row.awaitingImport && row.payerId === view.budget.userId ? (
            <span className={styles.faint}>Waiting for your import</span>
          ) : row.kind === "repayment" ? (
            unconfirmed ? (
              <Tag tone="attention">Review</Tag>
            ) : (
              <span className={styles.faint}>Repayment</span>
            )
          ) : row.you === 0 ? (
            <span className={styles.faint}>Not yours</span>
          ) : (
            <span className={styles.muted}>
              {name(row.categoryId) ?? "No category"}
            </span>
          ),
          // Truncates in the editor's cell as it does in the row.
          paidBy: (
            <span className={`${styles.truncate} ${styles.muted}`}>
              {paidBy}
            </span>
          ),
          // What it cost, whoever paid; settlements and repayments moved
          // only what they settled.
          amount: (
            <span className={styles.muted}>
              {money(
                row.kind === "purchase" || row.kind === "refund"
                  ? row.shared
                  : Math.abs(row.change),
              )}
            </span>
          ),
          // Each cell carries its own tone, so it reads the same in the row
          // and in the editor.
          balance: <span className={styles.muted}>{money(row.balance)}</span>,
        };
        const edits = opens;
        if (settlement && editing?.id === row.id)
          return (
            <SettlementEditor
              key={row.id}
              row={row}
              cells={cells}
              partnerName={account.name}
              onClose={() => closeEditor(row.id)}
            />
          );
        if (edits && editing?.id === row.id)
          return (
            <EntryEditor
              key={row.id}
              row={row}
              cells={cells}
              partnerName={account.name}
              linked={linked}
              categoryEditable={checkable}
              focus={editing.field}
              onClose={() => closeEditor(row.id)}
            />
          );
        return (
          <div
            key={row.id}
            className={`${styles.rowWrap} ${reviewStyles.checkable} ${selectionStyles.row}`}
            {...selectionStyle.rowProps(row.id)}
            onMouseDown={(event) => {
              // Shift would otherwise extend a text selection across rows.
              if (checkable && event.shiftKey) event.preventDefault();
              // A double-click would select a word, and the click handler
              // would take it for a text selection and not open the entry.
              if (event.detail > 1) event.preventDefault();
            }}
          >
            {checkable && (
              <RowCheckbox
                label={`Select ${row.payee}`}
                state={isChecked}
                onChange={() => {
                  anchor.current = row.id;
                  onCheck([row.id], !isChecked);
                }}
                onShiftClick={() => checkTo(row.id, !isChecked)}
              />
            )}
            <button
              type="button"
              data-row
              data-id={checkable ? row.id : undefined}
              data-entry-row={row.id}
              className={`${styles.txColumns} ${styles.row}`}
              aria-current={isSelected ? "true" : undefined}
              onClick={(event) => {
                if (checkable && event.shiftKey) {
                  checkTo(row.id, !isChecked);
                  return;
                }
                // Finishing a text selection in the row doesn't click it.
                if (event.detail > 0 && window.getSelection()?.toString())
                  return;
                anchor.current = row.id;
                // A second pointer click on the one selected entry opens it
                // at the field clicked: the category when you can change it,
                // otherwise the amount. Enter and Space click with no
                // position, and only select.
                // Like a transaction's editor, an open entry stays open, with
                // what's typed, until it's saved or canceled.
                if (
                  edits &&
                  !editing &&
                  isSelected &&
                  checked.length === 1 &&
                  checked[0] === row.id &&
                  event.detail > 0
                ) {
                  const column =
                    event.target instanceof Element
                      ? event.target.closest<HTMLElement>("[data-column]")
                          ?.dataset.column
                      : undefined;
                  setEditing({
                    id: row.id,
                    field:
                      column === "category" && checkable
                        ? "category"
                        : "amount",
                  });
                  return;
                }
                onSelect(row.id);
              }}
            >
              <span className={styles.rowName} data-column="date" data-optional>
                {cells.date}
              </span>
              <span className={styles.rowName} data-column="payee">
                {cells.payee}
              </span>
              <span
                className={styles.truncate}
                data-column="paidBy"
                data-optional
              >
                {cells.paidBy}
              </span>
              <span className={styles.truncate} data-column="category">
                {cells.category}
              </span>
              <span
                className={styles.numeric}
                data-column="total"
                data-optional
              >
                {cells.amount}
              </span>
              <span
                className={styles.numeric}
                data-column="amount"
                aria-label={owedLabel(row.change)}
              >
                {money(row.change, true)}
              </span>
              <span className={styles.numeric} data-column="balance">
                {cells.balance}
              </span>
              <span />
            </button>
          </div>
        );
      })}
      <PartnerSelection
        selected={selected}
        onCheck={onCheck}
        disabled={Boolean(entry.session) || editing !== null}
        way={wayToTransaction()}
      />
    </div>
  );
}

// The island over the ledger while entries are selected: the way to the
// selected entry's transaction, and the one thing checked entries share,
// your category.
function PartnerSelection({
  selected,
  onCheck,
  disabled,
  way,
}: {
  selected: Row[];
  onCheck: (ids: string[], value: boolean) => void;
  disabled: boolean;
  way: Way | null;
}) {
  const entry = useTransactionEntry();
  const ids = selected.map((row) => row.id);
  return (
    <SelectionBar
      count={selected.length}
      onClear={() => onCheck(ids, false)}
      way={way}
    >
      <CategorizeAction
        count={selected.length}
        disabled={disabled}
        onCheck={onCheck}
        categorize={(categoryId) =>
          entry.categorizePartnerEntries(
            selected.map((row) => ({ rowId: row.id, entryId: row.entryId! })),
            categoryId,
            (rowId) => onCheck([rowId], true),
          )
        }
      />
    </SelectionBar>
  );
}

// How a settlement reads in either budget: how it was sent, and to or from
// whom.
function settlementPayee(row: Row, view: View, partnerName: string) {
  if (row.kind !== "settlement") return row.payee;
  const sent = row.payerId === view.budget.userId;
  return `${row.method} ${sent ? "to" : "from"} ${partnerName}`;
}

// A settlement, opened in place like any entry. Its amount and date came
// from both banks, so every cell only reads; what's left is confirming it,
// which confirms the partner's side too, or rejecting a wrong match.
function SettlementEditor({
  row,
  cells,
  partnerName,
  onClose,
}: {
  row: Row;
  cells: RowCells;
  partnerName: string;
  onClose: () => void;
}) {
  const formId = useId();
  const { saveCommand } = useTransactionEntry();
  const [error, setError] = useState("");
  const run = (command: Parameters<typeof saveCommand>[0], notice: string) => {
    const failure = saveCommand(command, notice);
    if (failure) setError(failure);
    else onClose();
  };
  const confirm = () =>
    row.confirmed
      ? onClose()
      : run(
          {
            type: "partner.settlement.confirm",
            id: newId(),
            settlementId: row.settlementId!,
          },
          `Confirmed. ${partnerName}’s side is confirmed too.`,
        );
  const reject = () =>
    run(
      {
        type: "partner.settlement.reject",
        id: newId(),
        settlementId: row.settlementId!,
      },
      "Match rejected. Both bank imports are back in review.",
    );
  return (
    <EditorForm
      id={formId}
      title={`Settlement ${row.change >= 0 ? "to" : "from"} ${partnerName}`}
      onSubmit={confirm}
      onCancel={onClose}
    >
      <div className={`${styles.txColumns} ${editorStyles.entryRow}`}>
        <EditorText column="date">{cells.date}</EditorText>
        <EditorText column="payee">{cells.payee}</EditorText>
        <EditorText column="paidBy" optional>
          {cells.paidBy}
        </EditorText>
        <EditorText column="category">{cells.category}</EditorText>
        <EditorText column="total" numeric optional>
          {cells.amount}
        </EditorText>
        <EditorText column="amount" numeric>
          {money(row.change, true)}
        </EditorText>
        <EditorText column="balance" numeric>
          {cells.balance}
        </EditorText>
        <span data-column="status" aria-hidden />
      </div>
      <EditorFooter
        actions={
          <>
            <Button size="sm" onClick={onClose}>
              {row.confirmed ? "Close" : "Cancel"}
            </Button>
            <Button size="sm" onClick={reject}>
              Reject match
            </Button>
            {!row.confirmed && (
              <Button variant="primary" size="sm" type="submit" autoFocus>
                Confirm settlement
              </Button>
            )}
          </>
        }
      >
        {error ? (
          <FormError>{error}</FormError>
        ) : (
          <span className={share.footerHint}>
            {row.confirmed
              ? "Confirmed in both budgets."
              : `Imported in both budgets. Confirming here confirms ${partnerName}’s side too.`}
          </span>
        )}
      </EditorFooter>
    </EditorForm>
  );
}

type RowCells = Record<
  "date" | "payee" | "paidBy" | "category" | "amount" | "balance",
  ReactNode
>;

// How an entry's Owed figure reads aloud: which way it moved the balance,
// whoever owed whom before it.
function owedLabel(change: number) {
  if (change > 0) return `${money(change)} more owed to you`;
  if (change < 0) return `${money(-change)} less owed to you`;
  return "Nothing owed";
}

// An entry, opened in place with the register's editor row. Its amount is
// the share of the one who didn't pay, which either partner can change; the
// category is your side of it, which only you see. The rest is the entry's,
// and reads as it does in the row.
function EntryEditor({
  row,
  cells,
  partnerName,
  linked,
  categoryEditable,
  focus,
  onClose,
}: {
  row: Row;
  cells: RowCells;
  partnerName: string;
  // Whether the entry shows in the person's budget too.
  linked: boolean;
  categoryEditable: boolean;
  // The field clicked to open it, which takes focus.
  focus: EditorField;
  onClose: () => void;
}) {
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);
  const categoryInput = useRef<HTMLInputElement>(null);
  const entry = useTransactionEntry();
  const { view } = entry;
  const paid = row.payerId === view.budget.userId;
  // The share is the part of the one who didn't pay.
  const theirShare = paid ? row.partner : row.you;
  const shareLabel = paid ? `${partnerName}’s share` : "Your share";
  const shareEditable = row.shareMode.mode !== "read";
  const [text, setText] = useState((theirShare / 100).toFixed(2));
  // Until you pick one, your payee memory fills in the category you gave
  // this payee last time.
  const [categoryId, setCategoryId] = useState(
    row.categoryId ?? row.suggestedCategoryId ?? "",
  );
  const [errors, setErrors] = useState<{ amount?: string; form?: string }>({});
  const categoryOptions: SearchListOption[] = view.categories
    .filter(
      (category) =>
        !category.pairedAccountId &&
        !category.pairedLoanId &&
        !category.counterpartyAccountId,
    )
    .map((category) => ({
      value: category.id,
      label: category.name,
      group: category.group,
      amount: category.available,
    }));
  // The field clicked takes focus, or the other one when it can't change.
  // Touch waits for a tap, so a keyboard doesn't cover the row before it's
  // read.
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const target =
      focus === "category"
        ? (categoryInput.current ?? input.current)
        : (input.current ?? categoryInput.current);
    target?.focus({ preventScroll: true });
  }, [focus]);
  const saveCategory = () => {
    if (!categoryEditable || !categoryId || categoryId === row.categoryId)
      return null;
    const label = categoryOptions.find(
      (option) => option.value === categoryId,
    )?.label;
    return entry.saveCommand(
      {
        type: "partner.categorize",
        id: newId(),
        entryId: row.entryId!,
        categoryId,
      },
      paid
        ? `Your import of ${row.payee} will go in ${label}. Only you see that.`
        : `Your ${money(row.you)} of ${row.payee} is in ${label}. Only you see that.`,
    );
  };
  const saveShare = (cents: number) => {
    if (cents === theirShare) return null;
    const notice =
      cents === 0
        ? `Wrote off the share of ${row.payee}.${linked ? " Both ledgers show $0.00 now." : ""}`
        : `${shareLabel} of ${row.payee} is ${money(cents)}.${linked ? " Both budgets updated." : ""}`;
    // Your own imported purchase saves like its Share cell; anything else
    // goes through the shared entry, which changes the payer's transaction.
    return row.transactionId
      ? entry.saveShare(
          row.transactionId,
          row.lineId!,
          shareOf(view, row, cents),
          notice,
        )
      : entry.saveCommand(
          {
            type: "partner.edit",
            id: newId(),
            entryId: row.entryId!,
            share: cents,
            recordedAt: new Date().toISOString(),
          },
          notice,
        );
  };
  const save = () => {
    const reading = shareEditable
      ? readAmount(text)
      : { ok: true as const, cents: theirShare };
    if (!reading.ok) return setErrors({ amount: reading.message });
    const cents = reading.cents;
    if (cents < 0) return setErrors({ amount: "Enter an amount, like 24.50." });
    if (cents > row.shared)
      return setErrors({
        amount: `A share can be at most ${money(row.shared)}.`,
      });
    const failure = saveCategory() ?? saveShare(cents);
    if (failure) return setErrors({ form: failure });
    onClose();
  };
  const readOnly = (column: string, content: ReactNode, numeric = false) => (
    <EditorText column={column} numeric={numeric}>
      {content}
    </EditorText>
  );
  const hint =
    row.shareMode.mode === "read"
      ? row.shareMode.reason
      : categoryEditable && row.needsCategory && categoryId
        ? `Filled in from ${row.payee} last time. Only you see your category.`
        : categoryEditable && paid
          ? "Your import takes this category when it arrives. Only you see it."
          : undefined;
  const editable = shareEditable || categoryEditable;
  return (
    <EditorForm
      id={formId}
      title="Edit shared entry"
      onSubmit={editable ? save : onClose}
      onCancel={onClose}
    >
      <div className={`${styles.txColumns} ${editorStyles.entryRow}`}>
        {readOnly("date", cells.date)}
        {readOnly("payee", cells.payee)}
        <EditorText column="paidBy" optional>
          {cells.paidBy}
        </EditorText>
        {categoryEditable ? (
          <EditorCell column="category" label="Your category">
            <SearchList
              inputRef={categoryInput}
              value={categoryId}
              options={categoryOptions}
              placeholder="Category"
              onChange={setCategoryId}
              onPicked={() => input.current?.focus({ preventScroll: true })}
            />
          </EditorCell>
        ) : (
          readOnly("category", cells.category)
        )}
        <EditorText column="total" numeric optional>
          {cells.amount}
        </EditorText>
        {shareEditable ? (
          <EditorCell column="amount" label={shareLabel} error={errors.amount}>
            <AmountInput
              inputRef={input}
              negative={row.change < 0}
              align="end"
              value={text}
              onChange={(value) => {
                if (errors.amount && !sameAmount(text, value)) setErrors({});
                setText(value);
              }}
            />
          </EditorCell>
        ) : (
          readOnly("amount", money(row.change, true), true)
        )}
        {readOnly("balance", cells.balance, true)}
        <span data-column="status" aria-hidden />
      </div>
      <EditorFooter
        actions={
          editable ? (
            <>
              <Button size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit">
                Save
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          )
        }
      >
        {errors.form ? (
          <FormError>{errors.form}</FormError>
        ) : (
          hint && <span className={share.footerHint}>{hint}</span>
        )}
      </EditorFooter>
    </EditorForm>
  );
}

// The payer's line share, as the register's share menu saves it.
function shareOf(view: View, row: Row, cents: number) {
  const transaction = view.budget.transactions.find(
    (item) => item.id === row.transactionId,
  );
  const line =
    transaction?.lines?.find((item) => item.id === row.lineId) ?? transaction;
  return { ...line!.counterpartyShare!, amount: cents };
}
