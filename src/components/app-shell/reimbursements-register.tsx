"use client";

import grid from "~/components/ui/register.module.css";

import { PlusIcon, SearchIcon, UsersIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readAmount, sameAmount } from "~/components/budget/amount";
import { newId, today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { AmountInput } from "~/components/ui/amount-input";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import { Field, FormError } from "~/components/ui/field";
import { Popover } from "~/components/ui/popover";
import { SearchList } from "~/components/ui/search-list";
import { counterpartyRegisterEntries } from "~/domain/counterparty";
import { money, shortDay, type Account } from "./model";
import moveStyles from "./move-money.module.css";
import { useShellData } from "./shell-data";
import { useTransactionEntry } from "./transaction-entry";
import { Empty } from "./views";
import { moveSelection } from "~/components/ui/move-selection";
import styles from "./shell.module.css";
import local from "./reimbursements-register.module.css";

type Entry = {
  id: string;
  transactionId: string;
  accountId: string;
  date: string;
  payee: string;
  who: string;
  category: string;
  amount: number;
  reviewed: boolean;
};

// Everyone who isn't the partner, in one private account: what each person
// or organization owes you is a filter on it, not an account each. Entries
// are oldest first; a day's keep the order they were recorded in.
function reimbursementEntries(
  view: View,
  account: Account,
  accounts: Account[],
): Entry[] {
  return counterpartyRegisterEntries(view.budget, { accountId: account.id })
    .map((entry) => {
      const transaction = view.budget.transactions.find(
        (item) => item.id === entry.transactionId,
      );
      const categoryId =
        transaction?.lines?.find((line) => line.id === entry.lineId)
          ?.categoryId ?? transaction?.categoryId;
      const cash = accounts.find((item) => item.id === entry.cashAccountId);
      return {
        id: entry.id,
        transactionId: entry.transactionId,
        accountId: entry.cashAccountId,
        date: entry.date,
        payee: entry.payee,
        who: entry.counterpartyName ?? account.name,
        category:
          entry.kind === "repayment"
            ? `Transfer from ${cash?.name ?? "a deleted account"}`
            : (view.categories.find((item) => item.id === categoryId)?.name ??
              "Needs category"),
        amount: entry.amount,
        reviewed: transaction?.reviewed ?? true,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function owedBy(entries: Entry[]) {
  const balances = new Map<string, number>();
  for (const entry of entries)
    balances.set(entry.who, (balances.get(entry.who) ?? 0) + entry.amount);
  return [...balances]
    .map(([who, balance]) => ({ who, balance }))
    .sort((a, b) => a.who.localeCompare(b.who));
}

function useReimbursements(account: Account) {
  const { view } = useTransactionEntry();
  const { accounts, categories } = useShellData();
  const entries = reimbursementEntries(view, account, accounts);
  return {
    entries,
    owedBy: owedBy(entries),
    envelope: categories.find(
      (category) => category.pairs?.accountId === account.id,
    ),
  };
}

// The account's balances: what's owed to you, and the paired envelope that
// holds money against it. A repayment lowers the first and refills the
// second, never Ready to Assign.
export function ReimbursementsSummary({
  account,
  who,
}: {
  account: Account;
  who: string | null;
}) {
  const { envelope, owedBy } = useReimbursements(account);
  return (
    <div className={styles.accountSummary}>
      <dl className={styles.balances}>
        <div data-total>
          <dt>Owed to you</dt>
          <dd className={local.owed}>{money(account.balance)}</dd>
        </div>
        {envelope && (
          <div>
            <dt>
              {envelope.name} envelope
              {envelope.assigned > 0 && ` · ${money(envelope.assigned)} float`}
            </dt>
            <dd className={local.envelope} data-state={envelope.funding}>
              {money(envelope.available)}
            </dd>
          </div>
        )}
      </dl>
      <div className={styles.summaryActions}>
        <span className={styles.reconciledLabel}>
          Only you see this account.
        </span>
        <RecordRepayment account={account} owedBy={owedBy} filter={who} />
      </div>
    </div>
  );
}

// Who owes what, as filters over the one register.
export function ReimbursementFilters({
  account,
  value,
  onChange,
}: {
  account: Account;
  value: string | null;
  onChange: (who: string | null) => void;
}) {
  const { owedBy } = useReimbursements(account);
  const active = owedBy.some((item) => item.who === value) ? value : null;
  return (
    <>
      <Button
        size="sm"
        aria-pressed={active === null}
        onClick={() => onChange(null)}
      >
        Everyone
      </Button>
      {owedBy.map((item) => (
        <Button
          key={item.who}
          size="sm"
          aria-pressed={active === item.who}
          onClick={() => onChange(active === item.who ? null : item.who)}
        >
          {item.who}
          <span className={styles.numeric}>{money(item.balance)}</span>
        </Button>
      ))}
    </>
  );
}

export function ReimbursementsRegister({
  account,
  who,
  query,
  onJump,
}: {
  account: Account;
  who: string | null;
  query: string;
  onJump: (transaction: {
    id: string;
    accountId: string;
    date: string;
  }) => void;
}) {
  const { entries } = useReimbursements(account);
  const { accounts } = useShellData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const search = query.trim().toLowerCase();
  // Balances run over the filtered entries, so one person's column ends at
  // what that person owes. A name with no entries left shows everyone.
  let running = 0;
  const rows = entries
    .filter(
      (entry) => entry.who === who || !entries.some((item) => item.who === who),
    )
    .map((entry) => ({ ...entry, balance: (running += entry.amount) }))
    .filter(
      (entry) =>
        !search ||
        [entry.payee, entry.who, entry.category, money(Math.abs(entry.amount))]
          .join(" ")
          .toLowerCase()
          .includes(search),
    )
    .reverse();
  if (!entries.length)
    return (
      <Empty title="Nothing owed yet." icon={UsersIcon}>
        When you pay for someone, give the expense a share and what they owe you
        shows here. A repayment refills its envelope in People.
      </Empty>
    );
  if (!rows.length)
    return (
      <Empty title={`No entries match “${query.trim()}”.`} icon={SearchIcon}>
        Search looks at payees, people, categories, and amounts.
      </Empty>
    );
  return (
    <div
      className={`${styles.list} ${grid.register} ${local.register}`}
      role="group"
      aria-label={account.name}
      onKeyDown={moveSelection}
    >
      <div className={`${grid.columns} ${grid.columnHeader}`} aria-hidden>
        <span data-optional>Date</span>
        <span>Payee</span>
        <span>Who</span>
        <span data-optional>Category</span>
        <span className={styles.numeric}>Amount</span>
        <span className={styles.numeric}>Balance</span>
        <span />
      </div>
      {rows.map((entry) => (
        <div
          key={entry.id}
          className={grid.rowWrap}
          onMouseDown={(event) => {
            // A double-click would select a word, and the click handler
            // would take it for a text selection and not open the entry.
            if (event.detail > 1) event.preventDefault();
          }}
        >
          <button
            type="button"
            data-row
            className={`${grid.columns} ${grid.row}`}
            aria-current={selectedId === entry.id ? "true" : undefined}
            title={
              selectedId === entry.id
                ? `Open in ${accounts.find((item) => item.id === entry.accountId)?.name ?? "its account"}`
                : undefined
            }
            onClick={(event) => {
              if (event.detail > 0 && window.getSelection()?.toString()) return;
              // A selected entry opens its transaction where it can be
              // edited: the purchase with its share, or the deposit.
              if (selectedId === entry.id) {
                onJump({
                  id: entry.transactionId,
                  accountId: entry.accountId,
                  date: entry.date,
                });
                return;
              }
              setSelectedId(entry.id);
            }}
          >
            <span className={styles.rowName} data-column="date" data-optional>
              <span
                className={styles.reviewDot}
                data-on={entry.reviewed ? undefined : ""}
              >
                {!entry.reviewed && (
                  <span className="sr-only">Needs review</span>
                )}
              </span>
              <span className={`${styles.truncate} ${styles.muted}`}>
                {shortDay(entry.date)}
              </span>
            </span>
            <span className={styles.truncate} data-column="payee">
              {entry.payee}
            </span>
            <span className={styles.truncate} data-column="who">
              {entry.who}
            </span>
            <span
              className={`${styles.truncate} ${styles.muted}`}
              data-column="category"
              data-optional
            >
              {entry.category}
            </span>
            <span className={styles.numeric} data-column="amount">
              {money(entry.amount, true)}
            </span>
            <span
              className={`${styles.numeric} ${styles.muted}`}
              data-column="balance"
            >
              {money(entry.balance)}
            </span>
            <span />
          </button>
        </div>
      ))}
    </div>
  );
}

// Money someone paid back, into one of your cash accounts. It's recorded
// here, by hand, and the bank import matches it later.
function RecordRepayment({
  account,
  owedBy,
  filter,
}: {
  account: Account;
  owedBy: { who: string; balance: number }[];
  // The register's person filter, who the repayment is most likely from.
  filter: string | null;
}) {
  const { view, saveCommand } = useTransactionEntry();
  const { accounts } = useShellData();
  const cash = accounts.filter((item) => item.kind === "cash");
  const owing = owedBy.filter((item) => item.balance > 0);
  const timezone = view.budget.settings.timezone;
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState("");
  const [amount, setAmount] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<{
    field?: "who" | "amount" | "cash";
    message: string;
  } | null>(null);
  const outstanding = owing.find((item) => item.who === who)?.balance ?? 0;
  // Who is usually known from the filter, so the amount field takes focus
  // as the form opens: it's what's left to check.
  const amountInput = useRef<HTMLInputElement>(null);
  const focusAmount = useRef(false);
  useEffect(() => {
    if (!open || !focusAmount.current) return;
    focusAmount.current = false;
    amountInput.current?.focus();
  }, [open]);
  const pick = (next: string) => {
    setWho(next);
    const balance = owing.find((item) => item.who === next)?.balance;
    setAmount(balance ? (balance / 100).toFixed(2) : "");
    setError(null);
  };
  return (
    <Popover
      label="Record a repayment"
      trigger={
        <Button size="sm" disabled={!owing.length}>
          <PlusIcon aria-hidden />
          Record repayment
        </Button>
      }
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        const known =
          owing.find((item) => item.who === filter)?.who ??
          (owing.length === 1 ? owing[0]!.who : "");
        pick(known);
        focusAmount.current = Boolean(known);
        setCashAccountId(cash.length === 1 ? cash[0]!.id : "");
        setDate(today(timezone));
      }}
      align="end"
      size="form"
      arrow
      autoFocus={!who}
    >
      <form
        className={moveStyles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const reading = readAmount(amount);
          if (!who)
            return setError({
              field: "who",
              message: "Choose who paid you back.",
            });
          if (amount.trim() && !reading.ok)
            return setError({ field: "amount", message: reading.message });
          const cents = reading.ok ? reading.cents : 0;
          if (!(cents > 0))
            return setError({
              field: "amount",
              message: "Enter the amount, like 412.00.",
            });
          if (cents > outstanding)
            return setError({
              field: "amount",
              message: `${who} owes you ${money(outstanding)}. Enter that much or less.`,
            });
          if (!cashAccountId)
            return setError({
              field: "cash",
              message: "Choose the account the money went into.",
            });
          const failure = saveCommand(
            {
              type: "counterparty.receive",
              id: newId(),
              counterpartyAccountId: account.id,
              cashAccountId,
              date,
              amount: cents,
              counterpartyName: who,
              recordedAt: new Date().toISOString(),
            },
            `Recorded ${money(cents)} from ${who}`,
          );
          if (failure) return setError({ message: failure });
          setOpen(false);
        }}
      >
        <div className={moveStyles.header}>
          <strong>Record a repayment</strong>
          {who && (
            <span className={moveStyles.balance}>
              {money(outstanding)} owed
            </span>
          )}
        </div>
        <div className={moveStyles.fieldSlot}>
          <Field
            label="From"
            error={error?.field === "who" ? error.message : undefined}
          >
            <SearchList
              value={who}
              options={owing.map((item) => ({
                value: item.who,
                label: item.who,
                amount: item.balance,
              }))}
              placeholder="Choose who paid"
              onChange={pick}
            />
          </Field>
        </div>
        <div className={local.fieldPair}>
          <div className={moveStyles.fieldSlot}>
            <Field
              label="Amount"
              error={error?.field === "amount" ? error.message : undefined}
            >
              <AmountInput
                inputRef={amountInput}
                value={amount}
                onChange={(next) => {
                  if (error?.field === "amount" && !sameAmount(amount, next))
                    setError(null);
                  setAmount(next);
                }}
              />
            </Field>
          </div>
          <div className={moveStyles.fieldSlot}>
            <Field label="Date">
              <DateField
                value={date}
                // A repayment is recorded once it arrived.
                max={today(timezone)}
                today={today(timezone)}
                onChange={setDate}
              />
            </Field>
          </div>
        </div>
        <div className={moveStyles.fieldSlot}>
          <Field
            label="Into"
            error={error?.field === "cash" ? error.message : undefined}
            hint={`It lowers what ${who || "they"} owe${who ? "s" : ""} and refills your ${account.name} envelope. It isn’t income, so Ready to Assign doesn’t change.`}
          >
            <SearchList
              value={cashAccountId}
              options={cash.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              placeholder="Choose an account"
              onChange={(next) => {
                setCashAccountId(next);
                if (error?.field === "cash") setError(null);
              }}
            />
          </Field>
        </div>
        {error && !error.field && (
          <div className={moveStyles.formError}>
            <FormError>{error.message}</FormError>
          </div>
        )}
        <div className={moveStyles.footer}>
          <Button size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Record
          </Button>
        </div>
      </form>
    </Popover>
  );
}
