import { isRejectedSettlementImport } from "~/domain/partner-settlements";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { composeChangeSets } from "~/domain/change-sets";
import { executeWithChanges, type Budget, type Command } from "~/domain/engine";
import type { ChangeSet } from "~/domain/rows";
import type { AccountingState } from "~/domain/shared-ledger";
import {
  rememberedCategory,
  rememberedCounterpartyShare,
} from "~/domain/payee-memory";
import { READY_TO_ASSIGN } from "~/domain/transfers";
import { prepareUserCommand } from "~/domain/user-command";
import { Prisma } from "~/generated/prisma";
import {
  bankAccountSchema,
  createPlaidClient,
} from "~/server/integrations/plaid";
import {
  applyTransactionSync,
  type StoredImport,
} from "~/server/integrations/transactions";
import { usdToCents } from "~/server/integrations/validation";
import {
  findOperation,
  readHouseholdRevision,
  RevisionConflictError,
} from "~/server/storage/rows";
import { decryptBankToken, encryptBankToken } from "~/server/token-crypto";
import {
  applyQuarantine,
  quarantinedTransactions,
  quarantineFingerprint,
  quarantineMessage,
  readQuarantine,
} from "./bank-quarantine";
import {
  emptyState,
  importRowStateShape,
  importStateChange,
  readImportStates,
  type ImportRowState,
} from "./bank-import-rows";
import {
  earlierResult,
  openHousehold,
  refusal,
  requireHousehold,
  writeServerOperation,
  type Database,
  type OperationResult,
} from "./household";
import { commandHash, domainError, jsonValue, operationHash } from "./safety";
import { settleFromImports } from "./partner-settlements";
import {
  budgetMaintenance,
  CONNECTION_MAINTENANCE_MESSAGE,
  connectionMaintenance,
  reportUnreadable,
  zodIssues,
} from "./stored-data";
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
import {
  confirmedPartnerMatch,
  inboxPartnerMatches,
  planPartnerImports,
  type InboxPartnerMatch,
} from "./partner-imports";

const connectionDetailsShape = {
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
type ImportState = z.infer<typeof importStateSchema>;
type ConnectionDetails = Omit<ImportState, keyof ImportRowState>;
type Mappings = z.infer<typeof mappingsSchema>;
type StoredConnection = {
  id: string;
  clerkUserId: string;
  imports: unknown;
  accountMappings: unknown;
};
export type ReadConnection<C extends StoredConnection = StoredConnection> =
  | { status: "ready"; connection: C; state: ImportState; mappings: Mappings }
  | { status: "maintenance"; connection: C };
/** Each connection's import state from rows (readImportStates). */
export type ImportStates = ReadonlyMap<string, ImportRowState | "unreadable">;

function readColumn<T>(
  connection: Pick<StoredConnection, "id" | "clerkUserId">,
  record: "BankConnection.imports" | "BankConnection.accountMappings",
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
): T | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  reportUnreadable(
    { record, connectionId: connection.id, userId: connection.clerkUserId },
    [{ issues: zodIssues(result.error) }],
  );
}

function connectionDetails(column: ConnectionDetails) {
  const {
    accounts,
    institutionId,
    institutionName,
    transactionStatus,
    synchronizedAccountIds,
  } = column;
  return {
    accounts,
    institutionId,
    institutionName,
    transactionStatus,
    synchronizedAccountIds,
  };
}

/**
 * The BankConnection.imports value holding these details. Import state a
 * connection saved before rows is kept as it was, for the one-time copy.
 */
function detailsColumn(stored: unknown, details: ConnectionDetails) {
  const legacy = connectionColumnSchema.safeParse(stored);
  const { records, resolved, errors, reviews } = legacy.success
    ? legacy.data
    : ({} as Partial<ImportRowState>);
  return jsonValue({
    ...(records ? { records, resolved, errors, reviews } : {}),
    ...connectionDetails(details),
  });
}

// A connection whose saved details or import rows can't be read is left
// alone and shown as under maintenance; the budget and other connections
// still work.
export function readBankConnection<C extends StoredConnection>(
  connection: C,
  imports: ImportStates,
): ReadConnection<C> {
  const column = readColumn(
    connection,
    "BankConnection.imports",
    connectionColumnSchema,
    connection.imports,
  );
  const mappings = readColumn(
    connection,
    "BankConnection.accountMappings",
    mappingsSchema,
    connection.accountMappings,
  );
  const rows = imports.get(connection.id) ?? emptyState();
  return column && mappings && rows !== "unreadable"
    ? {
        status: "ready",
        connection,
        state: { ...connectionDetails(column), ...rows },
        mappings,
      }
    : { status: "maintenance", connection };
}

// A connection as the app shows it. One under maintenance shows its
// maintenance message and no accounts.
export function bankConnectionView(
  read: ReadConnection<
    StoredConnection & {
      itemId: string;
      lastSyncedAt: Date | null;
      lastAttemptAt: Date | null;
      error: string | null;
    }
  >,
) {
  const { id, itemId, lastSyncedAt, lastAttemptAt, error, accountMappings } =
    read.connection;
  const connection = { id, itemId, lastSyncedAt, lastAttemptAt };
  return read.status === "ready"
    ? {
        ...connection,
        error,
        accountMappings,
        ...bankAccountDetails(read.state),
      }
    : {
        ...connection,
        error: CONNECTION_MAINTENANCE_MESSAGE,
        accountMappings: {},
        ...bankAccountDetails({}),
      };
}

function readyConnection<C extends StoredConnection>(
  connection: C,
  imports: ImportStates,
) {
  const read = readBankConnection(connection, imports);
  if (read.status === "maintenance") throw connectionMaintenance();
  return read;
}

function connectionMappings(connections: Omit<StoredConnection, "imports">[]) {
  return connections.map((saved) => {
    const mappings = readColumn(
      saved,
      "BankConnection.accountMappings",
      mappingsSchema,
      saved.accountMappings,
    );
    if (!mappings) throw connectionMaintenance();
    return mappings;
  });
}

export function bankAccountDetails(value: unknown) {
  return connectionDetails(connectionColumnSchema.parse(value));
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
    if (!(await readHouseholdRevision(db, userId)))
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
        imports: jsonValue(connectionDetails(connectionColumnSchema.parse({}))),
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
      const column = readColumn(
        fresh,
        "BankConnection.imports",
        connectionColumnSchema,
        fresh.imports,
      );
      if (!column) throw connectionMaintenance();
      await tx.bankConnection.update({
        where: { id: fresh.id },
        data: {
          imports: detailsColumn(fresh.imports, {
            ...connectionDetails(column),
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
  const [connections, opened] = await Promise.all([
    db.bankConnection.findMany({ where: { clerkUserId: userId } }),
    openHousehold(db, userId),
  ]);
  if (opened && opened.ledger.status !== "ready") throw budgetMaintenance();
  const imports = opened
    ? readImportStates(opened.household.rows, userId)
    : new Map<string, never>();
  return bankInboxItems(
    connections.map((connection) => readBankConnection(connection, imports)),
    opened?.ledger.status === "ready" ? opened.ledger.budget : undefined,
    opened?.ledger.status === "ready" ? opened.ledger.state : undefined,
  );
}

// Bank activity waiting for review, from connections that could be read.
export function bankInboxItems(
  connections: ReadConnection[],
  budget: Budget | undefined,
  ledger?: Pick<AccountingState, "partnerEntries">,
) {
  const transactions = new Map(
    budget?.transactions.map((transaction) => [transaction.id, transaction]),
  );
  const categories = new Map(
    budget?.categories.map((category) => [category.id, category.name]),
  );
  return connections.flatMap((read) => {
    if (read.status === "maintenance") return [];
    const { connection, state, mappings } = read;
    const imports = state.records
      .filter((record) => {
        const mapping = mappings[record.current.providerAccountId];
        if (!mapping) return false;
        const eligibility = bankImportEligibility(mapping, record);
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
        const mapping = mappings[record.current.providerAccountId];
        const loanId = budget?.loans.find(
          (loan) => loan.id === mapping?.accountId,
        )?.id;
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
        // The purchases a partner recorded that this import may be.
        const partnerMatches: InboxPartnerMatch[] =
          budget && ledger && !transactionId && !loanId
            ? inboxPartnerMatches(
                ledger,
                budget,
                mapping?.accountId ?? null,
                record,
              )
            : [];
        return {
          ...category,
          categoryId,
          transactionId,
          fingerprint: fingerprint(record),
          connectionId: connection.id,
          logicalId: record.id,
          providerAccountId: record.current.providerAccountId,
          accountId: loanId ? null : (mapping?.accountId ?? null),
          ...(loanId ? { loanId } : {}),
          date: record.current.date,
          payee: record.current.merchantName ?? record.current.name,
          amount: -record.current.amountCents,
          pending: record.current.pending,
          removed: record.removed,
          needsMatchReview: record.matchStatus === "needs_review",
          ...(partnerMatches.length ? { partnerMatches } : {}),
          error: loanId
            ? loanActivityReviewMessage
            : bankImportEligibility(
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
          mappings[review.transaction.providerAccountId] &&
          state.resolved[review.logicalTransactionId]?.fingerprint !==
            quarantineFingerprint(review.transaction),
      )
      .map((review) => {
        const { transaction } = review;
        const mapping = mappings[transaction.providerAccountId];
        const loanId = budget?.loans.find(
          (loan) => loan.id === mapping?.accountId,
        )?.id;
        return {
          categoryName: null,
          categoryId: null,
          transactionId: undefined,
          fingerprint: quarantineFingerprint(transaction),
          connectionId: connection.id,
          logicalId: review.logicalTransactionId,
          providerAccountId: transaction.providerAccountId,
          accountId: loanId ? null : (mapping?.accountId ?? null),
          ...(loanId ? { loanId } : {}),
          date: transaction.date ?? review.receivedOn,
          payee: transaction.name ?? "Unreadable bank transaction",
          // Budgets hold US dollars only; the bank's amount is in the message.
          amount: 0,
          pending: transaction.pending,
          removed: false,
          needsMatchReview: false,
          error: quarantineMessage(transaction),
          history: [],
          reviewEvidence: [review],
          quarantined: true,
        };
      });
    return [...imports, ...quarantined];
  });
}

const alreadyLinkedMessage =
  "This bank activity is already linked to a budget transaction. Review the existing transaction rather than creating it again.";

const loanActivityReviewMessage =
  "Review this loan activity with your lender. Record payments using the confirmed principal and interest, then dismiss this update. Loan balances are not changed automatically.";

// A connection of the member's and everything bank setup needs with it.
async function openConnection(
  db: Database,
  userId: string,
  connectionId: string,
) {
  const connection = await db.bankConnection.findFirst({
    where: { id: connectionId, clerkUserId: userId },
  });
  if (!connection) throw new TRPCError({ code: "NOT_FOUND" });
  const opened = await requireHousehold(db, userId);
  const imports = readImportStates(opened.household.rows, userId);
  return { opened, ...readyConnection(connection, imports) };
}

// Runs commands one after another on the actor's ledger as one operation.
function runCommands(
  state: AccountingState,
  actorId: string,
  commands: Command[],
  source: "user" | "agent" = "user",
) {
  const changeSets: ChangeSet[] = [];
  for (const command of commands) {
    const result = executeWithChanges(state, actorId, command, source);
    state = result.book;
    changeSets.push(result.changeSet);
  }
  return { state, changeSets };
}

export async function setupBankAccounts(
  db: Database,
  userId: string,
  input: SetupBankAccountsInput,
  submitted: unknown = input,
): Promise<OperationResult & { accountIds: string[] }> {
  try {
    input = setupBankAccountsSchema.parse(input);
    const operation = (accounts: unknown) => ({
      type: "bank.accounts.setup",
      connectionId: input.connectionId,
      operationId: input.operationId,
      accounts,
    });
    const submittedOperation = operation(
      z.object({ accounts: z.unknown() }).parse(submitted).accounts,
    );
    if (
      new Set(input.accounts.map((account) => account.providerAccountId))
        .size !== input.accounts.length
    )
      throw new Error("Choose each bank account only once.");
    const { connection, opened, state, mappings } = await openConnection(
      db,
      userId,
      input.connectionId,
    );
    const { household, ledger } = opened;
    const previous = await findOperation(
      db,
      household.workspaceId,
      input.operationId,
    );
    if (previous) {
      const result = earlierResult(
        previous,
        userId,
        submittedOperation,
        operation(input.accounts),
      );
      const accountIds = input.accounts.map((account) => {
        const id = mappings[account.providerAccountId]?.accountId;
        if (!id)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Account setup changed. Refresh your bank accounts.",
          });
        return id;
      });
      return { ...result, accountIds };
    }
    if (opened.requestRevision !== input.expectedRevision)
      throw refusal(
        "conflict",
        "Your budget changed. Refresh before adding accounts.",
        household.revision,
      );
    if (
      !connection.lastSyncedAt ||
      !["INITIAL_UPDATE_COMPLETE", "HISTORICAL_UPDATE_COMPLETE"].includes(
        state.transactionStatus ?? "",
      )
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Your bank is still preparing account activity. Update accounts and try setup again once the first update finishes.",
      });
    const budget = ledger.budget;
    const today = bankSetupDate(budget.settings.timezone);
    if (
      input.accounts.some((account) => !account.existingAccountId) &&
      bankSetupDate(budget.settings.timezone, connection.lastSyncedAt) !== today
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Update your bank accounts before setup so today's opening balances include the latest activity.",
      });
    const allMappings = connectionMappings(
      await db.bankConnection.findMany({ where: { clerkUserId: userId } }),
    );
    const usedAccountIds = new Set(
      allMappings.flatMap((saved) =>
        Object.values(saved).map((mapping) => mapping.accountId),
      ),
    );
    const accountIds: string[] = [];
    const commands: Command[] = [];
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
        provider.type !== "loan" &&
        !selected.existingAccountId &&
        !state.synchronizedAccountIds.includes(provider.accountId)
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `The bank is still preparing a matching balance and transaction history for ${provider.name}. Update accounts and try again before adding it.`,
        });
      if (allMappings.some((saved) => saved[selected.providerAccountId]))
        throw new Error(
          "This bank account is already added. Refresh to see its existing account.",
        );
      if (provider.currentBalance !== selected.expectedBalance)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The bank balance changed. Refresh and review the latest balance before adding this account.",
        });
      if (provider.type === "loan") {
        if (provider.currency !== "USD")
          throw new Error("Only bank accounts in USD are supported.");
        if (selected.existingAccountId) {
          const existing = budget.loans.find(
            (loan) => loan.id === selected.existingAccountId,
          );
          if (!existing)
            throw new Error("Choose an existing loan from this budget.");
          if (usedAccountIds.has(existing.id))
            throw new Error("This loan is already linked to a bank.");
          const openingDate = existing.rates
            .map((rate) => rate.effectiveDate)
            .sort()[0]!;
          if (!selected.startDate || selected.startDate <= openingDate)
            throw new Error(
              "Choose an import date after this loan's opening balance date.",
            );
          mappings[provider.accountId] = {
            accountId: existing.id,
            startDate: selected.startDate,
          };
          usedAccountIds.add(existing.id);
          accountIds.push(existing.id);
          continue;
        }
        if (!selected.loan)
          throw new Error(
            "Enter the loan's confirmed balance, APR, and required payment.",
          );
        if (
          provider.currentBalance !== null &&
          usdToCents(provider.currentBalance) !== selected.loan.principal
        )
          throw new Error(
            "Use the loan's latest bank balance, then review its terms.",
          );
        if (selected.startDate && selected.startDate !== today)
          throw new Error("New loans start with today's confirmed balance.");
        const loanId = `bank:${input.operationId}:${commandHash(provider.accountId).slice(0, 32)}`;
        commands.push({
          type: "loan.add",
          id: `${input.operationId}:${commandHash(provider.accountId).slice(0, 32)}`,
          loanId,
          categoryId: `${loanId}:payment`,
          name: selected.name,
          ...selected.loan,
          effectiveDate: today,
        });
        mappings[provider.accountId] = {
          accountId: loanId,
          startDate: today,
          openingSnapshot: openingSnapshot(
            state.records,
            provider.accountId,
            state.reviews,
          ),
        };
        usedAccountIds.add(loanId);
        accountIds.push(loanId);
        continue;
      }
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
          throw new Error("This budget account is already linked to a bank.");
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
        commands.push({
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
    const { changeSets } = runCommands(ledger.state, userId, commands);
    const written = await writeServerOperation(db, opened, {
      actorId: userId,
      operationId: input.operationId,
      source: "user",
      type: "bank.accounts.setup",
      submitted: submittedOperation,
      changeSet: composeChangeSets(input.operationId, changeSets),
      alongside: async (tx) => {
        const saved = await tx.bankConnection.updateMany({
          where: { id: connection.id, updatedAt: connection.updatedAt },
          data: { accountMappings: jsonValue(mappings) },
        });
        if (saved.count !== 1)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Account setup changed. Refresh your bank accounts.",
          });
      },
    });
    return { ...written, accountIds };
  } catch (error) {
    if (error instanceof RevisionConflictError)
      throw refusal(
        "conflict",
        "Your budget changed. Refresh before adding accounts.",
        error.revision,
      );
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
    const { connection, opened, state, mappings } = await openConnection(
      db,
      userId,
      input.connectionId,
    );
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
    const account = opened.ledger.budget.accounts.find(
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
    const allMappings = connectionMappings(
      await db.bankConnection.findMany({
        where: { clerkUserId: userId },
        select: { id: true, clerkUserId: true, accountMappings: true },
      }),
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
    // No row changes, but what the inbox shows does: the revision moves so
    // browsers refresh it.
    const operationId = randomUUID();
    const written = await writeServerOperation(db, opened, {
      actorId: userId,
      operationId,
      source: "user",
      type: "bank.account.map",
      submitted: { ...input, operationId },
      changeSet: { operationId, revision: 0, before: [], after: [] },
      alongside: async (tx) => {
        await tx.bankConnection.update({
          where: { id: connection.id },
          data: { accountMappings: jsonValue(mappings) },
        });
      },
    });
    return { mapped: true, ...written };
  } catch (error) {
    if (error instanceof RevisionConflictError)
      throw refusal(
        "conflict",
        "Your budget changed. Refresh before linking accounts.",
        error.revision,
      );
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
  // Updates change the budget, so none run while it's under maintenance.
  const first = await requireHousehold(db, userId);
  const readable = readImportStates(first.household.rows, userId);
  let imported = 0,
    updated = 0;
  for (const connection of connections) {
    const read = readBankConnection(connection, readable);
    if (read.status === "maintenance") continue;
    try {
      const plaid = client();
      const accessToken = decryptBankToken(connection.encryptedToken, userId);
      let delta = await plaid.syncTransactions(accessToken, connection.cursor);
      const accounts = await plaid.getAccounts(accessToken);
      const missingBalanceIds = new Set(
        accounts.accounts
          .filter(
            (account) =>
              ["credit", "depository"].includes(account.type) &&
              account.currency === "USD" &&
              account.currentBalance !== null &&
              !read.mappings[account.accountId] &&
              !read.state.synchronizedAccountIds.includes(account.accountId) &&
              !delta.accounts.some(
                (synced) => synced.accountId === account.accountId,
              ),
          )
          .map((account) => account.accountId),
      );
      if (
        connection.cursor &&
        delta.updateStatus === "HISTORICAL_UPDATE_COMPLETE" &&
        read.state.records.some((record) =>
          missingBalanceIds.has(record.current.providerAccountId),
        )
      ) {
        // Recover lost readiness without losing incremental removals. Snapshot
        // balances belong to this history only if both reads end at one cursor.
        const snapshot = await plaid.syncTransactions(accessToken);
        delta = await plaid.syncTransactions(accessToken, connection.cursor);
        if (
          snapshot.nextCursor === delta.nextCursor &&
          !snapshot.skipped.unidentifiable
        ) {
          const unreadableIds = new Set(
            snapshot.skipped.quarantined.map(
              (record) => record.providerAccountId,
            ),
          );
          delta = {
            ...delta,
            accounts: [
              ...new Map(
                [
                  ...snapshot.accounts.filter(
                    (account) => !unreadableIds.has(account.accountId),
                  ),
                  ...delta.accounts,
                ].map((account) => [account.accountId, account]),
              ).values(),
            ],
          };
        }
      }
      let counts: { imported: number; updated: number } | undefined;
      // The household may change while this runs; the update is planned
      // again on the newer rows.
      for (let attempt = 0; !counts; attempt++) {
        try {
          counts = await applyBankUpdate(
            db,
            userId,
            connection,
            delta,
            accounts,
          );
        } catch (error) {
          if (!(error instanceof RevisionConflictError) || attempt >= 4)
            throw error;
        }
      }
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
  // Payments between people that the update brought in, recognized as
  // transfers to and from the counterparty accounts.
  const { settled, repaid } = await settleFromImports(db, userId);
  return { imported, updated: updated + settled + repaid };
}

type PlaidClient = ReturnType<typeof client>;

/**
 * Applies one connection's bank update to the household as one provider
 * operation: its import state, and the changes the bank made to imported
 * transactions the member already recorded.
 */
async function applyBankUpdate(
  db: Database,
  userId: string,
  connection: { id: string; cursor: string | null },
  delta: Awaited<ReturnType<PlaidClient["syncTransactions"]>>,
  accounts: Awaited<ReturnType<PlaidClient["getAccounts"]>>,
) {
  const [fresh, opened] = await Promise.all([
    db.bankConnection.findFirstOrThrow({
      where: { id: connection.id, clerkUserId: userId },
    }),
    requireHousehold(db, userId),
  ]);
  if (fresh.cursor !== connection.cursor)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Another bank update finished first. Try again.",
    });
  const { state: old, mappings } = readyConnection(
    fresh,
    readImportStates(opened.household.rows, userId),
  );
  const plan = applyTransactionSync(old.records, delta, fresh.id);
  const changedAccounts = new Set(
    [
      ...delta.added,
      ...delta.modified,
      ...delta.removed,
      ...delta.skipped.quarantined,
    ].map((record) => record.providerAccountId),
  );
  const reportedAccounts = new Map(
    accounts.accounts.map((account) => [account.accountId, account]),
  );
  const retainedAccounts = old.accounts.filter((account) => {
    const reported = reportedAccounts.get(account.accountId);
    return (
      old.synchronizedAccountIds.includes(account.accountId) &&
      !changedAccounts.has(account.accountId) &&
      (fresh.cursor === delta.nextCursor ||
        (!delta.skipped.unidentifiable &&
          account.currentBalance !== null &&
          reported?.currentBalance === account.currentBalance &&
          reported.currency === account.currency))
    );
  });
  const synchronizedAccounts = new Map(
    [...retainedAccounts, ...delta.accounts].map((account) => [
      account.accountId,
      account,
    ]),
  );
  // Plaid omits accounts without transactions from /transactions/sync.
  // A completed, empty history with a reported zero balance can start at zero.
  const accountsWithActivity = new Set([
    ...plan.records.map((record) => record.current.providerAccountId),
    ...quarantinedTransactions(old.reviews).map(
      (review) => review.transaction.providerAccountId,
    ),
    ...delta.skipped.quarantined.map((record) => record.providerAccountId),
  ]);
  if (
    delta.updateStatus === "HISTORICAL_UPDATE_COMPLETE" &&
    !delta.skipped.unidentifiable
  )
    for (const account of accounts.accounts)
      if (
        !synchronizedAccounts.has(account.accountId) &&
        account.currentBalance === 0 &&
        !changedAccounts.has(account.accountId) &&
        !accountsWithActivity.has(account.accountId)
      )
        synchronizedAccounts.set(account.accountId, account);
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
    const existingReviews = state.reviews[review.logicalTransactionId] ?? [];
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
  let book = opened.ledger.state;
  const changeSets: ChangeSet[] = [];
  const operations: Command[] = [];
  const partnerImports = planPartnerImports(
    book,
    budgetOf(book, userId),
    plan.records,
    mappings,
    old.resolved,
    (record) => `sync:${fresh.id}:${fingerprint(record).slice(0, 40)}`,
  );
  for (const change of plan.changes) {
    const record = change.after;
    const mapped = mappings[record.current.providerAccountId];
    const resolution = old.resolved[record.id];
    const eligibility = bankImportEligibility(mapped, record);
    if (eligibility === "opening_snapshot_changed")
      state.errors[record.id] = openingSnapshotChangedMessage;
    if (
      !mapped ||
      opened.ledger.budget.loans.some((loan) => loan.id === mapped.accountId) ||
      eligibility !== "eligible" ||
      record.matchStatus !== "confirmed"
    )
      continue;
    if (!resolution) {
      if (
        isRejectedSettlementImport(
          budgetOf(book, userId),
          record.providerTransactionIds,
        )
      )
        continue;
      // A purchase a partner recorded first is matched, or waits to be.
      const partnerImport = partnerImports.get(record.id);
      if (partnerImport === "wait") continue;
      const remembered =
        partnerImport ??
        rememberedImport(
          budgetOf(book, userId),
          mapped.accountId,
          record,
          `sync:${fresh.id}:${fingerprint(record).slice(0, 40)}`,
        );
      if (!remembered) continue;
      try {
        const result = executeWithChanges(book, userId, remembered, "provider");
        book = result.book;
        changeSets.push(result.changeSet);
        operations.push(remembered);
        state.resolved[record.id] = {
          fingerprint: fingerprint(record),
          transactionId: remembered.transactionId,
        };
      } catch {
        // Left in the inbox for the user, as an import with no memory is.
      }
      continue;
    }
    if (!resolution.transactionId) continue;
    const transaction = budgetOf(book, userId).transactions.find(
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
      ? { type: "transaction.remove", id, transactionId: transaction.id }
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
              change.before?.current.merchantName ?? change.before?.current.name
            )?.slice(0, 240)
              ? (record.current.merchantName ?? record.current.name).slice(
                  0,
                  240,
                )
              : transaction.payee,
          status: record.current.pending ? "pending" : "posted",
          categoryId: transaction.categoryId,
          expenseMonth: transaction.expenseMonth,
          sharedCategoryId: transaction.sharedCategoryId,
          providerId: record.current.providerTransactionId,
        };
    try {
      const result = executeWithChanges(book, userId, command, "agent");
      book = result.book;
      changeSets.push(result.changeSet);
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
  const operationId = randomUUID();
  const changeSet = composeChangeSets(operationId, [
    ...changeSets,
    importStateChange(opened.household.rows, userId, fresh.id, state),
  ]);
  const saveConnection = async (tx: Prisma.TransactionClient | Database) => {
    const saved = await tx.bankConnection.updateMany({
      where: { id: fresh.id, cursor: fresh.cursor },
      data: {
        imports: detailsColumn(fresh.imports, state),
        cursor: delta.nextCursor,
        lastSyncedAt: new Date(),
        lastAttemptAt: new Date(),
        error: null,
      },
    });
    if (saved.count !== 1)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Another bank update finished first. Try again.",
      });
  };
  if (changeSet.after.length)
    await writeServerOperation(db, opened, {
      actorId: userId,
      operationId,
      source: "provider",
      type: "bank.sync",
      submitted: {
        connectionId: fresh.id,
        cursor: delta.nextCursor,
        commands: operations.map((command) => command.id),
      },
      changeSet,
      alongside: saveConnection,
    });
  else await saveConnection(db);
  return {
    imported: plan.changes.filter((c) => !c.before).length,
    updated: operations.length,
  };
}

/**
 * The transaction a new bank import becomes when its payee is remembered
 * (src/domain/payee-memory.ts): categorized as the user last categorized
 * the payee, and unreviewed. Nothing when the payee has no memory that fits,
 * or when a transaction entered by hand may be this purchase: that import
 * waits in the inbox, so the purchase is never counted twice.
 */
function rememberedImport(
  budget: Budget,
  accountId: string,
  record: StoredImport,
  operationId: string,
): Extract<Command, { type: "transaction.upsert" }> | undefined {
  if (record.removed) return undefined;
  const fact = record.current;
  const amount = -fact.amountCents;
  const payee = (fact.merchantName ?? fact.name).slice(0, 240);
  const categoryId = rememberedCategory(budget, { payee, accountId, amount });
  if (!categoryId) return undefined;
  const counterpartyShare = rememberedCounterpartyShare(budget, {
    payee,
    accountId,
    amount,
  });
  const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  const twin = budget.transactions.some(
    (transaction) =>
      !transaction.removed &&
      transaction.accountId === accountId &&
      (transaction.providerId === fact.providerTransactionId ||
        (!transaction.providerId &&
          transaction.amount === amount &&
          Math.abs(day(transaction.date) - day(fact.date)) <=
            MANUAL_MATCH_DAYS)),
  );
  if (twin) return undefined;
  return {
    type: "transaction.upsert",
    id: operationId,
    transactionId: randomUUID(),
    accountId,
    date: fact.date,
    amount,
    payee,
    status: fact.pending ? "pending" : "posted",
    ...(categoryId === READY_TO_ASSIGN ? {} : { categoryId }),
    ...(counterpartyShare ? { counterpartyShare } : {}),
    providerId: fact.providerTransactionId,
  };
}

// How far apart a bank import and a transaction entered by hand can be
// dated and still be the same purchase, as in YNAB's matching.
const MANUAL_MATCH_DAYS = 10;

const budgetOf = (state: AccountingState, userId: string): Budget =>
  "budgets" in state ? state.budgets[userId]! : state.budget;

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
    /** The command as the client sent it, which identifies a retried save. */
    submittedCommand?: unknown;
  },
): Promise<OperationResult & { resolved: true }> {
  const submittedCommand =
    "submittedCommand" in input ? input.submittedCommand : input.command;
  const saveIdentity = (command: unknown) =>
    input.expectedFingerprint
      ? {
          command,
          connectionId: input.connectionId,
          logicalId: input.logicalId,
          fingerprint: input.expectedFingerprint,
        }
      : command;
  try {
    const { connection, opened, state } = await openConnection(
      db,
      userId,
      input.connectionId,
    );
    const { household, ledger } = opened;
    const write = async (
      operationId: string,
      submitted: unknown,
      changeSets: ChangeSet[],
    ) => ({
      resolved: true as const,
      ...(await writeServerOperation(db, opened, {
        actorId: userId,
        operationId,
        source: "user",
        type: "bank.import.resolve",
        submitted,
        changeSet: composeChangeSets(operationId, [
          ...changeSets,
          importStateChange(household.rows, userId, connection.id, state),
        ]),
      })),
    });
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
      const operationId = randomUUID();
      return await write(operationId, { ...input, operationId }, []);
    }
    if (input.command) {
      const saved = await findOperation(
        db,
        household.workspaceId,
        input.command.id,
      );
      if (saved)
        return {
          resolved: true,
          ...earlierResult(
            saved,
            userId,
            saveIdentity(submittedCommand),
            saveIdentity(input.command),
          ),
        };
    }
    if (
      input.expectedFingerprint &&
      input.command &&
      input.expectedFingerprint !== fingerprint(record)
    )
      throw refusal(
        "conflict",
        "Your bank updated this transaction. Reopen it before saving.",
        household.revision,
      );
    const mapping = mappings(connection)[record.current.providerAccountId];
    let operationId: string = randomUUID();
    let submitted: unknown = { ...input, operationId };
    const changeSets: ChangeSet[] = [];
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
      if (ledger.budget.loans.some((loan) => loan.id === mapping.accountId))
        throw new Error(loanActivityReviewMessage);
      const eligibility = bankImportEligibility(mapping, record);
      if (eligibility !== "eligible")
        throw new Error(
          eligibility === "opening_snapshot_changed"
            ? openingSnapshotChangedMessage
            : "This activity is already included in the opening balance or predates the import start date. Ignore it rather than duplicating opening history.",
        );
      if (opened.requestRevision !== input.expectedRevision)
        throw refusal(
          "conflict",
          "Your budget changed. Refresh before confirming this import.",
          household.revision,
        );
      const budget = ledger.budget;
      let transactionId: string;
      if (input.existingTransactionId) {
        const transaction = budget.transactions.find(
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
      } else if (input.command?.type === "partner.match") {
        // The payer confirmed which recorded purchase this import is.
        if (state.resolved[record.id]?.transactionId)
          throw new Error(alreadyLinkedMessage);
        const command = confirmedPartnerMatch(input.command, mapping, record);
        changeSets.push(
          executeWithChanges(
            ledger.state,
            userId,
            prepareUserCommand(budget, command),
          ).changeSet,
        );
        transactionId = command.transactionId;
        operationId = command.id;
        submitted = saveIdentity(submittedCommand);
      } else {
        const command = input.command;
        if (state.resolved[record.id]?.transactionId)
          throw new Error(alreadyLinkedMessage);
        if (
          command?.type !== "transaction.upsert" &&
          !(input.expectedFingerprint && command?.type === "transaction.save")
        )
          throw new Error(
            "Record specialized payments or credits using their dedicated operation, then link the existing ledger record.",
          );
        if (record.removed)
          throw new Error(
            "This provider record was removed; do not create a new purchase from it.",
          );
        if (
          budget.transactions.some((item) => item.id === command.transactionId)
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
        const possibleDuplicates = budget.transactions.filter(
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
        if (input.expectedFingerprint) prepareUserCommand(budget, command);
        changeSets.push(
          executeWithChanges(ledger.state, userId, {
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
          }).changeSet,
        );
        transactionId = command.transactionId;
        operationId = command.id;
        submitted = saveIdentity(submittedCommand);
      }
      record.matchStatus = "confirmed";
      state.resolved[record.id] = {
        fingerprint: fingerprint(record),
        transactionId,
        decidedAt: new Date().toISOString(),
      };
    }
    delete state.errors[record.id];
    return await write(operationId, submitted, changeSets);
  } catch (error) {
    if (error instanceof RevisionConflictError)
      throw refusal(
        "conflict",
        "Your budget changed. Refresh before confirming this import.",
        error.revision,
      );
    domainError(error);
  }
}

function mappings(connection: StoredConnection): Mappings {
  return mappingsSchema.parse(connection.accountMappings);
}
