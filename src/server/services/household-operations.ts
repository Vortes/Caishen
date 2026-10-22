import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { composeChangeSets, rowsIn } from "~/domain/change-sets";
import {
  createBook,
  execute,
  executeWithChanges,
  mergeBooks,
  withCounterpartyAccounts,
  type Book,
  type Command,
} from "~/domain/engine";
import { bookToRows, diffRows, tombstone, type ChangeSet } from "~/domain/rows";
import { Prisma } from "~/generated/prisma";
import {
  householdLedger,
  households,
  writeOperation,
} from "~/server/storage/households";
import {
  carryOperations,
  findOperation,
  lacksCounterpartyAccounts,
  RevisionConflictError,
  writeChangeSet,
} from "~/server/storage/rows";
import {
  earlierResult,
  openHousehold,
  refusal,
  requireHousehold,
  writeServerOperation,
  type Database,
  type OperationResult,
  type RevisionObserver,
} from "./household";
import { commandHash, domainError, operationHash } from "./safety";
import { budgetMaintenance } from "./stored-data";

// The server's own household operations that aren't bank updates: creating
// a budget, joining a partner's household, and the legacy screen's bulk
// changes.

/** Creates a member's personal budget in a household of their own. */
export async function onboard(
  db: Database,
  userId: string,
  input: { name: string; month: string; timezone: string },
  observe?: RevisionObserver,
): Promise<OperationResult> {
  try {
    const book = execute(
      withCounterpartyAccounts(createBook(userId, input.name, input.month)),
      userId,
      { type: "settings.update", id: randomUUID(), timezone: input.timezone },
    );
    const rows = bookToRows(book);
    const operationId = randomUUID();
    const changeSet: ChangeSet = {
      operationId,
      revision: 0,
      before: rows.map((row) => tombstone(row)),
      after: rows,
    };
    const written = await db.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({ data: {} });
      await tx.workspaceMember.create({
        data: { clerkUserId: userId, workspaceId: workspace.id },
      });
      return writeChangeSet(tx, {
        workspaceId: workspace.id,
        baseRevision: 0,
        changeSet,
        operation: {
          actorId: userId,
          source: "user",
          type: "budget.onboard",
          inputHash: operationHash(input),
          command: input,
        },
      });
    });
    observe?.(written.revision);
    return {
      revision: written.revision,
      changeSet: written.changeSet,
      rebased: false,
    };
  } catch (error) {
    domainError(error);
  }
}

/**
 * Gives a household's budgets the counterparty accounts and paired
 * envelopes they lack, as one operation; budgets made before these accounts
 * existed get them before their first pull or write. Does nothing while any
 * part of the household doesn't read, and leaves a write race to the next request.
 */
export async function addCounterpartyAccounts(
  db: Database,
  userId: string,
  observe?: RevisionObserver,
): Promise<{ previousRevision: number; revision: number } | undefined> {
  if (!(await lacksCounterpartyAccounts(db, userId))) return;
  const opened = await openHousehold(db, userId, observe);
  if (!opened) return;
  const { household, ledger } = opened;
  if (ledger.status !== "ready" || ledger.personal || ledger.failures.length)
    return;
  const book = ledger.state as Book;
  const changes = diffRows(
    bookToRows(book),
    bookToRows(withCounterpartyAccounts(book)),
  );
  if (!changes.after.length) return;
  const operationId = randomUUID();
  try {
    const written = await writeOperation(db, household, {
      changeSet: { operationId, revision: 0, ...changes },
      operation: {
        actorId: userId,
        source: "user",
        type: "budget.counterparties",
        inputHash: operationHash({ operationId }),
        command: null,
      },
    });
    observe?.(written.revision);
    return { previousRevision: household.revision, revision: written.revision };
  } catch (error) {
    if (!(error instanceof RevisionConflictError)) throw error;
  }
}

// Joining merges both whole households, so every part of each must read.
async function wholeBook(db: Database, userId: string) {
  const household = await households.load(db, userId);
  if (!household)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Create your own personal budget first.",
    });
  const ledger = householdLedger(household, userId);
  if (ledger.status !== "ready" || ledger.personal || ledger.failures.length)
    throw budgetMaintenance();
  return { household, book: ledger.state as Book };
}

/**
 * Moves a member's personal budget into the household that invited them.
 * The household changes shape, so every browser downloads it again.
 */
export async function joinHousehold(
  db: Database,
  userId: string,
  code: string,
  observe?: RevisionObserver,
): Promise<OperationResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const invite = await db.partnerInvite.findUnique({
        where: { tokenHash: commandHash(code) },
      });
      if (!invite || invite.usedBy || invite.expiresAt < new Date())
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This invitation is invalid, expired, or already used.",
        });
      if (invite.createdBy === userId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Give this code to your partner to use in their own account.",
        });
      const own = await wholeBook(db, userId);
      const host = await wholeBook(db, invite.createdBy);
      if (host.household.workspaceId !== invite.workspaceId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This invitation is invalid, expired, or already used.",
        });
      const merged = withCounterpartyAccounts(
        mergeBooks(host.book, own.book, userId),
      );
      const operationId = randomUUID();
      const changeSet: ChangeSet = {
        operationId,
        revision: 0,
        ...diffRows(
          rowsIn(host.household.rows).filter((row) => !row.deleted),
          bookToRows(merged),
        ),
      };
      const written = await db.$transaction(
        async (tx) => {
          const result = await writeChangeSet(tx, {
            workspaceId: invite.workspaceId,
            baseRevision: host.household.revision,
            changeSet,
            operation: {
              actorId: userId,
              source: "user",
              type: "household.join",
              inputHash: operationHash({ inviteId: invite.id }),
              command: { inviteId: invite.id },
            },
            // Past any revision the joining member's browser holds.
            reset: { after: own.household.revision },
          });
          // The budget left behind stays as it was, and no longer changes.
          const left = await tx.workspace.updateMany({
            where: {
              id: own.household.workspaceId,
              revision: own.household.revision,
            },
            data: { revision: { increment: 1 } },
          });
          const used = await tx.partnerInvite.updateMany({
            where: { id: invite.id, usedBy: null },
            data: { usedBy: userId },
          });
          if (left.count !== 1 || used.count !== 1)
            throw new TRPCError({
              code: "CONFLICT",
              message: "A budget changed while joining. Try again.",
            });
          await tx.workspaceMember.update({
            where: { clerkUserId: userId },
            data: { workspaceId: invite.workspaceId },
          });
          await carryOperations(tx, {
            from: own.household.workspaceId,
            to: invite.workspaceId,
            actorId: userId,
          });
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30_000,
        },
      );
      observe?.(written.revision);
      return { revision: written.revision, changeSet: null, rebased: false };
    } catch (error) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034") ||
        error instanceof RevisionConflictError
      ) {
        if (attempt < 2) continue;
        throw refusal("conflict", "A budget changed while joining. Try again.");
      }
      domainError(error);
    }
  }
  throw refusal("conflict", "A budget changed while joining. Try again.");
}

/**
 * Runs commands one after another as one operation, for the legacy
 * screen's bulk changes: refused when the household moved past the
 * revision they were made against, answered with the original result when
 * retried.
 */
async function bulkOperation(
  db: Database,
  actorId: string,
  input: {
    operationId: string;
    type: string;
    submitted: unknown;
    expectedRevision: number;
    commands: Command[];
  },
  observe?: RevisionObserver,
): Promise<OperationResult> {
  try {
    const opened = await requireHousehold(db, actorId, observe);
    const saved = await findOperation(
      db,
      opened.household.workspaceId,
      input.operationId,
    );
    if (saved)
      return earlierResult(saved, actorId, input.submitted, input.submitted);
    if (opened.requestRevision !== input.expectedRevision)
      throw refusal(
        "conflict",
        "Your budget changed in another session. Refresh before saving.",
        opened.household.revision,
      );
    let state = opened.ledger.state;
    const changeSets: ChangeSet[] = [];
    for (const command of input.commands) {
      const result = executeWithChanges(state, actorId, command);
      state = result.book;
      changeSets.push(result.changeSet);
    }
    return await writeServerOperation(db, opened, {
      actorId,
      operationId: input.operationId,
      source: "user",
      type: input.type,
      submitted: input.submitted,
      changeSet: composeChangeSets(input.operationId, changeSets),
    });
  } catch (error) {
    if (error instanceof RevisionConflictError)
      throw refusal(
        "conflict",
        "Your budget changed. Refresh before saving.",
        error.revision,
      );
    domainError(error);
  }
}

export async function approveSuggestions(
  db: Database,
  actorId: string,
  input: {
    operationId: string;
    expectedRevision: number;
    items: { transactionId: string; categoryId: string }[];
  },
  submitted: unknown,
  observe?: RevisionObserver,
): Promise<OperationResult> {
  if (
    new Set(input.items.map((item) => item.transactionId)).size !==
    input.items.length
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose each purchase only once.",
    });
  return bulkOperation(
    db,
    actorId,
    {
      operationId: input.operationId,
      type: "suggestions.approve",
      submitted,
      expectedRevision: input.expectedRevision,
      commands: input.items.map((item) => ({
        type: "transaction.categorize",
        id: `${input.operationId}:${commandHash(item).slice(0, 32)}`,
        ...item,
      })),
    },
    observe,
  );
}

export async function importCategories(
  db: Database,
  actorId: string,
  input: {
    categories: Extract<Command, { type: "category.import" }>["categories"];
    expectedRevision: number;
  },
  observe?: RevisionObserver,
): Promise<OperationResult> {
  const command: Command = {
    type: "category.import",
    id: randomUUID(),
    categories: input.categories,
  };
  return bulkOperation(
    db,
    actorId,
    {
      operationId: command.id,
      type: command.type,
      submitted: command,
      expectedRevision: input.expectedRevision,
      commands: [command],
    },
    observe,
  );
}
