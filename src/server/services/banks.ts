import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "~/generated/prisma";
import { bookSchema, execute, type Command } from "~/domain/engine";
import { createPlaidClient } from "~/server/integrations/plaid";
import {
  applyTransactionSync,
  storedImportsSchema,
  type StoredImport,
} from "~/server/integrations/transactions";
import { decryptBankToken, encryptBankToken } from "~/server/token-crypto";
import { commandHash, domainError, jsonValue } from "./safety";
import { readWorkspace, type Database } from "./workspace";

const mappingsSchema = z.record(
  z.object({ accountId: z.string(), startDate: z.string() }),
);
type ImportState = {
  records: StoredImport[];
  resolved: Record<
    string,
    {
      fingerprint: string;
      transactionId?: string;
      ignored?: boolean;
      decidedAt?: string;
    }
  >;
  errors: Record<string, string>;
  reviews: Record<string, unknown[]>;
};
const importStateSchema = z
  .object({
    records: storedImportsSchema,
    resolved: z.record(
      z
        .object({
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          transactionId: z.string().optional(),
          ignored: z.boolean().optional(),
          decidedAt: z.string().datetime().optional(),
        })
        .strict(),
    ),
    errors: z.record(z.string()),
    reviews: z.record(z.array(z.unknown()).max(100)).default({}),
  })
  .strict();
function importState(value: unknown): ImportState {
  return importStateSchema.parse(value);
}

const fingerprint = (record: StoredImport) =>
  commandHash({
    current: record.current,
    removed: record.removed,
    matchStatus: record.matchStatus,
  });
function client() {
  return createPlaidClient({
    clientId: process.env.PLAID_CLIENT_ID ?? "",
    secret: process.env.PLAID_SECRET ?? "",
    environment: z
      .enum(["sandbox", "production"])
      .parse(process.env.PLAID_ENV ?? "sandbox"),
  });
}

export async function linkBankToken(userId: string) {
  try {
    // Verify token encryption is configured before starting a bank connection.
    encryptBankToken("configuration-check", userId);
    return await client().createLinkToken(userId);
  } catch (error) {
    domainError(error);
  }
}
export async function exchangeBankToken(
  db: Database,
  userId: string,
  publicToken: string,
) {
  try {
    if (!(await readWorkspace(db, userId)))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Create your personal budget first.",
      });
    encryptBankToken("configuration-check", userId);
    const result = await client().exchangePublicToken(publicToken);
    const existing = await db.bankConnection.findUnique({
      where: { itemId: result.itemId },
    });
    if (existing && existing.clerkUserId !== userId)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This connection is already in use.",
      });
    const connection = await db.bankConnection.upsert({
      where: { itemId: result.itemId },
      create: {
        clerkUserId: userId,
        itemId: result.itemId,
        encryptedToken: encryptBankToken(result.accessToken, userId),
        imports: jsonValue({
          records: [],
          resolved: {},
          errors: {},
          reviews: {},
        }),
        accountMappings: {},
      },
      update: {
        encryptedToken: encryptBankToken(result.accessToken, userId),
        error: null,
      },
    });
    return { id: connection.id };
  } catch (error) {
    domainError(error);
  }
}

export async function bankInbox(db: Database, userId: string) {
  const connections = await db.bankConnection.findMany({
    where: { clerkUserId: userId },
  });
  return connections.flatMap((connection) => {
    const state = importState(connection.imports);
    const mappings = mappingsSchema.parse(connection.accountMappings);
    return state.records
      .filter(
        (record) =>
          (!mappings[record.current.providerAccountId] ||
            record.current.date >=
              mappings[record.current.providerAccountId]!.startDate) &&
          state.resolved[record.id]?.fingerprint !== fingerprint(record),
      )
      .map((record) => ({
        connectionId: connection.id,
        logicalId: record.id,
        providerAccountId: record.current.providerAccountId,
        accountId:
          mappings[record.current.providerAccountId]?.accountId ?? null,
        date: record.current.date,
        payee: record.current.merchantName ?? record.current.name,
        amount: -record.current.amountCents,
        pending: record.current.pending,
        removed: record.removed,
        needsMatchReview: record.matchStatus === "needs_review",
        error: state.errors[record.id] ?? null,
        history: record.history,
        reviewEvidence: state.reviews[record.id] ?? [],
      }));
  });
}

export async function mapBankAccount(
  db: Database,
  userId: string,
  input: {
    connectionId: string;
    providerAccountId: string;
    accountId: string;
    startDate: string;
  },
) {
  try {
    return await db.$transaction(
      async (tx) => {
        const [connection, member] = await Promise.all([
          tx.bankConnection.findFirst({
            where: { id: input.connectionId, clerkUserId: userId },
          }),
          tx.workspaceMember.findUnique({
            where: { clerkUserId: userId },
            include: { workspace: true },
          }),
        ]);
        if (!connection || !member) throw new TRPCError({ code: "NOT_FOUND" });
        const book = bookSchema.parse(member.workspace.book);
        const account = book.budgets[userId]!.accounts.find(
          (a) => a.id === input.accountId,
        );
        if (!account)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Account not found.",
          });
        if (input.startDate <= account.date)
          throw new Error(
            "Choose an import start date after the account's confirmed opening balance date to avoid importing the opening balance twice.",
          );
        const mappings = mappingsSchema.parse(connection.accountMappings);
        if (mappings[input.providerAccountId])
          throw new Error(
            "This bank account is already mapped. Review its existing imports first.",
          );
        if (
          Object.values(mappings).some(
            (mapping) => mapping.accountId === input.accountId,
          )
        )
          throw new Error(
            "A ledger account can only be mapped once per connection.",
          );
        mappings[input.providerAccountId] = {
          accountId: input.accountId,
          startDate: input.startDate,
        };
        await tx.bankConnection.update({
          where: { id: connection.id },
          data: { accountMappings: jsonValue(mappings) },
        });
        return { mapped: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    domainError(error);
  }
}

export async function syncBanks(db: Database, userId: string) {
  const connections = await db.bankConnection.findMany({
    where: { clerkUserId: userId },
  });
  if (!connections.length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Connect a bank through Plaid before requesting updates.",
    });
  let imported = 0,
    updated = 0;
  for (const connection of connections) {
    try {
      const delta = await client().syncTransactions(
        decryptBankToken(connection.encryptedToken, userId),
        connection.cursor,
      );
      const counts = await db.$transaction(
        async (tx) => {
          const fresh = await tx.bankConnection.findFirstOrThrow({
            where: { id: connection.id, clerkUserId: userId },
          });
          if (fresh.cursor !== connection.cursor)
            throw new TRPCError({
              code: "CONFLICT",
              message: "Another bank update finished first. Try again.",
            });
          const member = await tx.workspaceMember.findUniqueOrThrow({
            where: { clerkUserId: userId },
            include: { workspace: true },
          });
          const old = importState(fresh.imports);
          const plan = applyTransactionSync(old.records, delta, fresh.id);
          const state: ImportState = {
            records: plan.records,
            resolved: { ...old.resolved },
            errors: { ...old.errors },
            reviews: { ...old.reviews },
          };
          for (const review of plan.reviewItems) {
            state.errors[review.logicalTransactionId] = review.message;
            const existingReviews =
              state.reviews[review.logicalTransactionId] ?? [];
            if (
              !existingReviews.some(
                (item) => commandHash(item) === commandHash(review),
              )
            )
              state.reviews[review.logicalTransactionId] = [
                ...existingReviews,
                review,
              ].slice(-100);
          }
          const mappings = mappingsSchema.parse(fresh.accountMappings);
          let book = bookSchema.parse(member.workspace.book);
          const operations: Command[] = [];
          for (const change of plan.changes) {
            const record = change.after;
            const mapped = mappings[record.current.providerAccountId];
            const resolution = old.resolved[record.id];
            if (
              !mapped ||
              record.current.date < mapped.startDate ||
              record.matchStatus !== "confirmed" ||
              !resolution?.transactionId
            )
              continue;
            const transaction = book.budgets[userId]!.transactions.find(
              (t) => t.id === resolution.transactionId && !t.removed,
            );
            if (
              !transaction ||
              !["purchase", "income", "refund"].includes(transaction.kind)
            )
              continue;
            const id = `sync:${fresh.id}:${fingerprint(record).slice(0, 40)}`;
            const command: Command = record.removed
              ? {
                  type: "transaction.remove",
                  id,
                  transactionId: transaction.id,
                }
              : {
                  type: "transaction.upsert",
                  id,
                  transactionId: transaction.id,
                  accountId: mapped.accountId,
                  date: record.current.date,
                  amount: -record.current.amountCents,
                  payee: (
                    record.current.merchantName ?? record.current.name
                  ).slice(0, 240),
                  status: record.current.pending ? "pending" : "posted",
                  categoryId: transaction.categoryId,
                  expenseMonth: transaction.expenseMonth,
                  sharedCategoryId: transaction.sharedCategoryId,
                  providerId: record.current.providerTransactionId,
                };
            try {
              book = execute(book, userId, command, "agent");
              operations.push(command);
              state.resolved[record.id] = {
                fingerprint: fingerprint(record),
                transactionId: transaction.id,
              };
              delete state.errors[record.id];
            } catch (error) {
              state.errors[record.id] =
                error instanceof Error
                  ? error.message
                  : "This bank update needs review.";
            }
          }
          if (operations.length) {
            const saved = await tx.workspace.updateMany({
              where: {
                id: member.workspaceId,
                revision: member.workspace.revision,
              },
              data: { book: jsonValue(book), revision: { increment: 1 } },
            });
            if (saved.count !== 1) throw new TRPCError({ code: "CONFLICT" });
            await tx.budgetOperation.createMany({
              data: operations.map((op) => ({
                workspaceId: member.workspaceId,
                operationId: op.id,
                actorId: userId,
                source: "provider",
                type: op.type,
                commandHash: commandHash(op),
                revision: member.workspace.revision + 1,
              })),
            });
          }
          await tx.bankConnection.update({
            where: { id: fresh.id },
            data: {
              imports: jsonValue(state),
              cursor: delta.nextCursor,
              lastSyncedAt: new Date(),
              lastAttemptAt: new Date(),
              error: null,
            },
          });
          return {
            imported: plan.changes.filter((c) => !c.before).length,
            updated: operations.length,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 20_000,
        },
      );
      imported += counts.imported;
      updated += counts.updated;
    } catch (error) {
      await db.bankConnection.update({
        where: { id: connection.id },
        data: {
          lastAttemptAt: new Date(),
          error:
            error instanceof TRPCError
              ? error.message
              : "Bank update failed. Reconnect or try again; previous records were preserved.",
        },
      });
      domainError(error);
    }
  }
  return { imported, updated };
}

export async function resolveImport(
  db: Database,
  userId: string,
  input: {
    connectionId: string;
    logicalId: string;
    command?: Command;
    existingTransactionId?: string;
    expectedRevision: number;
    ignore: boolean;
  },
) {
  try {
    return await db.$transaction(
      async (tx) => {
        const connection = await tx.bankConnection.findFirst({
          where: { id: input.connectionId, clerkUserId: userId },
        });
        const member = await tx.workspaceMember.findUnique({
          where: { clerkUserId: userId },
          include: { workspace: true },
        });
        if (!connection || !member) throw new TRPCError({ code: "NOT_FOUND" });
        const state = importState(connection.imports);
        const record = state.records.find((r) => r.id === input.logicalId);
        if (!record) throw new TRPCError({ code: "NOT_FOUND" });
        const mapping = mappingsSchema.parse(connection.accountMappings)[
          record.current.providerAccountId
        ];
        if (input.ignore)
          state.resolved[record.id] = {
            fingerprint: fingerprint(record),
            ignored: true,
            decidedAt: new Date().toISOString(),
          };
        else {
          if (!mapping)
            throw new Error(
              "Map this provider account to your own ledger account first.",
            );
          if (record.current.date < mapping.startDate)
            throw new Error(
              "This record predates the selected import start date. Ignore it rather than duplicating opening history.",
            );
          if (member.workspace.revision !== input.expectedRevision)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Your budget changed. Refresh before confirming this import.",
            });
          let book = bookSchema.parse(member.workspace.book);
          let transactionId: string;
          if (input.existingTransactionId) {
            const transaction = book.budgets[userId]!.transactions.find(
              (t) => t.id === input.existingTransactionId && !t.removed,
            );
            if (
              transaction?.accountId !== mapping.accountId ||
              transaction.amount !== -record.current.amountCents ||
              transaction.date !== record.current.date
            )
              throw new Error(
                "The selected ledger record must have the same account, signed amount, and date. Uncertain matches need investigation.",
              );
            transactionId = transaction.id;
          } else {
            const command = input.command;
            if (command?.type !== "transaction.upsert")
              throw new Error(
                "Record specialized payments or credits using their dedicated operation, then link the existing ledger record.",
              );
            if (record.removed)
              throw new Error(
                "This provider record was removed; do not create a new purchase from it.",
              );
            if (
              command.accountId !== mapping.accountId ||
              command.amount !== -record.current.amountCents ||
              command.date !== record.current.date
            )
              throw new Error(
                "Imported account, amount, and date must match the bank fact.",
              );
            const possibleDuplicates = book.budgets[
              userId
            ]!.transactions.filter(
              (t) =>
                !t.removed &&
                t.accountId === mapping.accountId &&
                t.amount === command.amount &&
                t.date === command.date &&
                t.payee.toLowerCase() ===
                  (
                    record.current.merchantName ?? record.current.name
                  ).toLowerCase(),
            );
            if (possibleDuplicates.length)
              throw new Error(
                "A matching ledger record already exists. Link it explicitly to avoid counting it twice.",
              );
            book = execute(book, userId, {
              ...command,
              status: record.current.pending ? "pending" : "posted",
              payee: (record.current.merchantName ?? record.current.name).slice(
                0,
                240,
              ),
              providerId: record.current.providerTransactionId,
            });
            transactionId = command.transactionId;
            const saved = await tx.workspace.updateMany({
              where: {
                id: member.workspaceId,
                revision: input.expectedRevision,
              },
              data: { book: jsonValue(book), revision: { increment: 1 } },
            });
            if (saved.count !== 1) throw new TRPCError({ code: "CONFLICT" });
            await tx.budgetOperation.create({
              data: {
                workspaceId: member.workspaceId,
                operationId: command.id,
                actorId: userId,
                source: "user",
                type: command.type,
                commandHash: commandHash(command),
                revision: input.expectedRevision + 1,
              },
            });
          }
          record.matchStatus = "confirmed";
          state.resolved[record.id] = {
            fingerprint: fingerprint(record),
            transactionId,
            decidedAt: new Date().toISOString(),
          };
        }
        delete state.errors[record.id];
        await tx.bankConnection.update({
          where: { id: connection.id },
          data: { imports: jsonValue(state) },
        });
        return { resolved: true };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15_000,
      },
    );
  } catch (error) {
    domainError(error);
  }
}
