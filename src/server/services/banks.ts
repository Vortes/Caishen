import { isRejectedSettlementImport } from "~/domain/partner-settlements";
import { MANUAL_MATCH_DAYS } from "~/domain/bank-import-balances";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  plaidLinkMetadataSchema,
  type PlaidLinkMetadata,
} from "~/lib/plaid-link-metadata";
import {
  bankLinkVerdict,
  bankRecoveryCandidates,
  bankAccountNeedsRecovery,
  sameBankAccount,
  resolveBankAccountIdentity,
} from "~/lib/bank-account-identity";
import {
  applyChangeSet,
  composeChangeSets,
  rowsIn,
} from "~/domain/change-sets";
import {
  executeWithChanges,
  checkRestoredLedger,
  isCleared,
  projectBook,
  type Budget,
  type Command,
} from "~/domain/engine";
import {
  rowOwner,
  rowsToPersonalLedger,
  tombstone,
  type ChangeSet,
} from "~/domain/rows";
import type { AccountingState } from "~/domain/shared-ledger";
import {
  rememberedCategory,
  rememberedCounterpartyShare,
} from "~/domain/payee-memory";
import { READY_TO_ASSIGN } from "~/domain/transfers";
import {
  classifyRegisterEntry,
  type ImportEligibility,
  type BankInboxItem,
  alreadyLinkedImportMessage,
  quarantinedImportMessage,
} from "~/domain/register-entry";
import { prepareUserCommand } from "~/domain/user-command";
import type { Prisma } from "~/generated/prisma";
import {
  bankAccountSchema,
  createPlaidClient,
} from "~/server/integrations/plaid";
import {
  applyTransactionSync,
  type StoredImport,
} from "~/server/integrations/transactions";
import { IntegrationError, usdToCents } from "~/server/integrations/validation";
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
  plaidRequestRecorder,
  recordBankLinkOutcome,
} from "./bank-provider-events";
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
type ImportState = z.infer<typeof importStateSchema>;
type ConnectionDetails = Omit<ImportState, keyof ImportRowState>;
type Mappings = z.infer<typeof mappingsSchema>;
type StoredConnection = {
  id: string;
  clerkUserId: string;
  imports: unknown;
  accountMappings: unknown;
  unavailableAccountIds?: string[];
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
    ...(column.disconnectedAt ? { disconnectedAt: column.disconnectedAt } : {}),
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
        ...(read.connection.unavailableAccountIds?.length
          ? { unavailableAccountIds: read.connection.unavailableAccountIds }
          : {}),
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

function overlappingBankAccount(
  incoming: Pick<ConnectionDetails, "institutionId" | "accounts">,
  existing: Pick<ConnectionDetails, "institutionId" | "accounts">,
) {
  return incoming.accounts.find((account) =>
    existing.accounts.some((saved) =>
      sameBankAccount(
        account,
        saved,
        incoming.institutionId,
        existing.institutionId,
      ),
    ),
  );
}

export function bankAccountDetails(value: unknown) {
  return connectionDetails(connectionColumnSchema.parse(value));
}
// The request id is what Plaid support can act on, so a failed update
// names it where the Banks panel shows the failure.
function withPlaidRequestId(message: string, error: unknown) {
  return error instanceof IntegrationError && error.requestId
    ? `${message} (Plaid request id: ${error.requestId})`
    : message;
}

// Every request the client makes lands in the audit trail against the
// member and, once one exists, the connection it concerns.
function client(db: Database, userId: string, connectionId?: string | null) {
  return createPlaidClient(
    {
      clientId: process.env.PLAID_CLIENT_ID ?? "",
      secret: process.env.PLAID_SECRET ?? "",
      environment: z
        .enum(["sandbox", "production"])
        .parse(process.env.PLAID_ENV ?? "sandbox"),
      redirectUri: process.env.PLAID_REDIRECT_URI,
    },
    undefined,
    plaidRequestRecorder(db, { userId, connectionId }),
  );
}

function requireConnected(connection: StoredConnection) {
  const details = readColumn(
    connection,
    "BankConnection.imports",
    connectionColumnSchema,
    connection.imports,
  );
  if (!details) throw connectionMaintenance();
  if (details.disconnectedAt)
    throw new Error(
      "This bank is disconnected. Choose Link again to authorize a new connection.",
    );
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
    if (connection) requireConnected(connection);
    // Verify token encryption is configured before starting a bank connection.
    encryptBankToken("configuration-check", userId);
    const token = await client(db, userId, connection?.id).createLinkToken(
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
function reviewBankLinkConnections(
  connections: StoredConnection[],
  linked: PlaidLinkMetadata,
) {
  const institutionId = linked.institution?.institution_id;
  if (!institutionId)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Plaid did not identify the bank. Try connecting again.",
    });
  const matching = connections
    .flatMap((connection) => {
      const details = readColumn(
        connection,
        "BankConnection.imports",
        connectionColumnSchema,
        connection.imports,
      );
      if (!details) throw connectionMaintenance();
      if (details.disconnectedAt || details.institutionId !== institutionId)
        return [];
      const lost = Object.keys(mappings(connection))
        .filter(
          (id) => !details.accounts.some((account) => account.accountId === id),
        )
        .map((accountId) => ({ accountId, name: null, mask: null }));
      return [
        {
          id: connection.id,
          institutionName: details.institutionName,
          accounts: [...details.accounts, ...lost],
        },
      ];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const accounts = matching.flatMap((connection) => connection.accounts);
  const { verdict } = matching.length
    ? bankLinkVerdict(
        linked.accounts.map(({ id, ...account }) => ({
          accountId: id,
          ...account,
        })),
        institutionId,
        { institutionId, accounts },
      )
    : { verdict: "none" as const };
  const visible = matching.map((connection) => ({
    id: connection.id,
    institutionName: connection.institutionName,
    accounts: connection.accounts.map(({ accountId, name, mask }) => ({
      accountId,
      name,
      mask,
    })),
  }));
  return {
    verdict,
    connections: visible,
    mayDisconnectExisting: matching.some((connection) =>
      /\b(chase|pnc|navy federal|schwab)\b/i.test(
        connection.institutionName ?? "",
      ),
    ),
    reviewId: operationHash({ metadata: linked, connections: matching }),
  };
}

export async function reviewBankLink(
  db: Database,
  userId: string,
  metadata: unknown,
) {
  const linked = plaidLinkMetadataSchema.parse(metadata);
  const connections = await db.bankConnection.findMany({
    where: { clerkUserId: userId },
  });
  return reviewBankLinkConnections(connections, linked);
}

export async function exchangeBankToken(
  db: Database,
  userId: string,
  publicToken: string,
  metadata: unknown,
  reviewId?: string,
): Promise<{ id: string; warning?: string }> {
  // Link completed in the browser whatever the exchange makes of it; the
  // trail records that outcome once, with the connection when one results.
  let completed: PlaidLinkMetadata | undefined;
  let connectionId: string | null = null;
  try {
    if (!(await readHouseholdRevision(db, userId)))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Create your personal budget first.",
      });
    encryptBankToken("configuration-check", userId);
    // Check Link metadata before exchange: exchanging a duplicate creates a
    // second Plaid Item, even if budget-account setup later refuses it.
    const linked = plaidLinkMetadataSchema.parse(metadata);
    completed = linked;
    if (!linked.institution)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Plaid did not identify the bank. Try connecting again.",
      });
    const institutionId = linked.institution.institution_id;
    const connection = await db.$transaction(
      async (tx) => {
        // The lock spans the duplicate check and the external token exchange.
        // It is shared by all app instances and released on commit or failure.
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`plaid-link:${userId}`}, 0)) AS acquired
      `;
        if (!lock?.acquired)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Another bank connection is being saved. Wait for it to finish and try again.",
          });
        const connections = await tx.bankConnection.findMany({
          where: { clerkUserId: userId },
        });
        const review = reviewBankLinkConnections(connections, linked);
        if (reviewId && reviewId !== review.reviewId)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Your bank accounts changed. Review the connection again before continuing.",
          });
        if (
          review.verdict === "all" ||
          (review.verdict === "some" && !reviewId)
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This bank account is already connected. Use Choose shared accounts in the existing bank’s ⋯ menu to share additional accounts.",
          });
        if (review.verdict === "unknown" && !reviewId)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Caishen couldn’t tell whether this bank account is already connected, because the account details to compare are incomplete or ambiguous. Use Choose shared accounts in the existing bank’s ⋯ menu to share additional accounts.",
          });
        const result = await client(db, userId).exchangePublicToken(
          publicToken,
        );
        const existing = await tx.bankConnection.findUnique({
          where: { itemId: result.itemId },
        });
        if (existing && existing.clerkUserId !== userId)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This connection is already in use.",
          });
        return tx.bankConnection.upsert({
          where: { itemId: result.itemId },
          create: {
            clerkUserId: userId,
            itemId: result.itemId,
            encryptedToken: encryptBankToken(result.accessToken, userId),
            imports: jsonValue(
              connectionDetails(
                connectionColumnSchema.parse({
                  institutionId: institutionId,
                }),
              ),
            ),
            accountMappings: {},
          },
          update: {
            encryptedToken: encryptBankToken(result.accessToken, userId),
            error: null,
          },
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    connectionId = connection.id;
    try {
      await refreshBankAccounts(db, userId, connection.id);
      return { id: connection.id };
    } catch (error) {
      const warning = withPlaidRequestId(
        "Your bank is connected, but account details are still unavailable. Request an update to try again.",
        error,
      );
      await db.bankConnection.updateMany({
        where: { id: connection.id, updatedAt: connection.updatedAt },
        data: { error: warning, lastAttemptAt: new Date() },
      });
      return { id: connection.id, warning };
    }
  } catch (error) {
    return domainError(error);
  } finally {
    if (completed)
      await recordBankLinkOutcome(db, {
        userId,
        method: "success",
        connectionId,
        institutionId: completed.institution?.institution_id ?? null,
        accountCount: completed.accounts.length,
      });
  }
}

export const bankLinkExitSchema = z.object({
  connectionId: z.string().min(1).max(256).optional(),
  institutionId: z.string().min(1).max(256).nullable().optional(),
  errorCode: z.string().min(1).max(100).nullable().optional(),
  requestId: z.string().min(1).max(256).nullable().optional(),
});

/** Where a member's Link attempt ended when it did not complete. */
export async function recordBankLinkExit(
  db: Database,
  userId: string,
  exit: z.infer<typeof bankLinkExitSchema>,
) {
  // A connection id from the browser counts only when it is the member's own.
  const connection = exit.connectionId
    ? await db.bankConnection.findFirst({
        where: { id: exit.connectionId, clerkUserId: userId },
        select: { id: true },
      })
    : null;
  await recordBankLinkOutcome(db, {
    userId,
    method: "exit",
    connectionId: connection?.id ?? null,
    institutionId: exit.institutionId ?? null,
    accountCount: null,
    errorCode: exit.errorCode ?? null,
    requestId: exit.requestId ?? null,
  });
}

// Missing provider accounts retain their identity for display and duplicate checks.
// Only a response from Plaid can make their balances current again.
function mergeAccountCatalog(
  previous: ConnectionDetails["accounts"],
  reported: ConnectionDetails["accounts"],
  mappings: Mappings,
) {
  const reportedIds = new Set(reported.map((account) => account.accountId));
  return {
    accounts: [
      ...new Map(
        [
          ...previous.filter((account) => mappings[account.accountId]),
          ...reported,
        ].map((account) => [account.accountId, account]),
      ).values(),
    ],
    unavailableAccountIds: Object.keys(mappings).filter(
      (id) => !reportedIds.has(id),
    ),
  };
}

/** An automatic identity decision, recorded on the operation that made it. */
type IdentityDecision = {
  rung: 1 | 2;
  from: string;
  to: string;
  accountId: string;
};

// Only rungs 1 and 2 preserve a mapped account automatically. Rung 2 moves
// its mapping to the new id, so the old id leaves the catalog with the merge.
function followAccountIdentities(
  previous: ConnectionDetails["accounts"],
  reported: ConnectionDetails["accounts"],
  mappings: Mappings,
) {
  const next = { ...mappings };
  const decisions: IdentityDecision[] = [];
  const candidates = previous
    .filter((account) => mappings[account.accountId])
    .map((account) => ({
      account,
      institutionId: null,
      sameConnection: true,
      absent: !reported.some((item) => item.accountId === account.accountId),
    }));
  for (const account of reported) {
    const resolution = resolveBankAccountIdentity(account, {
      institutionId: null,
      reported,
      candidates,
    });
    if (resolution.rung !== 1 && resolution.rung !== 2) continue;
    const from = resolution.existing.accountId;
    const to = account.accountId;
    next[to] = next[from]!;
    if (from !== to) delete next[from];
    decisions.push({
      rung: resolution.rung,
      from,
      to,
      accountId: next[to].accountId,
    });
  }
  return {
    mappings: next,
    decisions,
    ...mergeAccountCatalog(previous, reported, next),
  };
}

async function refreshBankAccounts(
  db: Database,
  userId: string,
  connectionId: string,
) {
  const requested = await db.bankConnection.findFirst({
    where: { id: connectionId, clerkUserId: userId },
  });
  if (!requested) throw new TRPCError({ code: "NOT_FOUND" });
  requireConnected(requested);
  const accounts = await client(db, userId, requested.id).getAccounts(
    decryptBankToken(requested.encryptedToken, userId),
  );
  const column = readColumn(
    requested,
    "BankConnection.imports",
    connectionColumnSchema,
    requested.imports,
  );
  if (!column) throw connectionMaintenance();
  const identity = followAccountIdentities(
    column.accounts,
    accounts.accounts,
    mappings(requested),
  );
  // Saved only over the connection the response was requested for, so an
  // older response cannot overwrite a newer update.
  const save = async (tx: Prisma.TransactionClient | Database) => {
    const saved = await tx.bankConnection.updateMany({
      where: {
        id: requested.id,
        clerkUserId: userId,
        updatedAt: requested.updatedAt,
      },
      data: {
        imports: detailsColumn(requested.imports, {
          ...connectionDetails(column),
          ...accounts,
          accounts: identity.accounts,
          transactionStatus: null,
          synchronizedAccountIds: [],
        }),
        unavailableAccountIds: identity.unavailableAccountIds,
        ...(identity.decisions.length
          ? { accountMappings: jsonValue(identity.mappings) }
          : {}),
        lastAttemptAt: new Date(),
        error: null,
      },
    });
    if (saved.count !== 1)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Another bank update finished first. Refresh and try again.",
      });
  };
  if (!identity.decisions.length) return save(db);
  const operationId = randomUUID();
  await writeServerOperation(db, await requireHousehold(db, userId), {
    actorId: userId,
    operationId,
    source: "provider",
    type: identity.decisions.some((decision) => decision.rung === 2)
      ? "bank.accounts.supersede"
      : "bank.accounts.identify",
    submitted: { connectionId: requested.id, decisions: identity.decisions },
    changeSet: composeChangeSets(operationId, []),
    alongside: save,
  });
}

export async function reconnectBank(
  db: Database,
  userId: string,
  connectionId: string,
  metadata?: unknown,
): Promise<{ id: string; warning?: string }> {
  // Update-mode Link completed in the browser before this refresh; the trail
  // records that against the member's own connection whatever follows.
  let completed: PlaidLinkMetadata | undefined;
  let owned: string | null = null;
  try {
    const connection = await db.bankConnection.findFirst({
      where: { id: connectionId, clerkUserId: userId },
    });
    if (!connection) throw new TRPCError({ code: "NOT_FOUND" });
    owned = connection.id;
    if (metadata !== undefined)
      completed = plaidLinkMetadataSchema.parse(metadata);
    requireConnected(connection);
    await refreshBankAccounts(db, userId, connection.id);
    return { id: connection.id };
  } catch (error) {
    return domainError(error);
  } finally {
    if (completed)
      await recordBankLinkOutcome(db, {
        userId,
        method: "success",
        connectionId: owned,
        institutionId: completed.institution?.institution_id ?? null,
        accountCount: completed.accounts.length,
      });
  }
}

export async function disconnectBank(
  db: Database,
  userId: string,
  input: {
    connectionId: string;
    operationId: string;
    expectedRevision: number;
  },
): Promise<OperationResult> {
  try {
    const { connection, opened, state } = await openConnection(
      db,
      userId,
      input.connectionId,
    );
    const submitted = {
      type: "bank.disconnect",
      connectionId: input.connectionId,
    };
    const previous = await findOperation(
      db,
      opened.household.workspaceId,
      input.operationId,
    );
    if (previous) return earlierResult(previous, userId, submitted, submitted);
    if (opened.requestRevision !== input.expectedRevision)
      throw refusal(
        "conflict",
        "Your budget changed. Refresh before disconnecting.",
        opened.household.revision,
      );
    if (!state.disconnectedAt)
      await client(db, userId, connection.id).removeItem(
        decryptBankToken(connection.encryptedToken, userId),
      );
    return await writeServerOperation(db, opened, {
      actorId: userId,
      operationId: input.operationId,
      source: "user",
      type: "bank.disconnect",
      submitted,
      changeSet: composeChangeSets(input.operationId, []),
      alongside: async (tx) => {
        const saved = await tx.bankConnection.updateMany({
          where: { id: connection.id, updatedAt: connection.updatedAt },
          data: {
            imports: detailsColumn(connection.imports, {
              ...state,
              disconnectedAt: state.disconnectedAt ?? new Date().toISOString(),
            }),
            encryptedToken: "",
            error: null,
          },
        });
        if (saved.count !== 1)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Your bank changed. Try disconnecting again.",
          });
      },
    });
  } catch (error) {
    if (error instanceof RevisionConflictError)
      throw refusal(
        "conflict",
        "Your budget changed. Refresh before disconnecting.",
        error.revision,
      );
    domainError(error);
  }
}

const duplicateRepairSelectionSchema = z.object({
  retiredConnectionId: z.string().min(1).max(256),
  replacementConnectionId: z.string().min(1).max(256),
});
type DuplicateRepairSelection = z.infer<typeof duplicateRepairSelectionSchema>;

/** Administrative repair for duplicate starting balances that have never been used. */
async function prepareDuplicateBankRepair(
  db: Database,
  userId: string,
  selection: DuplicateRepairSelection,
) {
  selection = duplicateRepairSelectionSchema.parse(selection);
  if (selection.retiredConnectionId === selection.replacementConnectionId)
    throw new Error("Choose two different connections.");
  const opened = await openHousehold(db, userId);
  if (opened?.ledger.status !== "ready") throw budgetMaintenance();
  const connections = await db.bankConnection.findMany({
    where: { clerkUserId: userId },
  });
  const imports = readImportStates(opened.household.rows, userId);
  const read = (id: string) => {
    const connection = connections.find((item) => item.id === id);
    if (!connection) throw new TRPCError({ code: "NOT_FOUND" });
    return readyConnection(connection, imports);
  };
  const retired = read(selection.retiredConnectionId);
  const replacement = read(selection.replacementConnectionId);
  if (
    !retired.state.institutionId ||
    retired.state.institutionId !== replacement.state.institutionId ||
    retired.connection.createdAt >= replacement.connection.createdAt ||
    replacement.state.disconnectedAt ||
    replacement.state.transactionStatus !== "HISTORICAL_UPDATE_COMPLETE" ||
    !replacement.connection.lastSyncedAt
  )
    throw new Error(
      "Choose the newer, fully synchronized connection to the same bank.",
    );
  const budget = opened.ledger.budget;
  const mappings = structuredClone(replacement.mappings);
  const accounts: {
    name: string;
    keepAccountId: string;
    removeAccountId: string;
  }[] = [];
  const removedIds = new Set<string>();
  for (const [providerId, mapping] of Object.entries(retired.mappings)) {
    const source = retired.state.accounts.find(
      (account) => account.accountId === providerId,
    );
    const candidates = source
      ? replacement.state.accounts.filter((account) =>
          sameBankAccount(
            source,
            account,
            retired.state.institutionId,
            replacement.state.institutionId,
          ),
        )
      : [];
    const target = candidates.length === 1 ? candidates[0] : undefined;
    const targetMapping = target && mappings[target.accountId];
    if (
      target &&
      !replacement.state.synchronizedAccountIds.includes(target.accountId)
    )
      throw new Error(
        "The replacement needs a matching balance and history snapshot before repair.",
      );
    const keep = budget.accounts.find(
      (account) => account.id === mapping.accountId,
    );
    const remove = budget.accounts.find(
      (account) => account.id === targetMapping?.accountId,
    );
    if (
      !source ||
      !target ||
      !targetMapping ||
      !keep ||
      !remove ||
      keep.id === remove.id ||
      removedIds.has(remove.id) ||
      !["cash", "credit"].includes(keep.kind) ||
      keep.kind !== remove.kind
    )
      throw new Error(
        "Every retired bank account must match exactly one separate duplicate budget account.",
      );
    if (
      source.currentBalance !== target.currentBalance ||
      keep.openingBalance !== remove.openingBalance ||
      bankAccountOpening(target).openingBalance !== keep.openingBalance
    )
      throw new Error(
        "The duplicate starting balances disagree. Review these accounts manually.",
      );
    if (
      budget.transactions.some((transaction) =>
        [keep.id, remove.id].includes(transaction.accountId),
      ) ||
      remove.reconciled
    )
      throw new Error(
        "This account has transaction or reconciliation history. Automatic duplicate repair is not safe.",
      );
    if (
      connections.some(
        (connection) =>
          ![retired.connection.id, replacement.connection.id].includes(
            connection.id,
          ) &&
          Object.values(mappingsSchema.parse(connection.accountMappings)).some(
            (saved) => [keep.id, remove.id].includes(saved.accountId),
          ),
      )
    )
      throw new Error("Another bank connection uses these accounts.");
    removedIds.add(remove.id);
    accounts.push({
      name: keep.name,
      keepAccountId: keep.id,
      removeAccountId: remove.id,
    });
    mappings[target.accountId] = { ...targetMapping, accountId: keep.id };
  }
  if (!accounts.length)
    throw new Error("There are no duplicate accounts to repair.");
  const affected = new Set(
    accounts.flatMap((account) => [
      account.keepAccountId,
      account.removeAccountId,
    ]),
  );
  if (
    bankInboxItems([retired, replacement], budget, opened.ledger.state).some(
      (item) => affected.has(item.accountId ?? item.loanId ?? ""),
    )
  )
    throw new Error(
      "Review outstanding bank activity before repairing these duplicates.",
    );
  if (
    await db.reviewEvidence.count({
      where: { clerkUserId: userId, accountId: { in: [...removedIds] } },
    })
  )
    throw new Error(
      "A duplicate account has review evidence. Preserve it with a manual repair.",
    );
  const categoryIds = new Set(
    budget.categories
      .filter((category) => removedIds.has(category.pairedAccountId ?? ""))
      .map((category) => category.id),
  );
  const rows = rowsIn(opened.household.rows).filter((row) => !row.deleted);
  const before = rows.filter(
    (row) =>
      rowOwner(row) === userId &&
      ((row.table === "account" &&
        row.data !== null &&
        removedIds.has(row.data.id)) ||
        (row.table === "category" &&
          row.data !== null &&
          categoryIds.has(row.data.id)) ||
        (row.table === "bankImport" &&
          row.data?.connectionId === retired.connection.id)),
  );
  const removedRows = new Set(before);
  const referencesRemoved = (value: unknown): boolean =>
    typeof value === "string"
      ? removedIds.has(value) || categoryIds.has(value)
      : Array.isArray(value)
        ? value.some(referencesRemoved)
        : value !== null &&
          typeof value === "object" &&
          Object.values(value).some(referencesRemoved);
  if (rows.some((row) => !removedRows.has(row) && referencesRemoved(row.data)))
    throw new Error(
      "A duplicate account or payment category has budget activity. Automatic repair is not safe.",
    );
  const changeSet: ChangeSet = {
    operationId: "preview",
    revision: 0,
    before,
    after: before.map((row) => tombstone(row)),
  };
  checkRestoredLedger(
    rowsToPersonalLedger(
      rowsIn(applyChangeSet(opened.household.rows, changeSet)),
      userId,
    ),
  );
  const plan = {
    ...selection,
    revision: opened.household.revision,
    accounts,
    retiredImportCount: before.filter((row) => row.table === "bankImport")
      .length,
    removedCategoryCount: categoryIds.size,
    hash: commandHash({
      userId,
      selection,
      revision: opened.household.revision,
      connections: [retired, replacement].map(({ connection }) => ({
        id: connection.id,
        updatedAt: connection.updatedAt.toISOString(),
        imports: connection.imports,
        accountMappings: connection.accountMappings,
      })),
      accounts,
    }),
  };
  return { plan, opened, retired, replacement, mappings, changeSet };
}

export async function previewDuplicateBankRepair(
  db: Database,
  userId: string,
  selection: DuplicateRepairSelection,
) {
  return (await prepareDuplicateBankRepair(db, userId, selection)).plan;
}

export async function repairDuplicateBankAccounts(
  db: Database,
  userId: string,
  input: DuplicateRepairSelection & {
    operationId: string;
    expectedPlanHash: string;
  },
): Promise<OperationResult> {
  const parsed = duplicateRepairSelectionSchema
    .extend({
      operationId: z.string().uuid(),
      expectedPlanHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(input);
  const household = await readHouseholdRevision(db, userId);
  if (!household) throw budgetMaintenance();
  const submitted = { type: "bank.duplicates.repair", ...parsed };
  const previous = await findOperation(
    db,
    household.workspaceId,
    parsed.operationId,
  );
  if (previous) return earlierResult(previous, userId, submitted, submitted);
  const prepared = await prepareDuplicateBankRepair(db, userId, parsed);
  if (prepared.plan.hash !== parsed.expectedPlanHash)
    throw new Error(
      "The repair plan changed. Preview it again before applying.",
    );
  const { retired, replacement, opened, mappings, changeSet } = prepared;
  const live = await client(db, userId, replacement.connection.id).getAccounts(
    decryptBankToken(replacement.connection.encryptedToken, userId),
  );
  if (
    live.institutionId !== replacement.state.institutionId ||
    Object.keys(replacement.mappings).some((providerId) => {
      const saved = replacement.state.accounts.find(
        (account) => account.accountId === providerId,
      );
      const current = live.accounts.find(
        (account) => account.accountId === providerId,
      );
      if (!saved) return true;
      if (!current) return true;
      return (
        saved.currentBalance !== current.currentBalance ||
        saved.currency !== current.currency
      );
    })
  )
    throw new Error(
      "The replacement bank accounts changed. Sync and preview the repair again.",
    );
  // Revocation happens first: if the database write conflicts, retrying
  // /item/remove is safe and the credential is still available for cleanup.
  await client(db, userId, retired.connection.id).removeItem(
    decryptBankToken(retired.connection.encryptedToken, userId),
  );
  return writeServerOperation(db, opened, {
    actorId: userId,
    operationId: parsed.operationId,
    source: "user",
    type: submitted.type,
    submitted,
    changeSet,
    alongside: async (tx) => {
      const saved = await tx.bankConnection.updateMany({
        where: {
          id: replacement.connection.id,
          clerkUserId: userId,
          updatedAt: replacement.connection.updatedAt,
        },
        data: { accountMappings: jsonValue(mappings) },
      });
      const removed = await tx.bankConnection.deleteMany({
        where: {
          id: retired.connection.id,
          clerkUserId: userId,
          updatedAt: retired.connection.updatedAt,
        },
      });
      if (saved.count !== 1 || removed.count !== 1)
        throw new Error("A bank connection changed. Preview the repair again.");
    },
  });
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
        const eligibility: ImportEligibility = loanId
          ? "loan_activity"
          : !mapping
            ? "unmapped"
            : bankImportEligibility(mapping, record);
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
          eligibility,
          error: state.errors[record.id] ?? null,
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
        const eligibility: ImportEligibility = loanId
          ? "loan_activity"
          : !mapping
            ? "unmapped"
            : "eligible";
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
          eligibility,
          error: quarantineMessage(transaction),
          history: [],
          reviewEvidence: [review],
          quarantined: true,
        };
      });
    return [...imports, ...quarantined];
  });
}

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
    if (state.disconnectedAt)
      throw new Error(
        "This bank is disconnected. Link it again before setting up accounts.",
      );
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
    const connections = await db.bankConnection.findMany({
      where: { clerkUserId: userId },
    });
    const allMappings = connectionMappings(connections);
    const remainingMappings = allMappings.map((mapping) => ({ ...mapping }));
    const details = connections.map((saved) => {
      const parsed = readColumn(
        saved,
        "BankConnection.imports",
        connectionColumnSchema,
        saved.imports,
      );
      if (!parsed) throw connectionMaintenance();
      return parsed;
    });
    const identities = connections.map((saved, index) => ({
      ...details[index]!,
      accountMappings: allMappings[index]!,
      unavailableAccountIds: saved.unavailableAccountIds,
    }));
    const activeMappings = allMappings.map((saved, index) =>
      Object.fromEntries(
        Object.entries(saved).filter(
          ([providerId]) =>
            !bankAccountNeedsRecovery(identities[index]!, providerId),
        ),
      ),
    );
    const retired = new Set<number>();
    const retiredProviderIds = new Set<string>();
    const linkedAccounts = identities.map((saved, index) => ({
      institutionId: saved.institutionId,
      accounts: saved.accounts.filter(
        (account) => activeMappings[index]![account.accountId],
      ),
    }));
    const usedAccountIds = new Set(
      activeMappings.flatMap((saved) =>
        Object.values(saved).map((mapping) => mapping.accountId),
      ),
    );
    const budgetAccountKinds = new Map([
      ...budget.accounts.map((account) => [account.id, account.kind] as const),
      ...budget.loans.map((loan) => [loan.id, "loan"] as const),
    ]);
    const accountIds: string[] = [];
    const commands: Command[] = [];
    for (const selected of input.accounts) {
      const provider = state.accounts.find(
        (account) => account.accountId === selected.providerAccountId,
      );
      if (
        !provider ||
        connection.unavailableAccountIds.includes(provider.accountId)
      )
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
      if (activeMappings.some((saved) => saved[selected.providerAccountId]))
        throw new Error(
          "This bank account is already added. Refresh to see its existing account.",
        );
      if (
        linkedAccounts.some((saved) =>
          overlappingBankAccount(
            { institutionId: state.institutionId, accounts: [provider] },
            saved,
          ),
        )
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This bank account is already added through another connection. Use Choose shared accounts in the existing bank’s ⋯ menu instead.",
        });
      if (provider.currentBalance !== selected.expectedBalance)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The bank balance changed. Refresh and review the latest balance before adding this account.",
        });
      const recognized = bankRecoveryCandidates(
        provider,
        state.institutionId,
        identities,
        budgetAccountKinds,
      ).map((candidate) => candidate.accountId);
      if (
        recognized.length &&
        (!selected.existingAccountId ||
          !recognized.includes(selected.existingAccountId))
      )
        throw new Error(
          "Link this bank account to its existing budget account to keep its history.",
        );
      const sources = allMappings.flatMap((saved, index) =>
        Object.entries(saved).flatMap(([providerId, mapping]) =>
          mapping.accountId === selected.existingAccountId &&
          bankAccountNeedsRecovery(identities[index]!, providerId)
            ? [{ index, providerId }]
            : [],
        ),
      );
      if (sources.length) {
        const existing = budget.accounts.find(
          (account) => account.id === selected.existingAccountId,
        );
        if (!existing || !["cash", "credit"].includes(existing.kind))
          throw new Error(
            "Connection recovery currently supports cash accounts and credit cards.",
          );
        const opening = bankAccountOpening(provider);
        if (
          existing.kind !== opening.kind ||
          sources.some(
            ({ index }) =>
              !state.institutionId ||
              details[index]!.institutionId !== state.institutionId,
          )
        )
          throw new Error("Choose the matching account from the same bank.");
        if (usedAccountIds.has(existing.id))
          throw new Error("This budget account is already linked to a bank.");
        const imports = readImportStates(opened.household.rows, userId);
        const outstanding = bankInboxItems(
          [...new Set(sources.map(({ index }) => index))].map((index) =>
            readyConnection(connections[index]!, imports),
          ),
          budget,
          ledger.state,
        );
        if (outstanding.some((item) => item.accountId === existing.id))
          throw new Error(
            `Review the remaining bank activity for ${existing.name} before linking it again.`,
          );
        const cleared = projectBook(
          ledger.state,
          userId,
          today.slice(0, 7),
        ).accounts.find((account) => account.id === existing.id)!.cleared;
        if (
          existing.reconciled?.date !== today ||
          existing.reconciled.balance !== opening.openingBalance ||
          cleared !== opening.openingBalance ||
          budget.transactions.some(
            (transaction) =>
              transaction.accountId === existing.id &&
              !transaction.removed &&
              !isCleared(transaction),
          )
        )
          throw new Error(
            `Reconcile ${existing.name} to today's bank balance and resolve uncleared transactions before linking it again. Its existing balance and history will be kept.`,
          );
        if (
          bankSetupDate(budget.settings.timezone, connection.lastSyncedAt) !==
            today ||
          !state.synchronizedAccountIds.includes(provider.accountId) ||
          state.transactionStatus !== "HISTORICAL_UPDATE_COMPLETE"
        )
          throw new Error(
            "Update your bank accounts and wait for the complete history before linking this existing account.",
          );
        mappings[provider.accountId] = {
          accountId: existing.id,
          startDate: today,
          openingSnapshot: openingSnapshot(
            state.records,
            provider.accountId,
            state.reviews,
          ),
        };
        for (const { index, providerId } of sources) {
          if (connections[index]!.id === connection.id) {
            delete mappings[providerId];
            retiredProviderIds.add(providerId);
          } else {
            delete remainingMappings[index]![providerId];
            retired.add(index);
          }
        }
        usedAccountIds.add(existing.id);
        accountIds.push(existing.id);
        continue;
      }
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
        for (const index of retired) {
          const source = connections[index]!;
          const saved = await tx.bankConnection.updateMany({
            where: { id: source.id, updatedAt: source.updatedAt },
            data: { accountMappings: jsonValue(remainingMappings[index]!) },
          });
          if (saved.count !== 1)
            throw new TRPCError({
              code: "CONFLICT",
              message: "The previous bank link changed. Refresh and try again.",
            });
        }
        const saved = await tx.bankConnection.updateMany({
          where: { id: connection.id, updatedAt: connection.updatedAt },
          data: {
            accountMappings: jsonValue(mappings),
            ...(retiredProviderIds.size
              ? {
                  imports: detailsColumn(connection.imports, {
                    ...state,
                    accounts: state.accounts.filter(
                      (account) => !retiredProviderIds.has(account.accountId),
                    ),
                  }),
                }
              : {}),
            unavailableAccountIds: connection.unavailableAccountIds.filter(
              (id) => mappings[id],
            ),
          },
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
    if (read.status === "maintenance" || read.state.disconnectedAt) continue;
    try {
      const plaid = client(db, userId, connection.id);
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
      await db.bankConnection.updateMany({
        where: { id: connection.id, updatedAt: connection.updatedAt },
        data: {
          lastAttemptAt: new Date(),
          error:
            error instanceof TRPCError
              ? error.message
              : withPlaidRequestId(
                  "Bank update failed. Reconnect or try again; previous records were preserved.",
                  error,
                ),
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
  connection: { id: string; cursor: string | null; updatedAt: Date },
  delta: Awaited<ReturnType<PlaidClient["syncTransactions"]>>,
  accounts: Awaited<ReturnType<PlaidClient["getAccounts"]>>,
) {
  const [fresh, opened] = await Promise.all([
    db.bankConnection.findFirstOrThrow({
      where: { id: connection.id, clerkUserId: userId },
    }),
    requireHousehold(db, userId),
  ]);
  if (
    fresh.cursor !== connection.cursor ||
    fresh.updatedAt.getTime() !== connection.updatedAt.getTime()
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "Another bank update finished first. Try again.",
    });
  const { state: old, mappings: saved } = readyConnection(
    fresh,
    readImportStates(opened.household.rows, userId),
  );
  if (old.disconnectedAt) return { imported: 0, updated: 0 };
  const identity = followAccountIdentities(
    old.accounts,
    accounts.accounts,
    saved,
  );
  const { mappings } = identity;
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
      reported !== undefined &&
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
    [...retainedAccounts, ...delta.accounts]
      .filter((account) => reportedAccounts.has(account.accountId))
      .map((account) => [account.accountId, account]),
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
        [...identity.accounts, ...synchronizedAccounts.values()].map(
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
      where: { id: fresh.id, cursor: fresh.cursor, updatedAt: fresh.updatedAt },
      data: {
        imports: detailsColumn(fresh.imports, state),
        unavailableAccountIds: identity.unavailableAccountIds,
        ...(identity.decisions.length
          ? { accountMappings: jsonValue(mappings) }
          : {}),
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
  if (changeSet.after.length || identity.decisions.length)
    await writeServerOperation(db, opened, {
      actorId: userId,
      operationId,
      source: "provider",
      type: "bank.sync",
      submitted: {
        connectionId: fresh.id,
        cursor: delta.nextCursor,
        commands: operations.map((command) => command.id),
        ...(identity.decisions.length ? { decisions: identity.decisions } : {}),
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
 * The transaction a posted bank import becomes when its payee is remembered
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
  if (record.removed || record.current.pending) return undefined;
  const fact = record.current;
  const amount = -fact.amountCents;
  const payee = (fact.merchantName ?? fact.name).slice(0, 240);
  const categoryId = rememberedCategory(budget, { payee, accountId, amount });
  const counterpartyShare = rememberedCounterpartyShare(budget, {
    payee,
    accountId,
    amount,
  });
  if (!categoryId && !counterpartyShare) return undefined;
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
      if (!input.ignore) throw new Error(quarantinedImportMessage);
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
      const imported: BankInboxItem = {
        accountId: mapping?.accountId ?? null,
        transactionId: state.resolved[record.id]?.transactionId,
        removed: record.removed,
        quarantined: false,
        amount: -record.current.amountCents,
        eligibility: (!mapping
          ? "unmapped"
          : ledger.budget.loans.some((loan) => loan.id === mapping.accountId)
            ? "loan_activity"
            : bankImportEligibility(
                mapping,
                record,
              )) satisfies ImportEligibility,
      };
      const link = classifyRegisterEntry(ledger.budget, imported).capabilities
        .link;
      if (!link.ok) throw new Error(link.reason);
      if (!mapping)
        throw new Error(
          "Map this provider account to your own ledger account first.",
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
          throw new Error(alreadyLinkedImportMessage);
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
        const recordCapability = classifyRegisterEntry(budget, imported)
          .capabilities.record;
        if (!recordCapability.ok) throw new Error(recordCapability.reason);
        if (command?.type !== "transaction.upsert")
          throw new Error("Choose a transaction to record this bank activity.");
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
            reviewed: record.current.pending,
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
