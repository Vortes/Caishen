import type { Budget } from "~/domain/engine";
import { payeeKey } from "~/domain/payee-memory";
import { transferCounterparts } from "~/domain/transfers";
import { bankImportFingerprint } from "./bank-account-setup";
import type { ImportRowState } from "./bank-import-rows";

const paymentKey = (accountId: string, name: string, amount: number) =>
  JSON.stringify([accountId, payeeKey(name), Math.sign(amount)]);

// Learn from the bank facts attached to linked payments the user established
// or reviewed. Conflicting destinations stay distinct until both banks arrive.
export function rememberedPaymentDestinations(
  budget: Budget,
  imports: Iterable<Pick<ImportRowState, "records" | "resolved">>,
) {
  const transactions = new Map(
    budget.transactions.map((item) => [item.id, item]),
  );
  const destinations = new Map<string, Set<string>>();
  for (const state of imports) {
    for (const record of state.records) {
      const resolved = state.resolved[record.id];
      if (
        record.removed ||
        resolved?.fingerprint !== bankImportFingerprint(record) ||
        !resolved.transactionId
      )
        continue;
      const transaction = transactions.get(resolved.transactionId);
      if (
        !transaction ||
        transaction.removed ||
        transaction.kind !== "card-payment" ||
        !(
          transaction.reviewed ||
          transaction.history.some((entry) => entry.actorId === budget.userId)
        )
      )
        continue;
      const counterparts = transferCounterparts(budget, transaction);
      if (counterparts.length !== 1) continue;
      const key = paymentKey(
        transaction.accountId,
        record.current.name,
        transaction.amount,
      );
      const accounts = destinations.get(key) ?? new Set<string>();
      accounts.add(counterparts[0]!.accountId);
      destinations.set(key, accounts);
    }
  }
  return (accountId: string, name: string, amount: number) => [
    ...(destinations.get(paymentKey(accountId, name, amount)) ?? []),
  ];
}
