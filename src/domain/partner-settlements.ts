import { z } from "zod";
import type { Budget, Transaction } from "./engine";
import { isPartnerLedger } from "./partner-ledger";

// Settling up between partners (shared costs phase 4): money one partner
// sends the other, and what one partner asks the other to pay.
//
// Settlement contract
//
// - A settlement is one payment from one partner to the other: a Venmo,
//   Zelle, or bank transfer, or a payment into the other partner's credit
//   card. It has two legs, one in each partner's budget, and it never
//   exists with only one of them.
// - A `partnerSettlement` row is household data, so both partners' browsers
//   hold it. It carries only ledger facts: who paid, the payment date, the
//   amount, how it was sent (`method`), whether either partner confirmed
//   it, and the history of those facts. No account, bank, or category of
//   either budget is ever copied into it.
// - A leg is an ordinary transaction in that partner's own budget, private
//   to them: kind "reimbursement", `linkedCounterpartyAccountId` naming
//   their Partner account, and `partnerSettlementId` naming the
//   settlement. The payer's leg is an outflow from a cash account; the
//   recipient's is an inflow into a cash account or a credit card. A leg is
//   reviewed when it is recorded: its settlement's `confirmed` says whether
//   it still needs review, so one confirmation, by either partner, resolves
//   both sides.
// - Accounting is each leg's own (src/domain/engine.ts replay): a leg moves
//   its owner's Partner account by -amount and their paired envelope by
//   +amount, never Ready to Assign. A leg into a credit card counts as a
//   repayment received and paid straight into that card. Since both legs
//   are always recorded and removed together, with equal and opposite
//   amounts, both Partner accounts move by the same amount the other way.
// - Legs come from bank imports. When one partner's import of money sent to
//   the other and the other's import of money received match by amount,
//   date, and direction (src/server/services/partner-settlements.ts), the
//   server records the settlement and both legs in one operation, which a
//   partner's browser can't do, and links each import to its leg. The legs
//   can't be edited, removed, or merged through the register.
// - A `partnerRequest` row is household data too: one partner asking the
//   other to pay, with the amount and the day it was asked. The newest
//   request is the open one; older ones stay as they were. What's paid
//   toward it is every settlement from the other partner dated on or after
//   it, and it closes when that reaches the amount. No deadline, no
//   reminders.

export const SETTLEMENT_HISTORY_REASONS = [
  "matched",
  "confirmed",
  "removed",
] as const;

export type PartnerSettlementChange = {
  actorId: string;
  at?: string;
  operationId: string;
  reason: (typeof SETTLEMENT_HISTORY_REASONS)[number];
};

export type PartnerSettlement = {
  id: string;
  payerId: string;
  // The payer's leg date.
  date: string;
  // Positive: what the payer sent.
  amount: number;
  // How it was sent, as the bank named it: "Venmo", "Zelle", "Transfer",
  // or "Card payment".
  method: string;
  confirmed: boolean;
  removed?: boolean;
  history: PartnerSettlementChange[];
};

export type PartnerRequest = {
  id: string;
  requesterId: string;
  date: string;
  // Positive: what the requester asked for.
  amount: number;
};

const identifier = z.string().min(1).max(1024);
const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const positiveCents = z
  .number()
  .int()
  .safe()
  .refine((value) => value > 0, "Amount must be positive");

export const partnerSettlementChangeSchema = z.object({
  actorId: identifier,
  at: z.string().optional(),
  operationId: identifier,
  reason: z.enum(SETTLEMENT_HISTORY_REASONS),
});

export const partnerSettlementSchema = z.object({
  id: identifier,
  payerId: identifier,
  date: day,
  amount: positiveCents,
  method: z.string().min(1).max(120),
  confirmed: z.boolean(),
  removed: z.boolean().optional(),
  history: z.array(partnerSettlementChangeSchema),
});

export const partnerRequestSchema = z.object({
  id: identifier,
  requesterId: identifier,
  date: day,
  amount: positiveCents,
});

/** A leg's transaction id: one per partner per settlement. */
export function settlementLegId(settlementId: string, userId: string): string {
  return [settlementId, userId, "leg"]
    .map((part) => part.replaceAll("%", "%25").replaceAll(":", "%3A"))
    .join(":");
}

/** Whether a transaction is one partner's leg of a settlement. */
export function isSettlementLeg(
  transaction: Pick<Transaction, "partnerSettlementId">,
): boolean {
  return transaction.partnerSettlementId !== undefined;
}

/** A rejected leg stays in review even when the bank updates its identity. */
export function isRejectedSettlementImport(
  budget: Pick<Budget, "transactions">,
  providerIds: readonly string[],
): boolean {
  return budget.transactions.some(
    (transaction) =>
      transaction.removed &&
      isSettlementLeg(transaction) &&
      transaction.providerId !== undefined &&
      providerIds.includes(transaction.providerId),
  );
}

/**
 * Why a budget's settlement legs don't read: a leg must be a repayment
 * linked to the budget's Partner account, or the closed account of the
 * former partner it settled with, out of a cash account, or into a cash
 * account or credit card.
 */
export function settlementLegIssues(
  budget: Pick<Budget, "accounts" | "transactions">,
): string[] {
  return budget.transactions.some((transaction) => {
    if (transaction.removed || !isSettlementLeg(transaction)) return false;
    const account = budget.accounts.find(
      (item) => item.id === transaction.accountId,
    );
    const linked = budget.accounts.find(
      (item) => item.id === transaction.linkedCounterpartyAccountId,
    );
    return (
      !linked ||
      !isPartnerLedger(linked) ||
      transaction.kind !== "reimbursement" ||
      !transaction.amount ||
      transaction.categoryId !== undefined ||
      transaction.lines !== undefined ||
      transaction.counterpartyShare !== undefined ||
      !(
        account?.kind === "cash" ||
        (account?.kind === "credit" && transaction.amount > 0)
      )
    );
  })
    ? ["Invalid partner settlement leg"]
    : [];
}

/** The settlements that count: not removed. */
export function activeSettlements(
  settlements: PartnerSettlement[] | undefined,
): PartnerSettlement[] {
  return (settlements ?? []).filter((settlement) => !settlement.removed);
}

/** Settlements either partner still needs to confirm. */
export function unconfirmedSettlements(
  settlements: PartnerSettlement[] | undefined,
): PartnerSettlement[] {
  return activeSettlements(settlements).filter(
    (settlement) => !settlement.confirmed,
  );
}

export type OpenRequest = PartnerRequest & {
  // Settlements from the other partner since it was asked.
  paid: number;
  left: number;
};

/**
 * The household's newest request, with what's been paid toward it: every
 * settlement from the partner it asked, dated on or after it. Null when
 * nobody has asked.
 */
export function openRequest(
  requests: PartnerRequest[] | undefined,
  settlements: PartnerSettlement[] | undefined,
): OpenRequest | null {
  // Requests are kept in the order they were made.
  const latest = requests?.at(-1);
  if (!latest) return null;
  const paid = activeSettlements(settlements)
    .filter(
      (settlement) =>
        settlement.payerId !== latest.requesterId &&
        settlement.date >= latest.date,
    )
    .reduce((total, settlement) => total + settlement.amount, 0);
  return { ...latest, paid, left: Math.max(0, latest.amount - paid) };
}
