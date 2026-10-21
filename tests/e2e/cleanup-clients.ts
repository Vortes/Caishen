import type { createClerkClient } from "@clerk/backend";
import type { Prisma, PrismaClient } from "../../src/generated/prisma/index.js";
import type { CleanupServices } from "./cleanup";

async function ownedWorkspaces(db: Prisma.TransactionClient, userId: string) {
  const workspaces = await db.workspace.findMany({
    where: { members: { some: { clerkUserId: userId } } },
    include: { members: true },
  });
  if (
    workspaces.some((workspace) =>
      workspace.members.some((member) => member.clerkUserId !== userId),
    )
  )
    throw new Error(
      "Refusing to remove an E2E workspace with an unrelated member.",
    );
  return workspaces;
}

export function cleanupServices(
  auth: ReturnType<typeof createClerkClient>,
  db: PrismaClient,
): CleanupServices {
  return {
    findIdentity: async (email) => {
      const users = await auth.users.getUserList({
        emailAddress: [email],
        limit: 2,
      });
      return users.data.map((user) => ({
        id: user.id,
        email:
          user.emailAddresses.find((address) => address.emailAddress === email)
            ?.emailAddress ?? "",
        runId: user.privateMetadata.caishenE2ERun,
      }));
    },
    assertOwnedData: async (userId) => {
      await ownedWorkspaces(db, userId);
    },
    deleteIdentity: async (userId) => {
      await auth.users.deleteUser(userId);
    },
    clearData: async (userId) => {
      // Concurrent test runs share the database, so a serializable cleanup can
      // lose a write conflict; it is idempotent, so it is safe to retry.
      for (let attempt = 1; ; attempt++) {
        try {
          await clearOwnedData(db, userId);
          return;
        } catch (error) {
          if (attempt >= 5 || !isSerializationFailure(error)) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 200));
        }
      }
    },
  };
}

function isSerializationFailure(error: unknown) {
  return (
    error instanceof Error &&
    error.name === "PrismaClientKnownRequestError" &&
    "code" in error &&
    error.code === "P2034"
  );
}

async function clearOwnedData(db: PrismaClient, userId: string) {
  await db.$transaction(
    async (tx) => {
      // Recheck inside the transaction as well as before deleting Clerk.
      const workspaces = await ownedWorkspaces(tx, userId);
      await tx.workspace.deleteMany({
        where: { id: { in: workspaces.map(({ id }) => id) } },
      });
      const where = { clerkUserId: userId };
      await tx.clerkWebhookEvent.deleteMany({ where });
      await tx.bankConnection.deleteMany({ where });
      await tx.reviewEvidence.deleteMany({ where });
      await tx.dailyDelivery.deleteMany({ where });
      await tx.crudItem.deleteMany({ where });
      // Existing webhook synchronization never reactivates a tombstone.
      // Retain only this marker so delayed profile events cannot resurrect it.
      const tombstone = {
        active: false,
        deletedAt: new Date(),
        firstName: null,
        lastName: null,
        imageUrl: null,
        primaryEmail: null,
      };
      await tx.user.upsert({
        where,
        create: { ...where, ...tombstone },
        update: tombstone,
      });
    },
    { isolationLevel: "Serializable", timeout: 30_000 },
  );
}
