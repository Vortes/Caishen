import { rowsIn } from "~/domain/change-sets";
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
  // Keep only the settlement facts already visible to the surviving partner.
  const legs = original.budgets[userId]!.transactions.filter(
    (transaction) => !transaction.removed && transaction.partnerSettlementId,
  );
  if (legs.length) {
    removed.accounts.push({
      id: "retained-shared-records",
      name: "Shared activity",
      kind: "cash",
      openingBalance: 0,
      date: `${removed.startMonth}-01`,
    });
    removed.transactions = legs.map((transaction) => ({
      id: transaction.id,
      accountId: "retained-shared-records",
      date: transaction.date,
      expenseMonth: transaction.date.slice(0, 7),
      amount: transaction.amount,
      payee: "Partner settlement",
      status: transaction.status,
      revision: transaction.revision,
      reviewed: transaction.reviewed,
      kind: transaction.kind,
      linkedCounterpartyAccountId: transaction.linkedCounterpartyAccountId,
      partnerSettlementId: transaction.partnerSettlementId,
      history: [],
    }));
  }
  book.budgets[userId] = removed;
  book.audit = [];
  await removePersonalData(db, userId, {
    ...opened.household,
    rows: [
      ...bookToRows(withCounterpartyAccounts(book)),
      ...rowsIn(opened.household.rows).filter(
        (row) =>
          row.table === "bankImport" &&
          !row.deleted &&
          row.data?.userId !== userId,
      ),
    ],
  });
}
