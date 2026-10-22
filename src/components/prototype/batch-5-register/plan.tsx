"use client";

import { CircleAlertIcon, CircleCheckIcon, HandCoinsIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Property } from "~/components/prototype/app-shell/cards";
import { AvailablePill } from "~/components/prototype/app-shell/views";
import { ChoiceField } from "~/components/prototype/app-shell/transaction-fields";
import shell from "~/components/prototype/app-shell/shell.module.css";
import entry from "~/components/prototype/app-shell/transaction-entry.module.css";
import {
  TODAY,
  accounts,
  categories,
  day,
  money,
  olderPurchases,
  outstanding,
  type AccountId,
  type Reimbursement,
} from "./data";
import { useBook } from "./state";
import styles from "./batch-5.module.css";

export function PlanList() {
  const groups = [...new Set(categories.map((item) => item.group))];
  return (
    <div className={shell.list}>
      <div className={`${shell.columns} ${shell.columnHeader}`}>
        <span>Category</span>
        <span className={shell.numeric} data-optional>
          Assigned
        </span>
        <span className={shell.numeric} data-optional>
          Activity
        </span>
        <span className={shell.numeric}>Available</span>
      </div>
      {groups.map((group) => (
        <div key={group}>
          <div className={`${shell.columns} ${shell.groupRow}`}>
            <span>{group}</span>
          </div>
          {categories
            .filter((item) => item.group === group)
            .map((item) => (
              <div key={item.id} className={`${shell.columns} ${shell.row}`}>
                <span className={shell.truncate}>{item.name}</span>
                <span className={shell.numeric} data-optional>
                  {money(item.assigned)}
                </span>
                <span className={shell.numeric} data-optional>
                  {money(item.activity)}
                </span>
                <span className={shell.numeric}>
                  <AvailablePill category={item} />
                </span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

export function PlanInspector({
  openClaim,
  onOpenClaim,
  onShowPurchase,
}: {
  openClaim: string | null;
  onOpenClaim: (id: string | null) => void;
  onShowPurchase: (transactionId: string) => void;
}) {
  const { book } = useBook();
  const owed = book.reimbursements.filter((claim) => outstanding(claim) > 0);
  return (
    <>
      <Card>
        <div className={shell.rtaCard}>
          <span className={shell.rtaCardLabel}>Ready to Assign</span>
          <div className={shell.figure} data-state="funded">
            <strong>
              {money(2525882 + receivedThisSession(book.reimbursements))}
            </strong>
          </div>
        </div>
      </Card>
      <Card>
        <Property label="Assigned">{money(538500)}</Property>
        <Property label="Activity">{money(-261198)}</Property>
        <Property label="Available">{money(827293)}</Property>
      </Card>
      <Card>
        <Tabs defaultValue="reimbursements">
          <TabsList aria-label="Month details">
            <TabsTrigger value="auto-assign">Auto-Assign</TabsTrigger>
            <TabsTrigger value="cost-to-be-me">Cost to Be Me</TabsTrigger>
            <TabsTrigger value="shared">Shared</TabsTrigger>
            <TabsTrigger value="reimbursements">
              Reimbursements {owed.length}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="auto-assign">
            <p className={shell.tabEmpty}>Not part of this prototype.</p>
          </TabsContent>
          <TabsContent value="cost-to-be-me">
            <p className={shell.tabEmpty}>Not part of this prototype.</p>
          </TabsContent>
          <TabsContent value="shared">
            <p className={shell.tabEmpty}>Not part of this prototype.</p>
          </TabsContent>
          <TabsContent value="reimbursements">
            <ReimbursementsTab
              openClaim={openClaim}
              onOpenClaim={onOpenClaim}
              onShowPurchase={onShowPurchase}
            />
          </TabsContent>
        </Tabs>
      </Card>
    </>
  );
}

// Cash received in this demo goes to Ready to Assign (ADR 0002).
function receivedThisSession(reimbursements: Reimbursement[]) {
  return reimbursements
    .flatMap((claim) => claim.receipts)
    .filter((receipt) => receipt.id.startsWith("t-receipt"))
    .filter(
      (receipt) =>
        accounts.find((a) => a.id === receipt.accountId)!.kind === "cash",
    )
    .reduce((sum, receipt) => sum + receipt.amount, 0);
}

function ReimbursementsTab({
  openClaim,
  onOpenClaim,
  onShowPurchase,
}: {
  openClaim: string | null;
  onOpenClaim: (id: string | null) => void;
  onShowPurchase: (transactionId: string) => void;
}) {
  const { book } = useBook();
  const owed = book.reimbursements.filter((claim) => outstanding(claim) > 0);
  const received = book.reimbursements.filter(
    (claim) => outstanding(claim) === 0,
  );
  const purchaseOf = (claim: Reimbursement) => {
    const found = book.transactions.find(
      (item) => item.id === claim.transactionId,
    );
    return found
      ? { payee: found.payee, date: found.date, accountId: found.accountId }
      : {
          ...olderPurchases[claim.transactionId]!,
          accountId: "chase" as const,
        };
  };
  if (!book.reimbursements.length)
    return (
      <div className={shell.tabEmpty}>
        <span className={shell.tabEmptyTitle}>Nothing expected back.</span>
        <p>
          When someone owes you for a purchase, open it in the register and
          choose Expect money back.
        </p>
      </div>
    );
  return (
    <div className={styles.claims}>
      {owed.length === 0 && (
        <p className={shell.tabEmpty}>Every reimbursement has arrived.</p>
      )}
      <ul className={shell.actionList}>
        {owed.map((claim) => {
          const purchase = purchaseOf(claim);
          const open = openClaim === claim.id;
          const left = outstanding(claim);
          return (
            <li
              key={claim.id}
              className={styles.claim}
              data-open={open || undefined}
            >
              <button
                type="button"
                className={`${shell.actionItem} ${styles.claimRow}`}
                aria-expanded={open}
                onClick={() => onOpenClaim(open ? null : claim.id)}
              >
                <HandCoinsIcon size={13} aria-hidden />
                <span className={styles.choiceText}>
                  <span>{claim.from}</span>
                  <span className={shell.faint}>
                    For {purchase.payee} · {day(purchase.date)}
                  </span>
                </span>
                <span className={styles.claimAmount}>
                  <span className={shell.numeric}>{money(left)}</span>
                  {left !== claim.amount && (
                    <span className={shell.faint}>
                      of {money(claim.amount)}
                    </span>
                  )}
                </span>
              </button>
              {open && (
                <ReceiveForm
                  claim={claim}
                  purchaseAccount={purchase.accountId}
                  onDone={() => onOpenClaim(null)}
                  onShowPurchase={() => onShowPurchase(claim.transactionId)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {received.length > 0 && (
        <>
          <h3 className={styles.subheading}>Paid back</h3>
          <ul className={shell.actionList}>
            {received.map((claim) => {
              const last = claim.receipts.at(-1)!;
              return (
                <li key={claim.id}>
                  <div className={`${shell.actionItem} ${styles.claimRow}`}>
                    <CircleCheckIcon
                      size={13}
                      className={styles.done}
                      aria-hidden
                    />
                    <span className={styles.choiceText}>
                      <span>{claim.from}</span>
                      <span className={shell.faint}>
                        For {purchaseOf(claim).payee} · arrived {day(last.date)}
                      </span>
                    </span>
                    <span className={shell.numeric}>{money(claim.amount)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

// Opens in place under its claim, like the target editor in the
// inspector. A card credit arrives by import, so the form says so instead
// of asking for a cash account.
function ReceiveForm({
  claim,
  purchaseAccount,
  onDone,
  onShowPurchase,
}: {
  claim: Reimbursement;
  purchaseAccount: AccountId;
  onDone: () => void;
  onShowPurchase: () => void;
}) {
  const { actions } = useBook();
  const id = useId();
  const left = outstanding(claim);
  const [accountId, setAccountId] = useState<string>("chase");
  const [amount, setAmount] = useState((left / 100).toFixed(2));
  const [error, setError] = useState("");
  const cash = accounts.filter((item) => item.kind === "cash");
  const card = accounts.find((item) => item.id === purchaseAccount)!;
  return (
    <form
      className={styles.receive}
      aria-label={`Record money from ${claim.from}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const cents = Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100);
        if (!(cents > 0)) return setError("Enter an amount above zero.");
        if (cents > left)
          return setError(`Only ${money(left)} is still expected.`);
        actions.receive(claim.id, accountId as AccountId, cents, TODAY);
        onDone();
      }}
    >
      <p className={styles.hint}>
        Lands in a linked{" "}
        {card.kind === "credit" ? "account or card" : "account"}? Then it shows
        up in To review to match, with nothing to enter here.
      </p>
      <div className={styles.receiveFields}>
        <div className={styles.field}>
          <label htmlFor={`${id}-account`}>Into</label>
          <ChoiceField
            id={`${id}-account`}
            label="Into"
            value={accountId}
            options={cash.map((item) => ({ value: item.id, label: item.name }))}
            placeholder="Account"
            wide={false}
            onChange={setAccountId}
          />
        </div>
        <div className={styles.field} data-amount>
          <label htmlFor={`${id}-amount`}>Amount</label>
          <div
            className={entry.well}
            data-amount
            data-invalid={error ? "" : undefined}
          >
            <span className={entry.prefix} aria-hidden>
              $
            </span>
            <input
              id={`${id}-amount`}
              className={entry.input}
              inputMode="decimal"
              value={amount}
              autoComplete="off"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                setAmount(event.target.value);
                setError("");
              }}
            />
          </div>
        </div>
      </div>
      {error && (
        <p id={`${id}-error`} className={entry.fieldError}>
          <CircleAlertIcon size={13} aria-hidden />
          {error}
        </p>
      )}
      <div className={styles.receiveActions}>
        <Button variant="quiet" size="sm" onClick={onShowPurchase}>
          View purchase
        </Button>
        <span className={styles.spacer} />
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit">
          Record {money(Math.round(Number(amount || 0) * 100) || 0)}
        </Button>
      </div>
    </form>
  );
}
