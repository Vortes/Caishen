import { previewBudgetProjection, type Command } from "~/domain/engine";
import { budgetDay, prepareUserCommand } from "~/domain/user-command";
import type { State, View } from "~/components/budget/types";

function metadataView(view: View, command: Command): View {
  const budget = view.budget;
  switch (command.type) {
    case "transaction.approve": {
      const ids = new Set(command.transactionIds);
      const transactions = budget.transactions.filter(
        (transaction) => ids.has(transaction.id) && !transaction.removed,
      );
      if (
        transactions.length !== ids.size ||
        transactions.some(
          (transaction) =>
            transaction.kind === "purchase" &&
            transaction.amount < 0 &&
            !transaction.categoryId,
        )
      )
        return view;
      return {
        ...view,
        budget: {
          ...budget,
          transactions: budget.transactions.map((transaction) =>
            ids.has(transaction.id)
              ? { ...transaction, reviewed: true }
              : transaction,
          ),
        },
      };
    }
    case "income.expect": {
      if (command.month < budget.startMonth) return view;
      const expectedIncome = { ...budget.expectedIncome };
      if (command.amount === null) delete expectedIncome[command.month];
      else expectedIncome[command.month] = command.amount;
      return {
        ...view,
        budget: { ...budget, expectedIncome },
        expectedIncome:
          command.month === view.month ? command.amount : view.expectedIncome,
      };
    }
    default:
      return view;
  }
}

export function optimisticState(
  state: State,
  input: Command,
  now = new Date(),
): State {
  const view = state.view;
  if (!view) return state;
  try {
    const command = prepareUserCommand(view.budget, input, now);
    if (view.audit.some((entry) => entry.id === command.id)) return state;
    // Settings key the preferences form; pending changes must not remount its draft.
    if (command.type === "settings.update") return state;
    if (
      command.type === "transaction.approve" ||
      command.type === "income.expect"
    ) {
      const next = metadataView(view, command);
      return next === view ? state : { ...state, view: next };
    }
    const projected = previewBudgetProjection(
      view,
      command,
      budgetDay(view.budget.settings.timezone, now).slice(0, 7),
    );
    return { ...state, view: { ...projected, audit: view.audit } };
  } catch {
    // Prediction is optional; the server still validates and executes the command.
    return state;
  }
}
