"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { money, type Account } from "./model";
import {
  ReconcilePopover,
  reconciledLabel,
  type Reconciling,
} from "./reconcile";
import { useShellData } from "./shell-data";
import styles from "./shell.module.css";

// YNAB's balance equation: what the bank has cleared, plus what is still
// pending, is the balance the budget works with. One account's summary also
// reconciles it.
export function AccountSummary({
  accounts,
  account,
  reconciling,
}: {
  accounts: Account[];
  account?: Account;
  reconciling: Reconciling;
}) {
  const { today } = useShellData();
  const working = accounts.reduce((sum, item) => sum + item.balance, 0);
  const uncleared = accounts.reduce((sum, item) => sum + item.pending, 0);
  return (
    <div className={styles.accountSummary}>
      <dl className={styles.balances}>
        <div>
          <dt>Cleared</dt>
          <dd>{money(working - uncleared)}</dd>
        </div>
        <span className={styles.balanceOperator} aria-hidden>
          +
        </span>
        <div>
          <dt>Uncleared</dt>
          <dd>{money(uncleared)}</dd>
        </div>
        <span className={styles.balanceOperator} aria-hidden>
          =
        </span>
        <div data-total>
          <dt>Working balance</dt>
          <dd>{money(working)}</dd>
        </div>
      </dl>
      {/* Reconciling compares one account with one bank statement. */}
      {account && (
        <div className={styles.summaryActions}>
          <span className={styles.reconciledLabel}>
            {reconciledLabel(account, today)}
          </span>
          <ReconcilePopover account={account} reconciling={reconciling}>
            <Button size="sm">Reconcile</Button>
          </ReconcilePopover>
        </div>
      )}
    </div>
  );
}

// "/" focuses the field, like Linear; Escape clears it and leaves.
export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
      )
        return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <label className={styles.toolbarSearch}>
      <SearchIcon size={13} className={styles.searchIcon} aria-hidden />
      <input
        ref={input}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-keyshortcuts="/"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          onChange("");
          event.currentTarget.blur();
        }}
      />
      {value ? (
        <IconButton size="sm" label="Clear search" onClick={() => onChange("")}>
          <XIcon aria-hidden />
        </IconButton>
      ) : (
        <kbd className={styles.searchKey} aria-hidden>
          /
        </kbd>
      )}
    </label>
  );
}
