"use client";

import { useState } from "react";
import type { DraftShare } from "~/components/transactions/transaction-draft";
import { Button } from "~/components/ui/button";
import { useTransactionEntry } from "./transaction-entry";
import { ChoiceField } from "./transaction-fields";
import styles from "./transaction-entry.module.css";

export function ShareField({
  id,
  value,
  total,
  onChange,
  inputRef,
}: {
  id: string;
  inputRef?: (element: HTMLInputElement | null) => void;
  value?: DraftShare | null;
  total: number;
  onChange: (share: DraftShare | null) => void;
}) {
  const { view } = useTransactionEntry();
  const [writeoff, setWriteoff] = useState(false);
  const accounts = view.accounts.filter(
    (item) => item.kind === "partner" || item.kind === "reimbursements",
  );
  return (
    <div className={styles.shareFields}>
      <ChoiceField
        id={id}
        label="Share with"
        inputRef={inputRef}
        value={value?.accountId ?? ""}
        options={[
          { value: "", label: "Just me" },
          ...accounts.map((item) => ({ value: item.id, label: item.name })),
        ]}
        placeholder="Just me"
        onChange={(accountId) =>
          onChange(
            accountId
              ? {
                  ...value,
                  accountId,
                  amount:
                    value?.amount ??
                    (Math.round(Math.abs(total) / 2) / 100).toFixed(2),
                }
              : null,
          )
        }
      />
      {value && (
        <>
          {value.accountId === "counterparty:reimbursements" && (
            <label className={styles.shareLabel}>
              Person or organization
              <div className={styles.well}>
                <input
                  className={styles.input}
                  value={value.counterpartyName ?? ""}
                  autoComplete="off"
                  placeholder="Name"
                  onChange={(event) =>
                    onChange({ ...value, counterpartyName: event.target.value })
                  }
                />
              </div>
            </label>
          )}
          <label className={styles.shareLabel}>
            Their share
            <div className={styles.well} data-amount>
              <span aria-hidden>$</span>
              <input
                className={styles.input}
                inputMode="decimal"
                value={value.amount}
                onChange={(event) =>
                  onChange({ ...value, amount: event.target.value })
                }
              />
            </div>
          </label>
          <div>
            <Button
              variant="quiet"
              size="sm"
              onClick={() =>
                onChange({
                  ...value,
                  amount: (Math.round(Math.abs(total) / 2) / 100).toFixed(2),
                })
              }
            >
              Half
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setWriteoff(true)}>
              Write off
            </Button>
          </div>
          {writeoff && (
            <div role="group" aria-label="Review writeoff">
              <p className={styles.shareLabel}>
                Their share will become $0. You take on this cost. Save the
                transaction to apply it.
              </p>
              <Button size="sm" onClick={() => setWriteoff(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onChange({ ...value, amount: "0.00" });
                  setWriteoff(false);
                }}
              >
                Set share to $0
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
