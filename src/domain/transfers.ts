import type { Account, Budget, Transaction } from "./engine";

export function isTransfer(transaction: Pick<Transaction, "kind">) {
  return transaction.kind === "transfer" || transaction.kind === "card-payment";
}

export function transferCounterparts(
  budget: Pick<Budget, "transactions">,
  transaction: Transaction,
) {
  if (!isTransfer(transaction) || !transaction.linkedId) return [];
  return budget.transactions.filter(
    (item) =>
      !item.removed &&
      item.id !== transaction.id &&
      isTransfer(item) &&
      item.linkedId === transaction.linkedId,
  );
}

export function transferPayee(
  account: Account,
  other: Account,
  amount: number,
) {
  const sending = amount < 0 ? account : other;
  const receiving = amount < 0 ? other : account;
  const payment = sending.kind === "cash" && receiving.kind === "credit";
  return `${payment ? "Payment" : "Transfer"} ${amount < 0 ? "to" : "from"} ${other.name}`;
}

export function registerPayee(budget: Budget, transaction: Transaction) {
  const counterpart = transferCounterparts(budget, transaction)[0];
  const account = budget.accounts.find(
    (item) => item.id === transaction.accountId,
  );
  const other = budget.accounts.find(
    (item) => item.id === counterpart?.accountId,
  );
  if (account && other)
    return transferPayee(account, other, transaction.amount);
  if (transaction.kind === "loan-payment") {
    const loan = budget.loans.find((item) =>
      item.payments.some((payment) => payment.id === transaction.linkedId),
    );
    if (loan) return `Payment to ${loan.name}`;
  }
  return transaction.payee;
}

export const READY_TO_ASSIGN = "__ready_to_assign__";

export function transferNeedsCategory(account: Account, other: Account) {
  return (account.kind === "tracking") !== (other.kind === "tracking");
}
