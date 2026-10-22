import { z } from "zod";

import { type BankAccount } from "~/server/integrations/plaid";
import { type StoredImport } from "~/server/integrations/transactions";
import {
  centsSchema,
  dateSchema,
  usdToCents,
} from "~/server/integrations/validation";
import { commandHash } from "./safety";

export const bankMappingsSchema = z.record(
  z.object({
    accountId: z.string(),
    startDate: dateSchema,
    openingSnapshot: z
      .object({
        postedImportIds: z.array(z.string()).max(50_000),
        fingerprints: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
        financialFingerprints: z
          .record(z.string().regex(/^[a-f0-9]{64}$/))
          .optional(),
        reviewImportIds: z.array(z.string()).max(50_000).optional(),
      })
      .optional(),
  }),
);
export type BankMapping = z.infer<typeof bankMappingsSchema>[string];

export const setupBankAccountsSchema = z.object({
  connectionId: z.string().min(1).max(256),
  operationId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  accounts: z
    .array(
      z.object({
        providerAccountId: z.string().min(1).max(256),
        name: z.string().trim().min(1).max(120),
        expectedBalance: z.number().finite().nullable(),
        existingAccountId: z.string().min(1).max(256).optional(),
        startDate: dateSchema.optional(),
        loan: z
          .object({
            principal: centsSchema.nonnegative(),
            annualRateBps: z.number().int().min(0).max(100000),
            minimumPayment: centsSchema.positive(),
            variable: z.boolean(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(100),
});
export type SetupBankAccountsInput = z.infer<typeof setupBankAccountsSchema>;

export function bankAccountOpening(account: BankAccount): {
  kind: "cash" | "credit";
  openingBalance: number;
} {
  const kind =
    account.type === "depository"
      ? "cash"
      : account.type === "credit" && account.subtype === "credit card"
        ? "credit"
        : null;
  if (!kind)
    throw new Error("Only cash accounts and credit cards can be added here.");
  if (account.currency !== "USD")
    throw new Error("Only bank accounts in USD are supported.");
  if (account.currentBalance === null)
    throw new Error(
      "Update this bank account to get its current balance first.",
    );
  const balance = usdToCents(account.currentBalance);
  const openingBalance = kind === "credit" ? -balance : balance;
  if (kind === "credit" && openingBalance > 0)
    throw new Error(
      "This credit card has a positive balance. Setting up overpaid credit cards is not supported yet.",
    );
  return { kind, openingBalance: openingBalance === 0 ? 0 : openingBalance };
}

export const bankImportFingerprint = (record: StoredImport) =>
  commandHash({
    current: record.current,
    removed: record.removed,
    matchStatus: record.matchStatus,
  });

function bankImportFinancialFingerprint(record: StoredImport) {
  const fact = record.current;
  return commandHash({
    providerTransactionId: fact.providerTransactionId,
    providerAccountId: fact.providerAccountId,
    amountCents: fact.amountCents,
    currency: fact.currency,
    date: fact.date,
    pending: fact.pending,
    removed: record.removed,
    matchStatus: record.matchStatus,
  });
}

function unchangedOpeningActivity(mapping: BankMapping, record: StoredImport) {
  const snapshot = mapping.openingSnapshot!;
  if (snapshot.fingerprints[record.id] === bankImportFingerprint(record))
    return true;
  const saved = snapshot.financialFingerprints?.[record.id];
  if (saved) return saved === bankImportFinancialFingerprint(record);
  for (const entry of record.history) {
    if (!entry.after) continue;
    for (const matchStatus of ["confirmed", "needs_review"] as const) {
      const original = {
        ...record,
        current: entry.after,
        removed: false,
        matchStatus,
      };
      if (snapshot.fingerprints[record.id] === bankImportFingerprint(original))
        return (
          bankImportFinancialFingerprint(original) ===
          bankImportFinancialFingerprint(record)
        );
    }
  }
  return false;
}

export const openingSnapshotChangedMessage =
  "This activity may already be included in this account's opening balance. Investigate the bank's changes or uncertain matches before recording an adjustment; importing it could count it twice.";

export function bankImportEligibility(
  mapping: BankMapping | undefined,
  record: StoredImport,
):
  | "eligible"
  | "before_start"
  | "opening_snapshot"
  | "opening_snapshot_changed" {
  if (!mapping) return "eligible";
  if (mapping.openingSnapshot?.reviewImportIds?.includes(record.id))
    return "opening_snapshot_changed";
  if (mapping.openingSnapshot?.postedImportIds.includes(record.id))
    return unchangedOpeningActivity(mapping, record)
      ? "opening_snapshot"
      : "opening_snapshot_changed";
  return record.current.date < mapping.startDate ? "before_start" : "eligible";
}

export function openingSnapshot(
  records: readonly StoredImport[],
  providerAccountId: string,
  reviews: Readonly<Record<string, readonly unknown[]>> = {},
): NonNullable<BankMapping["openingSnapshot"]> {
  const posted = records.filter(
    (record) =>
      record.current.providerAccountId === providerAccountId &&
      !record.current.pending &&
      !record.removed,
  );
  const postedIds = new Set(posted.map((record) => record.id));
  const pending = records.filter(
    (record) =>
      record.current.providerAccountId === providerAccountId &&
      record.current.pending &&
      !record.removed,
  );
  const pendingIds = new Set(pending.map((record) => record.id));
  const reviewIds = new Set(
    pending
      .filter((record) => record.matchStatus === "needs_review")
      .map((record) => record.id),
  );
  const reviewSchema = z.object({
    kind: z.enum(["possible_pending_match", "conflicting_identity"]),
    logicalTransactionId: z.string(),
    candidateIds: z.array(z.string()),
  });
  for (const saved of Object.values(reviews).flat()) {
    const result = reviewSchema.safeParse(saved);
    if (!result.success) continue;
    const review = result.data;
    if (
      !postedIds.has(review.logicalTransactionId) &&
      review.kind !== "conflicting_identity"
    )
      continue;
    for (const id of [review.logicalTransactionId, ...review.candidateIds])
      if (pendingIds.has(id)) reviewIds.add(id);
  }
  return {
    postedImportIds: posted.map((record) => record.id),
    fingerprints: Object.fromEntries(
      posted.map((record) => [record.id, bankImportFingerprint(record)]),
    ),
    financialFingerprints: Object.fromEntries(
      posted.map((record) => [
        record.id,
        bankImportFinancialFingerprint(record),
      ]),
    ),
    reviewImportIds: [...reviewIds],
  };
}

export function bankSetupDate(zone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${parts.find((p) => p.type === "day")!.value}`;
}
