"use client";

import { cn } from "~/lib/utils";
import type { ReactNode } from "react";
import type { Panel, State, View } from "~/components/budget/types";
import type { Category } from "~/components/budget/category-table";
import { Amount, Icon } from "~/components/shared";
import { Button } from "~/components/ui/button";
import { ReimbursementsSection } from "~/components/reimbursements/reimbursements-section";
import { SharedBalance } from "~/components/shared-expenses/shared-balance";
import {
  PartnerInvite,
  ShareCategory,
} from "~/components/shared-expenses/share-category";
import {
  partnerOf,
  sharePercent,
  sharedCategoryFor,
} from "~/components/shared-expenses/split";

export function CategoryInspector({
  view,
  selected,
  state,
  pending,
  open,
  onReview,
  onClear,
  targetEditor,
  showClose = false,
}: {
  view: View;
  selected: Category[];
  state: State;
  pending: number;
  open: (panel: Panel) => void;
  onReview: () => void;
  onClear: () => void;
  targetEditor?: ReactNode;
  showClose?: boolean;
}) {
  const category = selected.length === 1 ? selected[0] : undefined;
  const values = selected.length ? selected : view.categories;
  const total = (key: "assigned" | "activity" | "available") =>
    values.reduce((sum, item) => sum + item[key], 0);
  const partner = partnerOf(view);
  const shared = category && sharedCategoryFor(view, category.id);
  return (
    <aside
      className="category-inspector"
      aria-label={category ? `${category.name} details` : "Budget details"}
    >
      <div className="inspector-heading">
        <h2>
          {category?.name ??
            (selected.length
              ? `${selected.length} categories selected`
              : "Month summary")}
        </h2>
        {(selected.length > 0 || showClose) && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              selected.length
                ? "Clear category selection"
                : "Close budget details"
            }
            onClick={onClear}
          >
            <Icon name="close" size={16} />
          </Button>
        )}
      </div>
      {shared && (
        <div className="shared-rule">
          <span className="shared-mark">
            <Icon name="shared" size={13} />
            Shared with your partner
          </span>
          <span>
            You {sharePercent(shared.weights, view.budget.userId)}% · partner{" "}
            {100 - sharePercent(shared.weights, view.budget.userId)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Edit ${shared.name} split`}
            onClick={() => open({ type: "shared-category", id: shared.id })}
          >
            Edit split
          </Button>
        </div>
      )}
      <section className="inspector-section">
        <h3>
          {selected.length ? "Available balance" : "Available in categories"}
          <Amount
            value={total("available")}
            className={
              total("available") < 0
                ? "negative"
                : total("available") > 0
                  ? "positive"
                  : "muted"
            }
          />
        </h3>
        <dl className="inspector-values">
          <div>
            <dt>Assigned this month</dt>
            <dd>
              <Amount value={total("assigned")} />
            </dd>
          </div>
          <div>
            <dt>Activity this month</dt>
            <dd>
              <Amount value={total("activity")} />
            </dd>
          </div>
          {category && category.reserved > 0 && (
            <>
              <div>
                <dt>Set aside for your partner</dt>
                <dd>
                  <Amount value={category.reserved} />
                </dd>
              </div>
              <div>
                <dt>Spendable</dt>
                <dd>
                  <Amount value={category.spendable} />
                </dd>
              </div>
            </>
          )}
        </dl>
        {category && (
          <Button
            variant="secondary"
            size="sm"
            className="inspector-wide-action"
            onClick={() => open({ type: "assign", id: category?.id })}
          >
            <Icon name="transactions" size={14} />
            Move money
          </Button>
        )}
      </section>
      {category ? (
        <section className="inspector-section target-section">
          <h3>
            <span>
              <Icon name="target" size={15} />
              Target
            </span>
            {category.target && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => open({ type: "target", id: category.id })}
              >
                Edit
              </Button>
            )}
          </h3>
          {targetEditor ??
            (category.targetProgress ? (
              <>
                <div
                  className={cn(
                    "target-status",
                    category.targetProgress.snoozed && "is-snoozed",
                    !category.targetProgress.snoozed &&
                      category.targetProgress.needed === 0 &&
                      "is-funded",
                  )}
                >
                  <Icon
                    name={
                      category.targetProgress.snoozed
                        ? "clock"
                        : category.targetProgress.needed === 0
                          ? "check"
                          : "target"
                    }
                    size={30}
                  />
                  <strong>
                    {category.targetProgress.snoozed
                      ? "Snoozed this month"
                      : category.targetProgress.needed === 0
                        ? "You’ve reached your target"
                        : "Keep your target on track"}
                  </strong>
                </div>
                <dl className="inspector-values">
                  <div>
                    <dt>Target amount</dt>
                    <dd>
                      <Amount value={category.targetProgress.total} />
                    </dd>
                  </div>
                  <div>
                    <dt>Funded</dt>
                    <dd>
                      <Amount value={category.targetProgress.funded} />
                    </dd>
                  </div>
                  <div>
                    <dt>Still needed</dt>
                    <dd>
                      <Amount value={category.targetProgress.needed} />
                    </dd>
                  </div>
                </dl>
                <Button
                  variant="secondary"
                  size="sm"
                  className="inspector-wide-action"
                  onClick={() => open({ type: "target", id: category.id })}
                >
                  Edit target
                </Button>
              </>
            ) : (
              <div className="target-empty">
                <Icon name="target" size={30} />
                <h4>What’s your plan for {category.name}?</h4>
                <p>
                  Set a target to see how much to set aside and track your
                  progress.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Set target for ${category.name}`}
                  onClick={() => open({ type: "target", id: category.id })}
                >
                  Create target
                </Button>
              </div>
            ))}
        </section>
      ) : (
        <>
          <section className="inspector-section">
            <h3>Spending this month</h3>
            <dl className="inspector-values">
              <div>
                <dt>Your personal share</dt>
                <dd>
                  <Amount value={view.personalSpending} />
                </dd>
              </div>
              <div>
                <dt>Full amount paid</dt>
                <dd>
                  <Amount value={view.amountPaid} />
                </dd>
              </div>
            </dl>
            <p className="inspector-note">
              Your personal share includes your part of shared expenses.
            </p>
          </section>
          <section className="inspector-section">
            <h3>
              <span>
                <Icon name="check" size={15} />
                Review inbox
              </span>
              {pending > 0 && <span className="nav-count">{pending}</span>}
            </h3>
            <p className="inspector-note">
              {pending
                ? `${pending} ${pending === 1 ? "item needs" : "items need"} your review. They’ll stay here until resolved.`
                : "You’re all caught up. New activity will appear here for your review."}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="inspector-wide-action"
              onClick={onReview}
            >
              Open review inbox
              <Icon name="arrow" size={14} />
            </Button>
          </section>
        </>
      )}
      {category?.pairedAccountId && (
        <section className="inspector-section">
          <h3>Credit card payment</h3>
          <p className="inspector-note">
            Record a payment after you’ve paid your card.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              open({ type: "card-payment", id: category.pairedAccountId })
            }
          >
            Record a card payment
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              open({ type: "statement-credit", id: category.pairedAccountId })
            }
          >
            Statement credit
          </Button>
        </section>
      )}
      {category &&
        partner &&
        !shared &&
        !category.pairedAccountId &&
        !category.pairedLoanId && (
          <ShareCategory category={category} open={open} />
        )}
      {!selected.length &&
        (!partner ? (
          <PartnerInvite open={open} />
        ) : view.sharedCategories.length ? (
          <SharedBalance view={view} open={open} />
        ) : (
          <section className="inspector-section">
            <h3>
              <span>
                <Icon name="shared" size={15} />
                Shared with your partner
              </span>
            </h3>
            <p className="inspector-note">
              Select a category like rent or groceries, then choose Share this
              category to split it.
            </p>
          </section>
        ))}
      {!selected.length && <ReimbursementsSection view={view} open={open} />}
      {state.evidence.length > 0 && !selected.length && (
        <section className="inspector-section">
          <h3>Latest reconciliation</h3>
          {state.evidence.slice(0, 3).map((evidence) => (
            <div className="reconciliation-note" key={evidence.id}>
              <span
                className={`badge ${evidence.result.status === "reconciled" ? "" : "warning"}`}
              >
                {evidence.result.status === "reconciled"
                  ? "Matched"
                  : "Needs review"}
              </span>
              <span>
                {
                  view.accounts.find(
                    (account) => account.id === evidence.accountId,
                  )?.name
                }{" "}
                · {evidence.cutoff}
              </span>
            </div>
          ))}
        </section>
      )}
      <div className="inspector-footer">
        <Icon name="shield" size={14} />
        You decide where your money goes.
      </div>
    </aside>
  );
}
