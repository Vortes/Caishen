import { Prisma, type PrismaClient } from "~/generated/prisma";

// Erases what a deleted account leaves: its own household, when it has one
// to itself, and everything kept about it beside the budgets.
export async function removePersonalData(
  db: PrismaClient,
  userId: string,
  household?: { workspaceId: string; revision: number },
) {
  await db.$transaction(
    async (tx) => {
      if (household) {
        const removed = await tx.workspace.deleteMany({
          where: { id: household.workspaceId, revision: household.revision },
        });
        if (removed.count !== 1)
          throw new Error(
            "The household changed during account deletion. Retry cleanup.",
          );
      }
      await tx.partnerInvite.deleteMany({
        where: { OR: [{ createdBy: userId }, { usedBy: userId }] },
      });
      await tx.reviewEvidence.deleteMany({ where: { clerkUserId: userId } });
      await tx.dailyDelivery.deleteMany({ where: { clerkUserId: userId } });
      await tx.bankProviderEvent.deleteMany({ where: { clerkUserId: userId } });
      await tx.bankConnection.deleteMany({ where: { clerkUserId: userId } });
      await tx.crudItem.deleteMany({ where: { clerkUserId: userId } });
      await tx.workspace.deleteMany({
        where: { members: { none: {} }, budgetMembers: { some: { userId } } },
      });
      await tx.user.update({
        where: { clerkUserId: userId },
        data: {
          firstName: null,
          lastName: null,
          primaryEmail: null,
          imageUrl: null,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30_000,
    },
  );
}
