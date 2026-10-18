import type { Command } from "~/domain/engine";
import type { CommandInput } from "~/components/budget/command-types";
import { text } from "~/components/budget/format";

export function buildRuleCommand({
  panel,
  operationId,
  entityId,
  data,
}: CommandInput): Command | undefined {
  const id = operationId;
  let command: Command | undefined;
  switch (panel.type) {
    case "rule":
      command = {
        type: "rule.set",
        id,
        ruleId: entityId,
        fromCategoryId: text(data, "fromCategoryId"),
        toCategoryId: text(data, "toCategoryId"),
        enabled: true,
      };
      break;
  }
  return command;
}
