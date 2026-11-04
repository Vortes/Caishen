import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "~/generated/prisma";
import { bookToRows, rowKey, rowsToBook } from "~/domain/rows";
import { commandHash, operationHash } from "~/server/services/safety";
import { invitationToken } from "~/server/services/partner-invites";
import { importStateRows } from "~/server/services/bank-import-rows";
import {
  buildDevelopmentSeedBanks,
  developmentSeedConnectionIds,
} from "./seed-banks";
import {
  forgetOperations,
  loadRows,
  recordPastOperations,
  removeBankImports,
  replaceRows,
  resetHouseholdRows,
} from "~/server/storage/rows";
import {
  buildDevelopmentSeed,
  developmentToday,
  soloSeedScenario,
  type DevelopmentSeedScenario,
} from "./seed-scenarios";
import {
  assertDevelopmentDatabase,
  type EndpointLookup,
} from "./development-database";

export function assertDevelopmentSeedEnvironment(
  env: Record<string, string | undefined>,
  lookup?: EndpointLookup,
) {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production")
    throw new Error("Development seeding is disabled in production.");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const host = new URL(env.DATABASE_URL).hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
    assertDevelopmentDatabase(env, lookup);
  if (
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith("pk_test_")
  )
    throw new Error(
      "Development seeding requires a Clerk development instance.",
    );
  if (env.CLERK_SECRET_KEY && !env.CLERK_SECRET_KEY.startsWith("sk_test_"))
    throw new Error("Development seeding cannot use a live Clerk secret.");
}

export function developmentSeedIdentity(userId: string, partnerId?: string) {
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex").slice(0, 24);
  const partner = partnerId ?? `dev-seed-partner-${hash(userId)}`;
  if (partner === userId) throw new Error("Choose two different participants.");
  return {
    userId,
    partnerId: partner,
    workspaceId: `dev-seed-v1-${hash(JSON.stringify([userId, partner].sort()))}`,
  };
}

export type SeedDatabaseOptions = {
  userId: string;
  partnerId?: string;
  asOf?: string;
  activate?: boolean;
  reset?: boolean;
  scenario?: DevelopmentSeedScenario;
};

export function developmentSeedArchiveId(userId: string) {
  return `dev-seed-archive-${createHash("sha256").update(userId).digest("hex").slice(0, 24)}`;
}

async function seedTransaction<T>(
  db: PrismaClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt >= 2
      )
        throw error;
    }
  }
}

export async function seedDevelopmentDatabase(
  db: PrismaClient,
  options: SeedDatabaseOptions,
) {
  assertDevelopmentSeedEnvironment(process.env);
  const identity = developmentSeedIdentity(options.userId, options.partnerId);
  const asOf = options.asOf ?? developmentToday();
  if (asOf > developmentToday())
    throw new Error("Seed activity cannot be dated in the future.");
  const userIds = [identity.userId, identity.partnerId];
  const connectionIds = developmentSeedConnectionIds(identity.workspaceId);
  return seedTransaction(db, async (tx) => {
    const existing = await tx.workspace.findUnique({
      where: { id: identity.workspaceId },
      include: { members: true },
    });
    const saved = existing
      ? rowsToBook(await loadRows(tx, identity.workspaceId))
      : undefined;
    if (saved) {
      if (
        !saved.budgets[identity.userId] ||
        Object.keys(saved.budgets).some((id) => !userIds.includes(id)) ||
        existing!.members.some(
          (member) => !userIds.includes(member.clerkUserId),
        )
      )
        throw new Error(
          "The demo workspace participants do not match. No data was changed.",
        );
    }
    const savedScenario = saved
      ? Object.keys(saved.budgets).length === 2
        ? Object.values(saved.budgets).some((budget) =>
            budget.transactions.some((transaction) =>
              transaction.id.startsWith("simple-"),
            ),
          )
          ? "simple"
          : "household"
        : (await tx.partnerInvite.count({
              where: {
                workspaceId: identity.workspaceId,
                createdBy: identity.userId,
                usedBy: null,
                cancelledAt: null,
              },
            })) > 0
          ? "invitation"
          : "former-partner"
      : undefined;
    if (
      savedScenario &&
      options.scenario &&
      savedScenario !== options.scenario &&
      !options.reset
    )
      throw new Error("Use --reset to change the demo scenario.");
    const scenario = options.scenario ?? savedScenario ?? "household";
    if (
      soloSeedScenario(scenario) &&
      identity.partnerId !== developmentSeedIdentity(identity.userId).partnerId
    )
      throw new Error(
        "Solo scenarios use a mock former partner. Omit --partner.",
      );
    const seed = buildDevelopmentSeed({
      ...identity,
      asOf,
      scenario,
    });
    const memberIds = Object.keys(seed.book.budgets);
    const invitationId = `${identity.workspaceId}:invitation`;
    const invitationPath =
      seed.scenario === "invitation"
        ? `/invite/${invitationToken(invitationId)}`
        : null;
    const memberships = await tx.workspaceMember.findMany({
      where: { clerkUserId: { in: userIds } },
    });
    const previousWorkspaces = memberships
      .filter((member) => member.workspaceId !== identity.workspaceId)
      .map((member) => ({
        userId: member.clerkUserId,
        workspaceId: member.workspaceId,
      }));
    if (previousWorkspaces.length && !options.activate)
      throw new Error(
        "An account already has a budget. Use --activate to switch to the demo workspace while retaining the original workspace.",
      );
    const realConnections = await tx.bankConnection.count({
      where: { clerkUserId: { in: userIds }, id: { notIn: connectionIds } },
    });
    if (realConnections && !options.activate)
      throw new Error(
        "Use --activate to retain existing bank data in an inactive archive while testing the demo workspace.",
      );
    for (const userId of userIds) {
      const user = await tx.user.findUnique({
        where: { clerkUserId: userId },
      });
      if (user && !user.active)
        throw new Error("Inactive accounts cannot be seeded.");
      if (!user && !userId.startsWith("dev-seed-"))
        throw new Error(
          "Sign in to the development app once before seeding this Clerk account.",
        );
      if (!user)
        await tx.user.create({
          data: {
            clerkUserId: userId,
            firstName:
              userId === identity.userId ? "Alex (demo)" : "Jordan (demo)",
          },
        });
    }
    if (options.activate) {
      for (const clerkUserId of userIds) {
        const connections = await tx.bankConnection.count({
          where: { clerkUserId, id: { notIn: connectionIds } },
        });
        const previousWorkspace = previousWorkspaces.some(
          (member) => member.userId === clerkUserId,
        );
        const evidence = previousWorkspace
          ? await tx.reviewEvidence.count({
              where: {
                clerkUserId,
                NOT: {
                  id: { startsWith: `${identity.workspaceId}:statement:` },
                },
              },
            })
          : 0;
        if (!connections && !evidence) continue;
        const archiveId = developmentSeedArchiveId(clerkUserId);
        const archive = await tx.user.upsert({
          where: { clerkUserId: archiveId },
          create: {
            clerkUserId: archiveId,
            firstName: "Archived development data",
            active: false,
          },
          update: {},
        });
        if (archive.active)
          throw new Error("The development archive must be inactive.");
        await tx.bankConnection.updateMany({
          where: { clerkUserId, id: { notIn: connectionIds } },
          data: { clerkUserId: archiveId },
        });
        if (previousWorkspace)
          await tx.reviewEvidence.updateMany({
            where: {
              clerkUserId,
              NOT: {
                id: { startsWith: `${identity.workspaceId}:statement:` },
              },
            },
            data: { clerkUserId: archiveId },
          });
      }
    }
    if (existing && saved && !options.reset) {
      const latestDate =
        Object.values(saved.budgets)
          .flatMap((budget) =>
            budget.transactions.map((transaction) => transaction.date),
          )
          .sort()
          .at(-1) ?? asOf;
      for (const clerkUserId of memberIds)
        await tx.workspaceMember.upsert({
          where: { clerkUserId },
          create: { clerkUserId, workspaceId: identity.workspaceId },
          update: { workspaceId: identity.workspaceId },
        });
      return {
        ...identity,
        revision: existing.revision,
        skipped: true,
        previousWorkspaces,
        invitationPath,
        seed: {
          ...seed,
          book: saved,
          firstMonth: saved.budgets[identity.userId]!.startMonth,
          month: latestDate.slice(0, 7),
          asOf: latestDate,
        },
      };
    }
    const banks =
      seed.scenario === "simple"
        ? []
        : buildDevelopmentSeedBanks(seed, identity.workspaceId);
    const rows = [
      ...bookToRows(seed.book),
      ...banks.flatMap(({ data, imports }) =>
        importStateRows(data.clerkUserId, data.id, imports),
      ),
    ];
    let revision: number;
    if (existing)
      // Browsers holding the old demo download it again.
      revision = await resetHouseholdRows(tx, identity.workspaceId, rows);
    else {
      revision = 1;
      await tx.workspace.create({
        data: { id: identity.workspaceId, revision, resetRevision: revision },
      });
      await replaceRows(tx, identity.workspaceId, rows, revision);
    }
    await tx.workspaceMember.deleteMany({
      where: {
        workspaceId: identity.workspaceId,
        clerkUserId: { notIn: memberIds },
      },
    });
    for (const clerkUserId of memberIds)
      await tx.workspaceMember.upsert({
        where: { clerkUserId },
        create: { clerkUserId, workspaceId: identity.workspaceId },
        update: { workspaceId: identity.workspaceId },
      });
    await forgetOperations(tx, identity.workspaceId);
    await tx.partnerInvite.deleteMany({
      where: { workspaceId: identity.workspaceId },
    });
    if (invitationPath)
      await tx.partnerInvite.create({
        data: {
          id: invitationId,
          tokenHash: commandHash(invitationToken(invitationId)),
          workspaceId: identity.workspaceId,
          createdBy: identity.userId,
          expiresAt: new Date(Date.now() + 7 * 86400000),
          email: "partner@example.test",
          senderName: "Alex",
          washi: "vermilion",
          signature: [
            {
              points: [
                { x: 30, y: 80, t: 0 },
                { x: 52, y: 24, t: 50 },
                { x: 74, y: 80, t: 100 },
                { x: 45, y: 61, t: 150 },
                { x: 93, y: 60, t: 200 },
              ],
            },
          ],
          emails: 0,
        },
      });
    await recordPastOperations(
      tx,
      identity.workspaceId,
      seed.operations.map(({ actorId, source, command }) => ({
        operationId: command.id,
        actorId,
        type: command.type,
        source,
        inputHash: operationHash(command),
        revision,
      })),
    );
    await tx.bankConnection.deleteMany({
      where: { id: { in: connectionIds } },
    });
    for (const bank of banks)
      await tx.bankConnection.create({ data: bank.data });
    await tx.reviewEvidence.deleteMany({
      where: { id: { startsWith: `${identity.workspaceId}:statement:` } },
    });
    return {
      ...identity,
      revision,
      skipped: false,
      previousWorkspaces,
      invitationPath,
      seed,
    };
  });
}

export async function restoreDevelopmentWorkspace(
  db: PrismaClient,
  userId: string,
  workspaceId: string,
  partnerId?: string,
) {
  assertDevelopmentSeedEnvironment(process.env);
  const identity = developmentSeedIdentity(userId, partnerId);
  return seedTransaction(db, async (tx) => {
    const [member, original] = await Promise.all([
      tx.workspaceMember.findUnique({ where: { clerkUserId: userId } }),
      tx.workspace.findUnique({ where: { id: workspaceId } }),
    ]);
    if (
      member?.workspaceId !== identity.workspaceId ||
      !original ||
      workspaceId === identity.workspaceId ||
      workspaceId.startsWith("dev-seed-")
    )
      throw new Error(
        "Restore requires the active demo workspace and an original budget owned by this account.",
      );
    if (
      !(await loadRows(tx, workspaceId)).some(
        (row) => row.table === "member" && row.id === rowKey(userId),
      )
    )
      throw new Error(
        "The original workspace does not contain this account’s budget.",
      );
    await tx.workspaceMember.update({
      where: { clerkUserId: userId },
      data: { workspaceId },
    });
    await tx.partnerInvite.deleteMany({
      where: { workspaceId: identity.workspaceId, createdBy: userId },
    });
    const demoConnections = await tx.bankConnection.findMany({
      where: {
        id: { in: developmentSeedConnectionIds(identity.workspaceId) },
        clerkUserId: userId,
      },
      select: { id: true },
    });
    const demoConnectionIds = demoConnections.map(
      (connection) => connection.id,
    );
    await removeBankImports(tx, demoConnectionIds, userId);
    await tx.bankConnection.deleteMany({
      where: {
        id: {
          in: demoConnectionIds,
        },
        clerkUserId: userId,
      },
    });
    await tx.reviewEvidence.deleteMany({
      where: {
        id: {
          in: [0, 1, 2, 3, 4, 5].map(
            (index) => `${identity.workspaceId}:statement:${index}`,
          ),
        },
        clerkUserId: userId,
      },
    });
    const archiveId = developmentSeedArchiveId(userId);
    await tx.bankConnection.updateMany({
      where: { clerkUserId: archiveId },
      data: { clerkUserId: userId },
    });
    await tx.reviewEvidence.updateMany({
      where: { clerkUserId: archiveId },
      data: { clerkUserId: userId },
    });
    await tx.user.deleteMany({
      where: {
        clerkUserId: archiveId,
        active: false,
        bankConnections: { none: {} },
        evidence: { none: {} },
      },
    });
    return { userId, workspaceId };
  });
}
