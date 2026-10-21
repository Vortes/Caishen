import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "~/generated/prisma";
import { bookSchema, execute, type Command } from "~/domain/engine";
import { prepareUserCommand } from "~/domain/user-command";
import {
  bankAccountSchema,
  createPlaidClient,
} from "~/server/integrations/plaid";
import {
  applyTransactionSync,
  storedImportsSchema,
} from "~/server/integrations/transactions";
import { decryptBankToken, encryptBankToken } from "~/server/token-crypto";
import {
  applyQuarantine,
  quarantinedTransactions,
  quarantineFingerprint,
  readQuarantine,
} from "./bank-quarantine";
import { commandHash, domainError, jsonValue, operationHash } from "./safety";
import { readWorkspace, type Database } from "./workspace";
import {
  bankAccountOpening,
  bankImportEligibility,
  bankImportFingerprint as fingerprint,
  bankMappingsSchema as mappingsSchema,
  bankSetupDate,
  openingSnapshot,
  openingSnapshotChangedMessage,
  setupBankAccountsSchema,
  type SetupBankAccountsInput,
} from "./bank-account-setup";
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
    accounts: z.array(bankAccountSchema).max(1000).default([]),
    institutionId: z.string().max(256).nullable().default(null),
    institutionName: z.string().max(1024).nullable().default(null),
    transactionStatus: z.string().max(100).nullable().default(null),
    synchronizedAccountIds: z
      .array(z.string().min(1).max(256))
      .max(1000)
      .default([]),
  })
  .strict();
type ImportState = z.infer<typeof importStateSchema>;
function importState(value: unknown): ImportState {
  return importStateSchema.parse(value);
}

export function bankAccountDetails(value: unknown) {
  const {
    accounts,
    institutionId,
    institutionName,
    transactionStatus,
    synchronizedAccountIds,
  } = importState(value);
  return {
    accounts,
    institutionId,
    institutionName,
    transactionStatus,
    synchronizedAccountIds,
  };
}
function client() {
  return createPlaidClient({
    clientId: process.env.PLAID_CLIENT_ID ?? "",
    secret: process.env.PLAID_SECRET ?? "",
    environment: z
      .enum(["sandbox", "production"])
      .parse(process.env.PLAID_ENV ?? "sandbox"),
    redirectUri: process.env.PLAID_REDIRECT_URI,
  });
}

export async function linkBankToken(
  db: Database,
  userId: string,
  connectionId?: string,
) {
  try {
    const connection = connectionId
      ? await db.bankConnection.findFirst({
          where: { id: connectionId, clerkUserId: userId },
        })
      : null;
    if (connectionId && !connection) throw new TRPCError({ code: "NOT_FOUND" });
    // Verify token encryption is configured before starting a bank connection.
    encryptBankToken("configuration-check", userId);
    const token = await client().createLinkToken(
      userId,
      connection
        ? decryptBankToken(connection.encryptedToken, userId)
        : undefined,
    );
    return {
      ...token,
      ...(process.env.PLAID_REDIRECT_URI
        ? { redirectUri: process.env.PLAID_REDIRECT_URI }
        : {}),
    };
  } catch (error) {
    domainError(error);
  }
}
export async function exchangeBankToken(
  db: Database,
  userId: string,
  publicToken: string,
): Promise<{ id: string; warning?: string }> {
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
          accounts: [],
        }),
        accountMappings: {},
      },
      update: {
        encryptedToken: encryptBankToken(result.accessToken, userId),
        error: null,
      },
    });
    try {
      await refreshBankAccounts(db, userId, connection.id, result.accessToken);
      return { id: connection.id };
    } catch {
      const warning =
        "Your bank is connected, but account details are still unavailable. Request an update to try again.";
      await db.bankConnection.update({
        where: { id: connection.id },
        data: { error: warning, lastAttemptAt: new Date() },
      });
      return { id: connection.id, warning };
    }
  } catch (error) {
    domainError(error);
  }
}

async function refreshBankAccounts(
  db: Database,
  userId: string,
  connectionId: string,
  accessToken: string,
) {
  const accounts = await client().getAccounts(accessToken);
  await db.$transaction(
    async (tx) => {
      const fresh = await tx.bankConnection.findFirst({
        where: { id: connectionId, clerkUserId: userId },
      });
      if (!fresh) throw new TRPCError({ code: "NOT_FOUND" });
      await tx.bankConnection.update({
        where: { id: fresh.id },
        data: {
          imports: jsonValue({
            ...importState(fresh.imports),
            ...accounts,
            transactionStatus: null,
            synchronizedAccountIds: [],
          }),
          lastAttemptAt: new Date(),
          error: null,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function reconnectBank(
  db: Database,
  userId: string,
  connectionId: string,
): Promise<{ id: string; warning?: string }> {
  try {
    const connection = await db.bankConnection.findFirst({
      where: { id: connectionId, clerkUserId: userId },
    });
    if (!connection) throw new TRPCError({ code: "NOT_FOUND" });
    await refreshBankAccounts(
      db,
      userId,
      connection.id,
      decryptBankToken(connection.encryptedToken, userId),
    );
    return { id: connection.id };
  } catch (error) {
    domainError(error);
  }
}

export async function bankInbox(db: Database, userId: string) {
  const [connections, member] = await Promise.all([
    db.bankConnection.findMany({ where: { clerkUserId: userId } }),
    readWorkspace(db, userId),
  ]);
  const budget = member
    ? bookSchema.parse(member.workspace.book).budgets[userId]
    : undefined;
  const transactions = new Map(
    budget?.transactions.map((transaction) => [transaction.id, transaction]),
  );
  const categories = new Map(
    budget?.categories.map((category) => [category.id, category.name]),
  );
  return connections.flatMap((connection) => {
    const state = importState(connection.imports);
    const mappings = mappingsSchema.parse(connection.accountMappings);
    const imports = state.records
      .filter((record) => {
        const eligibility = bankImportEligibility(
          mappings[record.current.providerAccountId],
          record,
        );
        const resolution = state.resolved[record.id];
        return (
          ["eligible", "opening_snapshot_changed"].includes(eligibility) &&
          resolution?.fingerprint !== fingerprint(record) &&
          !(
            record.removed &&
            eligibility === "eligible" &&
            record.matchStatus === "confirmed" &&
            !resolution?.transactionId
          )
        );
      })
      .map((record) => {
        const transactionId = state.resolved[record.id]?.transactionId;
        const transaction = transactionId
          ? transactions.get(transactionId)
          : undefined;
        const categoryId = transaction
          ? transaction.categoryId
          : record.categoryId;
        const category: { categoryName?: string | null } = {
          categoryName: categoryId
            ? (categories.get(categoryId) ?? null)
            : null,
        };
        return {
          ...category,
          categoryId,
          transactionId,
          fingerprint: fingerprint(record),
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
          error:
            bankImportEligibility(
              mappings[record.current.providerAccountId],
              record,
            ) === "opening_snapshot_changed"
              ? openingSnapshotChangedMessage
              : (state.errors[record.id] ?? null),
          history: record.history,
          reviewEvidence: state.reviews[record.id] ?? [],
          quarantined: false,
        };
      });
    const quarantined = quarantinedTransactions(state.reviews)
      .filter(
        (review) =>
          state.resolved[review.logicalTransactionId]?.fingerprint !==
          quarantineFingerprint(review.transaction),
      )
      .map((review) => {
        const { transaction } = review;
        return {
          categoryName: null,
          categoryId: null,
          transactionId: undefined,
          fingerprint: quarantineFingerprint(transaction),
          connectionId: connection.id,
          logicalId: review.logicalTransactionId,
          providerAccountId: transaction.providerAccountId,
          accountId: mappings[transaction.providerAccountId]?.accountId ?? null,
          date: transaction.date ?? review.receivedOn,
          payee: transaction.name ?? "Unreadable bank transaction",
          // Budgets hold US dollars only; the bank's amount is in the message.
          amount: 0,
          pending: transaction.pending,
          removed: false,
          needsMatchReview: false,
          error: review.message,
          history: [],
          reviewEvidence: [review],
          quarantined: true,
        };
      });
    return [...imports, ...quarantined];
  });
}

export async function setupBankAccounts(
  db: Database,
  userId: string,
  input: SetupBankAccountsInput,
): Promise<{ revision: number; accountIds: string[] }> {
  try {
    input = setupBankAccountsSchema.parse(input);
    if (
      new Set(input.accounts.map((account) => account.providerAccountId))
        .size !== input.accounts.length
    )
      throw new Error("Choose each bank account only once.");
    const hash = commandHash({
      type: "bank.accounts.setup",
      connectionId: input.connectionId,
      operationId: input.operationId,
      accounts: input.accounts,
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await db.$transaction(
          async (tx) => {
            const [connection, member, connections] = await Promise.all([
              tx.bankConnection.findFirst({
                where: { id: input.connectionId, clerkUserId: userId },
              }),
              tx.workspaceMember.findUnique({
                where: { clerkUserId: userId },
                include: { workspace: true },
              }),
              tx.bankConnection.findMany({ where: { clerkUserId: userId } }),
            ]);
            if (!connection || !member)
              throw new TRPCError({ code: "NOT_FOUND" });
            const mappings = mappingsSchema.parse(connection.accountMappings);
            const previous = await tx.budgetOperation.findUnique({
              where: {
                workspaceId_operationId: {
                  workspaceId: member.workspaceId,
                  operationId: input.operationId,
                },
              },
            });
            if (previous) {
              if (previous.actorId !== userId || previous.commandHash !== hash)
                throw new TRPCError({
                  code: "CONFLICT",
                  message:
                    "This operation ID has already been used with different details.",
                });
              const accountIds = input.accounts.map((account) => {
                const id = mappings[account.providerAccountId]?.accountId;
                if (!id)
                  throw new TRPCError({
                    code: "CONFLICT",
                    message:
                      "Account setup changed. Refresh your bank accounts.",
                  });
                return id;
              });
              return {
                revision: member.workspace.revision,
                accountIds,
              };
            }
            if (member.workspace.revision !== input.expectedRevision)
              throw new TRPCError({
                code: "CONFLICT",
                message: "Your budget changed. Refresh before adding accounts.",
              });
            const state = importState(connection.imports);
            if (
              !connection.lastSyncedAt ||
              ![
                "INITIAL_UPDATE_COMPLETE",
                "HISTORICAL_UPDATE_COMPLETE",
              ].includes(state.transactionStatus ?? "")
            )
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message:
                  "Your bank is still preparing account activity. Update accounts and try setup again once the first update finishes.",
              });
            let book = bookSchema.parse(member.workspace.book);
            const budget = book.budgets[userId];
            if (!budget) throw new TRPCError({ code: "NOT_FOUND" });
            const today = bankSetupDate(budget.settings.timezone);
            if (
              input.accounts.some((account) => !account.existingAccountId) &&
              bankSetupDate(
                budget.settings.timezone,
                connection.lastSyncedAt,
              ) !== today
            )
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message:
                  "Update your bank accounts before setup so today's opening balances include the latest activity.",
              });
            const allMappings = connections.map((saved) =>
              mappingsSchema.parse(saved.accountMappings),
            );
            const usedAccountIds = new Set(
              allMappings.flatMap((saved) =>
                Object.values(saved).map((mapping) => mapping.accountId),
              ),
            );
            const accountIds: string[] = [];
            for (const selected of input.accounts) {
              const provider = state.accounts.find(
                (account) => account.accountId === selected.providerAccountId,
              );
              if (!provider)
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message:
                    "This bank account is no longer available. Update accounts first.",
                });
              if (
                !selected.existingAccountId &&
                !state.synchronizedAccountIds.includes(provider.accountId)
              )
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: `The bank is still preparing a matching balance and transaction history for ${provider.name}. Update accounts and try again before adding it.`,
                });
              if (
                allMappings.some((saved) => saved[selected.providerAccountId])
              )
                throw new Error(
                  "This bank account is already added. Refresh to see its existing account.",
                );
              if (provider.currentBalance !== selected.expectedBalance)
                throw new TRPCError({
                  code: "CONFLICT",
                  message:
                    "The bank balance changed. Refresh and review the latest balance before adding this account.",
                });
              const opening = bankAccountOpening(provider);
              let accountId: string;
              if (selected.existingAccountId) {
                const existing = budget.accounts.find(
                  (account) => account.id === selected.existingAccountId,
                );
                if (!existing)
                  throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Budget account not found.",
                  });
                if (existing.kind !== opening.kind)
                  throw new Error(
                    "Choose a budget account with the same cash or credit type.",
                  );
                if (usedAccountIds.has(existing.id))
                  throw new Error(
                    "This budget account is already linked to a bank.",
                  );
                if (!selected.startDate || selected.startDate <= existing.date)
                  throw new Error(
                    "Choose an import start date after the account's confirmed opening balance date to avoid importing the opening balance twice.",
                  );
                accountId = existing.id;
                mappings[provider.accountId] = {
                  accountId,
                  startDate: selected.startDate,
                };
              } else {
                if (selected.startDate && selected.startDate !== today)
                  throw new Error(
                    "New bank accounts start with today's current balance.",
                  );
                accountId = `bank:${input.operationId}:${commandHash(provider.accountId).slice(0, 32)}`;
                book = execute(book, userId, {
                  type: "account.add",
                  id: `${input.operationId}:${commandHash(provider.accountId).slice(0, 32)}`,
                  accountId,
                  name: selected.name,
                  ...opening,
                  date: today,
                });
                mappings[provider.accountId] = {
                  accountId,
                  startDate: today,
                  openingSnapshot: openingSnapshot(
                    state.records,
                    provider.accountId,
                    state.reviews,
                  ),
                };
              }
              usedAccountIds.add(accountId);
              accountIds.push(accountId);
            }
            const saved = await tx.workspace.updateMany({
              where: {
                id: member.workspaceId,
                revision: input.expectedRevision,
              },
              data: {
                book: jsonValue(book),
                history: {},
                revision: { increment: 1 },
              },
            });
            if (saved.count !== 1) throw new TRPCError({ code: "CONFLICT" });
            await tx.bankConnection.update({
              where: { id: connection.id },
              data: { accountMappings: jsonValue(mappings) },
            });
            await tx.budgetOperation.create({
              data: {
                workspaceId: member.workspaceId,
                operationId: input.operationId,
                actorId: userId,
                source: "user",
                type: "bank.accounts.setup",
                commandHash: hash,
                revision: input.expectedRevision + 1,
              },
            });
            return { revision: input.expectedRevision + 1, accountIds };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 20_000,
          },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034" &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
    throw new TRPCError({ code: "CONFLICT" });
  } catch (error) {
    domainError(error);
  }
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
        const state = importState(connection.imports);
        if (
          !state.accounts.some(
            (account) => account.accountId === input.providerAccountId,
          ) &&
          !state.records.some(
            (record) =>
              record.current.providerAccountId === input.providerAccountId,
          )
        )
          throw new Error(
            "This bank account is unavailable. Update accounts first.",
          );
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
        const connections = await tx.bankConnection.findMany({
          where: { clerkUserId: userId },
          select: { accountMappings: true },
        });
        const allMappings = connections.map((saved) =>
          mappingsSchema.parse(saved.accountMappings),
        );
        if (allMappings.some((saved) => saved[input.providerAccountId]))
          throw new Error(
            "This bank account is already mapped. Review its existing imports first.",
          );
        if (
          allMappings.some((saved) =>
            Object.values(saved).some(
              (mapping) => mapping.accountId === input.accountId,
            ),
          )
        )
          throw new Error(
            "A ledger account can only be linked to one bank account.",
          );
        mappings[input.providerAccountId] = {
          accountId: input.accountId,
          startDate: input.startDate,
        };
        const saved = await tx.workspace.updateMany({
          where: {
            id: member.workspaceId,
            revision: member.workspace.revision,
          },
          data: { history: {}, revision: { increment: 1 } },
        });
        if (saved.count !== 1)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Your budget changed. Refresh before linking accounts.",
          });
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
      const plaid = client();
      const accessToken = decryptBankToken(connection.encryptedToken, userId);
      const delta = await plaid.syncTransactions(
        accessToken,
        connection.cursor,
      );
      const accounts = await plaid.getAccounts(accessToken);
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
          const changedAccounts = new Set(
            [
              ...delta.added,
              ...delta.modified,
              ...delta.removed,
              ...delta.skipped.quarantined,
            ].map((record) => record.providerAccountId),
          );
          const retainedAccounts =
            fresh.cursor === delta.nextCursor
              ? old.accounts.filter(
                  (account) =>
                    old.synchronizedAccountIds.includes(account.accountId) &&
                    !changedAccounts.has(account.accountId),
                )
              : [];
          const synchronizedAccounts = new Map(
            [...retainedAccounts, ...delta.accounts].map((account) => [
              account.accountId,
              account,
            ]),
          );
          const state: ImportState = {
            ...accounts,
            accounts: [
              ...new Map(
                [...accounts.accounts, ...synchronizedAccounts.values()].map(
                  (account) => [account.accountId, account],
                ),
              ).values(),
            ],
            synchronizedAccountIds: [...synchronizedAccounts.keys()],
            transactionStatus: delta.updateStatus,
            records: plan.records,
            resolved: { ...old.resolved },
            errors: { ...old.errors },
            reviews: { ...old.reviews },
          };
          for (const review of plan.reviewItems) {
            state.errors[review.logicalTransactionId] = review.message;
            const existingReviews =
              state.reviews[review.logicalTransactionId] ?? [];
            // Saved evidence comes back from jsonb with its keys reordered.
            if (
              !existingReviews.some(
                (item) => operationHash(item) === operationHash(review),
              )
            )
              state.reviews[review.logicalTransactionId] = [
                ...existingReviews,
                review,
              ].slice(-100);
          }
          state.reviews = applyQuarantine(
            state.reviews,
            fresh.id,
            delta,
            delta.skipped.quarantined,
            new Date().toISOString().slice(0, 10),
          );
          const mappings = mappingsSchema.parse(fresh.accountMappings);
          let book = bookSchema.parse(member.workspace.book);
          const operations: Command[] = [];
          for (const change of plan.changes) {
            const record = change.after;
            const mapped = mappings[record.current.providerAccountId];
            const resolution = old.resolved[record.id];
            const eligibility = bankImportEligibility(mapped, record);
            if (eligibility === "opening_snapshot_changed")
              state.errors[record.id] = openingSnapshotChangedMessage;
            if (
              !mapped ||
              eligibility !== "eligible" ||
              record.matchStatus !== "confirmed" ||
              !resolution?.transactionId
            )
              continue;
            const transaction = book.budgets[userId]!.transactions.find(
              (t) => t.id === resolution.transactionId,
            );
            const restoresPending = Boolean(
              transaction?.removed &&
              change.before?.removed &&
              change.before.current.pending &&
              !record.removed &&
              !record.current.pending &&
              record.current.pendingTransactionId &&
              change.before.providerTransactionIds.includes(
                record.current.pendingTransactionId,
              ) &&
              transaction.history.at(-1)?.operationId ===
                `sync:${fresh.id}:${resolution.fingerprint.slice(0, 40)}`,
            );
            if (
              !transaction ||
              (transaction.removed && !restoresPending) ||
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
                  payee:
                    transaction.payee ===
                    (
                      change.before?.current.merchantName ??
                      change.before?.current.name
                    )?.slice(0, 240)
                      ? (
                          record.current.merchantName ?? record.current.name
                        ).slice(0, 240)
                      : transaction.payee,
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
      if (delta.skipped.quarantined.length || delta.skipped.unidentifiable)
        console.warn("Bank update left out transactions it could not import", {
          connectionId: connection.id,
          quarantined: delta.skipped.quarantined.map((transaction) => ({
            transactionId: transaction.providerTransactionId,
            accountId: transaction.providerAccountId,
            reason: transaction.reason,
            currency: transaction.currency,
          })),
          unidentifiable: delta.skipped.unidentifiable,
        });
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
    expectedFingerprint?: string;
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
        if (!record) {
          const quarantined = readQuarantine(state.reviews, input.logicalId);
          if (!quarantined) throw new TRPCError({ code: "NOT_FOUND" });
          if (!input.ignore)
            throw new Error(
              "This bank transaction wasn't imported. Record it yourself if it affects your budget, then dismiss it.",
            );
          state.resolved[input.logicalId] = {
            fingerprint: quarantineFingerprint(quarantined.transaction),
            ignored: true,
            decidedAt: new Date().toISOString(),
          };
          await tx.bankConnection.update({
            where: { id: connection.id },
            data: { imports: jsonValue(state) },
          });
          return { resolved: true };
        }
        if (input.expectedFingerprint && input.command) {
          const saved = await tx.budgetOperation.findMany({
            where: {
              workspaceId: member.workspaceId,
              operationId: input.command.id,
            },
          });
          const previous = saved[0];
          if (previous) {
            if (
              previous.actorId !== userId ||
              previous.commandHash !==
                commandHash({
                  command: input.command,
                  connectionId: input.connectionId,
                  logicalId: input.logicalId,
                  fingerprint: input.expectedFingerprint,
                })
            )
              throw new TRPCError({
                code: "CONFLICT",
                message: "This save was already used with different details.",
              });
            return { resolved: true };
          }
          if (input.expectedFingerprint !== fingerprint(record))
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Your bank updated this transaction. Reopen it before saving.",
            });
        }
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
          const eligibility = bankImportEligibility(mapping, record);
          if (eligibility !== "eligible")
            throw new Error(
              eligibility === "opening_snapshot_changed"
                ? openingSnapshotChangedMessage
                : "This activity is already included in the opening balance or predates the import start date. Ignore it rather than duplicating opening history.",
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
            if (state.resolved[record.id]?.transactionId)
              throw new Error(
                "This bank activity is already linked to a budget transaction. Review the existing transaction rather than creating it again.",
              );
            if (
              command?.type !== "transaction.upsert" &&
              !(
                input.expectedFingerprint &&
                command?.type === "transaction.save"
              )
            )
              throw new Error(
                "Record specialized payments or credits using their dedicated operation, then link the existing ledger record.",
              );
            if (record.removed)
              throw new Error(
                "This provider record was removed; do not create a new purchase from it.",
              );
            if (
              book.budgets[userId]!.transactions.some(
                (item) => item.id === command.transactionId,
              )
            )
              throw new Error(
                "This transaction ID already exists. Reopen the import before saving.",
              );
            if (
              command.accountId !== mapping.accountId ||
              (!input.expectedFingerprint &&
                (command.amount !== -record.current.amountCents ||
                  command.date !== record.current.date))
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
                (t.id === command.transactionId ||
                  t.providerId === record.current.providerTransactionId ||
                  (t.amount === -record.current.amountCents &&
                    t.date === record.current.date &&
                    t.payee.toLowerCase() ===
                      (
                        record.current.merchantName ?? record.current.name
                      ).toLowerCase())),
            );
            if (possibleDuplicates.length)
              throw new Error(
                "A matching ledger record already exists. Link it explicitly to avoid counting it twice.",
              );
            if (input.expectedFingerprint)
              prepareUserCommand(book.budgets[userId]!, command);
            book = execute(book, userId, {
              ...command,
              status: record.current.pending ? "pending" : "posted",
              payee: input.expectedFingerprint
                ? command.payee
                : (record.current.merchantName ?? record.current.name).slice(
                    0,
                    240,
                  ),
              reviewed: false,
              providerId: record.current.providerTransactionId,
            });
            transactionId = command.transactionId;
            await tx.budgetOperation.create({
              data: {
                workspaceId: member.workspaceId,
                operationId: command.id,
                actorId: userId,
                source: "user",
                type: command.type,
                commandHash: commandHash(
                  input.expectedFingerprint
                    ? {
                        command,
                        connectionId: input.connectionId,
                        logicalId: input.logicalId,
                        fingerprint: input.expectedFingerprint,
                      }
                    : command,
                ),
                revision: input.expectedRevision + 1,
              },
            });
          }
          const saved = await tx.workspace.updateMany({
            where: {
              id: member.workspaceId,
              revision: input.expectedRevision,
            },
            data: {
              book: jsonValue(book),
              history: {},
              revision: { increment: 1 },
            },
          });
          if (saved.count !== 1) throw new TRPCError({ code: "CONFLICT" });
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
