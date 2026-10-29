import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { rowsIn } from "~/domain/change-sets";
import {
  createBook,
  budgetReferenceIssues,
  execute,
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
import { domainError, operationHash } from "./safety";
import { budgetMaintenance } from "./stored-data";
import {
  limitInviteChecks,
  readInvitationToJoin,
  readPartnerInvite,
} from "./partner-invites";

// The server's household operations outside bank updates: creating a
// budget, joining a partner, and applying category changes together.

/** Creates a member's personal budget in a household of their own. */
export async function onboard(
  db: Database,
  userId: string,
  input: {
    name: string;
    month: string;
    timezone: string;
    emailEnabled?: boolean;
  },
  observe?: RevisionObserver,
): Promise<OperationResult> {
  try {
    const book = execute(
      withCounterpartyAccounts(createBook(userId, input.name, input.month)),
      userId,
      {
        type: "settings.update",
        id: randomUUID(),
        timezone: input.timezone,
        emailEnabled: input.emailEnabled ?? true,
      },
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
  await limitInviteChecks(db, userId);
  return join(db, userId, () => readPartnerInvite(db, userId, code), observe);
}

/** Accepts an invitation by email: signing it joins the sender's household. */
export function joinByInvitation(
  db: Database,
  userId: string,
  id: string,
  observe?: RevisionObserver,
): Promise<OperationResult> {
  return join(db, userId, () => readInvitationToJoin(db, userId, id), observe);
}

/**
 * Creates a newcomer's budget and accepts their invitation with it, since
 * joining needs a budget to merge. An invitation that can't be accepted
 * leaves no budget behind; a budget made before a join that failed is used
 * when they try again.
 */
export async function onboardByInvitation(
  db: Database,
  userId: string,
  input: Parameters<typeof onboard>[2],
  invitation: string,
  observe?: RevisionObserver,
): Promise<OperationResult> {
  await readInvitationToJoin(db, userId, invitation);
  if (
    !(await db.workspaceMember.findUnique({ where: { clerkUserId: userId } }))
  )
    await onboard(db, userId, input);
  return joinByInvitation(db, userId, invitation, observe);
}

async function join(
  db: Database,
  userId: string,
  read: () => Promise<{ id: string; workspaceId: string; createdBy: string }>,
  observe?: RevisionObserver,
): Promise<OperationResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const invite = await read();
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
            where: { id: invite.id, usedBy: null, cancelledAt: null },
            data: { usedBy: userId, usedAt: new Date() },
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

export async function setOnboardingCategories(
  db: Database,
  actorId: string,
  input: {
    operationId: string;
    expectedRevision: number;
    categories: Extract<Command, { type: "category.import" }>["categories"];
  },
  observe?: RevisionObserver,
) {
  const opened = await requireHousehold(db, actorId, observe);
  const saved = await findOperation(
    db,
    opened.household.workspaceId,
    input.operationId,
  );
  if (saved) return earlierResult(saved, actorId, input, input);
  if (opened.ledger.personal) throw budgetMaintenance();
  if (opened.requestRevision !== input.expectedRevision)
    throw refusal(
      "conflict",
      "Your budget changed. Refresh before saving categories.",
      opened.household.revision,
    );
  const original = opened.ledger.state as Book;
  const book = execute(original, actorId, {
    type: "category.import",
    id: input.operationId,
    categories: input.categories,
  });
  const selected = new Set(
    input.categories.map((category) => category.categoryId),
  );
  const budget = book.budgets[actorId]!;
  budget.categories = budget.categories.filter(
    (category) =>
      !category.id.startsWith("setup:") || selected.has(category.id),
  );
  if (budgetReferenceIssues(budget).length)
    throw refusal(
      "rejected",
      "A category you removed is already used by your budget. Keep it selected, or manage it from the plan.",
    );
  const written = await writeServerOperation(db, opened, {
    actorId,
    operationId: input.operationId,
    type: "budget.setupCategories",
    source: "user",
    submitted: input,
    changeSet: {
      operationId: input.operationId,
      revision: 0,
      ...diffRows(bookToRows(original), bookToRows(book)),
    },
  });
  observe?.(written.revision);
  return written;
}
