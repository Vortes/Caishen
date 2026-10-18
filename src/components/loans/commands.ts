import type { Command } from "~/domain/engine";
import type { CommandInput } from "~/components/budget/command-types";
import { money, text } from "~/components/budget/format";

export function buildLoanCommand({
  panel,
  view,
  operationId,
  entityId,
  data,
}: CommandInput): Command | undefined {
  const id = operationId;
  let command: Command | undefined;
  const loan = view.loans.find((item) => item.id === panel.id);
  switch (panel.type) {
    case "loan":
      command = {
        type: "loan.add",
        id,
        loanId: entityId,
        categoryId: text(data, "categoryId") || `${entityId}:category`,
        name: text(data, "name"),
        principal: money(data, "principal"),
        annualRateBps: Math.round(Number(text(data, "annualRate")) * 100),
        minimumPayment: money(data, "minimumPayment"),
        variable: text(data, "variable") === "variable",
        effectiveDate: text(data, "effectiveDate"),
      };
      break;
    case "loan-payment":
      if (loan)
        command = {
          type: "loan.payment",
          id,
          loanId: loan.id,
          accountId: text(data, "accountId"),
          date: text(data, "date"),
          principal: money(data, "principal"),
          interest: money(data, "interest"),
        };
      break;
    case "rate":
      if (loan)
        command = {
          type: "loan.rate",
          id,
          loanId: loan.id,
          annualRateBps: Math.round(Number(text(data, "annualRate")) * 100),
          effectiveDate: text(data, "effectiveDate"),
        };
      break;
  }
  return command;
}
