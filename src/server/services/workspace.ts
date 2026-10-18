import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "~/generated/prisma";
import { commandHash, domainError, jsonValue } from "./safety";

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
  source: "user" | "agent" | "provider",
  reduce: (book: Prisma.JsonValue, operations: T[]) => unknown,
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
          for (const op of operations) {
            const saved = previous.find((item) => item.operationId === op.id);
            if (
              saved &&
              (saved.actorId !== actorId ||
                saved.commandHash !== commandHash(op))
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
          const book = reduce(workspace.book, fresh);
          const updated = await tx.workspace.updateMany({
            where: { id: workspace.id, revision: expectedRevision },
            data: { book: jsonValue(book), revision: { increment: 1 } },
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
              commandHash: commandHash(op),
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
