/** Connection lifecycle: creates and reviews Link sessions, exchanges tokens, refreshes authorization, and disconnects a login. It owns provider credentials and connection health; account identity and budget links are delegated to the account module. */

import { IntegrationError } from "~/server/integrations/validation";
import {
  type Database,
  writeServerOperation,
  requireHousehold,
  type OperationResult,
  earlierResult,
  refusal,
} from "../household";
import { connectionMaintenance } from "../stored-data";
import {
  bankAccountRowsSelection,
  lockBankConnections,
} from "../bank-account-rows";
import { TRPCError } from "@trpc/server";
import { encryptBankToken, decryptBankToken } from "~/server/token-crypto";
import { domainError, operationHash } from "../safety";
import {
  type PlaidLinkMetadata,
  plaidLinkMetadataSchema,
} from "~/lib/plaid-link-metadata";
import { bankLinkVerdict } from "~/lib/bank-account-identity";
import { recordBankLinkOutcome } from "../bank-provider-events";
import {
  readHouseholdRevision,
  findOperation,
  RevisionConflictError,
} from "~/server/storage/rows";
import { z } from "zod";
import type { Prisma } from "~/generated/prisma";
import { writeProviderAccounts, writeBankLinks } from "../bank-account-writes";
import { randomUUID } from "node:crypto";
import { composeChangeSets } from "~/domain/change-sets";
import { bankClient as client } from "../bank-provider-events";
import {
  type StoredConnection,
  readConnectionColumn,
  connectionColumnSchema,
  mappings,
  connectionMetadata,
} from "./inbox";
import { migrateBankAccounts } from "../bank-account-migration";
import {
  currentProviderAccounts,
  followAccountIdentities,
  openConnection,
} from "./accounts";

// The request id is what Plaid support can act on, so a failed update
// names it where the Banks panel shows the failure.
export function withPlaidRequestId(message: string, error: unknown) {
  return error instanceof IntegrationError && error.requestId
    ? `${message} (Plaid request id: ${error.requestId})`
    : message;
}

/** Plaid's webhook signing key for a key id, for the webhook route. */
export function fetchPlaidWebhookKey(db: Database, keyId: string) {
  return client(db, null).getWebhookVerificationKey(keyId);
}

function requireConnected(connection: StoredConnection) {
  const details = readConnectionColumn(connection);
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
          include: { bankAccounts: bankAccountRowsSelection },
          where: { id: connectionId, clerkUserId: userId },
        })
      : null;
    if (connectionId && !connection) throw new TRPCError({ code: "NOT_FOUND" });
    if (connection) {
      requireConnected(connection);
    }
    // Verify token encryption is configured before starting a bank connection.
    encryptBankToken("configuration-check", userId);
    await migrateBankAccounts(db, userId);
    // The Item reports its health to the webhook route once the app has a
    // public address; without one the daily job remains the only source.
    const webhook = process.env.APP_BASE_URL
      ? new URL("/api/webhooks/plaid", process.env.APP_BASE_URL).toString()
      : undefined;
    const token = await client(db, userId, connection?.id).createLinkToken(
      userId,
      connection
        ? decryptBankToken(connection.encryptedToken, userId)
        : undefined,
      webhook,
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
      const details = readConnectionColumn(connection);
      if (!details) throw connectionMaintenance();
      if (
        details.disconnectedAt ||
        connection.status === "revoked" ||
        connection.status === "disconnected" ||
        details.institutionId !== institutionId
      )
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
    reviewId: operationHash({
      metadata: linked,
      connections: visible,
      verdict,
    }),
  };
}

export async function reviewBankLink(
  db: Database,
  userId: string,
  metadata: unknown,
  recordCompletion = true,
) {
  const linked = plaidLinkMetadataSchema.parse(metadata);
  await migrateBankAccounts(db, userId);
  const connections = await db.bankConnection.findMany({
    include: { bankAccounts: bankAccountRowsSelection },
    where: { clerkUserId: userId },
  });
  const review = reviewBankLinkConnections(connections, linked);
  if (recordCompletion)
    await recordBankLinkOutcome(db, {
      userId,
      method: "success",
      institutionId: linked.institution?.institution_id ?? null,
      accountCount: linked.accounts.length,
    });
  return review;
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
    await migrateBankAccounts(db, userId);
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
          include: { bankAccounts: bankAccountRowsSelection },
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
          include: { bankAccounts: bankAccountRowsSelection },
          where: { itemId: result.itemId },
        });
        if (existing && existing.clerkUserId !== userId)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This connection is already in use.",
          });
        if (existing) {
          await lockBankConnections(tx, userId, [existing.id]);
        }
        return tx.bankConnection.upsert({
          where: { itemId: result.itemId },
          create: {
            clerkUserId: userId,
            itemId: result.itemId,
            encryptedToken: encryptBankToken(result.accessToken, userId),
            imports: connectionMetadata(
              {},
              connectionColumnSchema.parse({ institutionId }),
            ),
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
    if (completed && !reviewId)
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

async function refreshBankAccounts(
  db: Database,
  userId: string,
  connectionId: string,
) {
  await migrateBankAccounts(db, userId);
  const requested = await db.bankConnection.findFirst({
    include: { bankAccounts: bankAccountRowsSelection },
    where: { id: connectionId, clerkUserId: userId },
  });
  if (!requested) throw new TRPCError({ code: "NOT_FOUND" });
  requireConnected(requested);
  const accounts = await client(db, userId, requested.id).getAccounts(
    decryptBankToken(requested.encryptedToken, userId),
  );
  accounts.accounts = currentProviderAccounts(requested, accounts.accounts);
  const column = readConnectionColumn(requested);
  if (!column) throw connectionMaintenance();
  const identity = followAccountIdentities(
    column.accounts,
    accounts.accounts,
    mappings(requested),
  );
  // Saved only over the connection the response was requested for, so an
  // older response cannot overwrite a newer update.
  const save = async (tx: Prisma.TransactionClient) => {
    await lockBankConnections(tx, userId, [requested.id]);
    const saved = await tx.bankConnection.updateMany({
      where: {
        id: requested.id,
        clerkUserId: userId,
        updatedAt: requested.updatedAt,
      },
      data: {
        imports: connectionMetadata(requested.imports, {
          ...column,
          ...accounts,
          transactionStatus: null,
        }),
        status: "connected",
        newAccountsAvailable: false,
        lastAttemptAt: new Date(),
        error: null,
      },
    });
    if (saved.count !== 1)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Another bank update finished first. Refresh and try again.",
      });
    await writeProviderAccounts(
      tx,
      userId,
      requested.id,
      accounts.accounts,
      [],
      identity.decisions,
    );
    const household = await readHouseholdRevision(db, userId);
    if (household)
      await writeBankLinks(
        tx,
        userId,
        household.workspaceId,
        requested.id,
        identity.mappings,
      );
  };
  if (!identity.decisions.length)
    return db.$transaction(save, { timeout: 30_000, maxWait: 10_000 });
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
      include: { bankAccounts: bankAccountRowsSelection },
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
    return await writeServerOperation(db, opened, {
      actorId: userId,
      operationId: input.operationId,
      source: "user",
      type: "bank.disconnect",
      submitted,
      changeSet: composeChangeSets(input.operationId, []),
      alongside: async (tx) => {
        await lockBankConnections(tx, userId, [connection.id]);
        if (!state.disconnectedAt)
          await client(db, userId, connection.id).removeItem(
            decryptBankToken(connection.encryptedToken, userId),
          );
        const saved = await tx.bankConnection.updateMany({
          where: {
            id: connection.id,
            updatedAt: connection.updatedAt,
          },
          data: {
            imports: connectionMetadata(connection.imports, {
              ...state,
              disconnectedAt: state.disconnectedAt ?? new Date().toISOString(),
            }),
            encryptedToken: "",
            status: "disconnected",
            error: null,
          },
        });
        await writeProviderAccounts(tx, userId, connection.id, [], []);
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
