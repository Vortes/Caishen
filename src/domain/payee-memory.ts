import type { Changes } from "./changes";
import type { Budget, PayeeMemory, Transaction } from "./engine";
import { READY_TO_ASSIGN } from "./transfers";

// Payee memory, like YNAB's memorized payee category: the user's most recent
// categorization of each payee prefills that payee's new bank imports and
// new entries. It is stored (PayeeMemory rows) rather than derived, because
// "most recent" means the last time the user categorized the payee, which
// transaction history doesn't order.

/**
 * The payee's key in memory: letters and digits only, lowercased, so
 * "Trader Joe’s", "Trader Joe's", and "TRADER JOES" are one payee. Empty
 * when the payee has no letters or digits.
 */
export function payeeKey(payee: string): string {
  return payee
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * The category a payee's memory prefills for a transaction in this account,
 * READY_TO_ASSIGN for Ready to Assign, or undefined when the payee has no
 * memory that fits. Ready to Assign fits only money coming into a cash
 * account, or an entry in one whose amount isn't known yet. A tracking
 * account takes no category.
 */
export function rememberedCategory(
  budget: Budget,
  {
    payee,
    accountId,
    amount,
  }: { payee: string; accountId: string; amount?: number },
): string | undefined {
  const account = budget.accounts.find((item) => item.id === accountId);
  const memory = budget.payeeMemory?.[payeeKey(payee)];
  if (!account || account.kind === "tracking" || !memory) return undefined;
  if (memory.kind === "readyToAssign")
    return account.kind === "cash" && (amount === undefined || amount > 0)
      ? READY_TO_ASSIGN
      : undefined;
  const category = budget.categories.find(
    (item) => item.id === memory.categoryId,
  );
  return category && !category.pairedAccountId && !category.pairedLoanId
    ? category.id
    : undefined;
}

// What memory would hold for a transaction's categorization, or undefined
// when it isn't one memory keeps. Split transactions (several category
// lines) are never remembered: when transactions gain lines, return
// undefined here for any transaction with more than one.
function categorization(
  budget: Budget,
  transaction: Transaction | undefined,
): (PayeeMemory & { key: string }) | undefined {
  if (
    !transaction ||
    transaction.removed ||
    !["purchase", "refund", "income"].includes(transaction.kind)
  )
    return undefined;
  const account = budget.accounts.find(
    (item) => item.id === transaction.accountId,
  );
  const key = payeeKey(transaction.payee);
  if (!account || account.kind === "tracking" || !key) return undefined;
  if (transaction.categoryId)
    return {
      key,
      payee: transaction.payee,
      kind: "category",
      categoryId: transaction.categoryId,
    };
  return transaction.kind === "income"
    ? { key, payee: transaction.payee, kind: "readyToAssign" }
    : undefined;
}

const same = (a: PayeeMemory, b: PayeeMemory) =>
  a.payee === b.payee && a.kind === b.kind && a.categoryId === b.categoryId;

/**
 * Remembers each categorization a user's command set or changed: a
 * transaction that is new, or whose payee or category changed. Approving,
 * removing, or changing only an amount or date leaves memory as it was.
 */
export function rememberCategorizations(
  budget: Budget,
  changes: Changes,
): void {
  for (const { before, after } of changes.transactionEdits(budget)) {
    const next = categorization(budget, after);
    if (!next) continue;
    const previous = categorization(budget, before);
    if (
      previous?.key === next.key &&
      previous.kind === next.kind &&
      previous.categoryId === next.categoryId
    )
      continue;
    const { key, ...memory } = next;
    const current = budget.payeeMemory?.[key];
    if (current && same(current, memory)) continue;
    changes.payeeMemory(budget, key)[key] = memory;
  }
}
