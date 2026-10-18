"use client";

import type { ReactNode } from "react";
import type { Panel, View } from "~/components/budget/types";
import {
  currentMonth,
  monthName,
  moveMonth,
  shortDate,
} from "~/components/budget/format";
import { Amount, Icon } from "~/components/shared";
import { Button } from "~/components/ui/button";
import { useMediaQuery } from "~/components/shared/use-media-query";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

type Statement = View["sharedStatement"];
type StatementCategory = Statement["categories"][number];
type Purchase = StatementCategory["purchases"][number];
type Repayment = Statement["repayments"][number];

const monthOnly = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
  });

function Direction({ effect }: { effect: number }) {
  if (effect === 0) return <strong className="muted">Even</strong>;
  return (
    <>
      <Amount
        value={Math.abs(effect)}
        className={effect > 0 ? "is-owed-by-you" : "is-owed-to-you"}
      />
      <small>{effect > 0 ? "you owe" : "owed to you"}</small>
    </>
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
  const month = monthOnly(view.month);
  const canRecord = view.month >= currentMonth(view.budget.settings.timezone);
  return (
    <section className="inspector-section shared-balance">
      <h3>
        <span>
          <Icon name="shared" size={15} />
          Shared with your partner
        </span>
        {canRecord && (
          <Button variant="ghost" onClick={() => open({ type: "opening" })}>
            Add opening amount
          </Button>
        )}
      </h3>
      <div className="shared-verdict">
        <span>
          End of {monthName(view.month)}
          {net > 0
            ? " · you owe your partner"
            : net < 0
              ? " · your partner owes you"
              : ""}
        </span>
        {net !== 0 ? (
          <Amount
            value={Math.abs(net)}
            className={net > 0 ? "is-owed-by-you" : "is-owed-to-you"}
          />
        ) : (
          <strong>You’re even</strong>
        )}
      </div>
      <ul
        className="shared-statement"
        aria-label={`${monthName(view.month)} shared statement`}
      >
        <li>
          <CarriedLine statement={statement} month={view.month} />
        </li>
        {statement.categories.map((category) => (
          <li key={category.sharedCategoryId}>
            <CategoryLine view={view} category={category} />
          </li>
        ))}
        {statement.repayments.map((repayment) => (
          <li key={repayment.settlementId}>
            <RepaymentLine repayment={repayment} />
          </li>
        ))}
        <li className="shared-statement-total">
          <span className="shared-line">
            <span className="shared-line-name">
              <strong>Balance</strong>
              <small>End of {month}</small>
            </span>
            <span className="shared-line-amount">
              <Direction effect={statement.balance} />
            </span>
          </span>
        </li>
      </ul>
      {statement.awaitingYourConfirmation.map((settlement) => (
        <div className="shared-pending" key={settlement.settlementId}>
          <p className="inspector-note">
            Your partner recorded a repayment of{" "}
            <Amount value={settlement.amount} /> on {shortDate(settlement.date)}
            . Check that it reached your account, then record it.
          </p>
          {canRecord && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                open({
                  type: "receive",
                  id: `settlement:${settlement.settlementId}`,
                })
              }
            >
              Record receipt
            </Button>
          )}
        </div>
      ))}
      {!canRecord ? (
        <p className="inspector-note">
          You’re looking at a past month. Record repayments from the current
          month.
        </p>
      ) : net > 0 ? (
        <>
          <Button
            variant="secondary"
            size="sm"
            className="inspector-wide-action"
            onClick={() => open({ type: "settlement" })}
          >
            Record net repayment
          </Button>
          <p className="inspector-note">
            Pay your partner in your banking app first, then record it here.
          </p>
        </>
      ) : (
        net < 0 && (
          <p className="inspector-note">
            Your partner records the repayment from their budget. You confirm it
            once the money arrives.
          </p>
        )
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
        <strong>Owed from before {monthOnly(month)}</strong>
        <small>
          {from === "earlier-months"
            ? `Balance at the end of ${monthOnly(moveMonth(month, -1))}`
            : from === "opening"
              ? `${opening.length} opening ${opening.length === 1 ? "amount" : "amounts"}`
              : "Nothing carried over"}
        </small>
      </span>
      <span className="shared-line-amount">
        <Direction effect={amount} />
      </span>
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
            <strong>{category.name}</strong>
            <small>
              {purchases.length
                ? `${purchases.length} shared ${purchases.length === 1 ? "purchase" : "purchases"}`
                : `No shared purchases in ${month}`}
            </small>
          </span>
          <span className="shared-line-amount">
            <Direction effect={category.effect} />
          </span>
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

function RepaymentLine({ repayment }: { repayment: Repayment }) {
  const status = repayment.amount
    ? repayment.receivedOn
      ? `Received ${shortDate(repayment.receivedOn)}`
      : repayment.paidByYou
        ? "Waiting for your partner to confirm"
        : "Waiting for you to confirm"
    : "Offset only, no money moved";
  return (
    <span className="shared-line">
      <span className="shared-line-name">
        <strong>
          {repayment.paidByYou
            ? "You paid your partner"
            : "Your partner paid you"}
        </strong>
        <small>
          {shortDate(repayment.date)} · {status}
        </small>
      </span>
      <span className="shared-line-amount">
        <Amount value={repayment.amount} />
        <small>{repayment.paidByYou ? "you sent" : "sent to you"}</small>
      </span>
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
        <Icon name="chevron" size={15} />
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
