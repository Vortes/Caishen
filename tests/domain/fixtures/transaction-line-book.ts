import { createBook, execute, type Command } from "../../../src/domain/engine";

export function storedLineBook() {
  let book = createBook("alan", "Alan", "2026-10");
  const commands: Command[] = [
    { type: "account.add", id: "cash", accountId: "checking", name: "Checking", kind: "cash", openingBalance: 100_000 },
    { type: "category.add", id: "food", categoryId: "groceries", name: "Groceries" },
    { type: "category.add", id: "home", categoryId: "household", name: "Household" },
    { type: "transaction.upsert", id: "purchase", transactionId: "costco", accountId: "checking", date: "2026-10-10", payee: "Costco", amount: -20_000 },
  ];
  for (const command of commands) book = execute(book, "alan", command, "user");
  const budget = book.budgets.alan!;
  return {
    ...book,
    budgets: {
      alan: {
        ...budget,
        transactions: budget.transactions.map(transaction => ({
          ...transaction,
          lines: [
            { id: "food", categoryId: "groceries", amount: -15_000 },
            { id: "paper", categoryId: "household", amount: -5_000 },
          ],
        })),
      },
    },
  };
}
