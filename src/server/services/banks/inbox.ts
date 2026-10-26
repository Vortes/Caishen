import { withBankAccountSuccessors } from "../bank-account-rows";
/** Inbox projection: validates connection metadata and provider rows, then presents their account and import state to callers. It produces maintenance results for unreadable connections and the public inbox without writing budget data. */

import {
  type importStateSchema,
  connectionColumnSchema,
  decodeLegacyBankAccounts,
  migrateBankAccounts,
} from "../bank-account-migration";
export {
  importStateSchema,
  connectionColumnSchema,
} from "../bank-account-migration";

import { type z } from "zod";
import {
  type ImportRowState,
  emptyState,
  readImportStates,
} from "../bank-import-rows";
import {
  type bankMappingsSchema as mappingsSchema,
  bankImportEligibility,
  bankImportFingerprint as fingerprint,
} from "../bank-account-setup";
import type { Prisma } from "~/generated/prisma";
import {
  type BankConnectionStatus,
  bankConnectionStatusSchema,
} from "../bank-connection-status";
import {
  type BankAccountSuccessor,
  readBankAccountRows,
  bankAccountRowsSelection,
} from "../bank-account-rows";
import {
  reportUnreadable,
  zodIssues,
  CONNECTION_MAINTENANCE_MESSAGE,
  connectionMaintenance,
  budgetMaintenance,
} from "../stored-data";
import { jsonValue } from "../safety";
import { TRPCError } from "@trpc/server";
import { type Database, openHousehold } from "../household";
import { type Budget } from "~/domain/engine";
import type { AccountingState } from "~/domain/shared-ledger";
import {
  type InboxPartnerMatch,
  inboxPartnerMatches,
} from "../partner-imports";
import { type ImportEligibility } from "~/domain/register-entry";
import {
  quarantinedTransactions,
  quarantineFingerprint,
  quarantineMessage,
} from "../bank-quarantine";

export type ImportState = z.infer<typeof importStateSchema>;

export type ConnectionDetails = Omit<ImportState, keyof ImportRowState>;

export type Mappings = z.infer<typeof mappingsSchema>;

export type StoredConnection = {
  id: string;
  clerkUserId: string;
  imports: unknown;
  accountMappings: unknown;
  unavailableAccountIds?: string[];
  revokedAccountIds?: string[];
  status?: string;
  consentExpiresAt?: Date | null;
  lastSuccessfulUpdateAt?: Date | null;
  lastFailedUpdateAt?: Date | null;
  newAccountsAvailable?: boolean;
  bankAccounts?: Prisma.BankAccountGetPayload<{ include: { link: true } }>[];
  bankAccountSuccessors?: BankAccountSuccessor[];
};

/** The connection's status and what Plaid last reported about the Item. */
export interface ConnectionHealth {
  status: BankConnectionStatus;
  consentExpiresAt: Date | null;
  lastSuccessfulUpdateAt: Date | null;
  lastFailedUpdateAt: Date | null;
  newAccountsAvailable: boolean;
}

export type ReadConnection<C extends StoredConnection = StoredConnection> =
  | {
      status: "ready";
      connection: C;
      state: ImportState;
      mappings: Mappings;
      health: ConnectionHealth;
      importMappings?: Mappings;
    }
  | { status: "maintenance"; connection: C };

/** Each connection's import state from rows (readImportStates). */
export type ImportStates = ReadonlyMap<string, ImportRowState | "unreadable">;

export function providerAccountProjection(connection: StoredConnection) {
  const rows = readBankAccountRows(connection);
  if (rows) return rows;
  // Unconverted malformed records stay under maintenance; valid empty rows
  // never borrow identities or links from the retired lists.
  if (!decodeLegacyBankAccounts(connection)) return undefined;
  return {
    accounts: [],
    mappings: {},
    importMappings: {},
    synchronizedAccountIds: [],
    unavailableAccountIds: [],
    revokedAccountIds: [],
  };
}
export function readConnectionColumn(
  connection: StoredConnection,
  providerRows = providerAccountProjection(connection),
) {
  if (!providerRows) return undefined;
  const stored = connection.imports;
  const result = connectionColumnSchema.safeParse(
    typeof stored === "object" && stored !== null
      ? {
          ...stored,
          accounts: providerRows.accounts,
          synchronizedAccountIds: providerRows.synchronizedAccountIds,
        }
      : stored,
  );
  if (result.success) return result.data;
  reportUnreadable(
    {
      record: "BankConnection.imports",
      connectionId: connection.id,
      userId: connection.clerkUserId,
    },
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

export function connectionMetadata(
  stored: unknown,
  details: ConnectionDetails,
) {
  const metadata =
    typeof stored === "object" && stored !== null
      ? Object.fromEntries(
          Object.entries(stored).filter(
            ([key]) => key !== "accounts" && key !== "synchronizedAccountIds",
          ),
        )
      : {};
  return jsonValue({
    ...metadata,
    institutionId: details.institutionId,
    institutionName: details.institutionName,
    transactionStatus: details.transactionStatus,
    ...(details.disconnectedAt
      ? { disconnectedAt: details.disconnectedAt }
      : {}),
  });
}

// A connection selected without its health columns reads as connected; one
// whose stored status this release does not know is under maintenance.
function connectionHealth(
  connection: StoredConnection,
): ConnectionHealth | undefined {
  const status =
    connection.status === undefined
      ? { success: true as const, data: "connected" as const }
      : bankConnectionStatusSchema.safeParse(connection.status);
  if (!status.success) {
    reportUnreadable(
      {
        record: "BankConnection.status",
        connectionId: connection.id,
        userId: connection.clerkUserId,
      },
      [{ issues: zodIssues(status.error) }],
    );
    return undefined;
  }
  return {
    status: status.data,
    consentExpiresAt: connection.consentExpiresAt ?? null,
    lastSuccessfulUpdateAt: connection.lastSuccessfulUpdateAt ?? null,
    lastFailedUpdateAt: connection.lastFailedUpdateAt ?? null,
    newAccountsAvailable: connection.newAccountsAvailable ?? false,
  };
}

// A connection whose saved details or import rows can't be read is left
// alone and shown as under maintenance; the budget and other connections
// still work.
export function readBankConnection<C extends StoredConnection>(
  connection: C,
  imports: ImportStates,
): ReadConnection<C> {
  try {
    const health = connectionHealth(connection);
    const providerRows = providerAccountProjection(connection);
    if (!providerRows) return { status: "maintenance", connection };
    const column = readConnectionColumn(connection, providerRows);
    const mappings = providerRows?.mappings;
    const rows = imports.get(connection.id) ?? emptyState();
    return column && mappings && health && rows !== "unreadable"
      ? {
          status: "ready",
          connection: providerRows
            ? {
                ...connection,
                unavailableAccountIds: providerRows.unavailableAccountIds,
                revokedAccountIds: providerRows.revokedAccountIds,
              }
            : connection,
          state: { ...connectionDetails(column), ...rows },
          mappings,
          health,
          importMappings: providerRows?.importMappings ?? mappings,
        }
      : { status: "maintenance", connection };
  } catch (error) {
    if (error instanceof TRPCError && error.code === "SERVICE_UNAVAILABLE")
      return { status: "maintenance", connection };
    throw error;
  }
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
  const { id, itemId, lastSyncedAt, lastAttemptAt, error } = read.connection;
  const connection = { id, itemId, lastSyncedAt, lastAttemptAt };
  return read.status === "ready"
    ? {
        ...connection,
        ...read.health,
        error,
        accountMappings: read.mappings,
        ...(read.connection.unavailableAccountIds?.length
          ? { unavailableAccountIds: read.connection.unavailableAccountIds }
          : {}),
        ...(read.connection.revokedAccountIds?.length
          ? { revokedAccountIds: read.connection.revokedAccountIds }
          : {}),
        ...bankAccountDetails(read.state),
      }
    : {
        ...connection,
        status: "connected" as const,
        consentExpiresAt: null,
        lastSuccessfulUpdateAt: null,
        lastFailedUpdateAt: null,
        newAccountsAvailable: false,
        error: CONNECTION_MAINTENANCE_MESSAGE,
        accountMappings: {},
        ...bankAccountDetails({}),
      };
}

export function readyConnection<C extends StoredConnection>(
  connection: C,
  imports: ImportStates,
) {
  const read = readBankConnection(connection, imports);
  if (read.status === "maintenance") throw connectionMaintenance();
  return read;
}

export function connectionMappings(connections: StoredConnection[]) {
  return connections.map(mappings);
}

export function bankAccountDetails(value: unknown) {
  return connectionDetails(connectionColumnSchema.parse(value));
}

export async function bankInbox(db: Database, userId: string) {
  await migrateBankAccounts(db, userId, { reportUnreadable: false });
  const [connections, opened] = await Promise.all([
    withBankAccountSuccessors(
      db,
      db.bankConnection.findMany({
        include: { bankAccounts: bankAccountRowsSelection },
        where: { clerkUserId: userId },
      }),
    ),
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
    const { connection, state } = read;
    const mappings = read.importMappings ?? read.mappings;
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

export function mappings(connection: StoredConnection): Mappings {
  const rows = providerAccountProjection(connection);
  if (!rows) throw connectionMaintenance();
  return rows.mappings;
}
