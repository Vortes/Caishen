"use client";

import type { Panel, View } from "~/components/budget/types";
import { Amount, Icon } from "~/components/shared";
import { Button } from "~/components/ui/button";

export function ReimbursementsSection({
  view,
  open,
}: {
  view: View;
  open: (panel: Panel) => void;
}) {
  const reimbursable = view.budget.transactions.some(
    (item) =>
      !item.removed &&
      item.amount < 0 &&
      item.kind === "purchase" &&
      !item.sharedCategoryId,
  );
  if (!reimbursable && !view.reimbursements.length) return null;
  return (
    <section className="inspector-section">
      <h3>
        <span>
          <Icon name="transactions" size={15} />
          Expected reimbursements
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!reimbursable}
          onClick={() => open({ type: "reimbursement" })}
        >
          <Icon name="plus" size={14} />
          Add
        </Button>
      </h3>
      {view.reimbursements.length ? (
        <ul className="reimbursement-list">
          {view.reimbursements.map((claim) => (
            <li key={claim.id}>
              <span>
                <strong>{claim.name}</strong>
                <small>
                  <Amount value={claim.outstanding} /> expected ·{" "}
                  {claim.kind === "cash" ? "cash" : "statement credit"}
                </small>
              </span>
              {claim.outstanding > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    open({
                      type:
                        claim.kind === "cash" ? "receive" : "statement-credit",
                      id: claim.id,
                    })
                  }
                >
                  Record received
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="inspector-note">
          Expected money isn’t spendable yet. Record it when it actually
          arrives.
        </p>
      )}
    </section>
  );
}
