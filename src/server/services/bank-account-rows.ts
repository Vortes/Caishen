import { z } from "zod";
import {
  connectionMaintenance,
  reportUnreadable,
  zodIssues,
} from "./stored-data";
import { Prisma, type PrismaClient } from "~/generated/prisma";
import { bankAccountSchema } from "~/server/integrations/plaid";
import { bankMappingsSchema, type BankMapping } from "./bank-account-setup";

export const bankOpeningSnapshotSchema =
  bankMappingsSchema.element.shape.openingSnapshot.unwrap().nullable();

export const bankAccountRowsSelection = {
  include: { link: true },
  orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
} satisfies Prisma.BankConnection$bankAccountsArgs;

const timestamp = z.union([z.date(), z.string().datetime()]);
const balance = z
  .union([
    z.number().finite(),
    z.instanceof(Prisma.Decimal).transform((value) => value.toNumber()),
  ])
  .nullable();

export const bankAccountRowSchema = z
  .object({
    id: z.string().min(1),
    connectionId: z.string().min(1),
    providerAccountId: bankAccountSchema.shape.accountId,
    persistentAccountId: bankAccountSchema.shape.persistentAccountId
      .unwrap()
      .nullable(),
    name: bankAccountSchema.shape.name,
    officialName: bankAccountSchema.shape.officialName,
    mask: bankAccountSchema.shape.mask,
    type: bankAccountSchema.shape.type,
    subtype: bankAccountSchema.shape.subtype,
    currency: bankAccountSchema.shape.currency,
    currentBalance: balance,
    availableBalance: balance,
    balancesAsOf: timestamp.nullable(),
    status: z.enum(["shared", "unavailable", "revoked", "retired"]),
    historyComplete: z.boolean(),
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    supersededById: z.string().nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export const bankAccountLinkRowSchema = z
  .object({
    id: z.string().min(1),
    bankAccountId: z.string().min(1),
    workspaceId: z.string().min(1),
    userId: z.string().min(1),
    accountId: z.string().min(1),
    startDate: bankMappingsSchema.element.shape.startDate,
    openingSnapshot: bankOpeningSnapshotSchema,
    linkedAt: timestamp,
    unlinkedAt: timestamp.nullable(),
  })
  .strict();

const accountWithLinkSchema = bankAccountRowSchema.extend({
  link: bankAccountLinkRowSchema.nullable(),
});

type AccountRow = Prisma.BankAccountGetPayload<{ include: { link: true } }>;

export type BankAccountSuccessor = { ownerId: string; row: AccountRow };
type ConnectionRows = {
  clerkUserId: string;
  bankAccounts?: AccountRow[];
};

/** Load only missing successor rows, in batches, without crossing an owner's budget. */
export async function withBankAccountSuccessors<
  T extends ConnectionRows | ConnectionRows[] | null,
>(db: Pick<PrismaClient, "bankAccount">, query: Promise<T>): Promise<T> {
  const result = await query;
  const connections: ConnectionRows[] =
    result === null ? [] : "clerkUserId" in result ? [result] : result;
  const owners = [
    ...new Set(connections.map((connection) => connection.clerkUserId)),
  ];
  const graph = new Map<string, BankAccountSuccessor>();
  for (const connection of connections)
    for (const row of connection.bankAccounts ?? [])
      graph.set(row.id, { ownerId: connection.clerkUserId, row });
  const attempted = new Set<string>();
  while (true) {
    const missing = [
      ...new Set(
        [...graph.values()].flatMap(({ row }) =>
          row.supersededById &&
          !graph.has(row.supersededById) &&
          !attempted.has(row.supersededById)
            ? [row.supersededById]
            : [],
        ),
      ),
    ];
    if (!missing.length) break;
    missing.forEach((id) => attempted.add(id));
    const successors = await db.bankAccount.findMany({
      where: {
        id: { in: missing },
        connection: { clerkUserId: { in: owners } },
      },
      include: { link: true, connection: { select: { clerkUserId: true } } },
    });
    for (const { connection, ...row } of successors)
      graph.set(row.id, { ownerId: connection.clerkUserId, row });
  }
  for (const connection of connections)
    Object.assign(connection, {
      bankAccountSuccessors: [...graph.values()].filter(
        ({ ownerId }) => ownerId === connection.clerkUserId,
      ),
    });
  return result;
}

// The reader release projects the new rows onto the existing service's
// account view. An empty table still uses the connection's legacy lists.
export function readBankAccountRows(connection: {
  id: string;
  clerkUserId: string;
  bankAccounts?: AccountRow[];
  bankAccountSuccessors?: BankAccountSuccessor[];
}) {
  if (!connection.bankAccounts?.length) return undefined;
  const result = z
    .array(accountWithLinkSchema)
    .superRefine((rows, context) => {
      rows.forEach((row, index) => {
        if (
          row.connectionId !== connection.id ||
          (row.link &&
            (row.link.userId !== connection.clerkUserId ||
              row.link.bankAccountId !== row.id))
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message:
              "The provider account or its link belongs to another owner.",
          });
        }
      });
    })
    .safeParse(connection.bankAccounts);
  if (!result.success) {
    reportUnreadable(
      {
        record: "BankAccount",
        connectionId: connection.id,
        userId: connection.clerkUserId,
      },
      [{ issues: zodIssues(result.error) }],
    );
    throw connectionMaintenance();
  }
  const rows = result.data;
  const accounts = rows
    .filter((row) => row.status !== "retired")
    .map((row) =>
      bankAccountSchema.parse({
        accountId: row.providerAccountId,
        ...(row.persistentAccountId
          ? { persistentAccountId: row.persistentAccountId }
          : {}),
        name: row.name,
        officialName: row.officialName,
        mask: row.mask,
        type: row.type,
        subtype: row.subtype,
        currency: row.currency,
        currentBalance: row.currentBalance,
        availableBalance: row.availableBalance,
      }),
    );
  const mappings: Record<string, BankMapping> = {};
  for (const row of rows) {
    const link = row.link;
    if (!link || link.unlinkedAt) continue;
    mappings[row.providerAccountId] = {
      accountId: link.accountId,
      startDate: link.startDate,
      ...(link.openingSnapshot
        ? { openingSnapshot: link.openingSnapshot }
        : {}),
    };
  }
  const importMappings = { ...mappings };
  const unreadableSuccessor = (accountId: string): never => {
    reportUnreadable(
      {
        record: "BankAccount",
        connectionId: connection.id,
        userId: connection.clerkUserId,
      },
      [
        {
          issues: [
            {
              path: [accountId, "supersededById"],
              code: "custom",
              message: "Missing or cyclic provider account successor.",
            },
          ],
        },
      ],
    );
    throw connectionMaintenance();
  };
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    if (row.status !== "retired") continue;
    let successor = row;
    const visited = new Set<string>();
    while (successor.supersededById) {
      if (visited.has(successor.id)) unreadableSuccessor(row.id);
      visited.add(successor.id);
      let next = byId.get(successor.supersededById);
      if (!next) {
        const external = connection.bankAccountSuccessors?.find(
          (candidate) => candidate.row.id === successor.supersededById,
        );
        const parsed = accountWithLinkSchema.safeParse(external?.row);
        const parsedRow = parsed.success
          ? parsed.data
          : unreadableSuccessor(row.id);
        if (
          external?.ownerId !== connection.clerkUserId ||
          (parsedRow.link &&
            (parsedRow.link.userId !== connection.clerkUserId ||
              parsedRow.link.bankAccountId !== parsedRow.id))
        )
          unreadableSuccessor(row.id);
        next = parsedRow;
        byId.set(next.id, next);
      }
      successor = next;
    }
    const link = successor.link;
    const mapping =
      link && !link.unlinkedAt
        ? {
            accountId: link.accountId,
            startDate: link.startDate,
            ...(link.openingSnapshot
              ? { openingSnapshot: link.openingSnapshot }
              : {}),
          }
        : undefined;
    if (mapping)
      importMappings[row.providerAccountId] = row.link
        ? {
            accountId: mapping.accountId,
            startDate: row.link.startDate,
            ...(row.link.openingSnapshot
              ? { openingSnapshot: row.link.openingSnapshot }
              : {}),
          }
        : mapping;
  }
  return {
    accounts,
    importMappings: bankMappingsSchema.parse(importMappings),
    mappings: bankMappingsSchema.parse(mappings),
    synchronizedAccountIds: rows
      .filter((row) => row.status === "shared" && row.historyComplete)
      .map((row) => row.providerAccountId),
    unavailableAccountIds: rows
      .filter((row) => row.status !== "shared" && row.status !== "retired")
      .map((row) => row.providerAccountId),
  };
}

// Both the legacy writer and the table writer must hold these parent locks
// before changing or copying account data. The writer release must acquire
// them before its first child-row insert, then read the latest legacy lists.
export async function lockBankConnections(
  tx: Prisma.TransactionClient,
  userId: string,
  connectionIds: string[],
) {
  const ids = [...new Set(connectionIds)].sort();
  return tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "BankConnection"
    WHERE "clerkUserId" = ${userId} AND "id" IN (${Prisma.join(ids)})
    ORDER BY "id" FOR UPDATE
  `);
}
