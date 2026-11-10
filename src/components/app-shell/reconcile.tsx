"use client";

import { CheckIcon, LandmarkIcon, WalletIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { readAmount } from "~/components/budget/amount";
import { newId } from "~/components/budget/format";
import { AmountInput } from "~/components/ui/amount-input";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Popover } from "~/components/ui/popover";
import type { Command } from "~/domain/engine";
import { reviewImportsBeforeReconciliation } from "~/domain/bank-import-balances";
import { money, type Account } from "./model";
import { useShellData } from "./shell-data";
import styles from "./reconcile.module.css";
import { PopoverSteps } from "./popover-steps";

export type Reconciling = {
  // Sends the reconciliation with a summary for its confirmation. Returns
  // why it can't be sent right now, or null once it's on its way.
  reconcile: (command: Command, summary: string) => string | null;
  // Called with a cleanup while the popover is open, so the shell can hold
  // its undo shortcut until it closes.
  holdOpen: () => () => void;
};

const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

// "Reconciled today", "Reconciled 3 days ago", like YNAB's timestamp under
// the account name.
export function reconciledLabel(account: Account, today: string) {
  if (!account.reconciled) return "Never reconciled";
  const days = Math.round(
    (Date.parse(account.reconciled.date) - Date.parse(today)) / 86_400_000,
  );
  return `Reconciled ${relative.format(days, "day")}`;
}

// YNAB's reconcile popover: the bank's cleared balance over Caishen's, joined
// by whether they match. Confirming locks every cleared transaction; a
// difference is fixed in the register or by an adjustment the user asks for.
export function ReconcilePopover({
  account,
  reconciling,
  children,
}: {
  account: Account;
  reconciling: Reconciling;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const { holdOpen } = reconciling;
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  return (
    <Popover
      label={`Reconcile ${account.name}`}
      trigger={children}
      open={open}
      onOpenChange={setOpen}
      align="end"
      size="form"
      arrow
    >
      <ReconcileForm
        account={account}
        reconcile={reconciling.reconcile}
        onDone={() => setOpen(false)}
      />
    </Popover>
  );
}

type Step = "ask" | "enter" | "result";

function ReconcileForm({
  account,
  reconcile,
  onDone,
}: {
  account: Account;
  reconcile: Reconciling["reconcile"];
  onDone: () => void;
}) {
  const { transactions, today } = useShellData();
  const [step, setStep] = useState<Step>("ask");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const messageId = useId();
  // A result takes focus on itself, not a button: a second Enter can't commit
  // an adjustment unseen, no button lights up, and the verdict is read out.
  const resultRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (step === "result") resultRef.current?.focus({ preventScroll: true });
  }, [step]);
  const unlocked = transactions.filter(
    (item) =>
      item.accountId === account.id &&
      item.source === "budget" &&
      item.cleared &&
      !item.reconciled,
  ).length;
  const locks = `${unlocked} cleared ${unlocked === 1 ? "transaction" : "transactions"}`;
  const reading = readAmount(text);
  const bank = reading.ok ? reading.cents : NaN;
  const valid = reading.ok;
  const difference = valid ? bank - account.cleared : 0;

  const go = (next: Step) => {
    setStep(next);
    setError("");
  };
  const finish = (balance: number) => {
    if (account.importReviewRequired) {
      setError(reviewImportsBeforeReconciliation);
      return;
    }
    const adjust = balance !== account.cleared;
    const command = {
      type: "account.reconcile" as const,
      id: newId(),
      accountId: account.id,
      date: today,
      balance,
      ...(adjust ? { adjustmentId: newId() } : {}),
    };
    const reason = reconcile(
      command,
      adjust
        ? `Reconciled ${account.name} with a ${money(balance - account.cleared, true)} adjustment`
        : `Reconciled ${account.name}`,
    );
    if (reason) setError(reason);
    else onDone();
  };

  return (
    <PopoverSteps step={step}>
      <form
        ref={step === "result" ? resultRef : undefined}
        tabIndex={step === "result" ? -1 : undefined}
        aria-label={step === "result" ? "Reconcile result" : undefined}
        aria-describedby={step === "result" ? messageId : undefined}
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (step === "ask") finish(account.cleared);
          else if (step === "enter") {
            if (valid) go("result");
          } else finish(bank);
        }}
      >
        {step === "enter" ? (
          <EnterBalance text={text} onChange={setText} />
        ) : (
          <Comparison
            account={account}
            bank={step === "result" ? bank : undefined}
            difference={difference}
            locks={locks}
            error={error}
            messageId={messageId}
          />
        )}
        <Actions
          step={step}
          valid={valid}
          adjust={step === "result" && difference !== 0}
          onBack={() => go(step === "result" ? "enter" : "ask")}
          onEnter={() => go("enter")}
        />
      </form>
    </PopoverSteps>
  );
}

// The simple form, like YNAB's: one field for the bank's figure.
function EnterBalance({
  text,
  onChange,
}: {
  text: string;
  onChange: (text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <Field
      label="Current balance at your bank"
      hint="Banks often call it the current balance. It leaves out pending transactions."
    >
      <AmountInput
        inputRef={input}
        placeholder="0.00"
        value={text}
        onChange={onChange}
      />
    </Field>
  );
}

// The bank's cleared balance over Caishen's, joined by whether they agree.
function Comparison({
  account,
  bank,
  difference,
  locks,
  error,
  messageId,
}: {
  account: Account;
  bank?: number;
  difference: number;
  locks: string;
  error: string;
  messageId: string;
}) {
  const state = bank === undefined ? "asking" : difference ? "off" : "matched";
  return (
    <>
      <div className={styles.balances} data-state={state}>
        <div className={styles.balance}>
          <span className={styles.icon}>
            <LandmarkIcon size={15} aria-hidden />
          </span>
          <div className={styles.figure}>
            <strong data-unknown={bank === undefined || undefined}>
              {bank === undefined ? "?" : money(bank)}
            </strong>
            <span>Bank’s cleared balance</span>
          </div>
        </div>
        {/* Where the rows meet: whether the two balances agree. */}
        <span className={styles.join} aria-hidden>
          {state === "matched" ? (
            <CheckIcon size={13} strokeWidth={3} />
          ) : state === "off" ? (
            "≠"
          ) : (
            "="
          )}
        </span>
        <div className={styles.balance}>
          <span className={styles.icon}>
            <WalletIcon size={15} aria-hidden />
          </span>
          <div className={styles.figure}>
            <strong>{money(account.cleared)}</strong>
            <span>Cleared in Caishen</span>
          </div>
        </div>
      </div>
      <p
        id={messageId}
        className={styles.message}
        role={error ? "alert" : undefined}
      >
        {error ||
          (state === "asking" ? (
            <>
              <strong>Does your bank show the same?</strong> Use its current
              balance, which leaves out pending transactions.
            </>
          ) : state === "matched" ? (
            <>
              <strong>They match.</strong> Finishing locks {locks}.
            </>
          ) : (
            <>
              <strong>Off by {money(difference, true)}.</strong> Look for
              missing, duplicate, or still-pending transactions, or adjust the
              balance{account.kind === "cash" ? " from Ready to Assign" : ""}.
            </>
          ))}
      </p>
    </>
  );
}

function Actions({
  step,
  valid,
  adjust,
  onBack,
  onEnter,
}: {
  step: Step;
  valid: boolean;
  adjust: boolean;
  onBack: () => void;
  onEnter: () => void;
}) {
  if (step === "enter")
    return (
      <div className={styles.footer}>
        <Button size="sm" variant="quiet" onClick={onBack}>
          Back
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!valid}>
          Next
        </Button>
      </div>
    );
  // Asking, Yes is the expected answer.
  return (
    <div className={styles.actions}>
      <Button variant="primary" type="submit" autoFocus={step === "ask"}>
        {step === "ask"
          ? "Yes, it matches"
          : adjust
            ? "Create adjustment & finish"
            : "Finish"}
      </Button>
      <Button variant="quiet" onClick={step === "ask" ? onEnter : onBack}>
        {step === "ask" ? "No, enter bank balance" : "Edit bank balance"}
      </Button>
    </div>
  );
}
