import {
  createBook,
  withCounterpartyAccounts,
  type Book,
} from "~/domain/engine";
import { bookToRows } from "~/domain/rows";
import { removePersonalData } from "~/server/storage/account-deletion";
import { createPlaidClient } from "~/server/integrations/plaid";
import { decryptBankToken } from "~/server/token-crypto";
import { openHousehold, type Database } from "./household";
import { cancelScheduledDailyReviews } from "./daily-delivery";

// Called after Clerk has confirmed user.deleted. A failed cleanup is retried
// by the signed webhook; the inactive user cannot read or change a budget.
export async function deletePersonalBudget(db: Database, userId: string) {
  const user = await db.user.findUnique({ where: { clerkUserId: userId } });
  if (!user || user.active)
    throw new Error("Account deletion requires a confirmed deleted identity.");
  await cancelScheduledDailyReviews(db, userId);
  const connections = await db.bankConnection.findMany({
    where: { clerkUserId: userId },
  });
  if (connections.length) {
    const plaid = createPlaidClient({
      clientId: process.env.PLAID_CLIENT_ID!,
      secret: process.env.PLAID_SECRET!,
      environment:
        process.env.PLAID_ENV === "production" ? "production" : "sandbox",
    });
    for (const connection of connections)
      await plaid.removeItem(
        decryptBankToken(connection.encryptedToken, userId),
      );
  }
  const opened = await openHousehold(db, userId);
  if (!opened) {
    await removePersonalData(db, userId);
    return;
  }
  if (
    opened.ledger.status !== "ready" ||
    opened.ledger.personal ||
    opened.ledger.failures.length
  )
    throw new Error(
      "Account deletion is waiting for household maintenance to finish.",
    );
  const original = opened.ledger.state as Book;
  if (Object.keys(original.budgets).length === 1) {
    await removePersonalData(db, userId, {
      workspaceId: opened.household.workspaceId,
      revision: opened.household.revision,
    });
    return;
  }
  const book = structuredClone(original);
  const removed = createBook(
    userId,
    "Deleted partner",
    book.budgets[userId]!.startMonth,
  ).budgets[userId]!;
  removed.settings.emailEnabled = false;
  for (const shared of book.sharedCategories) {
    shared.archived = true;
    removed.categories.push({
      id: shared.categoryIds[userId]!,
      name: "Shared category",
      group: "Shared",
    });
  }
  const settlementIds = new Set(
    book.settlements.map((settlement) => settlement.id),
  );
  const sharedRecords = original.budgets[userId]!.transactions.filter(
    (transaction) =>
      !transaction.removed &&
      (Boolean(transaction.sharedCategoryId) ||
        (transaction.linkedId && settlementIds.has(transaction.linkedId))),
  );
  if (sharedRecords.length) {
    removed.accounts.push({
      id: "retained-shared-records",
      name: "Shared activity",
      kind: "cash",
      openingBalance: 0,
      date: `${removed.startMonth}-01`,
    });
    removed.transactions = sharedRecords.map((transaction) => ({
      id: transaction.id,
      accountId: "retained-shared-records",
      date: transaction.date,
      amount: transaction.amount,
      payee: transaction.payee,
      status: transaction.status,
      categoryId: transaction.sharedCategoryId
        ? transaction.categoryId
        : undefined,
      expenseMonth: transaction.expenseMonth,
      sharedCategoryId: transaction.sharedCategoryId,
      shares: transaction.shares,
      splitWeights: transaction.splitWeights,
      revision: transaction.revision,
      reviewed: transaction.reviewed,
      kind: transaction.kind,
      linkedId: transaction.linkedId,
      history: [],
    }));
  }
  book.budgets[userId] = removed;
  book.audit = [];
  await removePersonalData(db, userId, {
    ...opened.household,
    rows: bookToRows(withCounterpartyAccounts(book)),
  });
}
