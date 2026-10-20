"use client";

import { Amount } from "~/components/shared";
import type { View } from "~/components/budget/types";
import type { TransactionHistory as HistoryEntry } from "~/domain/engine";

const reasonLabels: Record<HistoryEntry["reason"], string> = {
  created: "Created",
  updated: "Updated",
  categorized: "Categorized",
  merged: "Merged",
  removed: "Removed",
  undone: "Change undone",
  redone: "Change redone",
};

export function TransactionHistory({
  transaction,
}: {
  transaction: NonNullable<View>["budget"]["transactions"][number];
}) {
  return (
    <details>
      <summary className="small muted" style={{ cursor: "pointer" }}>
        Transaction history · {transaction.history.length}{" "}
        {transaction.history.length === 1 ? "record" : "records"}
      </summary>
      <ul className="audit-list" style={{ marginTop: 10 }}>
        {transaction.history.map((entry, index) => (
          <li key={`${entry.operationId}-${index}`}>
            <span className="muted">Revision {entry.revision}</span>
            <span>
              {reasonLabels[entry.reason]} · <Amount value={entry.amount} /> ·{" "}
              {entry.status}
              <small className="muted" style={{ display: "block" }}>
                {entry.date} · {entry.payee}
              </small>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
