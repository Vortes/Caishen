import type { Command } from "~/domain/engine";
import type { CommandInput } from "~/components/budget/command-types";
import { money, text } from "~/components/budget/format";

export function buildAccountCommand({
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
    case "account": {
      const kind = text(data, "kind") as "cash" | "credit";
      command = {
        type: "account.add",
        id,
        accountId: entityId,
        name: text(data, "name"),
        kind,
        openingBalance:
          kind === "credit"
            ? -Math.abs(money(data, "openingBalance"))
            : money(data, "openingBalance"),
        date: text(data, "date"),
      };
      break;
    }
    case "card-payment":
      command = {
        type: "card.payment",
        id,
        cashAccountId: text(data, "cashAccountId"),
        cardAccountId: text(data, "cardAccountId"),
        date: text(data, "date"),
        amount: money(data, "amount"),
      };
      break;
    case "statement-credit":
      command = {
        type: "card.credit",
        id,
        accountId: text(data, "accountId"),
        date: text(data, "date"),
        amount: money(data, "amount"),
        reimbursementId: claim?.id,
        posted: true,
      };
      break;
  }
  return command;
}
