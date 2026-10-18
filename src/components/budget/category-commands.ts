import type { Command } from "~/domain/engine";
import type { CommandInput } from "~/components/budget/command-types";
import { money, text } from "~/components/budget/format";

export function buildCategoryCommand({
  panel,
  view,
  month,
  operationId,
  entityId,
  data,
}: CommandInput): Command | undefined {
  const id = operationId;
  let command: Command | undefined;
  const category = view.categories.find((item) => item.id === panel.id);
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
    case "target": {
      if (!category) throw new Error("Choose a category.");
      command = {
        type: "target.set",
        id,
        categoryId: category.id,
        target: {
          cadence: text(data, "cadence") as
            | "weekly"
            | "monthly"
            | "yearly"
            | "custom"
            | "card-monthly"
            | "card-payoff"
            | "loan",
          behavior: text(data, "behavior") as
            "contribution" | "refill" | "balance",
          amount: money(data, "amount"),
          startMonth: text(data, "startMonth"),
          dueDate: text(data, "dueDate") || undefined,
          weekday: text(data, "weekday")
            ? Number(text(data, "weekday"))
            : undefined,
          repeatEvery: text(data, "repeatEvery")
            ? Number(text(data, "repeatEvery"))
            : undefined,
          repeatUnit: text(data, "repeatUnit")
            ? (text(data, "repeatUnit") as "months" | "years")
            : undefined,
          snoozedMonths: category.target?.snoozedMonths ?? [],
        },
      };
      break;
    }
  }
  return command;
}
