import { TRPCError } from "@trpc/server";
import type { Command } from "~/domain/engine";
import { findOperation, recentOperations } from "~/server/storage/rows";
import type { Household } from "~/server/storage/households";
import {
  earlierResult,
  executeCommand,
  refusal,
  requireHousehold,
  type Database,
  type OperationResult,
  type RevisionObserver,
} from "./household";

// Undo and redo for the legacy budget screen, which keeps them on the
// server (ADR 0006 moves undo into the browser; this keeps the old screen
// working until it does). The stacks are read from the household's recent
// operations: the member's own unbroken run of changes since anyone or
// anything else last changed the household. Undo reverts the latest change
// still standing; redo reverts that undo.

const HISTORY_LIMIT = 50;

type HistoryDirection = "undo" | "redo";

const commandLabels = {
  "account.add": "Add account",
  "account.reconcile": "Reconcile account",
  "group.add": "Add category group",
  "category.add": "Add category",
  "category.import": "Import categories",
  assign: "Assign money",
  "assign.set": "Assign money",
  "assign.batch": "Assign money",
  cover: "Cover overspending",
  "target.set": "Update category target",
  "target.snooze": "Snooze category target",
  "transaction.upsert": "Save transaction",
  "transaction.save": "Save transaction",
  "transaction.remove": "Delete transaction",
  "transaction.approve": "Approve transactions",
  "transaction.reject": "Reject transactions",
  "transaction.categorize": "Categorize transaction",
  "transaction.categorize.batch": "Categorize transactions",
  "transaction.merge": "Merge transactions",
  "shared.create": "Share category",
  "shared.rule": "Update shared category",
  "shared.remove": "Unshare category",
  "opening.add": "Add opening shared balance",
  "settlement.record": "Record settlement",
  "settlement.receive": "Receive settlement",
  "reimbursement.expect": "Add reimbursement",
  "reimbursement.receive": "Receive reimbursement",
  "card.payment": "Record card payment",
  "card.credit": "Record statement credit",
  "loan.add": "Add loan",
  "loan.rate": "Update loan rate",
  "loan.payment": "Record loan payment",
  "income.expect": "Update expected income",
  "settings.update": "Update budget settings",
} satisfies Record<Command["type"], string>;

/** Operations the legacy screen offers to undo, with what it calls them. */
const labels: Record<string, string> = {
  ...commandLabels,
  "suggestions.approve": "Approve suggested categories",
  // Standing rules are gone; operations recorded before still have a name.
  "rule.set": "Update standing rule",
};

type Entry = { operationId: string; label: string };

/** The member's undo and redo stacks, latest last. */
async function historyStacks(
  db: Database,
  household: Pick<Household, "workspaceId">,
  actorId: string,
): Promise<{ undo: Entry[]; redo: Entry[] }> {
  const operations = await recentOperations(
    db,
    household.workspaceId,
    HISTORY_LIMIT * 4,
  );
  // The member's own run of changes, newest first, back to the first
  // operation by anyone or anything else, or one too old to undo.
  const run = [];
  for (const operation of operations) {
    if (operation.type === "budget.counterparties") continue;
    if (
      operation.actorId !== actorId ||
      operation.source !== "user" ||
      operation.changes === null ||
      !(operation.type === "revert" || Object.hasOwn(labels, operation.type))
    )
      break;
    run.push(operation);
  }
  const undo: Entry[] = [];
  let redo: Entry[] = [];
  for (const operation of run.reverse()) {
    if (!operation.changes) continue;
    if (operation.type === "revert") {
      const target = operation.targetOperationId;
      if (undo.at(-1)?.operationId === target) {
        redo.push({
          operationId: operation.operationId,
          label: undo.pop()!.label,
        });
        continue;
      }
      if (redo.at(-1)?.operationId === target) {
        undo.push({
          operationId: operation.operationId,
          label: redo.pop()!.label,
        });
        continue;
      }
    }
    undo.push({
      operationId: operation.operationId,
      label: labels[operation.type] ?? "Undo",
    });
    redo = [];
  }
  return { undo: undo.slice(-HISTORY_LIMIT), redo };
}

/** What undo and redo would change, for the legacy screen's controls. */
export async function historySummary(
  db: Database,
  household: Pick<Household, "workspaceId">,
  actorId: string,
) {
  const stacks = await historyStacks(db, household, actorId);
  return {
    undo: stacks.undo.at(-1)?.label ?? null,
    redo: stacks.redo.at(-1)?.label ?? null,
  };
}

/**
 * Undoes the member's latest change still standing, or redoes the latest
 * undo, as a revert operation with the given id.
 */
export async function changeHistory(
  db: Database,
  actorId: string,
  input: {
    direction: HistoryDirection;
    expectedRevision: number;
    operationId: string;
  },
  observe?: RevisionObserver,
): Promise<OperationResult> {
  const { household, requestRevision } = await requireHousehold(
    db,
    actorId,
    observe,
  );
  const saved = await findOperation(
    db,
    household.workspaceId,
    input.operationId,
  );
  if (saved?.type === "revert") {
    const command = saved.command as { targetOperationId?: unknown } | null;
    const submitted = {
      type: "revert",
      id: input.operationId,
      targetOperationId: command?.targetOperationId,
    };
    return earlierResult(saved, actorId, submitted, submitted);
  }
  if (saved)
    throw refusal(
      "rejected",
      "This operation ID has already been used with different details.",
      saved.revision,
    );
  if (requestRevision !== input.expectedRevision)
    throw refusal(
      "conflict",
      "Your budget changed in another session. Refresh before saving.",
      household.revision,
    );
  const stacks = await historyStacks(db, household, actorId);
  const entry = (input.direction === "undo" ? stacks.undo : stacks.redo).at(-1);
  if (!entry)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        input.direction === "undo"
          ? "There is nothing to undo."
          : "There is nothing to redo.",
    });
  const command = {
    type: "revert" as const,
    id: input.operationId,
    targetOperationId: entry.operationId,
  };
  const result = await executeCommand(
    db,
    actorId,
    { command, submitted: command, baseRevision: household.revision },
    observe,
  );
  return {
    ...result,
    rebased: result.revision !== input.expectedRevision + 1,
  };
}
