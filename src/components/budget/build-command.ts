import { buildAccountCommand } from "~/components/accounts/commands";
import { buildCategoryCommand } from "~/components/budget/category-commands";
import type { CommandInput } from "~/components/budget/command-types";
import { buildLoanCommand } from "~/components/loans/commands";
import { buildReimbursementCommand } from "~/components/reimbursements/commands";
import { buildRuleCommand } from "~/components/settings/rule-command";
import { buildSharedCommand } from "~/components/shared-expenses/commands";

export function buildCommand(input: CommandInput) {
  switch (input.panel.type) {
    case "account":
    case "card-payment":
    case "statement-credit":
      return buildAccountCommand(input);
    case "category":
    case "assign":
    case "target":
      return buildCategoryCommand(input);
    case "loan":
    case "loan-payment":
    case "rate":
      return buildLoanCommand(input);
    case "reimbursement":
    case "receive":
      return buildReimbursementCommand(input);
    case "rule":
      return buildRuleCommand(input);
    case "shared-category":
    case "opening":
    case "settlement":
      return buildSharedCommand(input);
    default:
      return undefined;
  }
}
