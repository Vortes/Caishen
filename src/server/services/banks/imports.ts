import { withBankAccountSuccessors } from "../bank-account-rows";
/** Import application: fetches account activity and applies each provider update or user inbox decision as a household operation. It owns transaction matching, reconciliation, quarantine, and the corresponding change sets. */

import { isBankAccountLive } from "~/lib/bank-account-identity";
import { isCardPaymentOutflow } from "~/lib/card-payment-recognition";
import { rememberedPaymentDestinations } from "../bank-payment-memory";
import { transferImportCommand } from "~/domain/transfers";
import { rejectImportChange } from "~/domain/bank-import-rejection";

import {
  type Database,
  requireHousehold,
  writeServerOperation,
  type OperationResult,
  earlierResult,
  refusal,
} from "../household";
import {
  bankAccountRowsSelection,
  readBankAccountRows,
  lockBankConnections,
} from "../bank-account-rows";
import { TRPCError } from "@trpc/server";
import { readImportStates, importStateChange } from "../bank-import-rows";
import { itemHealthChange } from "../bank-connection-status";
import { decryptBankToken } from "~/server/token-crypto";
import { RevisionConflictError, findOperation } from "~/server/storage/rows";
import {
  isPrismaError,
  domainError,
  domainRefusal,
  operationHash,
} from "../safety";
import { settleFromImports } from "../partner-settlements";
import {
  applyTransactionSync,
  type StoredImport,
} from "~/server/integrations/transactions";
import {
  quarantinedTransactions,
  applyQuarantine,
  readQuarantine,
  quarantineFingerprint,
} from "../bank-quarantine";
import { type ChangeSet } from "~/domain/rows";
import { type Command, executeWithChanges, type Budget } from "~/domain/engine";
import {
  planPartnerImports,
  confirmedPartnerMatch,
  inboxPartnerMatches,
} from "../partner-imports";
import {
  bankImportFingerprint as fingerprint,
  bankImportEligibility,
} from "../bank-account-setup";
import { isRejectedSettlementImport } from "~/domain/partner-settlements";
import { randomUUID } from "node:crypto";
import { composeChangeSets } from "~/domain/change-sets";
import type { Prisma } from "~/generated/prisma";
import { writeProviderAccounts, writeBankLinks } from "../bank-account-writes";
import {
  rememberedCategory,
  rememberedCounterpartyShare,
} from "~/domain/payee-memory";
import { matchesManualImport } from "~/domain/bank-import-balances";
import { READY_TO_ASSIGN } from "~/domain/transfers";
import type { AccountingState } from "~/domain/shared-ledger";
import {
  quarantinedImportMessage,
  type BankInboxItem,
  type ImportEligibility,
  classifyRegisterEntry,
  alreadyLinkedImportMessage,
} from "~/domain/register-entry";
import { prepareUserCommand } from "~/domain/user-command";
import { migrateBankAccounts } from "../bank-account-migration";
import {
  readBankConnection,
  readyConnection,
  type ImportState,
  connectionMetadata,
  mappings,
} from "./inbox";
import { bankClient as client } from "../bank-provider-events";
import { withPlaidRequestId } from "./connections";
import {
  currentProviderAccounts,
  followAccountIdentities,
  openConnection,
} from "./accounts";

/**
 * How one connection's update ended. A deferred update lost to another that
 * committed first, so the connection is current and nothing was recorded.
 */
export type BankUpdateOutcome =
  | { connectionId: string; kind: "synced" | "skipped" }
  | { connectionId: string; kind: "deferred" | "failed"; error: TRPCError };

/** Another update of the connection committed after this one read Plaid. */
class SupersededBankUpdate extends TRPCError {
  constructor() {
    super({
      code: "CONFLICT",
      message: "Another bank update finished first. Try again.",
    });
  }
}

/**
 * Updates each of a member's connections in turn, or only those named. A
 * failing connection records its error and the others still update; every
 * outcome is returned.
 */
export async function syncBanks(
  db: Database,
  userId: string,
  { connectionIds }: { connectionIds?: string[] } = {},
) {
  await migrateBankAccounts(db, userId);
  const connections = await withBankAccountSuccessors(
    db,
    db.bankConnection.findMany({
      include: { bankAccounts: bankAccountRowsSelection },
      where: {
        clerkUserId: userId,
        ...(connectionIds ? { id: { in: connectionIds } } : {}),
      },
      orderBy: { id: "asc" },
    }),
  );
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
  const outcomes: BankUpdateOutcome[] = [];
  for (const connection of connections) {
    const read = readBankConnection(connection, readable);
    if (
      read.status === "maintenance" ||
      read.state.disconnectedAt ||
      // No update can reach an Item the user has revoked or disconnected.
      ["revoked", "disconnected"].includes(connection.status)
    ) {
      outcomes.push({ connectionId: connection.id, kind: "skipped" });
      continue;
    }
    // The Item's health is read first, so a sign-in problem it reports is
    // recorded even when the update itself fails.
    let health: ReturnType<typeof itemHealthChange> | undefined;
    try {
      const plaid = client(db, userId, connection.id);
      const accessToken = decryptBankToken(connection.encryptedToken, userId);
      health = itemHealthChange(
        await plaid.getItem(accessToken),
        read.health.status,
      );
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
            health,
          );
        } catch (error) {
          if (!(error instanceof RevisionConflictError) || attempt >= 4)
            throw error;
        }
      }
      imported += counts.imported;
      updated += counts.updated;
      outcomes.push({ connectionId: connection.id, kind: "synced" });
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
          ...health,
          lastAttemptAt: new Date(),
          error:
            error instanceof TRPCError
              ? error.message
              : isPrismaError(error) &&
                  (error.code === "P2002" || error.code === "P2034")
                ? "Your budget changed. Refresh and try again."
                : withPlaidRequestId(
                    "Bank update failed. Reconnect or try again; previous records were preserved.",
                    error,
                  ),
        },
      });
      outcomes.push({
        connectionId: connection.id,
        kind: error instanceof SupersededBankUpdate ? "deferred" : "failed",
        error: domainRefusal(error),
      });
    }
  }
  // Match payments across the member's owned accounts and counterparty accounts.
  const { settled, repaid } = await settleFromImports(db, userId);
  return { imported, updated: updated + settled + repaid, outcomes };
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
  health: ReturnType<typeof itemHealthChange>,
) {
  const [fresh, opened] = await Promise.all([
    withBankAccountSuccessors(
      db,
      db.bankConnection.findFirstOrThrow({
        include: { bankAccounts: bankAccountRowsSelection },
        where: { id: connection.id, clerkUserId: userId },
      }),
    ),
    requireHousehold(db, userId),
  ]);
  if (
    fresh.cursor !== connection.cursor ||
    fresh.updatedAt.getTime() !== connection.updatedAt.getTime()
  )
    throw new SupersededBankUpdate();
  const { state: old, mappings: saved } = readyConnection(
    fresh,
    readImportStates(opened.household.rows, userId),
  );
  if (old.disconnectedAt) return { imported: 0, updated: 0 };
  accounts.accounts = currentProviderAccounts(fresh, accounts.accounts);
  const identity = followAccountIdentities(
    old.accounts,
    accounts.accounts,
    saved,
  );
  const { mappings } = identity;
  const importMappings = {
    ...readBankAccountRows(fresh)?.importMappings,
    ...mappings,
  };
  const revoked = new Set(
    fresh.bankAccounts
      .filter(
        (account) =>
          account.status === "revoked" &&
          !isBankAccountLive(accounts, account.providerAccountId),
      )
      .map((account) => account.providerAccountId),
  );
  if (revoked.size) {
    const allowed = (record: { providerAccountId: string }) =>
      !revoked.has(record.providerAccountId);
    delta = {
      ...delta,
      added: delta.added.filter(allowed),
      modified: delta.modified.filter(allowed),
      removed: delta.removed.filter((removed) => {
        const accountId =
          removed.providerAccountId ??
          old.records.find((record) =>
            record.providerTransactionIds.includes(
              removed.providerTransactionId,
            ),
          )?.current.providerAccountId;
        return !accountId || !revoked.has(accountId);
      }),
      skipped: {
        ...delta.skipped,
        quarantined: delta.skipped.quarantined.filter(allowed),
      },
    };
  }
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
  const paymentDestinations = rememberedPaymentDestinations(
    budgetOf(book, userId),
    [state],
  );
  const partnerImports = planPartnerImports(
    book,
    budgetOf(book, userId),
    plan.records,
    importMappings,
    old.resolved,
    (record) => `sync:${fresh.id}:${fingerprint(record).slice(0, 40)}`,
  );
  for (const change of plan.changes) {
    const record = change.after;
    const mapped = importMappings[record.current.providerAccountId];
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
        (paymentDestinations(
          mapped.accountId,
          record.current.name,
          -record.current.amountCents,
        ).length
          ? undefined
          : rememberedImport(
              budgetOf(book, userId),
              mapped.accountId,
              record,
              `sync:${fresh.id}:${fingerprint(record).slice(0, 40)}`,
            ));
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
      (!["purchase", "income", "refund"].includes(transaction.kind) &&
        !(
          transaction.kind === "statement-credit" &&
          transaction.status === "pending"
        ))
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
  const saveConnection = async (tx: Prisma.TransactionClient) => {
    await lockBankConnections(tx, userId, [fresh.id]);
    const saved = await tx.bankConnection.updateMany({
      where: {
        id: fresh.id,
        cursor: fresh.cursor,
        updatedAt: fresh.updatedAt,
      },
      data: {
        ...health,
        imports: connectionMetadata(fresh.imports, state),
        cursor: delta.nextCursor,
        lastSyncedAt: new Date(),
        lastAttemptAt: new Date(),
        error: null,
      },
    });
    if (saved.count !== 1) throw new SupersededBankUpdate();
    await writeProviderAccounts(
      tx,
      userId,
      fresh.id,
      state.accounts.filter((account) =>
        isBankAccountLive(accounts, account.accountId),
      ),
      state.synchronizedAccountIds,
      identity.decisions,
    );
    await writeBankLinks(
      tx,
      userId,
      opened.household.workspaceId,
      fresh.id,
      mappings,
    );
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
  else
    await db.$transaction(saveConnection, { timeout: 30_000, maxWait: 10_000 });
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
  if (amount < 0 && isCardPaymentOutflow(fact.name)) return undefined;
  const payee = (fact.merchantName ?? fact.name).slice(0, 240);
  const categoryId = rememberedCategory(budget, { payee, accountId, amount });
  const counterpartyShare = rememberedCounterpartyShare(budget, {
    payee,
    accountId,
    amount,
  });
  if (!categoryId && !counterpartyShare) return undefined;
  const twin = budget.transactions.some(
    (transaction) =>
      !transaction.removed &&
      transaction.accountId === accountId &&
      (transaction.providerId === fact.providerTransactionId ||
        matchesManualImport(transaction, {
          accountId,
          amount,
          date: fact.date,
        })),
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
    review?: "approve" | "enter";
    operationId?: string;
    decidedAt?: string;
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
          ...(input.review ? { review: input.review } : {}),
        }
      : command;
  try {
    if (
      input.ignore &&
      (input.command || input.review || input.existingTransactionId)
    )
      throw new Error(
        "Reject bank activity separately from recording or matching it.",
      );
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
    const retryId = input.ignore ? input.operationId : input.command?.id;
    const rejectedIdentity = {
      type: "bank.import.reject",
      id: input.operationId,
      connectionId: input.connectionId,
      logicalId: input.logicalId,
      fingerprint: input.expectedFingerprint ?? null,
    };
    if (retryId) {
      const saved = await findOperation(db, household.workspaceId, retryId);
      if (saved)
        return {
          resolved: true,
          ...earlierResult(
            saved,
            userId,
            input.ignore ? rejectedIdentity : saveIdentity(submittedCommand),
            input.ignore ? rejectedIdentity : saveIdentity(input.command),
          ),
        };
    }
    const record = state.records.find((r) => r.id === input.logicalId);
    if (!record) {
      const quarantined = readQuarantine(state.reviews, input.logicalId);
      if (!quarantined) throw new TRPCError({ code: "NOT_FOUND" });
      if (!input.ignore) throw new Error(quarantinedImportMessage);
      if (
        input.expectedFingerprint &&
        input.expectedFingerprint !==
          quarantineFingerprint(quarantined.transaction)
      )
        throw refusal(
          "conflict",
          "Your bank updated this transaction. Reopen it before saving.",
          household.revision,
        );
      const operationId = input.operationId ?? randomUUID();
      return {
        resolved: true,
        ...(await writeServerOperation(db, opened, {
          actorId: userId,
          operationId,
          source: "user",
          type: "bank.import.resolve",
          submitted: input.operationId
            ? rejectedIdentity
            : { ...input, operationId },
          changeSet: {
            ...rejectImportChange(
              household.rows,
              userId,
              connection.id,
              input.logicalId,
              quarantineFingerprint(quarantined.transaction),
              input.decidedAt ?? new Date().toISOString(),
            ),
            operationId,
          },
        })),
      };
    }
    if (
      input.expectedFingerprint &&
      input.expectedFingerprint !== fingerprint(record)
    )
      throw refusal(
        "conflict",
        "Your bank updated this transaction. Reopen it before saving.",
        household.revision,
      );
    const mapping = (readBankAccountRows(connection)?.importMappings ??
      mappings(connection))[record.current.providerAccountId];
    let operationId: string =
      input.ignore && input.operationId ? input.operationId : randomUUID();
    let submitted: unknown =
      input.ignore && input.operationId
        ? rejectedIdentity
        : { ...input, operationId };
    const changeSets: ChangeSet[] = [];
    if (input.ignore) {
      if (opened.requestRevision !== input.expectedRevision)
        throw refusal(
          "conflict",
          "Your budget changed. Refresh before rejecting this import.",
          household.revision,
        );
      return {
        resolved: true,
        ...(await writeServerOperation(db, opened, {
          actorId: userId,
          operationId,
          source: "user",
          type: "bank.import.resolve",
          submitted,
          changeSet: {
            ...rejectImportChange(
              household.rows,
              userId,
              connection.id,
              record.id,
              fingerprint(record),
              input.decidedAt ?? new Date().toISOString(),
            ),
            operationId,
          },
        })),
      };
    } else {
      const imported: BankInboxItem = {
        accountId: mapping?.accountId ?? null,
        transactionId: state.resolved[record.id]?.transactionId,
        removed: record.removed,
        quarantined: false,
        amount: -record.current.amountCents,
        pending: record.current.pending,
        error: state.errors[record.id],
        needsMatchReview: record.matchStatus === "needs_review",
        partnerMatches: inboxPartnerMatches(
          ledger.state,
          ledger.budget,
          mapping?.accountId ?? null,
          record,
        ),
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
      if (input.review) {
        if (
          input.existingTransactionId ||
          input.command?.type !== "transaction.upsert" ||
          !input.expectedFingerprint
        )
          throw new Error("Reopen this bank activity before reviewing it.");
        const allowed = classifyRegisterEntry(budget, imported).capabilities[
          input.review
        ];
        if (!allowed.ok) throw new Error(allowed.reason);
      }
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
        if (!record.current.pending) {
          const command = transferImportCommand(budget, transaction, {
            id: operationId,
            date: record.current.date,
            amount: -record.current.amountCents,
            providerId: record.current.providerTransactionId,
          });
          if (command)
            changeSets.push(
              executeWithChanges(ledger.state, userId, command, "provider")
                .changeSet,
            );
        }
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
            reviewed: record.current.pending || input.review === "approve",
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
