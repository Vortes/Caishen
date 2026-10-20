"use client";

import { Popover } from "radix-ui";
import type { SpendingEntry } from "~/domain/spending";
import { money, shortDay } from "../model";
import { useShellData } from "../shell-data";
import { Button } from "~/components/ui/button";
import { usePortalContainer } from "~/components/ui/tooltip";
import shell from "../shell.module.css";
import { seriesColor } from "./chart-utils";
import type { ChartItem } from "./report";
import styles from "./reflect.module.css";

// YNAB's slice popover: the slice's transactions where you clicked. Your own
// open in their account's register; a partner's shared purchases aren't in
// your register, so they're listed but not openable.
export function SlicePopover({
  item,
  entries,
  onOpenEntry,
  onDrill,
}: {
  item: ChartItem;
  entries: SpendingEntry[];
  onOpenEntry: (entry: SpendingEntry) => void;
  onDrill?: () => void;
}) {
  const container = usePortalContainer();
  const { accounts, partner } = useShellData();
  const accountName = (entry: SpendingEntry) =>
    entry.paidByYou
      ? (accounts.find((account) => account.id === entry.accountId)?.name ??
        "Account")
      : `Paid by ${partner?.name ?? "your partner"}`;
  return (
    <Popover.Portal container={container}>
      <Popover.Content
        className={`${styles.popover} ${styles.slicePopover}`}
        side="top"
        sideOffset={12}
        collisionPadding={12}
        aria-label={`${item.name} transactions`}
      >
        <div className={styles.sliceHeader}>
          <span
            className={styles.sliceSwatch}
            style={{ background: seriesColor(item.slot) }}
            aria-hidden
          />
          <strong className={shell.truncate}>{item.name}</strong>
          <span>
            {entries.length}{" "}
            {entries.length === 1 ? "transaction" : "transactions"} ·{" "}
            {money(item.total)}
          </span>
        </div>
        <div
          className={styles.sliceTable}
          role="group"
          aria-label="Transactions"
        >
          <div className={styles.sliceRows}>
            <div className={styles.sliceColumns} data-header aria-hidden>
              <span>Account</span>
              <span>Date</span>
              <span>Payee</span>
              <span>Amount</span>
            </div>
            {entries.map((entry) => {
              const cells = (
                <>
                  <span className={shell.truncate}>{accountName(entry)}</span>
                  <span>{shortDay(entry.date)}</span>
                  <span className={shell.truncate} title={entry.payee}>
                    {entry.payee}
                  </span>
                  <span data-inflow={entry.amount < 0 || undefined}>
                    {money(-entry.amount, true)}
                  </span>
                </>
              );
              return entry.paidByYou ? (
                <button
                  type="button"
                  key={entry.id}
                  className={styles.sliceColumns}
                  title="Open in its account"
                  onClick={() => onOpenEntry(entry)}
                >
                  {cells}
                </button>
              ) : (
                <div key={entry.id} className={styles.sliceColumns} data-static>
                  {cells}
                </div>
              );
            })}
          </div>
        </div>
        <div className={styles.popoverFooter}>
          {onDrill && (
            <Button variant="quiet" size="sm" onClick={onDrill}>
              Show categories
            </Button>
          )}
          <Popover.Close asChild>
            <Button size="sm">Close</Button>
          </Popover.Close>
        </div>
        <Popover.Arrow className={styles.popoverArrow} width={14} height={7} />
      </Popover.Content>
    </Popover.Portal>
  );
}
