"use client";

import grid from "~/components/ui/register.module.css";

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
import { ActionBar, type Way } from "~/components/ui/action-bar";
import { Field, FormError } from "~/components/ui/field";
import { Tag } from "~/components/ui/tag";
import { Register } from "~/components/ui/register";
import { Popover } from "~/components/ui/popover";
import { SearchList, type SearchListOption } from "~/components/ui/search-list";
import { money, shortDay, type Account } from "./model";
import moveStyles from "./move-money.module.css";
import { useShellData } from "./shell-data";
import { useTransactionEntry } from "./transaction-entry";
import { EditorCell, EditorFooter, EditorForm, EditorText } from "./editor-row";
import { CategorizeAction } from "./transaction-review";
import { Empty } from "./views";
import styles from "./shell.module.css";
import share from "./share.module.css";
import local from "./partner-register.module.css";
import editorStyles from "./transaction-entry.module.css";

type Row = View["partnerLedger"][number];

function owedSentence(name: string, balance: number) {
  if (balance > 0) return `${name} owes you`;
  if (balance < 0) return `You owe ${name}`;
  return `You and ${name} are even`;
}

// The Partner account: the one ledger both budgets share. Its balance is
// what's owed, live, and the envelope beside it holds money against it.
export function PartnerSummary({ account }: { account: Account }) {
  const { categories } = useShellData();
  const { view } = useTransactionEntry();
  const envelope = categories.find(
    (category) => category.pairs?.accountId === account.id,
  );
  const request = view.partnerRequest;
  const asker =
    request?.requesterId === view.budget.userId ? "You" : account.name;
  return (
    <>
      <div className={styles.accountSummary}>
        <dl className={styles.balances}>
          <div data-total>
            <dt>{owedSentence(account.name, account.balance)}</dt>
            <dd className={local.owed}>{money(Math.abs(account.balance))}</dd>
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
          {envelope && (
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
          {account.balance > 0 ? (
            <RequestPopover account={account} />
          ) : account.balance < 0 ? (
            <PayPopover account={account} />
          ) : null}
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

// A former partner's closed account: what was owed when the partnership
// ended, kept as it stood. Nothing settles it or adds to it in the app.
export function FormerPartnerSummary({ account }: { account: Account }) {
  const balance = account.balance;
  return (
    <div className={styles.accountSummary}>
      <dl className={styles.balances}>
        <div data-total>
          <dt>
            {balance > 0
              ? `${account.name} owed you`
              : balance < 0
                ? `You owed ${account.name}`
                : `You and ${account.name} were even`}
          </dt>
          <dd className={local.owed}>{money(Math.abs(balance))}</dd>
        </div>
      </dl>
      {account.closed && (
        <div className={styles.summaryActions}>
          <span className={styles.reconciledLabel}>
            Closed {shortDay(account.closed.at.slice(0, 10))} · frozen as it
            stood
          </span>
        </div>
      )}
    </div>
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
// partner paid. What you paid carries its transaction's category.
function categorizable(row: Row, you: string, closed: boolean) {
  return !closed && Boolean(row.entryId) && row.payerId !== you;
}

type EditorField = "category" | "amount";

// The partner ledger, as a register: clicking an entry selects it, and
// clicking it again opens it at the field clicked. Entries you can
// categorize can be checked and categorized together.
export function PartnerRegister({
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
  const [editing, setEditing] = useState<{
    id: string;
    field: EditorField;
  } | null>(null);
  // A former partner's ledger reads as it stood when it closed.
  const closed = account.kind === "former-partner";
  const ledger = closed
    ? (view.formerPartnerLedgers[account.id] ?? [])
    : view.partnerLedger;
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
  const checkable = (row: Row) => categorizable(row, you, closed);
  const selected = rows.filter(
    (row) => checkable(row) && checked.includes(row.id),
  );
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
  const rowCells = (row: Row): RowCells => {
    const settlement = Boolean(row.settlementId);
    const unconfirmed = row.confirmed === false;
    const paidBy =
      row.kind === "repayment" || settlement
        ? null
        : row.payerId === view.budget.userId
          ? "You paid"
          : `${account.name} paid`;
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
          {paidBy && (
            <span className={`${local.paidBy} ${styles.faint}`}>{paidBy}</span>
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
      ) : row.kind === "repayment" ? (
        <span className={styles.faint}>Repayment</span>
      ) : row.you === 0 ? (
        <span className={styles.faint}>Not yours</span>
      ) : (
        <span className={styles.muted}>
          {name(row.categoryId) ?? "No category"}
        </span>
      ),
      // Each cell carries its own tone, so it reads the same in the row
      // and in the editor.
      balance: <span className={styles.muted}>{money(row.balance)}</span>,
    };
    return cells;
  };
  const register = (
    <Register
      aria-label={`${account.name} ledger`}
      columns={[
        { key: "date", label: "Date", optional: true },
        { key: "payee", label: "Payee" },
        { key: "your-category", label: "Your category" },
        { key: "amount", label: "Amount", numeric: true },
        { key: "balance", label: "Balance", numeric: true },
        { key: "status", label: "" },
      ]}
      layout={{
        wide: "5.5rem minmax(0, 1.4fr) minmax(0, 1fr) 7rem 7rem 16px",
        narrow: "minmax(0, 1.2fr) minmax(0, 1fr) 6rem 6rem 16px",
        gutter: "34px",
      }}
      rows={rows}
      cells={(row) => {
        const cells = rowCells(row);
        const settlement = Boolean(row.settlementId);
        const isSelected = selectedId === row.id;
        return {
          label: row.payee,
          attributes: {
            "data-entry-row": row.id,
            "aria-expanded": settlement ? isSelected : undefined,
          },
          content: (
            <>
              <span className={styles.rowName} data-column="date" data-optional>
                {cells.date}
              </span>
              <span className={styles.rowName} data-column="payee">
                {cells.payee}
              </span>
              <span className={styles.truncate} data-column="category">
                {cells.category}
              </span>
              <span className={styles.numeric} data-column="amount">
                {money(row.change, true)}
              </span>
              <span className={styles.numeric} data-column="balance">
                {cells.balance}
              </span>
              <span />
            </>
          ),
          controls: isSelected && settlement && (
            <SettlementDetail row={row} partnerName={account.name} />
          ),
        };
      }}
      checkable={checkable}
      selectedId={selectedId}
      onSelect={onSelect}
      checked={checked}
      onCheck={onCheck}
      onOpen={(row, column) => {
        if (editing || row.settlementId || !(row.entryId ?? row.lineId)) return;
        setEditing({
          id: row.id,
          field:
            column === "category" && checkable(row) ? "category" : "amount",
        });
      }}
      editingId={rows.find((row) => row.id === editing?.id)?.id}
      renderEditor={(row) =>
        row &&
        editing && (
          <EntryEditor
            row={row}
            cells={rowCells(row)}
            partnerName={account.name}
            categoryEditable={checkable(row)}
            focus={editing.field}
            onClose={() => setEditing(null)}
          />
        )
      }
      empty={
        closed ? (
          <Empty title="Nothing was shared." icon={UsersIcon}>
            You and {account.name} didn’t share a cost before they parted.
          </Empty>
        ) : (
          <Empty title="Nothing owed yet." icon={UsersIcon}>
            When you and {account.name} share a cost, what one of you owes the
            other shows here, in both budgets.
          </Empty>
        )
      }
      noMatch={
        ledger.length ? (
          <Empty
            title={`No entries match “${query.trim()}”.`}
            icon={SearchIcon}
          >
            Search looks at payees, categories, and amounts.
          </Empty>
        ) : undefined
      }
      actionBar={
        <PartnerActions
          selected={selected}
          onCheck={onCheck}
          disabled={Boolean(entry.session) || editing !== null}
          way={wayToTransaction()}
        />
      }
    />
  );
  return rows.length ? (
    <div className={local.ledger}>{register}</div>
  ) : (
    register
  );
}

// The action bar over the ledger while entries are selected: the way to the
// selected entry's transaction, and the one thing checked entries share,
// your category.
function PartnerActions({
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
    <ActionBar
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
    </ActionBar>
  );
}

// How a settlement reads in either budget: how it was sent, and to or from
// whom.
function settlementPayee(row: Row, view: View, partnerName: string) {
  if (row.kind !== "settlement") return row.payee;
  const sent = row.payerId === view.budget.userId;
  return `${row.method} ${sent ? "to" : "from"} ${partnerName}`;
}

// A settlement, opened: what it moved, how both budgets recognized it, and
// the one confirmation that resolves both sides.
function SettlementDetail({
  row,
  partnerName,
}: {
  row: Row;
  partnerName: string;
}) {
  const { saveCommand } = useTransactionEntry();
  const [error, setError] = useState("");
  return (
    <div
      className={share.detail}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className={share.detailMain}>
        <dl className={share.facts}>
          <div>
            <dt>
              {row.change >= 0
                ? `You paid ${partnerName}`
                : `${partnerName} paid you`}
            </dt>
            <dd>{money(Math.abs(row.change))}</dd>
          </div>
        </dl>
        <p className={local.source}>
          <LinkIcon size={13} aria-hidden />
          {row.confirmed
            ? "Matched in both budgets"
            : "Imported in both budgets. Confirm it in either one."}
          {" Reject a wrong match to review both bank imports separately."}
        </p>
        <div className={local.detailActions}>
          {!row.confirmed && (
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                setError(
                  saveCommand(
                    {
                      type: "partner.settlement.confirm",
                      id: newId(),
                      settlementId: row.settlementId!,
                    },
                    `Confirmed. ${partnerName}’s side is confirmed too.`,
                  ) ?? "",
                )
              }
            >
              Confirm settlement
            </Button>
          )}
          <Button
            size="sm"
            onClick={() =>
              setError(
                saveCommand(
                  {
                    type: "partner.settlement.reject",
                    id: newId(),
                    settlementId: row.settlementId!,
                  },
                  "Match rejected. Both bank imports are back in review.",
                ) ?? "",
              )
            }
          >
            Reject match
          </Button>
        </div>
        {error && <FormError>{error}</FormError>}
      </div>
    </div>
  );
}

type RowCells = Record<"date" | "payee" | "category" | "balance", ReactNode>;

// An entry, opened in place with the register's editor row. Its amount is
// the share of the one who didn't pay, which either partner can change; the
// category is your side of it, which only you see. The rest is the entry's,
// and reads as it does in the row.
function EntryEditor({
  row,
  cells,
  partnerName,
  categoryEditable,
  focus,
  onClose,
}: {
  row: Row;
  cells: RowCells;
  partnerName: string;
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
      `Your ${money(row.you)} of ${row.payee} is in ${label}. Only you see that.`,
    );
  };
  const saveShare = (cents: number) => {
    if (cents === theirShare) return null;
    const notice =
      cents === 0
        ? `Wrote off the share of ${row.payee}. Both ledgers show $0.00 now.`
        : `${shareLabel} of ${row.payee} is ${money(cents)}. Both budgets updated.`;
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
        : undefined;
  const editable = shareEditable || categoryEditable;
  return (
    <EditorForm
      id={formId}
      title="Edit shared entry"
      onSubmit={editable ? save : onClose}
      onCancel={onClose}
    >
      <div className={`${grid.columns} ${editorStyles.entryRow}`}>
        {readOnly("date", cells.date)}
        {readOnly("payee", cells.payee)}
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
        {shareEditable ? (
          <EditorCell column="amount" label="Amount" error={errors.amount}>
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
