import { TRPCError } from "@trpc/server";
import {
  applyChangeSet,
  changeSetVisibleTo,
  changesOnlyBudgetOf,
  executeRevert,
  rowsIn,
  toRowSet,
} from "~/domain/change-sets";
import {
  AccountingError,
  createBook,
  executeWithChanges,
  type Book,
  type CommandSource,
  type LedgerCommand,
} from "~/domain/engine";
import {
  diffRows,
  partnerFactRows,
  rowKeyParts,
  rowOwner,
  rowVisibleTo,
  type ChangeSet,
} from "~/domain/rows";
import type { PersonalLedger } from "~/domain/shared-ledger";
import { prepareUserCommand } from "~/domain/user-command";
import { Prisma, type PrismaClient } from "~/generated/prisma";
import {
  households,
  householdLedger,
  writeOperation,
  type Household,
  type HouseholdLedger,
} from "~/server/storage/households";
import { findOperation, RevisionConflictError } from "~/server/storage/rows";
import { bankMappingsSchema } from "./bank-account-setup";
import { addCounterpartyAccounts } from "./household-operations";
import { matchesSavedOperation, operationHash } from "./safety";
import { refusal } from "./sync-refusal";

export { refusal, SyncRefusal, type SyncErrorKind } from "./sync-refusal";
import { budgetMaintenance, reportUnreadable } from "./stored-data";

// Running operations against a household's rows (ADR 0006): user commands
// with the sync contract's rules (idempotent retries, re-running commands
// that touch only the actor's own budget on a newer revision, undo by
// revert), and the server's own operations.

export type Database = PrismaClient;

/** Where a request reports the household revision it saw. */
export type RevisionObserver = (revision: number) => void;

export type OpenLedger = {
  /** The revision before this request alone added the system accounts. */
  requestRevision: number;
  household: Household;
  ledger: Extract<HouseholdLedger, { status: "ready" }>;
};

/**
 * A member's household and their view of it, or null when they have none.
 * Anything stored that doesn't read raises the stored-data alert.
 */
export async function openHousehold(
  db: Database,
  userId: string,
  observe?: RevisionObserver,
): Promise<{ household: Household; ledger: HouseholdLedger } | null> {
  const household = await households.load(db, userId);
  if (!household) return null;
  observe?.(household.revision);
  const ledger = householdLedger(household, userId);
  if (ledger.failures.length)
    reportUnreadable(
      { record: "rows", workspaceId: household.workspaceId, userId },
      ledger.failures,
    );
  return { household, ledger };
}

/**
 * A member's household for a change: refused when they have none, and
 * while their plan is under maintenance, so unreadable rows are never
 * written over.
 */
export async function requireHousehold(
  db: Database,
  userId: string,
  observe?: RevisionObserver,
): Promise<OpenLedger> {
  const upgrade = await addCounterpartyAccounts(db, userId, observe);
  const opened = await openHousehold(db, userId, observe);
  if (!opened)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Create your personal budget first.",
    });
  if (opened.ledger.status !== "ready") throw budgetMaintenance();
  return {
    household: opened.household,
    ledger: opened.ledger,
    requestRevision:
      upgrade?.revision === opened.household.revision
        ? upgrade.previousRevision
        : opened.household.revision,
  };
}

export type OperationResult = {
  revision: number;
  /** The rows the operation changed that the actor's browser holds. */
  changeSet: ChangeSet | null;
  rebased: boolean;
};

export const PARTNER_MAINTENANCE_MESSAGE =
  "This change also needs your partner’s plan, which is under maintenance. Try again in a few minutes.";

// A household holding only this partner's budget, with the household's
// shared records, to derive what the other partner sees of it.
function partnerView(ledger: PersonalLedger): Book {
  const budgets: Book["budgets"] = { [ledger.budget.userId]: ledger.budget };
  for (const member of ledger.members)
    if (member.userId !== ledger.budget.userId)
      budgets[member.userId] = createBook(
        member.userId,
        member.name,
        ledger.budget.startMonth,
      ).budgets[member.userId]!;
  return {
    version: 1,
    budgets,
    sharedCategories: ledger.sharedCategories,
    obligations: [],
    settlements: ledger.settlements,
    audit: [],
  };
}

/**
 * While the partner's budget doesn't read, a change runs on the actor's
 * personal ledger, which can't update what the partner sees of the actor's
 * budget. Such a change waits until the partner's budget reads again.
 */
function ensurePartnerUnaffected(
  before: PersonalLedger,
  after: PersonalLedger,
) {
  for (const member of before.members) {
    if (member.userId === before.budget.userId) continue;
    const changed = diffRows(
      partnerFactRows(partnerView(before), member.userId),
      partnerFactRows(partnerView(after), member.userId),
    );
    if (changed.after.length)
      throw new AccountingError(PARTNER_MAINTENANCE_MESSAGE);
  }
}

/**
 * An undo can remove an account or transaction a bank connection still
 * names: an account its bank account is linked to, or the transaction a
 * bank import was matched with. Such an undo is refused.
 */
async function ensureBankReferencesKept(
  db: Database,
  household: Household,
  actorId: string,
  changeSet: ChangeSet,
) {
  const removed = (table: "account" | "transaction") =>
    new Set(
      changeSet.after.flatMap((row) =>
        row.table === table && row.deleted && rowOwner(row) === actorId
          ? [rowKeyParts(row.id)[1]!]
          : [],
      ),
    );
  const accounts = removed("account");
  const transactions = removed("transaction");
  if (!accounts.size && !transactions.size) return;
  const linked = (
    await db.bankConnection.findMany({
      where: { clerkUserId: actorId },
      select: { accountMappings: true },
    })
  ).some((connection) =>
    Object.values(
      bankMappingsSchema.safeParse(connection.accountMappings).data ?? {},
    ).some((mapping) => accounts.has(mapping.accountId)),
  );
  const matched = [
    ...(applyChangeSet(household.rows, changeSet).get("bankImport")?.values() ??
      []),
  ].some((row) => {
    if (row.table !== "bankImport" || !row.data) return false;
    const resolved = row.data.resolved as
      { transactionId?: unknown } | undefined;
    return (
      !row.deleted &&
      rowOwner(row) === actorId &&
      typeof resolved?.transactionId === "string" &&
      transactions.has(resolved.transactionId)
    );
  });
  if (linked || matched)
    throw new AccountingError(
      "This can't be undone because a bank connection uses it",
    );
}

/** The change set a command makes, run as the actor on the household. */
async function commandChangeSet(
  db: Database,
  { household, ledger }: OpenLedger,
  actorId: string,
  command: LedgerCommand,
  submitted: unknown,
): Promise<ChangeSet> {
  if (command.type === "revert") {
    const target = await findOperation(
      db,
      household.workspaceId,
      command.targetOperationId,
    );
    if (target?.actorId !== actorId)
      throw new AccountingError("Undo access denied");
    if (!target.changeSet)
      throw new AccountingError("This is too long ago to undo");
    const rows = ledger.personal
      ? toRowSet(
          rowsIn(household.rows).filter((row) => rowVisibleTo(row, actorId)),
        )
      : household.rows;
    const reverted = executeRevert(
      rows,
      command,
      target.changeSet,
      ledger.personal ? actorId : undefined,
    );
    await ensureBankReferencesKept(db, household, actorId, reverted.changeSet);
    if (ledger.personal)
      ensurePartnerUnaffected(
        ledger.state as PersonalLedger,
        reverted.book as PersonalLedger,
      );
    return reverted.changeSet;
  }
  const result = executeWithChanges(
    ledger.state,
    actorId,
    prepareUserCommand(ledger.budget, command),
    "user",
    submitted,
  );
  if (ledger.personal)
    ensurePartnerUnaffected(
      ledger.state as PersonalLedger,
      result.book as PersonalLedger,
    );
  return result.changeSet;
}

/**
 * The answer to an operation id already recorded: its original result
 * when it is a retry of the same operation by the same member.
 */
export function earlierResult(
  saved: NonNullable<Awaited<ReturnType<typeof findOperation>>>,
  actorId: string,
  submitted: unknown,
  validated: unknown,
): OperationResult {
  if (
    saved.actorId !== actorId ||
    !matchesSavedOperation(saved.inputHash, submitted, validated)
  )
    throw refusal(
      "rejected",
      "This operation ID has already been used with different details.",
      saved.revision,
    );
  return {
    revision: saved.revision,
    changeSet: saved.changeSet && changeSetVisibleTo(saved.changeSet, actorId),
    rebased: false,
  };
}

const isDuplicateOperation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

/**
 * Runs a member's command (or undo) under the sync contract. The command
 * was made against `baseRevision`. A retry of a recorded operation answers
 * with its original result. When the household has moved on, the command
 * runs again on the newer rows if it changes only the actor's own budget,
 * and is a conflict otherwise.
 */
export async function executeCommand(
  db: Database,
  actorId: string,
  input: {
    command: LedgerCommand;
    /** The command exactly as submitted, which identifies retries. */
    submitted: unknown;
    baseRevision: number;
  },
  observe?: RevisionObserver,
): Promise<OperationResult> {
  const { command, submitted, baseRevision } = input;
  for (let attempt = 0; ; attempt++) {
    const opened = await requireHousehold(db, actorId, observe);
    const { household } = opened;
    const earlier = async () => {
      const saved = await findOperation(db, household.workspaceId, command.id);
      return saved && earlierResult(saved, actorId, submitted, command);
    };
    // A retry finds the household moved on, by the operation itself.
    const stale = opened.requestRevision !== baseRevision;
    if (stale) {
      const result = await earlier();
      if (result) return result;
    }
    if (baseRevision > opened.requestRevision)
      throw refusal(
        "conflict",
        "Your budget changed. Refresh before saving.",
        household.revision,
      );
    let changeSet: ChangeSet;
    try {
      changeSet = await commandChangeSet(
        db,
        opened,
        actorId,
        command,
        submitted,
      );
    } catch (error) {
      if (!(error instanceof AccountingError) && !isZodError(error))
        throw error;
      throw refusal(
        command.type === "revert" ? "revertRefused" : "rejected",
        error instanceof AccountingError
          ? error.message
          : "Check the entered values.",
        household.revision,
      );
    }
    if (stale && !changesOnlyBudgetOf(changeSet, actorId))
      throw refusal(
        "conflict",
        "Your partner changed this budget at the same time. Review it and try again.",
        household.revision,
      );
    try {
      const written = await writeOperation(db, household, {
        changeSet,
        operation: {
          actorId,
          source: "user",
          type: command.type,
          inputHash: operationHash(submitted),
          command: submitted,
        },
      });
      observe?.(written.revision);
      return {
        revision: written.revision,
        changeSet: changeSetVisibleTo(written.changeSet, actorId),
        rebased: written.revision !== baseRevision + 1,
      };
    } catch (error) {
      if (isDuplicateOperation(error)) {
        const result = await earlier();
        if (result) return result;
      }
      if (!(error instanceof RevisionConflictError) || attempt >= 4)
        throw error;
    }
  }
}

const isZodError = (error: unknown) =>
  error instanceof Error && error.name === "ZodError";

/**
 * Writes one of the server's own operations (bank updates, imports,
 * joining, setup) at the household's next revision. Its change set comes
 * back filtered to the actor's browser.
 */
export async function writeServerOperation(
  db: Database,
  { household }: Pick<OpenLedger, "household">,
  input: {
    actorId: string;
    operationId: string;
    source: CommandSource;
    type: string;
    /** The operation exactly as submitted, which identifies retries. */
    submitted: unknown;
    changeSet: ChangeSet;
    alongside?: (tx: Prisma.TransactionClient) => Promise<void>;
  },
): Promise<OperationResult> {
  const written = await writeOperation(db, household, {
    changeSet: { ...input.changeSet, operationId: input.operationId },
    operation: {
      actorId: input.actorId,
      source: input.source,
      type: input.type,
      inputHash: operationHash(input.submitted),
      command: input.submitted,
    },
    alongside: input.alongside,
  });
  return {
    revision: written.revision,
    changeSet: changeSetVisibleTo(written.changeSet, input.actorId),
    rebased: false,
  };
}
