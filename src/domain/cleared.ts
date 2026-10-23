import type { Transaction } from "./engine";

type Status = Pick<Transaction, "cleared" | "reconciled" | "status">;

// Whether a transaction has cleared the bank, YNAB's green C. Reconciled
// ones always have, and rows saved before the flag existed have once posted.
export function isCleared(transaction: Status): boolean {
  return (
    Boolean(transaction.reconciled) ||
    (transaction.cleared ?? transaction.status === "posted")
  );
}

// Still pending at the bank, unless the user has cleared it, as clicking
// YNAB's clock does. A pending inflow stays out of balances until then.
export function isPending(transaction: Status): boolean {
  return transaction.status === "pending" && !isCleared(transaction);
}
