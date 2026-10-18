import type { Command } from "~/domain/engine";
import type { CommandInput } from "~/components/budget/command-types";
import { money, text } from "~/components/budget/format";

export function buildReimbursementCommand({
  panel,
  view,
  operationId,
  entityId,
  data,
}: CommandInput): Command | undefined {
  const id = operationId;
  let command: Command | undefined;
  const claim = view.reimbursements.find((item) => item.id === panel.id);
  switch (panel.type) {
    case "reimbursement":
      command = {
        type: "reimbursement.expect",
        id,
        reimbursementId: entityId,
        transactionId: text(data, "transactionId"),
        name: text(data, "name"),
        amount: money(data, "amount"),
        kind: text(data, "kind") as "cash" | "statement-credit",
      };
      break;
    case "receive": {
      if (panel.id?.startsWith("settlement:"))
        command = {
          type: "settlement.receive",
          id,
          settlementId: panel.id.slice(11),
          accountId: text(data, "accountId"),
          date: text(data, "date"),
        };
      else if (claim)
        command = {
          type: "reimbursement.receive",
          id,
          reimbursementId: claim.id,
          accountId: text(data, "accountId"),
          date: text(data, "date"),
          amount: money(data, "amount"),
        };
      break;
    }
  }
  return command;
}
