"use client";

import { HistoryIcon, PlusIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { View } from "~/components/budget/types";
import { lineField } from "~/components/transactions/transaction-draft";
import { canShare } from "~/components/transactions/transaction-share";
import { Button } from "~/components/ui/button";
import { counterpartyLines } from "~/domain/counterparty";
import type { CounterpartyShare, TransactionLine } from "~/domain/engine";
import { money, type Transaction } from "./model";
import {
  AmountWell,
  halfOf,
  parseCents,
  ShareLabel,
  ShareMenu,
  useShareParties,
} from "./share-field";
import { useTransactionEntry } from "./transaction-entry";
import moveStyles from "./move-money.module.css";
import shell from "./shell.module.css";
import styles from "./share.module.css";

type BudgetTransaction = View["budget"]["transactions"][number];
type Who = (share: CounterpartyShare) => string;

// The lines a share can sit on: a split's lines, or the transaction itself
// as one line, even before it has a category.
function shareLines(transaction: BudgetTransaction): TransactionLine[] {
  return (
    transaction.lines ?? [
      {
        id: transaction.id,
        categoryId: transaction.categoryId ?? "",
        amount: transaction.amount,
        counterpartyShare: transaction.counterpartyShare,
      },
    ]
  );
}

// The shares on a transaction's lines, added up by who owes them.
function shareTotal(who: Who, transaction: BudgetTransaction) {
  const shares = shareLines(transaction)
    .map((line) => line.counterpartyShare)
    .filter((share): share is CounterpartyShare => Boolean(share?.amount));
  if (!shares.length) return null;
  const first = shares[0]!;
  const same = shares.every(
    (share) =>
      share.accountId === first.accountId &&
      share.counterpartyName === first.counterpartyName,
  );
  return {
    ...first,
    counterpartyName: same
      ? first.counterpartyName
      : [...new Set(shares.map((share) => who(share)))].join(", "),
    amount: shares.reduce((sum, share) => sum + share.amount, 0),
  };
}

function shareNotice(
  who: Who,
  payee: string,
  before: CounterpartyShare | null | undefined,
  share: CounterpartyShare | null,
) {
  if (share?.amount) {
    const name = who(share);
    return share.counterpartyName
      ? `${name} owes you ${money(share.amount)} for ${payee}.`
      : `${name}'s share of ${payee} is ${money(share.amount)}.`;
  }
  return before?.amount && share
    ? `Wrote off the share of ${payee}.`
    : `${payee} is all yours now.`;
}

// The register's Share cell, over its row in the Share column. On one line
// it opens the share menu and saves what's picked; a split opens the editor,
// where each line has its own. A linked refund's share follows its
// purchase, so it only reads.
export function ShareCell({
  row,
  accountColumn,
}: {
  row: Transaction;
  accountColumn: boolean;
}) {
  const entry = useTransactionEntry();
  const { view, who } = useShareParties();
  if (!row.shareable) return null;
  const transactionId = row.id;
  const transaction =
    row.source === "budget"
      ? view.budget.transactions.find((item) => item.id === transactionId)
      : undefined;
  if (row.source === "budget" && !transaction) return null;
  const lines = transaction
    ? shareLines(transaction)
    : [{ id: row.id, categoryId: row.categoryId ?? "", amount: row.amount }];
  const total = transaction ? shareTotal(who, transaction) : null;
  const label = total && <ShareLabel share={total} />;
  const payee = row.payee;
  const slot = (content: ReactNode) => (
    <div
      className={`${shell.txColumns} ${styles.shareActions}`}
      data-accounts={accountColumn || undefined}
    >
      <span className={styles.shareSlot}>{content}</span>
    </div>
  );
  if (transaction?.refundOfTransactionId)
    return label
      ? slot(<span className={styles.shareStatic}>{label}</span>)
      : null;
  const button = (
    <button
      type="button"
      className={styles.shareButton}
      data-empty={!label || undefined}
      aria-label={
        total
          ? `${who(total)}'s share of ${payee}: ${money(total.amount)}. Change`
          : `Share ${payee}`
      }
      onClick={
        lines.length > 1
          ? () =>
              entry.start({
                transactionId,
                field: lineField(lines[0]!.id, "counterpartyShare"),
              })
          : undefined
      }
    >
      {label ?? (
        <>
          <PlusIcon size={12} aria-hidden />
          Share
        </>
      )}
    </button>
  );
  if (lines.length > 1) return slot(button);
  const line = lines[0]!;
  return slot(
    <ShareMenu
      amount={Math.abs(line.amount)}
      share={line.counterpartyShare}
      saved={line.counterpartyShare}
      onChange={(share) => {
        // Imports resolve through the editor, with the share already set.
        if (row.source === "bank")
          return entry.start({
            transactionId,
            field: line.categoryId ? "counterpartyShare" : "categoryId",
            counterpartyShare: share,
          })
            ? null
            : "Save or cancel the open transaction first.";
        return entry.saveShare(
          transactionId,
          line.id,
          share,
          shareNotice(who, payee, line.counterpartyShare, share),
        );
      }}
    >
      {button}
    </ShareMenu>,
  );
}

// A shared entry, opened under its selected row: what's shared, the share
// itself, and every change to it.
export function ShareDetail({ transactionId }: { transactionId: string }) {
  const parties = useShareParties();
  const { view, who } = parties;
  const transaction = view.budget.transactions.find(
    (item) => item.id === transactionId,
  );
  if (!transaction || !canShare(view, transaction)) return null;
  const lines = counterpartyLines(transaction).filter(
    (line) => line.counterpartyShare,
  );
  const history = shareHistory(parties, transaction);
  if (!lines.length && !history.length) return null;
  const shared = lines.reduce((sum, line) => sum + Math.abs(line.amount), 0);
  const theirs = lines.reduce(
    (sum, line) => sum + line.counterpartyShare!.amount,
    0,
  );
  const total = shareTotal(who, transaction);
  const name = total
    ? who(total)
    : lines[0] && who(lines[0].counterpartyShare!);
  const refund = transaction.amount > 0;
  const original =
    transaction.refundOfTransactionId &&
    view.budget.transactions.find(
      (item) => item.id === transaction.refundOfTransactionId,
    );
  return (
    <div
      className={styles.detail}
      // The register moves its selection with the arrow keys; in here they
      // belong to the fields.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className={styles.detailMain}>
        {lines.length > 0 && name && (
          <dl className={styles.facts}>
            <div>
              <dt>{refund ? "Refunded" : "Shared"}</dt>
              <dd>{money(shared)}</dd>
            </div>
            <div>
              <dt>You</dt>
              <dd>{money(shared - theirs)}</dd>
            </div>
            <div>
              <dt>{name}</dt>
              <dd>{money(theirs)}</dd>
            </div>
            <div>
              <dt>{refund ? `Back to ${name}` : `${name} owes you`}</dt>
              <dd>{money(theirs)}</dd>
            </div>
          </dl>
        )}
        {original ? (
          <p className={styles.formHint}>
            This refund&rsquo;s share follows {original.payee} on{" "}
            {original.date}, in proportion to the amount refunded.
          </p>
        ) : (
          lines.map((line) => (
            <ShareEditor
              key={`${line.id}-${line.counterpartyShare!.amount}`}
              transactionId={transaction.id}
              payee={transaction.payee}
              line={line}
              category={
                lines.length > 1 || transaction.lines
                  ? view.categories.find((item) => item.id === line.categoryId)
                      ?.name
                  : undefined
              }
            />
          ))
        )}
      </div>
      {history.length > 0 && (
        <div className={styles.history}>
          <h3>
            <HistoryIcon size={13} aria-hidden />
            History
          </h3>
          <ol>
            {history.map((change, index) => (
              <li key={index}>
                <span className={shell.faint}>
                  {change.when} · {change.by}
                </span>
                <span>{change.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ShareEditor({
  transactionId,
  payee,
  line,
  category,
}: {
  transactionId: string;
  payee: string;
  line: TransactionLine;
  // The line's category, when the transaction has more than one line.
  category?: string;
}) {
  const id = useId();
  const entry = useTransactionEntry();
  const { who } = useShareParties();
  const share = line.counterpartyShare!;
  const amount = Math.abs(line.amount);
  const [text, setText] = useState((share.amount / 100).toFixed(2));
  const [error, setError] = useState("");
  const apply = (cents: number) => {
    const next = { ...share, amount: cents };
    const failure = entry.saveShare(
      transactionId,
      line.id,
      next,
      cents === 0
        ? `Wrote off the share of ${payee}.`
        : shareNotice(who, payee, share, next),
    );
    if (failure) setError(failure);
    else {
      setError("");
      setText((cents / 100).toFixed(2));
    }
  };
  return (
    <form
      className={styles.detailField}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const cents = parseCents(text);
        if (cents === null) return setError("Enter an amount, like 24.50.");
        if (cents > amount)
          return setError(`A share can be at most ${money(amount)}.`);
        apply(cents);
      }}
    >
      <label htmlFor={id}>
        {who(share)}&rsquo;s share
        {category && ` · ${category}`}
      </label>
      <div className={styles.shareEdit}>
        <AmountWell
          id={id}
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
        <Button size="sm" variant="quiet" onClick={() => apply(halfOf(amount))}>
          Split evenly
        </Button>
        <Button
          size="sm"
          variant="quiet"
          disabled={share.amount === 0}
          onClick={() => apply(0)}
        >
          Write off
        </Button>
      </div>
      {error && <p className={moveStyles.error}>{error}</p>}
      <p className={styles.formHint}>
        {share.counterpartyName
          ? "Tracked in your Reimbursements account. Only you see it. Changes stay in the entry’s history."
          : "Changes apply to both budgets at once and stay in the entry’s history."}
      </p>
    </form>
  );
}

// Each recorded change to a line's share, oldest first, in words.
function shareHistory(
  { view, partner, who }: ReturnType<typeof useShareParties>,
  transaction: BudgetTransaction,
) {
  const day = (at: string) =>
    new Date(at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: view.budget.settings.timezone,
    });
  return transaction.history.flatMap((entry) =>
    (entry.shareChanges ?? []).map((change) => ({
      when: entry.at ? day(entry.at) : transaction.date,
      by:
        !entry.actorId || entry.actorId === view.budget.userId
          ? "You"
          : (partner?.name ?? "Your partner"),
      text: describeShareChange(who, transaction, change),
    })),
  );
}

function describeShareChange(
  who: Who,
  transaction: BudgetTransaction,
  {
    lineId,
    previous,
    next,
  }: {
    lineId: string;
    previous: CounterpartyShare | null;
    next: CounterpartyShare | null;
  },
) {
  const was = previous?.amount ?? 0;
  const now = next?.amount ?? 0;
  if (previous && was > 0 && now === 0)
    return `Changed ${who(previous)}'s share from ${money(was)} to $0.00 (written off)`;
  if (!was && next && now > 0) {
    const line = shareLines(transaction).find((item) => item.id === lineId);
    return line && !next.counterpartyName && now === halfOf(line.amount)
      ? `Split with ${who(next)} 50/50`
      : `Shared ${money(now)} with ${who(next)}`;
  }
  if (previous && !next) return `Removed ${who(previous)}'s share`;
  if (
    previous &&
    next &&
    (previous.accountId !== next.accountId ||
      previous.counterpartyName !== next.counterpartyName)
  )
    return `Moved the share from ${who(previous)} to ${who(next)} (${money(now)})`;
  return `Changed ${who(next ?? previous!)}'s share from ${money(was)} to ${money(now)}`;
}
