"use client";

import {
  CircleCheckIcon,
  LandmarkIcon,
  Link2Icon,
  PencilLineIcon,
  TagIcon,
  Unlink2Icon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  accountName,
  accounts,
  day,
  money,
  time,
  type HistoryEvent,
  type Transaction,
} from "./data";
import styles from "./batch-5.module.css";

const icons: Record<HistoryEvent["kind"], LucideIcon> = {
  imported: LandmarkIcon,
  posted: LandmarkIcon,
  date: LandmarkIcon,
  amount: LandmarkIcon,
  entered: PencilLineIcon,
  renamed: PencilLineIcon,
  categorized: TagIcon,
  approved: CircleCheckIcon,
  matched: Link2Icon,
  unmatched: Unlink2Icon,
};

// Every change to one transaction, oldest first so it reads as its story.
// Like YNAB's Bank Import Details, the name the bank sent leads, since it's
// what a renamed payee was renamed from.
export function TransactionHistory({
  transaction,
  onUnmatch,
}: {
  transaction: Transaction;
  onUnmatch?: () => void;
}) {
  const institution = accounts.find(
    (item) => item.id === transaction.accountId,
  )!.institution;
  const { matched } = transaction;
  return (
    <div className={styles.history}>
      {(transaction.bankPayee ?? matched) && (
        <dl className={styles.provenance}>
          {transaction.bankPayee && (
            <div>
              <dt>As {institution} sent it</dt>
              <dd className={styles.bankName}>{transaction.bankPayee}</dd>
            </div>
          )}
          {matched && (
            <div>
              <dt>Matched</dt>
              <dd className={styles.matchLine}>
                <span>
                  {matched.automatic ? "Automatically, with" : "With"} the{" "}
                  {day(matched.bankDate)} import from{" "}
                  {accountName(transaction.accountId)}
                  {matched.enteredAmount !== matched.bankAmount &&
                    `. The bank’s ${money(-matched.bankAmount)} replaced your ${money(-matched.enteredAmount)}`}
                </span>
                {onUnmatch && (
                  <Button variant="quiet" size="sm" onClick={onUnmatch}>
                    <Unlink2Icon aria-hidden />
                    Unmatch
                  </Button>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}
      {transaction.history.length > 0 ? (
        <ol className={styles.timeline} aria-label="Changes">
          {[...transaction.history]
            .sort((a, b) => a.at.localeCompare(b.at))
            .map((event) => {
              const Icon = icons[event.kind];
              return (
                <li key={event.id} className={styles.event}>
                  <span className={styles.eventIcon} data-actor={event.actor}>
                    <Icon size={13} aria-hidden />
                  </span>
                  <span className={styles.eventText}>
                    <span>{event.text}</span>
                    {(event.from ?? event.to) && (
                      <span className={styles.diff}>
                        {event.from && (
                          <del className={styles.before}>{event.from}</del>
                        )}
                        {event.from && event.to && (
                          <span aria-hidden className={styles.arrow}>
                            →
                          </span>
                        )}
                        {event.to && (
                          <ins className={styles.after}>{event.to}</ins>
                        )}
                      </span>
                    )}
                  </span>
                  <time className={styles.eventTime} dateTime={event.at}>
                    {day(event.at)}, {time(event.at)}
                  </time>
                </li>
              );
            })}
        </ol>
      ) : (
        <p className={styles.historyEmpty}>No changes since it arrived.</p>
      )}
    </div>
  );
}
