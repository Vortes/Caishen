"use client";

import type { Panel, View } from "~/components/budget/types";
import { Amount, Icon } from "~/components/shared";
import { Button } from "~/components/ui-legacy/button";

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
  const expected = view.reimbursements.filter((claim) => claim.outstanding > 0);
  if (!reimbursable && !expected.length) return null;
  return (
    <section className="inspector-section">
      <h3>
        Expected back
        <Button
          variant="ghost"
          size="icon"
          aria-label="Add expected reimbursement"
          disabled={!reimbursable}
          onClick={() => open({ type: "reimbursement" })}
        >
          <Icon name="plus" size={16} />
        </Button>
      </h3>
      {expected.length > 0 && (
        <ul className="reimbursement-list">
          {expected.map((claim) => (
            <li key={claim.id}>
              <span>{claim.name}</span>
              <Amount value={claim.outstanding} />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Record ${claim.name} received`}
                onClick={() =>
                  open({
                    type:
                      claim.kind === "cash" ? "receive" : "statement-credit",
                    id: claim.id,
                  })
                }
              >
                Received
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
