import type { Command } from "~/domain/engine";
import type { CommandInput } from "~/components/budget/command-types";
import { money, text } from "~/components/budget/format";

export function buildSharedCommand({
  panel,
  view,
  operationId,
  entityId,
  data,
}: CommandInput): Command | undefined {
  const id = operationId;
  let command: Command | undefined;
  const shared = view.sharedCategories.find((item) => item.id === panel.id);
  const partner = view.members.find(
    (member) => member.userId !== view.budget.userId,
  );
  switch (panel.type) {
    case "shared-category": {
      if (!partner)
        throw new Error(
          "Connect with your partner before creating a shared category.",
        );
      const percent = Number(text(data, "percent"));
      const weights = {
        [view.budget.userId]: percent,
        [partner.userId]: 100 - percent,
      };
      if (shared)
        command = {
          type: "shared.rule",
          id,
          sharedCategoryId: shared.id,
          weights,
        };
      else
        command = {
          type: "shared.create",
          id,
          sharedCategoryId: entityId,
          participants: [view.budget.userId, partner.userId],
          weights,
          categoryIds: {
            [view.budget.userId]: text(data, "categoryId"),
            [partner.userId]: `${entityId}:partner`,
          },
        };
      break;
    }
    case "opening": {
      if (!partner) throw new Error("Connect with your partner first.");
      const youOwe = text(data, "direction") === "you-owe";
      command = {
        type: "opening.add",
        id,
        obligationId: entityId,
        sharedCategoryId: text(data, "sharedCategoryId"),
        debtorId: youOwe ? view.budget.userId : partner.userId,
        creditorId: youOwe ? partner.userId : view.budget.userId,
        amount: money(data, "amount"),
      };
      break;
    }
    case "settlement": {
      if (!partner) throw new Error("Connect with your partner first.");
      command = {
        type: "settlement.record",
        id,
        settlementId: entityId,
        otherUserId: partner.userId,
        date: text(data, "date"),
        accountId: text(data, "accountId") || undefined,
        amount: money(data, "amount"),
      };
      break;
    }
  }
  return command;
}
