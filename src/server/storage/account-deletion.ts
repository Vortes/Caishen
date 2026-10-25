import { Prisma, type PrismaClient } from "~/generated/prisma";
import type { WireRow } from "~/domain/rows";
import { resetHouseholdRows } from "./rows";

export async function removePersonalData(
  db: PrismaClient,
  userId: string,
  household?: { workspaceId: string; revision: number; rows?: WireRow[] },
) {
  await db.$transaction(
    async (tx) => {
      if (household) {
        const unchanged = await tx.workspace.updateMany({
          where: { id: household.workspaceId, revision: household.revision },
          data: { revision: { increment: 1 } },
        });
        if (unchanged.count !== 1)
          throw new Error(
            "The household changed during account deletion. Retry cleanup.",
          );
        if (household.rows) {
          await resetHouseholdRows(tx, household.workspaceId, household.rows);
          await tx.operation.updateMany({
            where: { workspaceId: household.workspaceId },
            data: { command: Prisma.DbNull, changeSet: Prisma.DbNull },
          });
          await tx.workspaceMember.deleteMany({
            where: { clerkUserId: userId },
          });
        } else
          await tx.workspace.delete({ where: { id: household.workspaceId } });
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
