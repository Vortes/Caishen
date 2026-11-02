"use client";

import { PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readAmount, sameAmount } from "~/components/budget/amount";
import { newId, today } from "~/components/budget/format";
import { AmountInput } from "~/components/ui/amount-input";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import { Field, FormError } from "~/components/ui/field";
import { Popover } from "~/components/ui/popover";
import { SearchList } from "~/components/ui/search-list";
import { money, type Account } from "./model";
import moveStyles from "./move-money.module.css";
import { useShellData } from "./shell-data";
import { useTransactionEntry } from "./transaction-entry";
import local from "./person-register.module.css";

// Money a person paid back, into one of your cash accounts. It's recorded
// here, by hand, and the bank import matches it later. The partner pays
// through both budgets' imports instead, so this is for everyone else.
export function RecordRepayment({ account }: { account: Account }) {
  const { view, saveCommand } = useTransactionEntry();
  const { accounts } = useShellData();
  const cash = accounts.filter((item) => item.kind === "cash");
  const timezone = view.budget.settings.timezone;
  const owed = account.balance;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<{
    field?: "amount" | "cash";
    message: string;
  } | null>(null);
  // Who paid is known, so the amount takes focus as the form opens: it's
  // what's left to check.
  const amountInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) amountInput.current?.focus();
  }, [open]);
  return (
    <Popover
      label={`Record a repayment from ${account.name}`}
      trigger={
        <Button size="sm" disabled={owed <= 0}>
          <PlusIcon aria-hidden />
          Record repayment
        </Button>
      }
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setAmount(owed > 0 ? (owed / 100).toFixed(2) : "");
        setCashAccountId(cash.length === 1 ? cash[0]!.id : "");
        setDate(today(timezone));
        setError(null);
      }}
      align="end"
      size="form"
      arrow
      autoFocus={false}
    >
      <form
        className={moveStyles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const reading = readAmount(amount);
          if (amount.trim() && !reading.ok)
            return setError({ field: "amount", message: reading.message });
          const cents = reading.ok ? reading.cents : 0;
          if (!(cents > 0))
            return setError({
              field: "amount",
              message: "Enter the amount, like 412.00.",
            });
          if (cents > owed)
            return setError({
              field: "amount",
              message: `${account.name} owes you ${money(owed)}. Enter that much or less.`,
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
              recordedAt: new Date().toISOString(),
            },
            `Recorded ${money(cents)} from ${account.name}`,
          );
          if (failure) return setError({ message: failure });
          setOpen(false);
        }}
      >
        <div className={moveStyles.header}>
          <strong>Repayment from {account.name}</strong>
          <span className={moveStyles.balance}>{money(owed)} owed</span>
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
            hint={`It lowers what ${account.name} owes and refills your ${account.name} envelope. It isn’t income, so Ready to Assign doesn’t change.`}
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
