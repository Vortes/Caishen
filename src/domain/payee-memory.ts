import type { Changes } from "./changes";
import type {
  Budget,
  CounterpartyShare,
  PayeeMemory,
  Transaction,
} from "./engine";
import { READY_TO_ASSIGN } from "./transfers";
import { isFullShare, reimbursementPeople } from "./counterparty";

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
 * or People account takes no remembered category.
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
  if (
    !account ||
    (account.kind !== "cash" && account.kind !== "credit") ||
    !memory
  )
    return undefined;
  if (memory.kind === "readyToAssign")
    return account.kind === "cash" && (amount === undefined || amount > 0)
      ? READY_TO_ASSIGN
      : undefined;
  const category = budget.categories.find(
    (item) => item.id === memory.categoryId,
  );
  return category &&
    !category.pairedAccountId &&
    !category.pairedLoanId &&
    !category.counterpartyAccountId
    ? category.id
    : undefined;
}

/** The remembered share for an owned spending account; absent means zero. */
export function rememberedCounterpartyShare(
  budget: Budget,
  {
    payee,
    accountId,
    amount,
  }: { payee: string; accountId: string; amount?: number },
): CounterpartyShare | undefined {
  const account = budget.accounts.find((item) => item.id === accountId);
  const memory = budget.payeeMemory?.[payeeKey(payee)];
  if (
    !memory &&
    account &&
    (account.kind === "cash" || account.kind === "credit") &&
    amount !== undefined &&
    amount < 0
  ) {
    const people = reimbursementPeople(budget).filter(
      (name) => payeeKey(name) === payeeKey(payee),
    );
    const reimbursements = budget.accounts.find(
      (item) => item.kind === "reimbursements",
    );
    if (people.length === 1 && reimbursements)
      return {
        accountId: reimbursements.id,
        counterpartyName: people[0]!,
        amount: Math.abs(amount),
      };
  }
  if (
    !account ||
    (account.kind !== "cash" && account.kind !== "credit") ||
    (memory?.kind !== "category" && memory?.kind !== "share") ||
    (memory.kind === "category" &&
      !rememberedCategory(budget, { payee, accountId, amount })) ||
    (amount !== undefined && amount >= 0)
  )
    return undefined;
  const share = memory.counterpartyShare;
  if (!share) return undefined;
  const counterparty = budget.accounts.find(
    (item) => item.id === share.accountId,
  );
  if (
    !counterparty ||
    (counterparty.kind !== "partner" && counterparty.kind !== "reimbursements")
  )
    return undefined;
  return {
    ...share,
    amount:
      amount === undefined
        ? share.amount
        : memory.kind === "share"
          ? Math.abs(amount)
          : Math.min(share.amount, Math.abs(amount)),
  };
}

// What memory would hold for a transaction's categorization, or undefined
// when it isn't one memory keeps. Split transactions never replace memory.
function categorization(
  budget: Budget,
  transaction: Transaction | undefined,
): (PayeeMemory & { key: string }) | undefined {
  if (
    !transaction ||
    transaction.removed ||
    (transaction.lines?.length ?? 0) > 1 ||
    !["purchase", "refund", "income"].includes(transaction.kind)
  )
    return undefined;
  const account = budget.accounts.find(
    (item) => item.id === transaction.accountId,
  );
  const key = payeeKey(transaction.payee);
  if (
    !account ||
    (account.kind !== "cash" && account.kind !== "credit") ||
    !key
  )
    return undefined;
  if (isFullShare(transaction))
    return {
      key,
      payee: transaction.payee,
      kind: "share",
      counterpartyShare: { ...transaction.counterpartyShare! },
    };
  if (transaction.categoryId) {
    const category = budget.categories.find(
      (item) => item.id === transaction.categoryId,
    );
    if (
      !category ||
      category.pairedAccountId ||
      category.pairedLoanId ||
      category.counterpartyAccountId
    )
      return undefined;
    return {
      key,
      payee: transaction.payee,
      kind: "category",
      categoryId: transaction.categoryId,
      ...(transaction.counterpartyShare
        ? { counterpartyShare: { ...transaction.counterpartyShare } }
        : {}),
    };
  }
  return transaction.kind === "income"
    ? { key, payee: transaction.payee, kind: "readyToAssign" }
    : undefined;
}

const sameShare = (
  a: CounterpartyShare | undefined,
  b: CounterpartyShare | undefined,
) =>
  a?.accountId === b?.accountId &&
  a?.amount === b?.amount &&
  a?.counterpartyName === b?.counterpartyName;

const same = (a: PayeeMemory, b: PayeeMemory) =>
  a.payee === b.payee &&
  a.kind === b.kind &&
  a.categoryId === b.categoryId &&
  sameShare(a.counterpartyShare, b.counterpartyShare);

/**
 * Remembers each categorization a user's command set or changed: a
 * transaction that is new, or whose payee, category, or share changed.
 * Approving, removing, or changing only an amount or date keeps memory.
 */
export function rememberCategorizations(
  budget: Budget,
  changes: Changes,
  explicitCategorization = false,
): void {
  for (const { before, after } of changes.transactionEdits(budget)) {
    const next = categorization(budget, after);
    if (!next) continue;
    const previous = categorization(budget, before);
    if (
      !explicitCategorization &&
      previous?.key === next.key &&
      previous.kind === next.kind &&
      previous.categoryId === next.categoryId &&
      sameShare(previous.counterpartyShare, next.counterpartyShare)
    )
      continue;
    const { key, ...memory } = next;
    const current = budget.payeeMemory?.[key];
    if (current && same(current, memory)) continue;
    changes.payeeMemory(budget, key)[key] = memory;
  }
}
