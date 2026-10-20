"use client";

import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import type { State } from "~/components/budget/types";
import { FormField, SelectField } from "~/components/shared";

export function BankImportReview({
  state,
  item,
  onResolved,
}: {
  state: State;
  item: State["imports"][number];
  onResolved: () => void;
}) {
  const [error, setError] = useState("");
  const [categoryError, setCategoryError] = useState(false);
  const [existingTransactionId, setExistingTransactionId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const categoryErrorId = useId();
  const utils = api.useUtils();
  const refresh = () => utils.budget.state.invalidate();
  const map = api.budget.mapBankAccount.useMutation({
    onSuccess: refresh,
    onError: (failure) => setError(failure.message),
  });
  const resolve = api.budget.resolveImport.useMutation({
    onSuccess: async () => {
      await refresh();
      onResolved();
    },
    onError: (failure) => setError(failure.message),
  });
  const view = state.view!;
  const busy = map.isPending || resolve.isPending;

  return (
    <div className="bank-import-review stack">
      {item.removed && (
        <p className="field-hint">
          This imported record is no longer in the latest bank data. This does
          not confirm a cancellation or refund. Compare it with your account
          activity before dismissing this update.
        </p>
      )}
      {item.needsMatchReview && (
        <p className="field-hint">
          Check whether this matches a transaction you already recorded.
        </p>
      )}
      {item.error && <p className="form-error">! {item.error}</p>}
      {error && (
        <p className="form-error" role="alert">
          ! {error}
        </p>
      )}
      {!item.accountId ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setError("");
            const data = new FormData(event.currentTarget);
            map.mutate({
              connectionId: item.connectionId,
              providerAccountId: item.providerAccountId,
              accountId: formText(data, "accountId"),
              startDate: formText(data, "startDate"),
            });
          }}
        >
          <p className="field-hint">
            Choose the budget account for this bank activity. Start importing
            after its opening balance date to avoid counting that balance twice.
          </p>
          <div className="stack">
            <SelectField
              name="accountId"
              label="Your budget account"
              defaultValue=""
              required
              disabled={busy}
            >
              <option value="" disabled>
                Choose account
              </option>
              {view.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </SelectField>
            <FormField
              name="startDate"
              label="Import activity beginning"
              type="date"
              required
              disabled={busy}
            />
            <Button disabled={busy || !view.accounts.length} type="submit">
              {map.isPending ? "Connecting…" : "Connect account"}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setError("");
            if (!existingTransactionId && item.amount < 0 && !categoryId) {
              setCategoryError(true);
              return;
            }
            resolve.mutate({
              connectionId: item.connectionId,
              logicalId: item.logicalId,
              expectedRevision: state.revision,
              existingTransactionId: existingTransactionId || undefined,
              command: existingTransactionId
                ? undefined
                : {
                    type: "transaction.upsert",
                    id: crypto.randomUUID(),
                    transactionId: crypto.randomUUID(),
                    accountId: item.accountId!,
                    date: item.date,
                    amount: item.amount,
                    payee: item.payee,
                    categoryId: categoryId || undefined,
                    status: item.pending ? "pending" : "posted",
                    reviewed: false,
                  },
            });
          }}
        >
          <SelectField
            name="existingTransactionId"
            label="Already recorded?"
            value={existingTransactionId}
            disabled={busy}
            onChange={(event) => {
              setExistingTransactionId(event.target.value);
              setCategoryError(false);
              setError("");
            }}
          >
            <option value="">Add a new transaction</option>
            {view.budget.transactions
              .filter(
                (transaction) =>
                  !transaction.removed &&
                  transaction.accountId === item.accountId &&
                  transaction.date === item.date &&
                  transaction.amount === item.amount,
              )
              .map((transaction) => (
                <option key={transaction.id} value={transaction.id}>
                  {transaction.payee} · {transaction.kind}
                </option>
              ))}
          </SelectField>
          {!existingTransactionId && (
            <div>
              <SelectField
                name="categoryId"
                label="Category"
                value={categoryId}
                disabled={busy}
                aria-invalid={categoryError || undefined}
                aria-describedby={categoryError ? categoryErrorId : undefined}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  setCategoryError(false);
                  setError("");
                }}
              >
                <option value="">
                  {item.amount > 0 ? "Ready to Assign" : "Choose category"}
                </option>
                {view.categories
                  .filter(
                    (category) =>
                      !category.pairedAccountId && !category.pairedLoanId,
                  )
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </SelectField>
              {categoryError && (
                <p id={categoryErrorId} className="form-error" role="alert">
                  ! Choose a category or match an existing transaction.
                </p>
              )}
            </div>
          )}
          <details className="small muted">
            <summary>Reviewing a payment?</summary>
            <p className="field-hint">
              For card, loan, or partner payments, record the dedicated payment
              first, then match it here. Matches require the same account, date,
              and amount.
            </p>
          </details>
          <Button disabled={busy || item.removed} type="submit">
            {resolve.isPending ? "Saving…" : "Confirm bank activity"}
          </Button>
        </form>
      )}
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setError("");
          resolve.mutate({
            connectionId: item.connectionId,
            logicalId: item.logicalId,
            expectedRevision: state.revision,
            ignore: true,
          });
        }}
      >
        Ignore this bank transaction
      </Button>
      <details>
        <summary className="small muted">
          Bank update history · {item.history.length}{" "}
          {item.history.length === 1 ? "record" : "records"}
        </summary>
        <p className="field-hint">
          Pending-to-posted changes stay linked when the bank establishes the
          match.
        </p>
        <ul className="audit-list">
          {item.history.map((entry, index) => (
            <li key={index}>
              <span>{entry.kind}</span>
              <span className="muted">Bank update {index + 1}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function formText(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
