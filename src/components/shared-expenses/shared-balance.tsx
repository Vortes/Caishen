"use client";

import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import type { Panel, View } from "~/components/budget/types";
import {
  currentMonth,
  monthName,
  moveMonth,
  shortDate,
} from "~/components/budget/format";
import { Amount, Icon } from "~/components/shared";
import { Button } from "~/components/ui-legacy/button";
import { useMediaQuery } from "~/components/shared/use-media-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui-legacy/dropdown-menu";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui-legacy/popover";

type Statement = View["sharedStatement"];
type StatementCategory = Statement["categories"][number];
type Purchase = StatementCategory["purchases"][number];
type Repayment = Statement["repayments"][number];

const monthOnly = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
  });

function Direction({ effect }: { effect: number }) {
  if (effect === 0) return <span className="muted">Even</span>;
  const youOwe = effect > 0;
  return (
    <span
      className={cn("owe-amount", youOwe ? "is-owed-by-you" : "is-owed-to-you")}
      title={youOwe ? "You owe" : "Owed to you"}
    >
      <Icon name={youOwe ? "wallet-out" : "wallet-in"} size={16} />
      <Amount value={Math.abs(effect)} />
      <span className="sr-only">{youOwe ? " you owe" : " owed to you"}</span>
    </span>
  );
}

export function SharedBalance({
  view,
  open,
}: {
  view: View;
  open: (panel: Panel) => void;
}) {
  const statement = view.sharedStatement;
  const { net } = view.settlement;
  const canRecord = view.month >= currentMonth(view.budget.settings.timezone);
  const awaiting = new Set(
    statement.awaitingYourConfirmation.map((item) => item.settlementId),
  );
  const { carried } = statement;
  return (
    <section className="inspector-section shared-balance">
      <h3>
        Partner
        {canRecord && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="More partner actions"
              >
                <Icon name="more" size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => open({ type: "opening" })}>
                <Icon name="plus" />
                Add opening amount
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </h3>
      <div className="shared-verdict">
        <span>
          {net > 0
            ? "You owe your partner"
            : net < 0
              ? "Your partner owes you"
              : "Nothing owed"}
        </span>
        {net !== 0 ? <Direction effect={net} /> : <strong>You’re even</strong>}
      </div>
      <ul
        className="shared-statement"
        aria-label={`${monthName(view.month)} shared statement`}
      >
        {(carried.amount !== 0 || carried.from === "opening") && (
          <li>
            <CarriedLine statement={statement} month={view.month} />
          </li>
        )}
        {statement.categories
          .filter((category) => category.purchases.length || category.effect)
          .map((category) => (
            <li key={category.sharedCategoryId}>
              <CategoryLine view={view} category={category} />
            </li>
          ))}
        {statement.repayments.map((repayment) => (
          <li key={repayment.settlementId}>
            <RepaymentLine
              repayment={repayment}
              onConfirm={
                canRecord && awaiting.has(repayment.settlementId)
                  ? () =>
                      open({
                        type: "receive",
                        id: `settlement:${repayment.settlementId}`,
                      })
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
      {canRecord && net > 0 && (
        <Button
          variant="secondary"
          size="sm"
          className="inspector-wide-action"
          onClick={() => open({ type: "settlement" })}
        >
          Settle up
        </Button>
      )}
    </section>
  );
}

function CarriedLine({
  statement,
  month,
}: {
  statement: Statement;
  month: string;
}) {
  const { amount, from, opening } = statement.carried;
  const content = (
    <>
      <span className="shared-line-name">
        {from === "opening" ? "Opening amounts" : "Carried over"}
        <small>
          {from === "opening"
            ? opening.length
            : monthOnly(moveMonth(month, -1)).slice(0, 3)}
        </small>
      </span>
      <Direction effect={amount} />
    </>
  );
  if (from !== "opening") return <span className="shared-line">{content}</span>;
  return (
    <LinePopover
      trigger={content}
      title="Opening amounts"
      subtitle="Owed from before Caishen, already split"
    >
      <ul className="shared-breakdown-items">
        {opening.map((item) => (
          <li key={item.obligationId} className="is-opening">
            <span className="shared-item-name">
              <strong>{item.name}</strong>
            </span>
            <span className="shared-item-paid" />
            <small>Not split again</small>
            <small
              className={item.effect > 0 ? "is-owed-by-you" : "is-owed-to-you"}
            >
              {item.effect > 0 ? "you owe " : "owes you "}
              <Amount value={Math.abs(item.effect)} />
            </small>
          </li>
        ))}
      </ul>
    </LinePopover>
  );
}

function CategoryLine({
  view,
  category,
}: {
  view: View;
  category: StatementCategory;
}) {
  const { purchases } = category;
  const month = monthOnly(view.month);
  return (
    <LinePopover
      trigger={
        <>
          <span className="shared-line-name">
            {category.name}
            {purchases.length > 0 && <small>{purchases.length}</small>}
          </span>
          <Direction effect={category.effect} />
        </>
      }
      title={category.name}
      label={`${category.name} in ${month}`}
    >
      {purchases.length ? (
        <ul
          className="shared-breakdown-items"
          aria-label={`${category.name} purchases`}
        >
          {purchases.map((purchase) => (
            <PurchaseItem
              key={`${purchase.paidByYou}:${purchase.transactionId}`}
              purchase={purchase}
              month={view.month}
            />
          ))}
        </ul>
      ) : (
        <p className="shared-breakdown-empty">
          No shared purchases in {category.name} in {month}.
        </p>
      )}
    </LinePopover>
  );
}

function PurchaseItem({
  purchase,
  month,
}: {
  purchase: Purchase;
  month: string;
}) {
  const split = purchase.amountPaid
    ? Math.round((purchase.yourShare / purchase.amountPaid) * 100)
    : 0;
  return (
    <li>
      <span className="shared-item-name">
        <strong>{purchase.payee}</strong>
        {purchase.splitDiffersFromRule && (
          <span
            className="shared-split-tag"
            title="Split differs from the current rule"
          >
            {split}/{100 - split}
          </span>
        )}
        {purchase.status === "pending" && (
          <span className="shared-split-tag">Pending</span>
        )}
        {purchase.expenseMonth !== month && (
          <span className="shared-split-tag">
            For {monthOnly(purchase.expenseMonth)}
          </span>
        )}
      </span>
      <span className="shared-item-paid">
        <Amount value={purchase.amountPaid} />
      </span>
      <small>
        {shortDate(purchase.date)} ·{" "}
        {purchase.paidByYou ? "You paid" : "Your partner paid"} · your share{" "}
        <Amount value={purchase.yourShare} />
      </small>
      <small
        className={
          purchase.effect > 0
            ? "is-owed-by-you"
            : purchase.effect < 0
              ? "is-owed-to-you"
              : undefined
        }
      >
        {purchase.effect === 0 ? (
          "Nothing owed"
        ) : (
          <>
            {purchase.effect > 0 ? "you owe " : "owes you "}
            <Amount value={Math.abs(purchase.effect)} />
          </>
        )}
      </small>
    </li>
  );
}

function RepaymentLine({
  repayment,
  onConfirm,
}: {
  repayment: Repayment;
  onConfirm?: () => void;
}) {
  return (
    <span className="shared-line">
      <span className="shared-line-name">
        {repayment.paidByYou ? "You sent partner" : "Partner sent you"}
        <small>{shortDate(repayment.date)}</small>
        {!repayment.amount ? (
          <span className="shared-tag">Offset</span>
        ) : repayment.receivedOn ? null : onConfirm ? (
          <Button
            variant="ghost"
            size="sm"
            className="shared-confirm"
            onClick={onConfirm}
          >
            Confirm
          </Button>
        ) : (
          <span className="shared-tag">Pending</span>
        )}
      </span>
      <Amount value={repayment.amount} />
    </span>
  );
}

function LinePopover({
  trigger,
  title,
  subtitle,
  label = title,
  children,
}: {
  trigger: ReactNode;
  title: string;
  subtitle?: string;
  label?: string;
  children: ReactNode;
}) {
  const compact = useMediaQuery("(max-width: 1090px)");
  return (
    <Popover>
      <PopoverTrigger className="shared-line is-interactive">
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        side={compact ? "bottom" : "left"}
        align="center"
        sideOffset={10}
        collisionPadding={12}
        className="shared-breakdown"
        aria-label={label}
      >
        <div className="shared-breakdown-head">
          <div>
            <h4>{title}</h4>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <PopoverClose asChild>
            <Button variant="ghost" size="icon" aria-label={`Close ${label}`}>
              <Icon name="close" size={16} />
            </Button>
          </PopoverClose>
        </div>
        {children}
      </PopoverContent>
    </Popover>
  );
}
