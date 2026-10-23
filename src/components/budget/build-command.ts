import { buildAccountCommand } from "~/components/accounts/commands";
import { buildCategoryCommand } from "~/components/budget/category-commands";
import type { CommandInput } from "~/components/budget/command-types";
import { buildLoanCommand } from "~/components/loans/commands";

export function buildCommand(input: CommandInput) {
  switch (input.panel.type) {
    case "account":
    case "card-payment":
    case "statement-credit":
      return buildAccountCommand(input);
    case "category":
    case "assign":
      return buildCategoryCommand(input);
    case "loan":
    case "loan-payment":
    case "rate":
      return buildLoanCommand(input);
    default:
      return undefined;
  }
}
