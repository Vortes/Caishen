/** Legacy account migration: copies the retired connection JSON lists into provider-account and link rows once under the connection lock. The legacy decoder remains here for that copy and stored-data compatibility; ordinary reads project rows. */

import { type Database } from "./household";
import { readHouseholdRevision } from "~/server/storage/rows";
import { lockBankConnections } from "./bank-account-rows";
import { bankMappingsSchema as mappingsSchema } from "./bank-account-setup";
import { jsonValue, domainError } from "./safety";
import { readColumn, connectionColumnSchema } from "./banks/inbox";

/** Copy legacy identities and links once, while the rollback writer is locked out. */
export async function migrateBankAccounts(db: Database, userId: string) {
  const legacy = await db.bankConnection.findMany({
    where: { clerkUserId: userId, bankAccounts: { none: {} } },
    select: { id: true },
  });
  if (!legacy.length) return;
  const household = await readHouseholdRevision(db, userId);
  if (!household) return;
  try {
    await db.$transaction(
      async (tx) => {
        await lockBankConnections(
          tx,
          userId,
          legacy.map(({ id }) => id),
        );
        const connections = await tx.bankConnection.findMany({
          where: {
            id: { in: legacy.map(({ id }) => id) },
            clerkUserId: userId,
            bankAccounts: { none: {} },
          },
        });
        for (const connection of connections) {
          const column = readColumn(
            connection,
            "BankConnection.imports",
            connectionColumnSchema,
            connection.imports,
          );
          const links = readColumn(
            connection,
            "BankConnection.accountMappings",
            mappingsSchema,
            connection.accountMappings,
          );
          if (!column || !links) continue;
          const accounts = new Map(
            column.accounts.map((account) => [account.accountId, account]),
          );
          for (const providerId of Object.keys(links))
            if (!accounts.has(providerId))
              accounts.set(providerId, {
                accountId: providerId,
                name: "Previously linked account",
                officialName: null,
                mask: null,
                type: "unknown",
                subtype: null,
                currency: null,
                currentBalance: null,
                availableBalance: null,
              });
          for (const account of accounts.values()) {
            const missing = !column.accounts.some(
              (saved) => saved.accountId === account.accountId,
            );
            const { accountId, persistentAccountId, ...details } = account;
            const mapping = links[accountId];
            await tx.bankAccount.create({
              data: {
                connectionId: connection.id,
                providerAccountId: accountId,
                persistentAccountId: persistentAccountId ?? null,
                ...details,
                status:
                  missing ||
                  column.disconnectedAt ||
                  connection.unavailableAccountIds.includes(accountId)
                    ? "unavailable"
                    : "shared",
                historyComplete:
                  column.synchronizedAccountIds.includes(accountId),
                ...(mapping
                  ? {
                      link: {
                        create: {
                          workspaceId: household.workspaceId,
                          userId,
                          accountId: mapping.accountId,
                          startDate: mapping.startDate,
                          ...(mapping.openingSnapshot
                            ? {
                                openingSnapshot: jsonValue(
                                  mapping.openingSnapshot,
                                ),
                              }
                            : {}),
                        },
                      },
                    }
                  : {}),
              },
            });
          }
        }
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    domainError(error);
  }
}
