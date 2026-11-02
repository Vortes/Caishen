import { withBankAccountSuccessors } from "../bank-account-rows";
/** Account identity and links: resolves provider identities, validates explicit account setup and recovery, and plans or applies conservative duplicate repairs. It preserves budget history while row writers enforce one live feed per budget account. */

import {
  sameBankAccount,
  resolveBankAccountIdentity,
  bankAccountNeedsRecovery,
  isBankAccountLive,
  bankRecoveryCandidates,
} from "~/lib/bank-account-identity";
import { z } from "zod";
import type { bankAccountSchema } from "~/server/integrations/plaid";
import {
  type Database,
  openHousehold,
  type OperationResult,
  earlierResult,
  writeServerOperation,
  requireHousehold,
  refusal,
} from "../household";
import { budgetMaintenance, connectionMaintenance } from "../stored-data";
import {
  bankAccountRowsSelection,
  readBankAccountRows,
  lockBankConnections,
} from "../bank-account-rows";
import { readImportStates } from "../bank-import-rows";
import { TRPCError } from "@trpc/server";
import {
  bankAccountOpening,
  type SetupBankAccountsInput,
  setupBankAccountsSchema,
  bankSetupDate,
  openingSnapshot,
} from "../bank-account-setup";
import {
  rowsIn,
  applyChangeSet,
  composeChangeSets,
} from "~/domain/change-sets";
import {
  rowOwner,
  type ChangeSet,
  tombstone,
  rowsToPersonalLedger,
} from "~/domain/rows";
import {
  checkRestoredLedger,
  type Command,
  executeWithChanges,
  projectBook,
  isCleared,
} from "~/domain/engine";
import { commandHash, domainError } from "../safety";
import {
  readHouseholdRevision,
  findOperation,
  RevisionConflictError,
} from "~/server/storage/rows";
import { decryptBankToken } from "~/server/token-crypto";
import { writeBankLinks } from "../bank-account-writes";
import type { AccountingState } from "~/domain/shared-ledger";
import { usdToCents } from "~/server/integrations/validation";
import {
  type ConnectionDetails,
  type Mappings,
  type StoredConnection,
  readyConnection,
  bankInboxItems,
  connectionMappings,
  readConnectionColumn,
  connectionMetadata,
} from "./inbox";
import { migrateBankAccounts } from "../bank-account-migration";
import { bankClient as client } from "../bank-provider-events";

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
  accountId?: string;
};

// Only rungs 1 and 2 preserve a mapped account automatically. Rung 2 moves
// its mapping to the new id, so the old id leaves the catalog with the merge.
export function followAccountIdentities(
  previous: ConnectionDetails["accounts"],
  reported: ConnectionDetails["accounts"],
  mappings: Mappings,
) {
  const next = { ...mappings };
  const decisions: IdentityDecision[] = [];
  const candidates = previous.map((account) => ({
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
    if (next[from]) {
      next[to] = next[from]!;
      if (from !== to) delete next[from];
    }
    decisions.push({
      rung: resolution.rung,
      from,
      to,
      ...(next[to] ? { accountId: next[to].accountId } : {}),
    });
  }
  return {
    mappings: next,
    decisions,
    ...mergeAccountCatalog(previous, reported, next),
  };
}

export function currentProviderAccounts(
  connection: StoredConnection,
  accounts: z.infer<typeof bankAccountSchema>[],
) {
  const retired = new Set(
    connection.bankAccounts
      ?.filter((row) => row.status === "retired")
      .map((row) => row.providerAccountId),
  );
  return accounts.filter((account) => !retired.has(account.accountId));
}

const duplicateRepairSelectionSchema = z.union([
  z
    .object({
      retiredConnectionId: z.string().min(1).max(256),
      replacementConnectionId: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      connectionId: z.string().min(1).max(256),
      keepProviderAccountId: z.string().min(1).max(256),
      removeProviderAccountId: z.string().min(1).max(256),
    })
    .strict(),
]);

type DuplicateRepairSelection = z.infer<typeof duplicateRepairSelectionSchema>;

/** Administrative repair for duplicate starting balances that have never been used. */
async function prepareDuplicateBankRepair(
  db: Database,
  userId: string,
  selection: DuplicateRepairSelection,
) {
  await migrateBankAccounts(db, userId);
  selection = duplicateRepairSelectionSchema.parse(selection);
  const sameConnection = "connectionId" in selection ? selection : undefined;
  if (
    sameConnection &&
    sameConnection.keepProviderAccountId ===
      sameConnection.removeProviderAccountId
  )
    throw new Error("Choose two different provider accounts.");
  if (
    "retiredConnectionId" in selection &&
    selection.retiredConnectionId === selection.replacementConnectionId
  )
    throw new Error("Choose two different connections.");
  const opened = await openHousehold(db, userId);
  if (opened?.ledger.status !== "ready") throw budgetMaintenance();
  const connections = await withBankAccountSuccessors(
    db,
    db.bankConnection.findMany({
      include: { bankAccounts: bankAccountRowsSelection },
      where: { clerkUserId: userId },
    }),
  );
  const imports = readImportStates(opened.household.rows, userId);
  const read = (id: string) => {
    const connection = connections.find((item) => item.id === id);
    if (!connection) throw new TRPCError({ code: "NOT_FOUND" });
    return readyConnection(connection, imports);
  };
  const retired = read(
    "connectionId" in selection
      ? selection.connectionId
      : selection.retiredConnectionId,
  );
  const replacement = read(
    "connectionId" in selection
      ? selection.connectionId
      : selection.replacementConnectionId,
  );
  if (
    !retired.state.institutionId ||
    retired.state.institutionId !== replacement.state.institutionId ||
    (!sameConnection &&
      retired.connection.createdAt >= replacement.connection.createdAt) ||
    replacement.state.disconnectedAt ||
    replacement.state.transactionStatus !== "HISTORICAL_UPDATE_COMPLETE" ||
    !replacement.connection.lastSyncedAt
  )
    throw new Error(
      "Choose the newer, fully synchronized connection to the same bank.",
    );
  const budget = opened.ledger.budget;
  const untouchedAdjustment = (accountId: string) => {
    const account = budget.accounts.find((item) => item.id === accountId);
    const transactions = budget.transactions.filter(
      (item) => item.accountId === accountId,
    );
    const transaction = transactions.length === 1 ? transactions[0] : undefined;
    return transaction?.kind === "adjustment" &&
      transaction.date === account?.date &&
      transaction.revision === 1 &&
      !transaction.removed &&
      !transaction.reconciled &&
      isCleared(transaction)
      ? transaction
      : undefined;
  };
  const mappings = structuredClone(replacement.mappings);
  const accounts: {
    name: string;
    keepAccountId: string;
    removeAccountId: string;
    keepAccountName?: string;
    removeAccountName?: string;
    keepProviderAccountId?: string;
    removeProviderAccountId?: string;
    keepMask?: string | null;
    removeMask?: string | null;
  }[] = [];
  const removedIds = new Set<string>();
  const replacementRows = new Map<string, string>();
  for (const [providerId, mapping] of Object.entries(retired.mappings)) {
    if (sameConnection && providerId !== sameConnection.keepProviderAccountId)
      continue;
    const source = retired.state.accounts.find(
      (account) => account.accountId === providerId,
    );
    const candidates = sameConnection
      ? replacement.state.accounts.filter(
          (account) =>
            account.accountId === sameConnection.removeProviderAccountId,
        )
      : source
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
      (!sameConnection &&
        untouchedAdjustment(keep.id)?.amount !==
          untouchedAdjustment(remove.id)?.amount) ||
      bankAccountOpening(target).openingBalance !==
        untouchedAdjustment(sameConnection ? remove.id : keep.id)?.amount
    )
      throw new Error(
        "The duplicate starting balances disagree. Review these accounts manually.",
      );
    if (
      budget.transactions.some(
        (transaction) =>
          (sameConnection ? [remove.id] : [keep.id, remove.id]).includes(
            transaction.accountId,
          ) && transaction !== untouchedAdjustment(transaction.accountId),
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
          Object.values(connectionMappings([connection])[0]!).some((saved) =>
            [keep.id, remove.id].includes(saved.accountId),
          ),
      )
    )
      throw new Error("Another bank connection uses these accounts.");
    if (!sameConnection) {
      const sourceRow = retired.connection.bankAccounts.find(
        (row) => row.providerAccountId === source.accountId,
      );
      const targetRow = replacement.connection.bankAccounts.find(
        (row) => row.providerAccountId === target.accountId,
      );
      if (!sourceRow || !targetRow) throw connectionMaintenance();
      replacementRows.set(sourceRow.id, targetRow.id);
    }
    removedIds.add(remove.id);
    accounts.push({
      name: keep.name,
      keepAccountId: keep.id,
      removeAccountId: remove.id,
      ...(sameConnection
        ? {
            keepAccountName: keep.name,
            removeAccountName: remove.name,
            keepProviderAccountId: source.accountId,
            removeProviderAccountId: target.accountId,
            keepMask: source.mask,
            removeMask: target.mask,
          }
        : {}),
    });
    if (sameConnection) delete mappings[target.accountId];
    else mappings[target.accountId] = { ...targetMapping, accountId: keep.id };
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
    bankInboxItems(
      sameConnection ? [retired] : [retired, replacement],
      budget,
      opened.ledger.state,
    ).some((item) =>
      (sameConnection ? removedIds : affected).has(
        item.accountId ?? item.loanId ?? "",
      ),
    )
  )
    throw new Error(
      "Review outstanding bank activity before repairing these duplicates.",
    );
  const importMappings = replacement.importMappings ?? replacement.mappings;
  const reviewedImport = replacement.state.records.some(
    (record) =>
      removedIds.has(
        importMappings[record.current.providerAccountId]?.accountId ?? "",
      ) &&
      (Boolean(replacement.state.resolved[record.id]) ||
        Boolean(replacement.state.reviews[record.id]?.length)),
  );
  if (
    reviewedImport ||
    (await db.reviewEvidence.count({
      where: { clerkUserId: userId, accountId: { in: [...removedIds] } },
    }))
  )
    throw new Error(
      "A duplicate account has review evidence. Preserve it with a manual repair.",
    );
  const categoryIds = new Set(
    budget.categories
      .filter((category) => removedIds.has(category.pairedAccountId ?? ""))
      .map((category) => category.id),
  );
  const removedAdjustmentIds = new Set(
    [...removedIds].map((id) => untouchedAdjustment(id)?.id),
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
        (row.table === "transaction" &&
          row.data !== null &&
          removedIds.has(row.data.accountId)) ||
        (row.table === "transactionHistory" &&
          row.data !== null &&
          removedAdjustmentIds.has(row.data.transactionId)) ||
        (!sameConnection &&
          row.table === "bankImport" &&
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
  const deletedRows = sameConnection ? [] : retired.connection.bankAccounts;
  const deletedIds = new Set(deletedRows.map((row) => row.id));
  const graph = new Map(
    connections.flatMap((connection) =>
      connection.bankAccounts.map((row) => [row.id, row] as const),
    ),
  );
  for (const row of deletedRows) {
    let successor = row;
    const visited = new Set<string>();
    while (deletedIds.has(successor.id) && !replacementRows.has(successor.id)) {
      if (visited.has(successor.id) || !successor.supersededById) break;
      visited.add(successor.id);
      const next = graph.get(successor.supersededById);
      if (!next) break;
      successor = next;
    }
    const to =
      replacementRows.get(successor.id) ??
      (!deletedIds.has(successor.id) ? successor.id : undefined);
    if (to) replacementRows.set(row.id, to);
  }
  const successorRedirects = connections
    .flatMap((connection) =>
      connection.bankAccounts.flatMap((row) => {
        if (
          connection.id === retired.connection.id ||
          !row.supersededById ||
          !deletedIds.has(row.supersededById)
        )
          return [];
        const to = replacementRows.get(row.supersededById);
        if (!to)
          throw new Error(
            "Provider history cannot be redirected safely. Review these connections manually.",
          );
        return [
          {
            id: row.id,
            connectionId: connection.id,
            from: row.supersededById,
            to,
            updatedAt: row.updatedAt,
          },
        ];
      }),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
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
      connections: [retired, replacement].map(
        ({ connection, state, mappings }) => ({
          id: connection.id,
          updatedAt: connection.updatedAt.toISOString(),
          imports: connectionMetadata(connection.imports, state),
          links: mappings,
          bankAccounts: connection.bankAccounts,
        }),
      ),
      accounts,
      successorRedirects,
    }),
  };
  return {
    plan,
    opened,
    retired,
    replacement,
    mappings,
    changeSet,
    deletedIds,
    successorRedirects,
  };
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
  const { operationId, expectedPlanHash, ...selection } = input;
  const parsed = {
    ...duplicateRepairSelectionSchema.parse(selection),
    ...z
      .object({
        operationId: z.string().uuid(),
        expectedPlanHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse({ operationId, expectedPlanHash }),
  };
  const household = await readHouseholdRevision(db, userId);
  if (!household) throw budgetMaintenance();
  const submitted = { type: "bank.duplicates.repair", ...parsed };
  const previous = await findOperation(
    db,
    household.workspaceId,
    parsed.operationId,
  );
  if (previous) return earlierResult(previous, userId, submitted, submitted);
  const prepared = await prepareDuplicateBankRepair(db, userId, selection);
  if (prepared.plan.hash !== parsed.expectedPlanHash)
    throw new Error(
      "The repair plan changed. Preview it again before applying.",
    );
  const {
    retired,
    replacement,
    opened,
    mappings,
    changeSet,
    deletedIds,
    successorRedirects,
  } = prepared;
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
  return writeServerOperation(db, opened, {
    actorId: userId,
    operationId: parsed.operationId,
    source: "user",
    type: submitted.type,
    submitted,
    changeSet,
    alongside: async (tx) => {
      await lockBankConnections(tx, userId, [
        retired.connection.id,
        replacement.connection.id,
        ...successorRedirects.map((row) => row.connectionId),
      ]);
      const currentConnections = await withBankAccountSuccessors(
        tx,
        tx.bankConnection.findMany({
          where: {
            clerkUserId: userId,
            id: { in: [retired.connection.id, replacement.connection.id] },
          },
          include: { bankAccounts: bankAccountRowsSelection },
        }),
      );
      if (
        [retired, replacement].some(({ connection }) => {
          const current = currentConnections.find(
            (item) => item.id === connection.id,
          );
          return (
            current?.updatedAt.getTime() !== connection.updatedAt.getTime() ||
            commandHash(current.bankAccounts) !==
              commandHash(connection.bankAccounts)
          );
        })
      )
        throw new Error("A bank connection changed. Preview the repair again.");
      if ("connectionId" in parsed) {
        const saved = await tx.bankConnection.updateMany({
          where: {
            id: replacement.connection.id,
            clerkUserId: userId,
            updatedAt: replacement.connection.updatedAt,
          },
          data: { updatedAt: new Date() },
        });
        if (saved.count !== 1)
          throw new Error(
            "A bank connection changed. Preview the repair again.",
          );
        await writeBankLinks(
          tx,
          userId,
          opened.household.workspaceId,
          replacement.connection.id,
          mappings,
        );
        const kept = await tx.bankAccount.findUniqueOrThrow({
          where: {
            connectionId_providerAccountId: {
              connectionId: parsed.connectionId,
              providerAccountId: parsed.keepProviderAccountId,
            },
          },
        });
        await tx.bankAccount.update({
          where: {
            connectionId_providerAccountId: {
              connectionId: parsed.connectionId,
              providerAccountId: parsed.removeProviderAccountId,
            },
          },
          data: {
            status: "retired",
            historyComplete: false,
            supersededById: kept.id,
          },
        });
        return;
      }
      const incoming = await tx.bankAccount.findMany({
        where: {
          supersededById: { in: [...deletedIds] },
          connectionId: { not: retired.connection.id },
          connection: { clerkUserId: userId },
        },
        select: {
          id: true,
          connectionId: true,
          supersededById: true,
          updatedAt: true,
        },
      });
      if (
        incoming.length !== successorRedirects.length ||
        successorRedirects.some((expected) => {
          const current = incoming.find((row) => row.id === expected.id);
          return (
            current?.connectionId !== expected.connectionId ||
            current.supersededById !== expected.from ||
            current.updatedAt.getTime() !== expected.updatedAt.getTime()
          );
        })
      )
        throw new Error("A bank connection changed. Preview the repair again.");
      for (const redirect of successorRedirects) {
        await tx.bankAccount.update({
          where: { id: redirect.id },
          data: { supersededById: redirect.to },
        });
      }
      await tx.bankConnection.updateMany({
        where: {
          clerkUserId: userId,
          id: {
            in: successorRedirects
              .map((row) => row.connectionId)
              .filter((id) => id !== replacement.connection.id),
          },
        },
        data: { updatedAt: new Date() },
      });
      // A successful removal is not undone if a later database write fails;
      // the stored credential stays available for an idempotent retry.
      await client(db, userId, retired.connection.id).removeItem(
        decryptBankToken(retired.connection.encryptedToken, userId),
      );
      const saved = await tx.bankConnection.updateMany({
        where: {
          id: replacement.connection.id,
          clerkUserId: userId,
          updatedAt: replacement.connection.updatedAt,
        },
        data: { updatedAt: new Date() },
      });
      const removed = await tx.bankConnection.deleteMany({
        where: {
          id: retired.connection.id,
          clerkUserId: userId,
          updatedAt: retired.connection.updatedAt,
        },
      });
      await writeBankLinks(
        tx,
        userId,
        opened.household.workspaceId,
        replacement.connection.id,
        mappings,
      );
      if (saved.count !== 1 || removed.count !== 1)
        throw new Error("A bank connection changed. Preview the repair again.");
    },
  });
}

// A connection of the member's and everything bank setup needs with it.
export async function openConnection(
  db: Database,
  userId: string,
  connectionId: string,
) {
  await migrateBankAccounts(db, userId);
  const connection = await withBankAccountSuccessors(
    db,
    db.bankConnection.findFirst({
      include: { bankAccounts: bankAccountRowsSelection },
      where: { id: connectionId, clerkUserId: userId },
    }),
  );
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
    const connections = await withBankAccountSuccessors(
      db,
      db.bankConnection.findMany({
        include: { bankAccounts: bankAccountRowsSelection },
        where: { clerkUserId: userId },
      }),
    );
    const allMappings = connectionMappings(connections);
    const remainingMappings = allMappings.map((mapping) => ({ ...mapping }));
    const details = connections.map((saved) => {
      const parsed = readConnectionColumn(saved);
      if (!parsed) throw connectionMaintenance();
      return parsed;
    });
    const identities = connections.map((saved, index) => ({
      ...details[index]!,
      status: saved.status,
      accountMappings: allMappings[index]!,
      unavailableAccountIds:
        readBankAccountRows(saved)?.unavailableAccountIds ?? [],
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
    const supersessions: { connectionId: string; from: string; to: string }[] =
      [];
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
        !isBankAccountLive(
          { ...state, unavailableAccountIds: connection.unavailableAccountIds },
          provider.accountId,
        )
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
          } else {
            delete remainingMappings[index]![providerId];
            retired.add(index);
            supersessions.push({
              connectionId: connections[index]!.id,
              from: providerId,
              to: provider.accountId,
            });
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
        await lockBankConnections(tx, userId, [
          connection.id,
          ...[...retired].map((index) => connections[index]!.id),
        ]);
        for (const index of retired) {
          const source = connections[index]!;
          const saved = await tx.bankConnection.updateMany({
            where: { id: source.id, updatedAt: source.updatedAt },
            data: { updatedAt: new Date() },
          });
          await writeBankLinks(
            tx,
            userId,
            household.workspaceId,
            source.id,
            remainingMappings[index]!,
          );
          if (saved.count !== 1)
            throw new TRPCError({
              code: "CONFLICT",
              message: "The previous bank link changed. Refresh and try again.",
            });
        }
        const saved = await tx.bankConnection.updateMany({
          where: { id: connection.id, updatedAt: connection.updatedAt },
          data: { updatedAt: new Date() },
        });
        await writeBankLinks(
          tx,
          userId,
          household.workspaceId,
          connection.id,
          mappings,
        );
        if (saved.count !== 1)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Account setup changed. Refresh your bank accounts.",
          });
        for (const edge of supersessions) {
          const successor = await tx.bankAccount.findUniqueOrThrow({
            where: {
              connectionId_providerAccountId: {
                connectionId: connection.id,
                providerAccountId: edge.to,
              },
            },
          });
          await tx.bankAccount.update({
            where: {
              connectionId_providerAccountId: {
                connectionId: edge.connectionId,
                providerAccountId: edge.from,
              },
            },
            data: {
              status: "retired",
              historyComplete: false,
              supersededById: successor.id,
            },
          });
        }
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
