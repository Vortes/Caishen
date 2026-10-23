"use client";

import type { Command } from "~/domain/engine";
import type { View } from "~/components/budget/types";
import type { Category } from "~/components/budget/category-table";
import { newId } from "~/components/budget/format";
import { Amount } from "~/components/shared";
import { Button } from "~/components/ui-legacy/button";
import { MoveMoneyPopover } from "~/components/budget/move-money-popover";
import { cn } from "~/lib/utils";
import { useState } from "react";

type Row = [label: string, value: number];

export function AvailableSection({
  view,
  selected,
  busy,
  run,
}: {
  view: View;
  selected: Category[];
  busy: boolean;
  run: (command: Command) => void;
}) {
  const [moving, setMoving] = useState(false);
  const category = selected.length === 1 ? selected[0] : undefined;
  const card =
    category?.pairedAccountId &&
    view.accounts.find((account) => account.id === category.pairedAccountId);
  // A card target owns the funding prompt; without one, YNAB asks for the full balance.
  const underfunded = card && !category.target ? card.shortfall : 0;
  const assignable = Math.min(underfunded, Math.max(0, view.readyToAssign));
  const values = selected.length ? selected : view.categories;
  const total = (
    key: "opening" | "assigned" | "activity" | "available" | "cashOverspending",
  ) => values.reduce((sum, item) => sum + item[key], 0);
  const available = total("available");
  const overspent = Math.max(0, -available);
  const cashOverspent = Math.min(overspent, total("cashOverspending"));
  const creditOverspent = overspent - cashOverspent;
  const rows: Row[] = card
    ? [
        ["Left over from last month", category.opening],
        ["Assigned this month", category.assigned],
        ["Funded spending", card.fundedSpending],
        ["Payments made", card.paymentsMade],
        ...(card.creditsReleased
          ? ([["Released by statement credits", card.creditsReleased]] as Row[])
          : []),
      ]
    : category
      ? [
          ["Left over from last month", category.opening],
          ["Assigned this month", category.assigned],
          ["Cash spending", category.cashActivity],
          ["Credit spending", category.creditActivity],
        ]
      : [
          ["Left over from last month", total("opening")],
          ["Assigned this month", total("assigned")],
          ["Activity", total("activity")],
        ];
  return (
    <section className="inspector-section">
      <div className="inspector-hero">
        <span>
          {card
            ? "Available for payment"
            : available < 0
              ? "Overspent"
              : selected.length
                ? "Available"
                : "Available in categories"}
        </span>
        <Amount
          value={available}
          className={
            cashOverspent > 0
              ? "negative"
              : overspent > 0 || underfunded > 0
                ? "caution"
                : available > 0
                  ? "positive"
                  : "muted"
          }
        />
      </div>
      <dl className="inspector-values">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <Amount value={value} signed />
            </dd>
          </div>
        ))}
      </dl>
      {category && underfunded > 0 ? (
        <div className="inspector-callout">
          <p>
            Your card balance is <Amount value={underfunded} /> more than you’ve
            set aside to pay it.
          </p>
          <Button
            size="sm"
            disabled={busy || assignable === 0}
            onClick={() =>
              run({
                type: "assign",
                id: newId(),
                categoryId: category.id,
                month: view.month,
                amount: assignable,
              })
            }
          >
            {assignable === 0 ? (
              "Nothing ready to assign"
            ) : (
              <>
                Assign <Amount value={assignable} />
              </>
            )}
          </Button>
        </div>
      ) : category && overspent > 0 ? (
        <div
          className={cn(
            "inspector-callout",
            cashOverspent > 0 ? "is-cash" : "is-credit",
          )}
        >
          <p>
            {cashOverspent > 0 && creditOverspent > 0 ? (
              <>
                You overspent this category by <Amount value={overspent} />:{" "}
                <Amount value={cashOverspent} /> in cash and{" "}
                <Amount value={creditOverspent} /> with credit.
              </>
            ) : (
              <>
                You overspent this category by <Amount value={overspent} />{" "}
                {cashOverspent > 0 ? "in cash" : "with credit"}.
              </>
            )}{" "}
            {cashOverspent > 0
              ? "Cover it now, or it comes out of next month’s Ready to Assign."
              : "Cover it to avoid creating card debt."}
          </p>
          <MoveMoneyPopover
            view={view}
            category={category}
            open={moving}
            onOpenChange={setMoving}
            run={run}
          >
            <Button size="sm" disabled={busy}>
              Cover overspending
            </Button>
          </MoveMoneyPopover>
        </div>
      ) : (
        category && (
          <MoveMoneyPopover
            view={view}
            category={category}
            open={moving}
            onOpenChange={setMoving}
            run={run}
          >
            <Button
              variant="secondary"
              size="sm"
              className="inspector-wide-action"
              disabled={busy}
            >
              Move money
            </Button>
          </MoveMoneyPopover>
        )
      )}
      {!selected.length && (
        <dl className="inspector-values inspector-values-split">
          <div>
            <dt>
              <abbr title="Includes your part of shared expenses">
                Your share of spending
              </abbr>
            </dt>
            <dd>
              <Amount value={view.personalSpending} />
            </dd>
          </div>
          <div>
            <dt>You paid</dt>
            <dd>
              <Amount value={view.amountPaid} />
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
