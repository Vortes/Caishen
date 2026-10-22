"use client";

import { useId, useState } from "react";
import { newId, today } from "~/components/budget/format";
import { counterpartyRegisterEntries } from "~/domain/counterparty";
import { Button } from "~/components/ui/button";
import { TransactionEditor } from "./transaction-form";
import { useTransactionEntry } from "./transaction-entry";
import { ChoiceField } from "./transaction-fields";
import { money, type Account } from "./model";
import shell from "./shell.module.css";
import styles from "./transaction-entry.module.css";
import local from "./reimbursements-register.module.css";

export function CounterpartyRegister({
  account,
  query,
}: {
  account: Account;
  query: string;
}) {
  const { view, saveCommand, session, start } = useTransactionEntry();
  const [name, setName] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [cashAccountId, setCashAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => today(view.budget.settings.timezone));
  const [error, setError] = useState("");
  const formId = useId();
  const cash = view.accounts.filter((item) => item.kind === "cash");
  const entries = counterpartyRegisterEntries(view.budget, {
    accountId: account.id,
  })
    .map((entry) => {
      const transaction = view.budget.transactions.find(
        (item) => item.id === entry.transactionId,
      );
      const categoryId =
        transaction?.lines?.find((line) => line.id === entry.lineId)
          ?.categoryId ?? transaction?.categoryId;
      return {
        ...entry,
        name: entry.counterpartyName ?? account.name,
        category:
          entry.kind === "repayment"
            ? account.name
            : (view.categories.find((item) => item.id === categoryId)?.name ??
              ""),
        receipt: entry.kind === "repayment",
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const names = [...new Set(entries.map((item) => item.name))].sort();
  const rows = entries.filter(
    (item) =>
      (!name || item.name === name) &&
      (!query.trim() ||
        `${item.payee} ${item.name} ${item.category}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );
  const balance = rows.reduce((sum, item) => sum + item.amount, 0);
  return (
    <div className={`${local.register} ${shell.register}`} data-accounts>
      {session && <TransactionEditor accountColumn />}
      <div className={local.toolbar}>
        <div className={local.filter}>
          <ChoiceField
            id={`${formId}-filter`}
            label="Person or organization"
            value={name}
            options={[
              { value: "", label: "Everyone" },
              ...names.map((value) => ({ value, label: value })),
            ]}
            placeholder="Everyone"
            onChange={setName}
          />
        </div>
        <span className={shell.muted}>
          {money(Math.abs(balance))} {balance < 0 ? "you owe" : "outstanding"}
        </span>
        <Button
          size="sm"
          onClick={() => {
            setReceiving(true);
            if (!name && names.length === 1) setName(names[0]!);
            setAmount(balance > 0 ? (balance / 100).toFixed(2) : "");
          }}
        >
          Receive repayment
        </Button>
      </div>
      {receiving && (
        <form
          className={local.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
              setError(
                "Enter a repayment greater than $0 with no more than two decimal places.",
              );
              return;
            }
            if (account.kind === "reimbursements" && !name) {
              setError("Choose the person or organization that repaid you.");
              return;
            }
            if (!cashAccountId) {
              setError("Choose the cash account that received the money.");
              return;
            }
            const failure = saveCommand(
              {
                type: "counterparty.receive",
                id: newId(),
                counterpartyAccountId: account.id,
                cashAccountId,
                date,
                amount: Math.round(Number(amount) * 100),
                counterpartyName: name || undefined,
              },
              "Received repayment",
            );
            if (failure) setError(failure);
            else {
              setReceiving(false);
              setError("");
            }
          }}
        >
          <h2>Receive repayment</h2>
          <p className={shell.muted}>
            Repayments reduce what is owed and restore your {account.name}{" "}
            envelope.
          </p>
          <div>
            <label htmlFor={`${formId}-person`}>Person or organization</label>
            <ChoiceField
              id={`${formId}-person`}
              label="Person or organization"
              value={name}
              options={names.map((value) => ({ value, label: value }))}
              placeholder="Everyone"
              onChange={setName}
            />
          </div>
          <div>
            <label htmlFor={`${formId}-cash`}>Received in</label>
            <ChoiceField
              id={`${formId}-cash`}
              label="Received in"
              value={cashAccountId}
              options={cash.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              placeholder="Choose cash account"
              onChange={setCashAccountId}
            />
          </div>
          <label>
            Date
            <div className={styles.well}>
              <input
                className={styles.input}
                type="date"
                required
                value={date}
                max={today(view.budget.settings.timezone)}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </label>
          <label>
            Amount
            <div className={styles.well}>
              <span aria-hidden>$</span>
              <input
                className={styles.input}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          </label>
          {error && (
            <p className={styles.fieldError} role="alert">
              {error}
            </p>
          )}
          <div className={local.actions}>
            <Button size="sm" onClick={() => setReceiving(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit">
              Receive repayment
            </Button>
          </div>
        </form>
      )}
      <div className={local.header} aria-hidden>
        <span>Date</span>
        <span>Payee</span>
        <span>Person or organization</span>
        <span>Category</span>
        <span>Owed</span>
      </div>
      {rows.map((item) => (
        <div className={local.row} key={item.id}>
          <span className={shell.muted}>{item.date}</span>
          <span>{item.payee}</span>
          <span>{item.name}</span>
          <span className={shell.muted}>{item.category}</span>
          <span className={shell.numeric}>
            {item.amount < 0 ? "−" : ""}
            {money(Math.abs(item.amount))}
          </span>
          {!item.receipt && (
            <details className={local.entryActions}>
              <summary>Expense details</summary>
              <div className={local.actions}>
                <Button
                  size="sm"
                  onClick={() =>
                    start({
                      transactionId: item.transactionId,
                      field: "counterpartyShare",
                    })
                  }
                >
                  Edit share
                </Button>
                {item.kind === "share" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      start({
                        accountId: view.budget.transactions.find(
                          (transaction) =>
                            transaction.id === item.transactionId,
                        )?.accountId,
                        refundOfTransactionId: item.transactionId,
                        field: "inflow",
                      })
                    }
                  >
                    Refund
                  </Button>
                )}
              </div>
            </details>
          )}
        </div>
      ))}
      {!rows.length && (
        <p className={local.empty}>
          No shares here yet. Add a share to an expense to track what someone
          owes you.
        </p>
      )}
    </div>
  );
}
