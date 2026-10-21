import { TRPCError } from "@trpc/server";
import type { CommandSource } from "~/domain/engine";
import { Prisma, type PrismaClient, type Workspace } from "~/generated/prisma";
import type { ZodError } from "zod";
import type { AccountingState } from "~/domain/shared-ledger";
import {
  domainError,
  jsonValue,
  matchesSavedOperation,
  operationHash,
} from "./safety";
import {
  openBudget,
  reportUnreadable,
  zodIssues,
  type OpenBudget,
} from "./stored-data";
import {
  recordWorkspaceHistory,
  restoreWorkspaceHistory,
  workspaceChangeLabel,
  type HistoryDirection,
} from "./workspace-history";

export type Database = PrismaClient;
export type MutationOperation = { id: string; type: string };

export async function readWorkspace(db: Database, actorId: string) {
  return db.workspaceMember.findUnique({
    where: { clerkUserId: actorId },
    include: { workspace: true },
  });
}

export async function mutateWorkspace<T extends MutationOperation>(
  db: Database,
  actorId: string,
  expectedRevision: number,
  operations: T[],
  source: CommandSource,
  reduce: (state: AccountingState, operations: T[]) => AccountingState,
  {
    label,
    submitted = operations,
  }: {
    label?: string;
    /**
     * Each operation as its author submitted it, before validation, when it
     * differs from the operation itself. It identifies retries.
     */
    submitted?: readonly unknown[];
  } = {},
) {
  return commitWorkspaceOperations(
    db,
    actorId,
    expectedRevision,
    operations,
    submitted,
    source,
    (workspace, opened, fresh) => {
      const next = reduce(opened.state, fresh);
      return {
        book: opened.store(next),
        history:
          source === "user"
            ? recordWorkspaceHistory(
                workspace.history,
                actorId,
                workspace.revision,
                opened.state,
                next,
                label ?? workspaceChangeLabel(fresh),
                historyAlert(workspace, actorId),
              )
            : {},
      };
    },
  );
}

export async function changeWorkspaceHistory(
  db: Database,
  actorId: string,
  input: {
    direction: HistoryDirection;
    expectedRevision: number;
    operationId: string;
  },
) {
  return commitWorkspaceOperations(
    db,
    actorId,
    input.expectedRevision,
    [{ id: input.operationId, type: `history.${input.direction}` }],
    [{ id: input.operationId, type: `history.${input.direction}` }],
    "user",
    (workspace, opened) => {
      const { book, history } = restoreWorkspaceHistory(
        workspace.history,
        actorId,
        workspace.revision,
        opened.state,
        input.direction,
        input.operationId,
        historyAlert(workspace, actorId),
      );
      return { book: opened.store(book), history };
    },
  );
}

export function historyAlert(workspace: Pick<Workspace, "id">, userId: string) {
  return (error: ZodError) =>
    reportUnreadable(
      { record: "Workspace.history", workspaceId: workspace.id, userId },
      [{ issues: zodIssues(error) }],
    );
}

async function commitWorkspaceOperations<T extends MutationOperation>(
  db: Database,
  actorId: string,
  expectedRevision: number,
  operations: T[],
  submitted: readonly unknown[],
  source: CommandSource,
  change: (
    workspace: Workspace,
    opened: OpenBudget,
    operations: T[],
  ) => { book: unknown; history: unknown },
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const member = await tx.workspaceMember.findUnique({
            where: { clerkUserId: actorId },
            include: { workspace: true },
          });
          if (!member)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Create your personal budget first.",
            });
          const workspace = member.workspace;
          const previous = await tx.budgetOperation.findMany({
            where: {
              workspaceId: workspace.id,
              operationId: { in: operations.map((op) => op.id) },
            },
          });
          if (submitted.length !== operations.length)
            throw new Error("Each operation needs its submitted input.");
          for (const [index, op] of operations.entries()) {
            const saved = previous.find((item) => item.operationId === op.id);
            if (
              saved &&
              (saved.actorId !== actorId ||
                !matchesSavedOperation(saved.commandHash, submitted[index], op))
            )
              throw new TRPCError({
                code: "CONFLICT",
                message:
                  "This operation ID has already been used with different details.",
              });
          }
          const fresh = operations.filter(
            (op) => !previous.some((item) => item.operationId === op.id),
          );
          if (!fresh.length) return { revision: workspace.revision };
          if (workspace.revision !== expectedRevision)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Your budget changed in another session. Refresh before saving.",
            });
          const { book, history } = change(
            workspace,
            openBudget(workspace, actorId),
            fresh,
          );
          const updated = await tx.workspace.updateMany({
            where: { id: workspace.id, revision: expectedRevision },
            data: {
              book: jsonValue(book),
              history: jsonValue(history),
              revision: { increment: 1 },
            },
          });
          if (updated.count !== 1)
            throw new TRPCError({
              code: "CONFLICT",
              message: "Your budget changed. Refresh before saving.",
            });
          await tx.budgetOperation.createMany({
            data: fresh.map((op) => ({
              workspaceId: workspace.id,
              actorId,
              operationId: op.id,
              type: op.type,
              commandHash: operationHash(submitted[operations.indexOf(op)]),
              source,
              revision: expectedRevision + 1,
            })),
          });
          return { revision: expectedRevision + 1 };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 2
      )
        continue;
      domainError(error);
    }
  }
  throw new TRPCError({
    code: "CONFLICT",
    message: "Your budget changed. Refresh and try again.",
  });
}
