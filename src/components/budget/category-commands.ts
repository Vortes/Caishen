import type { Command } from "~/domain/engine";
import type { CommandInput } from "~/components/budget/command-types";
import { money, text } from "~/components/budget/format";

export function buildCategoryCommand({
  panel,
  month,
  operationId,
  entityId,
  data,
}: CommandInput): Command | undefined {
  const id = operationId;
  let command: Command | undefined;
  switch (panel.type) {
    case "category":
      command = {
        type: "category.add",
        id,
        categoryId: entityId,
        name: text(data, "name"),
        group: text(data, "group") || "Everyday",
      };
      break;
    case "assign": {
      const from = text(data, "fromCategoryId");
      if (from)
        command = {
          type: "cover",
          id,
          fromCategoryId: from,
          toCategoryId: text(data, "categoryId"),
          month,
          amount: money(data, "amount"),
        };
      else
        command = {
          type: "assign",
          id,
          categoryId: text(data, "categoryId"),
          month,
          amount: money(data, "amount"),
        };
      break;
    }
  }
  return command;
}
