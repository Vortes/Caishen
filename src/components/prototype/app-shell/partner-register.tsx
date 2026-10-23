"use client";

import { HistoryIcon, LinkIcon, SearchIcon, UsersIcon } from "lucide-react";
import { useId, useState } from "react";
import { newId } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { Button } from "~/components/ui/button";
import { Tag } from "~/components/ui/tag";
import type { PartnerEntryChange } from "~/domain/partner-ledger";
import { money, shortDay, type Account } from "./model";
import moveStyles from "./move-money.module.css";
import { AmountWell, halfOf, parseCents } from "./share-field";
import { useShellData } from "./shell-data";
import { useTransactionEntry } from "./transaction-entry";
import { ChoiceField, type ChoiceOption } from "./transaction-fields";
import { Empty, moveSelection } from "./views";
import styles from "./shell.module.css";
import share from "./share.module.css";
import local from "./partner-register.module.css";

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
  const envelope = categories.find(
    (category) => category.pairs?.accountId === account.id,
  );
  return (
    <div className={styles.accountSummary}>
      <dl className={styles.balances}>
        <div data-total>
          <dt>{owedSentence(account.name, account.balance)}</dt>
          <dd className={local.owed}>{money(Math.abs(account.balance))}</dd>
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
    </div>
  );
}

export function PartnerRegister({
  account,
  query,
}: {
  account: Account;
  query: string;
}) {
  const { view } = useTransactionEntry();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const name = (id: string | undefined) =>
    view.categories.find((item) => item.id === id)?.name;
  const search = query.trim().toLowerCase();
  const payee = (row: Row) => settlementPayee(row, view, account.name);
  const rows = view.partnerLedger.filter(
    (row) =>
      !search ||
      [payee(row), name(row.categoryId), money(row.shared), money(row.change)]
        .join(" ")
        .toLowerCase()
        .includes(search),
  );
  if (!view.partnerLedger.length)
    return (
      <Empty title="Nothing owed yet." icon={UsersIcon}>
        When you and {account.name} share a cost, what one of you owes the other
        shows here, in both budgets.
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
      className={`${styles.list} ${styles.register} ${local.register}`}
      role="group"
      aria-label={`${account.name} ledger`}
      onKeyDown={moveSelection}
    >
      <div className={`${styles.txColumns} ${styles.columnHeader}`} aria-hidden>
        <span data-optional>Date</span>
        <span>Payee</span>
        <span>Your category</span>
        <span className={styles.numeric} data-optional>
          Shared
        </span>
        <span className={styles.numeric}>Amount</span>
        <span className={styles.numeric}>Balance</span>
        <span />
      </div>
      {rows.map((row) => {
        const selected = selectedId === row.id;
        const settlement = row.kind === "settlement";
        const unconfirmed = row.confirmed === false;
        const opens = row.kind !== "repayment";
        const paidBy =
          row.kind === "repayment" || settlement
            ? null
            : row.payerId === view.budget.userId
              ? "You paid"
              : `${account.name} paid`;
        return (
          <div
            key={row.id}
            className={styles.rowWrap}
            data-open={selected || undefined}
          >
            <button
              type="button"
              data-row
              className={`${styles.txColumns} ${styles.row}`}
              aria-current={selected ? "true" : undefined}
              aria-expanded={opens ? selected : undefined}
              onClick={(event) => {
                // Finishing a text selection in the row doesn't click it.
                if (event.detail > 0 && window.getSelection()?.toString())
                  return;
                setSelectedId(selected ? null : row.id);
              }}
            >
              <span className={styles.rowName} data-optional>
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
              </span>
              <span className={styles.rowName}>
                <span className={styles.truncate}>{payee(row)}</span>
                {paidBy && (
                  <span className={`${local.paidBy} ${styles.faint}`}>
                    {paidBy}
                  </span>
                )}
              </span>
              <span className={styles.truncate}>
                {row.needsCategory ? (
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
                )}
              </span>
              <span
                className={`${styles.numeric} ${styles.faint}`}
                data-optional
              >
                {opens && !settlement ? money(row.shared) : ""}
              </span>
              <span className={styles.numeric}>{money(row.change, true)}</span>
              <span className={`${styles.numeric} ${styles.muted}`}>
                {money(row.balance)}
              </span>
              <span />
            </button>
            {selected && settlement && (
              <SettlementDetail row={row} partnerName={account.name} />
            )}
            {selected && opens && !settlement && (
              <EntryDetail
                key={`${row.id}-${row.partner}-${row.you}`}
                row={row}
                partnerName={account.name}
              />
            )}
          </div>
        );
      })}
    </div>
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
                ? `${partnerName} owes you`
                : `You owe ${partnerName}`}
            </dt>
            <dd>{money(Math.abs(row.change))}</dd>
          </div>
        </dl>
        <p className={local.source}>
          <LinkIcon size={13} aria-hidden />
          {row.confirmed
            ? "Matched in both budgets"
            : "Imported in both budgets. Confirm it in either one."}
        </p>
        {!row.confirmed && (
          <div className={local.detailActions}>
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
          </div>
        )}
        {error && <p className={moveStyles.error}>{error}</p>}
      </div>
    </div>
  );
}

// An entry, opened: who consumed what, your side's category, the share
// (either partner can change it), and its history.
function EntryDetail({ row, partnerName }: { row: Row; partnerName: string }) {
  const id = useId();
  const entry = useTransactionEntry();
  const { view } = entry;
  const paid = row.payerId === view.budget.userId;
  const refund = row.kind === "refund";
  // The share is the part of the one who didn't pay.
  const theirShare = paid ? row.partner : row.you;
  const shareLabel = paid ? `${partnerName}'s share` : "Your share";
  const [text, setText] = useState((theirShare / 100).toFixed(2));
  const [error, setError] = useState("");
  const apply = (cents: number) => {
    const notice =
      cents === 0
        ? `Wrote off the share of ${row.payee}. Both ledgers show $0.00 now.`
        : `${shareLabel} of ${row.payee} is ${money(cents)}. Both budgets updated.`;
    // Your own purchase saves like its Share cell; your partner's goes
    // through the shared entry, which changes their transaction.
    const failure = paid
      ? entry.saveShare(
          row.transactionId!,
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
    if (failure) return setError(failure);
    setError("");
    setText((cents / 100).toFixed(2));
  };
  return (
    <div
      className={share.detail}
      // The register moves its selection with the arrow keys; in here they
      // belong to the fields.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className={share.detailMain}>
        <dl className={share.facts}>
          <div>
            <dt>{refund ? "Refunded" : "Shared"}</dt>
            <dd>{money(row.shared)}</dd>
          </div>
          <div>
            <dt>You</dt>
            <dd>{money(row.you)}</dd>
          </div>
          <div>
            <dt>{partnerName}</dt>
            <dd>{money(row.partner)}</dd>
          </div>
          <div>
            <dt>
              {row.change >= 0
                ? `${partnerName} owes you`
                : `You owe ${partnerName}`}
            </dt>
            <dd>{money(Math.abs(row.change))}</dd>
          </div>
        </dl>
        <div className={share.detailField}>
          <label htmlFor={`${id}-category`}>Your category</label>
          {paid ? (
            <p className={local.readOnly}>
              {view.categories.find((item) => item.id === row.categoryId)
                ?.name ?? "No category"}
              <span className={styles.faint}> · on your {row.payee} line</span>
            </p>
          ) : (
            <SideCategory row={row} id={`${id}-category`} />
          )}
        </div>
        <form
          className={share.detailField}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const cents = parseCents(text);
            if (cents === null) return setError("Enter an amount, like 24.50.");
            if (cents > row.shared)
              return setError(`A share can be at most ${money(row.shared)}.`);
            apply(cents);
          }}
        >
          <label htmlFor={`${id}-share`}>{shareLabel}</label>
          <div className={share.shareEdit}>
            <AmountWell
              id={`${id}-share`}
              value={text}
              invalid={Boolean(error)}
              onChange={(value) => {
                setText(value);
                if (error) setError("");
              }}
            />
            <Button size="sm" type="submit">
              Update
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => apply(halfOf(row.shared))}
            >
              Split evenly
            </Button>
            {paid && (
              <Button
                size="sm"
                variant="quiet"
                disabled={theirShare === 0}
                onClick={() => apply(0)}
              >
                Write off
              </Button>
            )}
          </div>
          {error && <p className={moveStyles.error}>{error}</p>}
          <p className={share.formHint}>
            Changes apply to both budgets at once and stay in the entry&rsquo;s
            history.
          </p>
        </form>
      </div>
      {row.history.length > 0 && (
        <div className={share.history}>
          <h3>
            <HistoryIcon size={13} aria-hidden />
            History
          </h3>
          <ol>
            {row.history.map((change, index) => (
              <li key={index}>
                <span className={styles.faint}>
                  {change.at ? day(view, change.at) : shortDay(row.date)} ·{" "}
                  {change.actorId === view.budget.userId ? "You" : partnerName}
                </span>
                <span>
                  {describe(change, paid ? shareLabel : "your share")}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// Your side of your partner's purchase. Until you pick one, your payee
// memory fills in the category you gave this payee last time.
function SideCategory({ row, id }: { row: Row; id: string }) {
  const entry = useTransactionEntry();
  const { view } = entry;
  const [value, setValue] = useState(
    row.categoryId ?? row.suggestedCategoryId ?? "",
  );
  const [error, setError] = useState("");
  const options: ChoiceOption[] = view.categories
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
  const save = (categoryId: string) => {
    const label = options.find((option) => option.value === categoryId)?.label;
    const failure = entry.saveCommand(
      {
        type: "partner.categorize",
        id: newId(),
        entryId: row.entryId!,
        categoryId,
      },
      `Your ${money(row.you)} of ${row.payee} is in ${label}. Only you see that.`,
    );
    setError(failure ?? "");
  };
  const prefilled = row.needsCategory && Boolean(value);
  return (
    <>
      <div className={local.categoryEdit}>
        <ChoiceField
          id={id}
          label="Your category"
          value={value}
          options={options}
          placeholder="Pick a category"
          invalid={Boolean(error)}
          onChange={(next) => {
            setValue(next);
            save(next);
          }}
        />
        {prefilled && (
          <Button size="sm" variant="primary" onClick={() => save(value)}>
            Categorize
          </Button>
        )}
      </div>
      {error ? (
        <p className={moveStyles.error}>{error}</p>
      ) : (
        prefilled && (
          <p className={share.formHint}>
            Filled in from {row.payee} last time. Only you see your category.
          </p>
        )
      )}
    </>
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

function day(view: View, at: string) {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: view.budget.settings.timezone,
  });
}

// One change to an entry, in words.
function describe(change: PartnerEntryChange, shareLabel: string) {
  if (change.reason === "created") return "Shared";
  if (change.reason === "removed") return "Removed from the ledger";
  const parts = (change.changes ?? []).map(({ field, previous, next }) => {
    if (field === "share")
      return Number(next) === 0
        ? `Changed ${shareLabel} from ${money(Number(previous))} to $0.00 (written off)`
        : `Changed ${shareLabel} from ${money(Number(previous))} to ${money(Number(next))}`;
    if (field === "amount")
      return `Changed the amount from ${money(Math.abs(Number(previous)))} to ${money(Math.abs(Number(next)))}`;
    if (field === "date")
      return `Moved it from ${shortDay(String(previous))} to ${shortDay(String(next))}`;
    if (field === "payee") return `Renamed it from ${previous} to ${next}`;
    return next === "posted" ? "Posted" : `Marked ${next}`;
  });
  if (change.reason === "restored")
    return ["Shared again", ...parts].join(". ");
  return parts.join(". ") || "Updated";
}
