/** Legacy account migration: copies the retired connection JSON lists into provider-account and link rows once under the connection lock. The legacy decoder remains here for that copy and stored-data compatibility; ordinary reads project rows. */

import { type Database } from "./household";
import { readHouseholdRevision } from "~/server/storage/rows";
import { lockBankConnections } from "./bank-account-rows";
import { bankMappingsSchema as mappingsSchema } from "./bank-account-setup";
import { jsonValue, domainError } from "./safety";
import { z } from "zod";
import { bankAccountSchema } from "~/server/integrations/plaid";
import { importRowStateShape } from "./bank-import-rows";
import { reportUnreadable, zodIssues } from "./stored-data";

const connectionDetailsShape = {
  disconnectedAt: z.string().datetime().optional(),
  accounts: z.array(bankAccountSchema).max(1000).default([]),
  institutionId: z.string().max(256).nullable().default(null),
  institutionName: z.string().max(1024).nullable().default(null),
  transactionStatus: z.string().max(100).nullable().default(null),
  synchronizedAccountIds: z
    .array(z.string().min(1).max(256))
    .max(1000)
    .default([]),
};

/** A connection's whole import state, as the bank code works with it. */
export const importStateSchema = z
  .object({ ...importRowStateShape, ...connectionDetailsShape })
  .strict();

/**
 * BankConnection.imports: the connection's own details. Import state moved
 * to bankImport rows (ADR 0006); connections saved before keep it here for
 * the one-time copy into rows, and nothing else reads it.
 */
export const connectionColumnSchema = z
  .object({
    records: importRowStateShape.records.optional(),
    resolved: importRowStateShape.resolved.optional(),
    errors: importRowStateShape.errors.optional(),
    reviews: importRowStateShape.reviews,
    ...connectionDetailsShape,
  })
  .strict();

export function decodeLegacyBankAccounts(connection: {
  id: string;
  clerkUserId: string;
  imports: unknown;
  accountMappings?: unknown;
}) {
  const column = connectionColumnSchema.safeParse(connection.imports);
  const links = mappingsSchema.safeParse(connection.accountMappings ?? {});
  if (!column.success)
    reportUnreadable(
      {
        record: "BankConnection.imports",
        connectionId: connection.id,
        userId: connection.clerkUserId,
      },
      [{ issues: zodIssues(column.error) }],
    );
  if (!links.success)
    reportUnreadable(
      {
        record: "BankConnection.accountMappings",
        connectionId: connection.id,
        userId: connection.clerkUserId,
      },
      [{ issues: zodIssues(links.error) }],
    );
  return column.success && links.success
    ? { column: column.data, links: links.data }
    : undefined;
}

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
          const legacy = decodeLegacyBankAccounts(connection);
          if (!legacy) continue;
          const { column, links } = legacy;
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
