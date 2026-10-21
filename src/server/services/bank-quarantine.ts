import { z } from "zod";

import {
  quarantinedTransactionSchema,
  type QuarantinedTransaction,
  type TransactionSyncDelta,
} from "~/server/integrations/transactions";
import { dateSchema } from "~/server/integrations/validation";
import { operationHash } from "./safety";

// Quarantined transactions are kept with the import state's review evidence,
// under their own logical IDs. Releases that predate quarantine read that
// evidence as opaque values, so storing it needs no change to the state's
// shape and older code can still read every connection.
const quarantinePrefix = "plaid-quarantine:";

const quarantineReviewSchema = z.object({
  kind: z.literal("quarantined_transaction"),
  logicalTransactionId: z.string().startsWith(quarantinePrefix),
  candidateIds: z.array(z.string()).max(0),
  message: z.string(),
  transaction: quarantinedTransactionSchema,
  /** The day the update arrived, used when the bank's own date is unreadable. */
  receivedOn: dateSchema,
});
type QuarantineReview = z.infer<typeof quarantineReviewSchema>;

type Reviews = Record<string, unknown[]>;

export function quarantineId(namespace: string, providerTransactionId: string) {
  return `${quarantinePrefix}${encodeURIComponent(namespace)}:${encodeURIComponent(providerTransactionId)}`;
}

export function quarantineFingerprint(transaction: QuarantinedTransaction) {
  return operationHash(transaction);
}

const amountFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
});

export function quarantineMessage(transaction: QuarantinedTransaction): string {
  if (transaction.reason === "unsupported_currency") {
    const amount =
      transaction.amount === null
        ? "transaction"
        : `${amountFormat.format(Math.abs(transaction.amount))} ${transaction.amount < 0 ? "inflow" : "outflow"}`;
    return `Not imported: this ${transaction.currency} ${amount} isn't in US dollars, and budgets use US dollars only. If it affects your budget, record it yourself in dollars, then dismiss it.`;
  }
  return "Not imported: the bank sent this transaction in a form Caishen can't read. Compare it with your bank's records, record it yourself if it affects your budget, then dismiss it.";
}

/**
 * Records this update's quarantined transactions and clears any whose
 * provider record has since arrived in a readable form or been removed.
 */
export function applyQuarantine(
  reviews: Readonly<Reviews>,
  namespace: string,
  delta: TransactionSyncDelta,
  quarantined: readonly QuarantinedTransaction[],
  receivedOn: string,
): Reviews {
  const next = { ...reviews };
  for (const { providerTransactionId } of [
    ...delta.added,
    ...delta.modified,
    ...delta.removed,
  ])
    delete next[quarantineId(namespace, providerTransactionId)];
  for (const transaction of quarantined) {
    const id = quarantineId(namespace, transaction.providerTransactionId);
    const review: QuarantineReview = {
      kind: "quarantined_transaction",
      logicalTransactionId: id,
      candidateIds: [],
      message: quarantineMessage(transaction),
      transaction,
      receivedOn,
    };
    next[id] = [review];
  }
  return next;
}

export function readQuarantine(
  reviews: Readonly<Reviews>,
  logicalId: string,
): QuarantineReview | undefined {
  if (!logicalId.startsWith(quarantinePrefix)) return undefined;
  const result = quarantineReviewSchema.safeParse(reviews[logicalId]?.at(-1));
  return result.success ? result.data : undefined;
}

export function quarantinedTransactions(
  reviews: Readonly<Reviews>,
): QuarantineReview[] {
  return Object.keys(reviews).flatMap((id) => {
    const review = readQuarantine(reviews, id);
    return review ? [review] : [];
  });
}
