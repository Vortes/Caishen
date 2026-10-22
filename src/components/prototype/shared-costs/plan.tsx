"use client";

import { CalendarRangeIcon, FolderIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Figure, Property, Title } from "../app-shell/cards";
import { MoveMoneyPopover } from "../app-shell/move-money";
import { RtaCardLayout } from "../app-shell/ready-to-assign";
import { FundingRing } from "../app-shell/views";
import shell from "../app-shell/shell.module.css";
import entry from "../app-shell/transaction-entry.module.css";
import {
  isInOctober,
  isPartner,
  money,
  PEOPLE,
  reimbursementPeople,
  sum,
} from "./model";
import { parseCents } from "./share";
import { useStore } from "./store";
import styles from "./shared-costs.module.css";

export function PlanInspector({ selectedId }: { selectedId: string | null }) {
  const { budget, notify } = useStore();
  const category = budget.shell.categories.find(
    (item) => item.id === selectedId,
  );
  const paired =
    selectedId === "env-partner"
      ? "partner"
      : selectedId === "env-reimb"
        ? "reimbursements"
        : null;
  return (
    <>
      <RtaCardLayout
        amount={budget.shell.readyToAssign}
        wrapAction={(button) => (
          <span
            className={styles.wrapAction}
            onClickCapture={() =>
              notify("Assign money from a category's Assigned cell here.")
            }
          >
            {button}
          </span>
        )}
      />
      {paired && budget.envelope[paired] ? (
        <EnvelopeDetails key={paired} kind={paired} />
      ) : category ? (
        <CategoryDetails key={category.id} id={category.id} />
      ) : (
        <SharedSummary />
      )}
    </>
  );
}

function SharedSummary() {
  const { world, viewer, budget, navigate } = useStore();
  const partner = PEOPLE[budget.partner].name;
  const owed = budget.partnerBalance;
  return (
    <Card>
      <Title
        icon={<UsersIcon size={15} className={shell.titleIcon} aria-hidden />}
        title="Shared costs"
        subtitle="What others owe you is tracked, not spendable"
      />
      {world.partnered && (
        <Property label={partner}>
          <button
            type="button"
            className={styles.linkValue}
            onClick={() => navigate({ type: "partner" })}
          >
            {owed === 0
              ? "Even"
              : owed > 0
                ? `Owes you ${money(owed)}`
                : `You owe ${money(-owed)}`}
          </button>
        </Property>
      )}
      <Property label="Others">
        <button
          type="button"
          className={styles.linkValue}
          onClick={() => navigate({ type: "reimbursements" })}
        >
          {reimbursementPeople(world, viewer).filter((p) => p.balance).length
            ? `Owe you ${money(budget.reimbursementBalance)}`
            : "Nobody owes you"}
        </button>
      </Property>
      <p className={styles.cardNote}>
        Ready to Assign only counts cash you have. Money owed to you reaches it
        when it arrives, through the paired envelope.
      </p>
    </Card>
  );
}

function EnvelopeDetails({ kind }: { kind: "partner" | "reimbursements" }) {
  const { budget, update, navigate, viewer } = useStore();
  const envelope = budget.envelope[kind];
  const { category, float, balance, cashOver, creditOver } = envelope;
  const partner = PEOPLE[budget.partner].name;
  const account = kind === "partner" ? partner : "Reimbursements";
  const [text, setText] = useState((float / 100).toFixed(2));
  const owedLabel = balance >= 0 ? "Owed to you" : "You owe";
  const caption =
    category.available < 0
      ? category.status
      : balance > 0
        ? float >= balance
          ? `Your float covers the ${money(balance)} you fronted`
          : "Nothing fronted beyond the float"
        : balance < 0
          ? `Holds ${money(-balance)} for what you owe ${partner}`
          : "Nothing owed either way";
  return (
    <>
      <Card>
        <Title
          icon={<FundingRing category={category} size={15} />}
          title={category.name}
          subtitle={`Paired with your ${account} account`}
        />
        <Figure
          value={money(category.available)}
          caption={caption}
          tone={category.funding}
        />
        <div className={shell.cardActions}>
          {category.available < 0 && (
            <MoveMoneyPopover category={category} align="start">
              <Button variant="primary">Cover overspending</Button>
            </MoveMoneyPopover>
          )}
          <Button
            onClick={() =>
              navigate(
                kind === "partner"
                  ? { type: "partner" }
                  : { type: "reimbursements" },
              )
            }
          >
            Open {account}
          </Button>
        </div>
      </Card>
      <Card>
        <div className={styles.equation}>
          <Property label="Float">{money(float)}</Property>
          <Property label={owedLabel}>
            <span className={styles.minus}>
              {balance >= 0 ? "−" : "+"} {money(Math.abs(balance))}
            </span>
          </Property>
          <Property label="Available">
            <strong>{money(category.available)}</strong>
          </Property>
        </div>
        <p className={styles.cardNote}>
          Available is always the float you assigned minus the {account}{" "}
          balance. Every entry on the account moves the envelope the opposite
          way.
        </p>
        <form
          className={styles.floatForm}
          onSubmit={(event) => {
            event.preventDefault();
            const next = parseCents(text);
            if (next === null) return;
            const own = category.assigned + (next - float);
            update(
              (world) => ({
                ...world,
                assigned: {
                  ...world.assigned,
                  [viewer]: { ...world.assigned[viewer], [category.id]: own },
                },
              }),
              `${category.name}'s float is ${money(next)}. Ready to Assign ${next > float ? "gave" : "got back"} ${money(Math.abs(next - float))}.`,
            );
          }}
        >
          <label htmlFor="float-amount" className={styles.panelLabel}>
            Float for fronting costs
          </label>
          <div className={styles.inlineForm}>
            <div className={`${entry.well} ${styles.shareAmount}`} data-amount>
              <span className={entry.prefix} aria-hidden>
                $
              </span>
              <input
                id="float-amount"
                className={entry.input}
                inputMode="decimal"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </div>
            <Button size="sm" type="submit">
              Set float
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <Property label="Assigned">{money(category.assigned)}</Property>
        <Property label="Activity">{money(category.activity)}</Property>
        <Property label="Last month">{money(category.carryover)}</Property>
        <Property label="Next month" icon={CalendarRangeIcon}>
          <span className={styles.wrapText}>
            {cashOver > 0
              ? `If still overspent on Oct 31, the ${money(cashOver)} in cash comes out of November's Ready to Assign, like any cash overspending.`
              : creditOver > 0
                ? `If still overspent on Oct 31, the ${money(creditOver)} stays card debt with nothing set aside to pay it, like any credit overspending.`
                : `${money(category.available)} rolls into November. The ${account} balance carries over as is.`}
          </span>
        </Property>
      </Card>
    </>
  );
}

// A spending category: only the personal share is its activity.
function CategoryDetails({ id }: { id: string }) {
  const { world, viewer, budget } = useStore();
  const category = budget.shell.categories.find((item) => item.id === id)!;
  const paid = world.txns.filter(
    (item) =>
      item.owner === viewer &&
      item.accountId &&
      isInOctober(item.date) &&
      item.lines.some((line) => line.categoryId === id && line.share),
  );
  const lines = paid.flatMap((item) =>
    item.lines.filter((line) => line.categoryId === id && line.share),
  );
  const theirs = world.txns.filter(
    (item) =>
      item.owner !== viewer &&
      isInOctober(item.date) &&
      world.side[item.id]?.categoryId === id,
  );
  const theirShares = sum(
    theirs.flatMap((item) =>
      item.lines
        .filter((line) => isPartner(line.share))
        .map((l) => l.share!.amount),
    ),
  );
  return (
    <>
      <Card>
        <Title
          icon={<FundingRing category={category} size={15} />}
          title={category.name}
          subtitle={category.group}
        />
        <Figure
          value={money(category.available)}
          caption={
            category.status ||
            (category.available > 0
              ? "Money available"
              : "No money assigned yet")
          }
          tone={category.funding}
        />
        <div className={shell.cardActions}>
          <MoveMoneyPopover category={category} align="start">
            {category.available < 0 ? (
              <Button variant="primary">Cover overspending</Button>
            ) : (
              <Button>Move money</Button>
            )}
          </MoveMoneyPopover>
        </div>
      </Card>
      <Card>
        <Property label="Assigned">{money(category.assigned)}</Property>
        <Property label="Activity">{money(category.activity)}</Property>
        <Property label="Last month">{money(category.carryover)}</Property>
        <Property label="Group" icon={FolderIcon}>
          {category.group}
        </Property>
      </Card>
      {(lines.length > 0 || theirs.length > 0) && (
        <Card>
          {lines.length > 0 && (
            <Property label="You paid">
              <span className={styles.wrapText}>
                {money(sum(lines.map((l) => l.amount)))} on {lines.length}{" "}
                shared {lines.length === 1 ? "line" : "lines"};{" "}
                {money(sum(lines.map((l) => l.amount - l.share!.amount)))} is
                yours
              </span>
            </Property>
          )}
          {theirs.length > 0 && (
            <Property label={`${PEOPLE[budget.partner].name} paid`}>
              <span className={styles.wrapText}>
                Your {money(theirShares)} share of {theirs.length}{" "}
                {theirs.length === 1 ? "purchase" : "purchases"}
              </span>
            </Property>
          )}
          <p className={styles.cardNote}>
            Only personal shares count as activity here. The rest is on your
            shared accounts.
          </p>
        </Card>
      )}
    </>
  );
}
