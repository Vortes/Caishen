"use client";

import { ArrowRightIcon, FolderIcon, LinkIcon, UsersIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Figure, Property, Title } from "../app-shell/cards";
import { FundingBar } from "../app-shell/funding-bar";
import { RtaCardLayout } from "../app-shell/ready-to-assign";
import shell from "../app-shell/shell.module.css";
import { AvailablePill, FundingRing } from "../app-shell/views";
import moveStyles from "../app-shell/move-money.module.css";
import type { Category } from "../app-shell/model";
import { MONTH } from "./data";
import { money, parseCents, type Budget, type CategoryView } from "./ledger";
import { AmountWell } from "./share";
import type { Action } from "./store";
import styles from "./shared-costs.module.css";

// The category shape the shell's funding components read.
function asCategory(category: CategoryView) {
  return {
    ...category,
    id: category.id,
    carryover: 0,
    fundedRatio: 1,
    reserved: 0,
    spendable: category.available,
    sharePercents: [],
    pays:
      category.paired === "card"
        ? { type: "card" as const, id: category.id, name: category.name }
        : undefined,
  };
}

// The ring reads only the funding state and ratio; the rest of the shell's
// Category (targets, auto-assign) doesn't exist in this prototype.
function ringOf(category: CategoryView) {
  return asCategory(category) as unknown as Category;
}

export function PlanList({
  budget,
  selectedId,
  onSelect,
}: {
  budget: Budget;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={shell.list} role="group" aria-label="Categories">
      <div className={`${shell.columns} ${shell.columnHeader}`} aria-hidden>
        <span>Category</span>
        <span className={shell.numeric}>Assigned</span>
        <span className={shell.numeric}>Activity</span>
        <span className={shell.numeric}>Available</span>
      </div>
      {budget.groups.map((group) => {
        const sum = (pick: (item: CategoryView) => number) =>
          group.categories.reduce((total, item) => total + pick(item), 0);
        return (
          <div key={group.name}>
            <div className={`${shell.columns} ${shell.groupRow}`}>
              <span className={shell.groupName}>
                <span className={shell.truncate}>{group.name}</span>
                <span className={shell.groupCount}>
                  {group.categories.length}
                </span>
              </span>
              <span className={shell.numeric}>
                {money(sum((item) => item.assigned))}
              </span>
              <span className={shell.numeric}>
                {money(sum((item) => item.activity))}
              </span>
              <span className={shell.numeric}>
                {money(sum((item) => item.available))}
              </span>
            </div>
            {group.categories.map((category) => (
              <div key={category.id} className={shell.rowWrap}>
                <button
                  type="button"
                  data-row
                  className={`${shell.columns} ${shell.row}`}
                  aria-current={selectedId === category.id ? "true" : undefined}
                  onClick={() => onSelect(category.id)}
                >
                  <span className={shell.rowName}>
                    <FundingBar category={asCategory(category)}>
                      <span className={shell.truncate}>{category.name}</span>
                      {(category.paired === "partner" ||
                        category.paired === "reimbursements") && (
                        <LinkIcon
                          size={12}
                          className={shell.inlineIcon}
                          aria-label="Paired with an account"
                        />
                      )}
                      {(category.othersShare !== 0 ||
                        category.fromPartner !== 0) && (
                        <UsersIcon
                          size={12}
                          className={shell.inlineIcon}
                          aria-label="Has shared spending"
                        />
                      )}
                    </FundingBar>
                  </span>
                  <span className={`${shell.numeric} ${shell.muted}`}>
                    {money(category.assigned)}
                  </span>
                  <span className={`${shell.numeric} ${shell.muted}`}>
                    {money(category.activity)}
                  </span>
                  <span className={shell.numeric}>
                    <AvailablePill category={category} />
                  </span>
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function PlanInspector({
  budget,
  selectedId,
  onOpenAccount,
  dispatch,
  notify,
}: {
  budget: Budget;
  selectedId: string | null;
  onOpenAccount: (accountId: string) => void;
  dispatch: (action: Action) => void;
  notify: (message: string) => void;
}) {
  const category = budget.categories.find((item) => item.id === selectedId);
  return (
    <>
      <RtaCardLayout amount={budget.readyToAssign} />
      {category ? (
        category.paired === "partner" ||
        category.paired === "reimbursements" ? (
          <PairedDetails
            key={category.id}
            budget={budget}
            category={category}
            onOpenAccount={onOpenAccount}
            dispatch={dispatch}
            notify={notify}
          />
        ) : (
          <CategoryDetails budget={budget} category={category} />
        )
      ) : (
        <MonthDetails budget={budget} onOpenAccount={onOpenAccount} />
      )}
    </>
  );
}

function MonthDetails({
  budget,
  onOpenAccount,
}: {
  budget: Budget;
  onOpenAccount: (accountId: string) => void;
}) {
  const sharedOut = budget.categories.reduce(
    (sum, item) => sum + item.othersShare,
    0,
  );
  const sharedIn = budget.categories.reduce(
    (sum, item) => sum + item.fromPartner,
    0,
  );
  return (
    <Card>
      <Title
        title={MONTH}
        subtitle="Nothing selected. Pick a category to see its details."
      />
      <Property label="Others' shares">{money(sharedOut)} you paid</Property>
      <Property label={`${budget.partnerName} paid`}>
        {money(sharedIn)} of yours
      </Property>
      <Property label="Balance" icon={UsersIcon}>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => onOpenAccount(`${budget.person}-partner`)}
        >
          {budget.partnerBalance >= 0
            ? `${budget.partnerName} owes you ${money(budget.partnerBalance)}`
            : `You owe ${budget.partnerName} ${money(-budget.partnerBalance)}`}
        </button>
      </Property>
    </Card>
  );
}

// A category with shared lines shows the gap between what left the bank and
// what was yours: Rent's $2,700 out, $1,350 of it Anna's.
function CategoryDetails({
  budget,
  category,
}: {
  budget: Budget;
  category: CategoryView;
}) {
  const shared = category.othersShare !== 0 || category.fromPartner !== 0;
  return (
    <>
      <Card>
        <Title
          icon={<FundingRing category={ringOf(category)} size={15} />}
          title={category.name}
          subtitle={category.group}
        />
        <Figure
          value={money(category.available)}
          caption={
            category.status ||
            (category.available > 0 ? "Money available" : "No money assigned")
          }
          tone={category.funding}
        />
      </Card>
      {shared && (
        <Card>
          <h3 className={styles.cardHeading}>Your spending this month</h3>
          <Property label="Paid">{money(category.paid)}</Property>
          {category.othersShare !== 0 && (
            <Property label="Others' shares">
              −{money(category.othersShare)}
            </Property>
          )}
          {category.fromPartner !== 0 && (
            <Property label={`${budget.partnerName} paid`}>
              +{money(category.fromPartner)} of yours
            </Property>
          )}
          <div className={styles.propertyTotal}>
            <Property label="Your spending">
              {money(-category.activity)}
            </Property>
          </div>
          <p className={styles.cardNote}>
            Only your spending counts against {category.name}. Shares others owe
            you sit in their account until they pay you back.
          </p>
        </Card>
      )}
      <Card>
        <Property label="Assigned">{money(category.assigned)}</Property>
        <Property label="Activity">{money(category.activity)}</Property>
        <Property label="Group" icon={FolderIcon}>
          {category.group}
        </Property>
      </Card>
    </>
  );
}

// The envelope paired with a counterparty account: available is always the
// float minus the account's balance.
function PairedDetails({
  budget,
  category,
  onOpenAccount,
  dispatch,
  notify,
}: {
  budget: Budget;
  category: CategoryView;
  onOpenAccount: (accountId: string) => void;
  dispatch: (action: Action) => void;
  notify: (message: string) => void;
}) {
  const id = useId();
  const partner = category.paired === "partner";
  const balance = -category.activity;
  const accountId = partner
    ? `${budget.person}-partner`
    : `${budget.person}-reimbursements`;
  const [text, setText] = useState((category.assigned / 100).toFixed(2));
  const [error, setError] = useState("");
  const owedLabel = partner
    ? balance >= 0
      ? `${budget.partnerName} owes you`
      : `You owe ${budget.partnerName}`
    : "Owed to you";
  return (
    <>
      <Card>
        <Title
          icon={<FundingRing category={ringOf(category)} size={15} />}
          title={category.name}
          subtitle={
            partner
              ? `Paired with your ${budget.partnerName} account`
              : "Paired with your Reimbursements account"
          }
        />
        <Figure
          value={money(category.available)}
          caption={category.status}
          tone={category.funding}
        />
        <div className={shell.cardActions}>
          <Button onClick={() => onOpenAccount(accountId)}>
            Open {partner ? `${budget.partnerName}'s ledger` : "Reimbursements"}
            <ArrowRightIcon aria-hidden />
          </Button>
        </div>
      </Card>
      <Card>
        <dl className={styles.equation}>
          <div>
            <dt>Float</dt>
            <dd>{money(category.assigned)}</dd>
          </div>
          <div>
            <dt>{balance >= 0 ? "−" : "+"}</dt>
            <dd />
          </div>
          <div>
            <dt>{owedLabel}</dt>
            <dd>{money(Math.abs(balance))}</dd>
          </div>
          <div>
            <dt>=</dt>
            <dd />
          </div>
          <div data-total>
            <dt>Available</dt>
            <dd data-state={category.funding}>{money(category.available)}</dd>
          </div>
        </dl>
        <p className={styles.cardNote}>{explain(budget, category, partner)}</p>
      </Card>
      <Card>
        <form
          className={styles.floatForm}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const cents = parseCents(text);
            if (cents === null)
              return setError("Enter an amount, like 500.00.");
            setError("");
            dispatch({
              type: "float",
              person: budget.person,
              kind: partner ? "partner" : "reimbursements",
              amount: cents,
            });
            notify(
              `${category.name} has a ${money(cents)} float. ${money(
                Math.abs(cents - category.assigned),
              )} ${cents >= category.assigned ? "came from" : "went back to"} Ready to Assign.`,
            );
          }}
        >
          <label htmlFor={id}>Float</label>
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
              Set float
            </Button>
          </div>
          {error && <p className={moveStyles.error}>{error}</p>}
          <p className={styles.formHint}>
            Cash you set aside to front costs before they&rsquo;re paid back. It
            comes from Ready to Assign like any assignment.
          </p>
        </form>
      </Card>
    </>
  );
}

function explain(budget: Budget, category: CategoryView, partner: boolean) {
  const name = partner ? budget.partnerName : "whoever owes you";
  const balance = -category.activity;
  if (partner && balance < 0)
    return `This is the cash for what you owe ${budget.partnerName}. ${budget.partnerName}'s purchases for you land here instead of in your other categories' cash, and paying ${budget.partnerName} comes out of here.`;
  if (category.available < 0)
    return `You fronted more than the float covers, so it shows as ${category.funding === "credit" ? "credit overspending: it went on a card" : "overspent: it left your checking"}. It refills when ${name} pays you back, or cover it now from another category.`;
  return `Fronting a share takes from here; ${name} paying you back refills it. Paybacks never go to Ready to Assign. Move any surplus from here.`;
}
