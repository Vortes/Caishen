import type { BankMapping } from "./bank-account-setup";
import { jsonValue } from "./safety";
import { Prisma } from "~/generated/prisma";
import type { BankAccount } from "~/server/integrations/plaid";
import { lockBankConnections } from "./bank-account-rows";

/** Persist the latest reported accounts; omission cannot undo a revocation. */
export async function writeProviderAccounts(
  tx: Prisma.TransactionClient,
  userId: string,
  connectionId: string,
  accounts: BankAccount[],
  readyIds: string[],
  identities: { from: string; to: string }[] = [],
) {
  await lockBankConnections(tx, userId, [connectionId]);
  const previous = await tx.bankAccount.findMany({ where: { connectionId } });
  const reported = new Set(accounts.map((account) => account.accountId));
  await tx.bankAccount.updateMany({
    where: {
      connectionId,
      status: "shared",
      providerAccountId: { notIn: [...reported] },
    },
    data: { status: "unavailable", historyComplete: false },
  });
  for (const account of accounts) {
    const old = previous.find(
      (row) => row.providerAccountId === account.accountId,
    );
    if (old?.status === "retired") continue;
    const { accountId, persistentAccountId, ...details } = account;
    const data = {
      ...details,
      persistentAccountId:
        persistentAccountId ?? old?.persistentAccountId ?? null,
      status: "shared",
      historyComplete: readyIds.includes(accountId),
      lastSeenAt: new Date(),
      balancesAsOf: new Date(),
    };
    await tx.bankAccount.upsert({
      where: {
        connectionId_providerAccountId: {
          connectionId,
          providerAccountId: accountId,
        },
      },
      create: { connectionId, providerAccountId: accountId, ...data },
      update: data,
    });
  }
  for (const identity of identities) {
    if (identity.from === identity.to) continue;
    const successor = await tx.bankAccount.findUniqueOrThrow({
      where: {
        connectionId_providerAccountId: {
          connectionId,
          providerAccountId: identity.to,
        },
      },
    });
    await tx.bankAccount.updateMany({
      where: {
        connectionId,
        providerAccountId: identity.from,
        status: { not: "retired" },
      },
      data: {
        status: "retired",
        historyComplete: false,
        supersededById: successor.id,
      },
    });
  }
}

/** Replace live feeds while keeping ended links as evidence for old imports. */
export async function writeBankLinks(
  tx: Prisma.TransactionClient,
  userId: string,
  workspaceId: string,
  connectionId: string,
  mappings: Record<string, BankMapping>,
) {
  await lockBankConnections(tx, userId, [connectionId]);
  const rows = await tx.bankAccount.findMany({
    where: { connectionId },
    include: { link: true },
  });
  const ended = rows.filter(
    (row) =>
      row.link &&
      !row.link.unlinkedAt &&
      mappings[row.providerAccountId]?.accountId !== row.link.accountId,
  );
  await tx.bankAccountLink.updateMany({
    where: {
      bankAccountId: { in: ended.map((row) => row.id) },
      unlinkedAt: null,
    },
    data: { unlinkedAt: new Date() },
  });
  for (const [providerId, mapping] of Object.entries(mappings)) {
    const row = rows.find((row) => row.providerAccountId === providerId);
    if (!row || row.status === "retired")
      throw new Error("Account setup changed. Refresh your bank accounts.");
    const data = {
      workspaceId,
      userId,
      accountId: mapping.accountId,
      startDate: mapping.startDate,
      openingSnapshot: mapping.openingSnapshot
        ? jsonValue(mapping.openingSnapshot)
        : Prisma.DbNull,
      unlinkedAt: null,
    };
    await tx.bankAccountLink.upsert({
      where: { bankAccountId: row.id },
      create: { bankAccountId: row.id, ...data },
      update: data,
    });
  }
  for (const row of ended) {
    const successorId = Object.entries(mappings).find(
      ([, mapping]) => mapping.accountId === row.link!.accountId,
    )?.[0];
    const successor = rows.find(
      (candidate) => candidate.providerAccountId === successorId,
    );
    if (successor && successor.id !== row.id)
      await tx.bankAccount.update({
        where: { id: row.id },
        data: {
          status: "retired",
          historyComplete: false,
          supersededById: successor.id,
        },
      });
  }
}
