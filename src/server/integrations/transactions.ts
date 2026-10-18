import { z } from "zod";

import {
  centsSchema,
  dateSchema,
  providerIdSchema,
  usdToCents,
} from "./validation";

export const plaidTransactionSchema = z.object({
  transaction_id: providerIdSchema,
  account_id: providerIdSchema,
  pending_transaction_id: providerIdSchema.nullish(),
  pending: z.boolean(),
  amount: z.number().finite(),
  iso_currency_code: z.literal("USD"),
  unofficial_currency_code: z.string().nullish(),
  date: dateSchema,
  authorized_date: dateSchema.nullish(),
  name: z.string().min(1).max(500),
  merchant_name: z.string().max(500).nullish(),
});

export interface ImportedTransaction {
  provider: "plaid";
  providerTransactionId: string;
  providerAccountId: string;
  pendingTransactionId: string | null;
  /** Plaid convention: positive is an outflow; negative is an inflow. */
  amountCents: number;
  currency: "USD";
  date: string;
  authorizedDate: string | null;
  name: string;
  merchantName: string | null;
  pending: boolean;
}

export function normalizePlaidTransaction(input: unknown): ImportedTransaction {
  const value = plaidTransactionSchema.parse(input);
  if (value.unofficial_currency_code)
    throw new Error("Only USD transactions are supported.");
  if (value.pending_transaction_id === value.transaction_id)
    throw new Error("A transaction cannot replace itself.");
  return {
    provider: "plaid",
    providerTransactionId: value.transaction_id,
    providerAccountId: value.account_id,
    pendingTransactionId: value.pending_transaction_id ?? null,
    amountCents: usdToCents(value.amount),
    currency: "USD",
    date: value.date,
    authorizedDate: value.authorized_date ?? null,
    name: value.name,
    merchantName: value.merchant_name ?? null,
    pending: value.pending,
  };
}

export interface ImportHistoryEntry {
  kind: "added" | "modified" | "pending_posted" | "removed" | "restored";
  before: ImportedTransaction | null;
  after: ImportedTransaction | null;
}

export interface StoredImport {
  id: string;
  namespace: string;
  providerTransactionIds: string[];
  current: ImportedTransaction;
  categoryId: string | null;
  removed: boolean;
  matchStatus: "confirmed" | "needs_review";
  history: ImportHistoryEntry[];
}

export const importedTransactionSchema: z.ZodType<ImportedTransaction> = z
  .object({
    provider: z.literal("plaid"),
    providerTransactionId: providerIdSchema,
    providerAccountId: providerIdSchema,
    pendingTransactionId: providerIdSchema.nullable(),
    amountCents: centsSchema,
    currency: z.literal("USD"),
    date: dateSchema,
    authorizedDate: dateSchema.nullable(),
    name: z.string().min(1).max(500),
    merchantName: z.string().max(500).nullable(),
    pending: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.pendingTransactionId !== value.providerTransactionId,
    "A transaction cannot replace itself",
  );

export const storedImportSchema: z.ZodType<StoredImport> = z
  .object({
    id: z.string().min(1).max(2048),
    namespace: providerIdSchema,
    providerTransactionIds: z.array(providerIdSchema).min(1).max(16),
    current: importedTransactionSchema,
    categoryId: z.string().min(1).max(256).nullable(),
    removed: z.boolean(),
    matchStatus: z.enum(["confirmed", "needs_review"]),
    history: z
      .array(
        z
          .object({
            kind: z.enum([
              "added",
              "modified",
              "pending_posted",
              "removed",
              "restored",
            ]),
            before: importedTransactionSchema.nullable(),
            after: importedTransactionSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict()
  .refine(
    (record) =>
      new Set(record.providerTransactionIds).size ===
        record.providerTransactionIds.length &&
      record.providerTransactionIds.includes(
        record.current.providerTransactionId,
      ),
    "Stored provider aliases must be unique and include the current transaction",
  );

export const storedImportsSchema = z.array(storedImportSchema).max(50_000);

export interface TransactionSyncDelta {
  added: ImportedTransaction[];
  modified: ImportedTransaction[];
  removed: { providerTransactionId: string; providerAccountId: string }[];
}

export interface ImportReviewItem {
  key: string;
  kind: "possible_pending_match" | "conflicting_identity";
  logicalTransactionId: string;
  candidateIds: string[];
  message: string;
  incomingTransaction?: ImportedTransaction;
}

export interface ImportChange {
  logicalTransactionId: string;
  before: StoredImport | null;
  after: StoredImport;
}

function sameFact(
  left: ImportedTransaction,
  right: ImportedTransaction,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function merchantKey(value: ImportedTransaction): string {
  return (value.merchantName ?? value.name)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function withinPostingWindow(
  left: ImportedTransaction,
  right: ImportedTransaction,
): boolean {
  const difference = Math.abs(
    Date.parse(`${left.date}T00:00:00Z`) -
      Date.parse(`${right.authorizedDate ?? right.date}T00:00:00Z`),
  );
  return difference <= 7 * 86_400_000;
}

export function applyTransactionSync(
  existing: readonly StoredImport[],
  delta: TransactionSyncDelta,
  namespace: string,
): {
  records: StoredImport[];
  changes: ImportChange[];
  reviewItems: ImportReviewItem[];
} {
  providerIdSchema.parse(namespace);
  const records = structuredClone(existing) as StoredImport[];
  const original = new Map(existing.map((record) => [record.id, record]));
  const reviewItems: ImportReviewItem[] = [];
  const findAlias = (id: string) =>
    records.find(
      (record) =>
        record.namespace === namespace &&
        record.providerTransactionIds.includes(id),
    );
  const imported = [
    ...new Map(
      [...delta.added, ...delta.modified].map((fact) => [
        fact.providerTransactionId,
        fact,
      ]),
    ).values(),
  ];
  const removedIds = new Set(
    delta.removed.map((fact) => fact.providerTransactionId),
  );

  // Pending facts must exist before replacements, even when the provider paginates them in reverse order.
  const facts = imported
    .filter((fact) => fact.pending)
    .concat(imported.filter((fact) => !fact.pending));
  for (const fact of facts) {
    const direct = findAlias(fact.providerTransactionId);
    const pending =
      !fact.pending && fact.pendingTransactionId
        ? findAlias(fact.pendingTransactionId)
        : undefined;
    const identityConflict =
      Boolean(direct && pending && direct.id !== pending.id) ||
      Boolean(
        direct && direct.current.providerAccountId !== fact.providerAccountId,
      ) ||
      Boolean(
        pending && pending.current.providerAccountId !== fact.providerAccountId,
      ) ||
      Boolean(
        pending &&
        !pending.current.pending &&
        pending.current.providerTransactionId !== fact.providerTransactionId,
      );
    if (identityConflict) {
      const conflict = direct ?? pending;
      if (conflict) {
        conflict.matchStatus = "needs_review";
        reviewItems.push({
          key: `identity:${namespace}:${fact.providerTransactionId}`,
          kind: "conflicting_identity",
          logicalTransactionId: conflict.id,
          candidateIds: [direct?.id, pending?.id].filter((id): id is string =>
            Boolean(id),
          ),
          message:
            "Provider identity evidence conflicts with an existing transaction. Review before applying this update.",
          incomingTransaction: fact,
        });
      }
      continue;
    }
    const record = direct ?? pending;
    if (record) {
      // A replay of an obsolete pending alias must not replace its posted successor.
      if (
        direct &&
        record.current.providerTransactionId !== fact.providerTransactionId &&
        fact.pending
      )
        continue;
      if (!record.removed && sameFact(record.current, fact)) continue;
      if (
        record.removed &&
        removedIds.has(fact.providerTransactionId) &&
        sameFact(record.current, fact)
      )
        continue;
      const previous = record.current;
      const kind = record.removed
        ? "restored"
        : pending && previous.pending
          ? "pending_posted"
          : "modified";
      record.history.push({ kind, before: previous, after: fact });
      record.current = fact;
      record.removed = false;
      if (!record.providerTransactionIds.includes(fact.providerTransactionId))
        record.providerTransactionIds.push(fact.providerTransactionId);
      if (
        fact.pendingTransactionId &&
        !record.providerTransactionIds.includes(fact.pendingTransactionId)
      )
        record.providerTransactionIds.push(fact.pendingTransactionId);
      continue;
    }

    const id = `plaid:${encodeURIComponent(namespace)}:${encodeURIComponent(fact.providerTransactionId)}`;
    const candidates =
      !fact.pending && !fact.pendingTransactionId
        ? records.filter(
            (candidate) =>
              candidate.namespace === namespace &&
              candidate.current.pending &&
              candidate.current.providerAccountId === fact.providerAccountId &&
              Math.sign(candidate.current.amountCents) ===
                Math.sign(fact.amountCents) &&
              merchantKey(candidate.current) !== "" &&
              merchantKey(candidate.current) === merchantKey(fact) &&
              withinPostingWindow(candidate.current, fact),
          )
        : [];
    const created: StoredImport = {
      id,
      namespace,
      providerTransactionIds: [
        fact.providerTransactionId,
        ...(fact.pendingTransactionId ? [fact.pendingTransactionId] : []),
      ],
      current: fact,
      categoryId: null,
      removed: false,
      matchStatus: candidates.length ? "needs_review" : "confirmed",
      history: [{ kind: "added", before: null, after: fact }],
    };
    records.push(created);
    if (candidates.length) {
      reviewItems.push({
        key: `pending-match:${namespace}:${fact.providerTransactionId}`,
        kind: "possible_pending_match",
        logicalTransactionId: id,
        candidateIds: candidates.map((candidate) => candidate.id),
        message:
          "Similar merchant and dates may indicate a pending purchase posting. Provider identity evidence is missing; confirm the match.",
      });
    }
  }

  for (const removed of delta.removed) {
    const record = findAlias(removed.providerTransactionId);
    if (
      !record ||
      record.removed ||
      record.current.providerTransactionId !== removed.providerTransactionId
    )
      continue;
    if (record.current.providerAccountId !== removed.providerAccountId) {
      record.matchStatus = "needs_review";
      reviewItems.push({
        key: `identity:${namespace}:${removed.providerTransactionId}`,
        kind: "conflicting_identity",
        logicalTransactionId: record.id,
        candidateIds: [],
        message:
          "The removed provider record belongs to a different account. Review the conflict.",
      });
      continue;
    }
    record.removed = true;
    record.history.push({
      kind: "removed",
      before: record.current,
      after: null,
    });
  }

  const changes = records.flatMap((record): ImportChange[] => {
    const before = original.get(record.id) ?? null;
    return before && JSON.stringify(before) === JSON.stringify(record)
      ? []
      : [{ logicalTransactionId: record.id, before, after: record }];
  });
  return { records, changes, reviewItems };
}

export interface ManualMatchCandidate {
  id: string;
  accountId: string;
  date: string;
  merchant: string;
  amountCents: number;
}

export function findManualMatchCandidates(
  transaction: ImportedTransaction,
  candidates: readonly ManualMatchCandidate[],
): string[] {
  const key = merchantKey(transaction);
  return candidates
    .filter((candidate) => {
      const candidateKey = candidate.merchant
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      const days =
        Math.abs(
          Date.parse(`${candidate.date}T00:00:00Z`) -
            Date.parse(
              `${transaction.authorizedDate ?? transaction.date}T00:00:00Z`,
            ),
        ) / 86_400_000;
      return (
        candidate.accountId === transaction.providerAccountId &&
        key !== "" &&
        candidateKey === key &&
        days <= 7 &&
        Math.sign(candidate.amountCents) === Math.sign(transaction.amountCents)
      );
    })
    .map((candidate) => candidate.id);
}
