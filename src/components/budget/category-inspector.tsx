"use client";

import type { Command } from "~/domain/engine";
import type { Panel, State, View } from "~/components/budget/types";
import type { Category } from "~/components/budget/category-table";
import { monthName } from "~/components/budget/format";
import { Amount, Icon } from "~/components/shared";
import { Button } from "~/components/ui-legacy/button";
import { AutoAssignSection } from "~/components/budget/auto-assign-section";
import { AvailableSection } from "~/components/budget/available-section";
import { CostToBeMe } from "~/components/budget/cost-to-be-me";
import { TargetSection } from "~/components/budget/target-section";
import { ReimbursementsSection } from "~/components/reimbursements/reimbursements-section";
import { SharedBalance } from "~/components/shared-expenses/shared-balance";
import {
  PartnerSettingsLink,
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
  busy,
  run,
  open,
  onClear,
  showClose = false,
}: {
  view: View;
  selected: Category[];
  state: State;
  busy: boolean;
  run: (command: Command) => void;
  open: (panel: Panel) => void;
  onClear: () => void;
  showClose?: boolean;
}) {
  const category = selected.length === 1 ? selected[0] : undefined;
  const partner = partnerOf(view);
  const shared = category && sharedCategoryFor(view, category.id);
  const card = view.accounts.find(
    (account) => account.id === category?.pairedAccountId,
  );
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
              : monthName(view.month).split(" ")[0])}
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
        <Button
          variant="ghost"
          size="sm"
          className="shared-rule"
          aria-label={`Edit ${shared.name} split`}
          onClick={() => open({ type: "shared-category", id: shared.id })}
        >
          <Icon name="shared" size={13} />
          Shared · you {sharePercent(shared.weights, view.budget.userId)}%
        </Button>
      )}
      {!selected.length && <CostToBeMe view={view} run={run} />}
      <AvailableSection view={view} selected={selected} busy={busy} run={run} />
      {category && (
        <TargetSection
          key={category.id}
          view={view}
          month={view.month}
          category={category}
          busy={busy}
          run={run}
        />
      )}
      <AutoAssignSection
        view={view}
        selected={selected}
        busy={busy}
        run={run}
      />
      {card && (
        <section className="inspector-section">
          <h3>Card balance</h3>
          <dl className="inspector-values">
            {(
              [
                ["Start of month", card.priorBalance],
                ["Spending", card.outflows],
                ["Payments and credits", card.inflows],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <Amount value={value} signed />
                </dd>
              </div>
            ))}
            <div className="inspector-values-total">
              <dt>Current balance</dt>
              <dd>
                <Amount
                  value={card.balance}
                  className={card.balance < 0 ? "negative" : undefined}
                />
              </dd>
            </div>
          </dl>
          <div className="inspector-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => open({ type: "card-payment", id: card.id })}
            >
              Record a card payment
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                open({
                  type: "statement-credit",
                  id: card.id,
                })
              }
            >
              Statement credit
            </Button>
          </div>
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
          <PartnerSettingsLink />
        ) : view.sharedCategories.length ? (
          <SharedBalance view={view} open={open} />
        ) : (
          <section className="inspector-section">
            <h3>Partner</h3>
            <p className="inspector-note">
              Select a category like rent, then share it to split its purchases.
            </p>
          </section>
        ))}
      {!selected.length && <ReimbursementsSection view={view} open={open} />}
      {state.evidence.length > 0 && !selected.length && (
        <section className="inspector-section">
          <h3>Reconciliation</h3>
          {state.evidence.slice(0, 3).map((evidence) => (
            <div className="reconciliation-note" key={evidence.id}>
              <span>
                {
                  view.accounts.find(
                    (account) => account.id === evidence.accountId,
                  )?.name
                }{" "}
                · {evidence.cutoff}
              </span>
              <span
                className={`badge ${evidence.result.status === "reconciled" ? "" : "warning"}`}
              >
                {evidence.result.status === "reconciled"
                  ? "Matched"
                  : "Needs review"}
              </span>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}
