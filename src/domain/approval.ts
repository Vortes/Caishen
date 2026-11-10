import type { CommandSource, Transaction } from "./engine";

// What a person approves about a transaction. A change to anything else,
// such as the bank's wording of the payee or a pending one posting, leaves
// their approval standing.
const approvedFacts = [
  "accountId",
  "date",
  "amount",
  "categoryId",
  "expenseMonth",
  "kind",
] as const satisfies (keyof Transaction)[];
type Approved = Pick<Transaction, (typeof approvedFacts)[number]>;

/**
 * Whether a transaction is approved once a save replaces `before` with
 * `after`. A person's save is approved unless they ask otherwise. A bank or
 * agent update never approves anything: it keeps an approval only while the
 * approved facts stand.
 */
export function approvalAfterSave(
  source: CommandSource,
  before: (Approved & Pick<Transaction, "reviewed">) | undefined,
  after: Approved,
  requested?: boolean,
): boolean {
  if (source === "user") return requested ?? before?.reviewed ?? true;
  return Boolean(
    before?.reviewed &&
    approvedFacts.every((key) => before[key] === after[key]),
  );
}

/**
 * Whether a transaction is approved once it is given a category. Categorizing
 * is separate from approving: a person's choice keeps an approval and
 * approves a pending transaction, and an agent's leaves it to be reviewed.
 */
export function approvalAfterCategorize(
  source: CommandSource,
  before: Pick<Transaction, "reviewed" | "status">,
): boolean {
  return source === "user" && (before.reviewed || before.status === "pending");
}
