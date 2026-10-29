import type { Book } from "~/domain/engine";
import { removePersonalData } from "~/server/storage/account-deletion";
import { createPlaidClient } from "~/server/integrations/plaid";
import { plaidRequestRecorder } from "./bank-provider-events";
import { decryptBankToken } from "~/server/token-crypto";
import { openHousehold, type Database } from "./household";
import { cancelScheduledDailyReviews } from "./daily-delivery";
import { disconnectPartner } from "./household-operations";

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
    const config = {
      clientId: process.env.PLAID_CLIENT_ID!,
      secret: process.env.PLAID_SECRET!,
      environment:
        process.env.PLAID_ENV === "production" ? "production" : "sandbox",
    } as const;
    for (const connection of connections)
      await createPlaidClient(
        config,
        undefined,
        plaidRequestRecorder(db, { userId, connectionId: connection.id }),
      ).removeItem(decryptBankToken(connection.encryptedToken, userId));
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
  // A partner keeps the shared ledger as it stood, as when either of them
  // disconnects, with the deleted member's name redacted.
  if (Object.keys((opened.ledger.state as Book).budgets).length > 1) {
    await disconnectPartner(db, userId, { deleting: true });
    await removePersonalData(db, userId);
    return;
  }
  await removePersonalData(db, userId, {
    workspaceId: opened.household.workspaceId,
    revision: opened.household.revision,
  });
}
