import type { CommandSource, Transaction } from "./engine";
import { isTransfer } from "./transfers";

// What a person approves about a transaction. A change to anything else,
// such as the bank's wording of the payee or a pending one posting, leaves
// their approval standing.
const approvedFacts = [
  "accountId",
  "date",
  "amount",
  "categoryId",
  "expenseMonth",
] as const satisfies (keyof Transaction)[];
// A transfer or payment is approved as money moving between two accounts.
// Each side posts at its own bank on its own day, so the dates are the
// banks' to set.
const approvedPairFacts = [
  "amount",
  "kind",
] as const satisfies (keyof Transaction)[];
type Approved = Pick<
  Transaction,
  (typeof approvedFacts)[number] | (typeof approvedPairFacts)[number]
>;

const paired = (transaction: Pick<Transaction, "kind">) =>
  isTransfer(transaction) || transaction.kind === "loan-payment";

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
    (paired(after) ? approvedPairFacts : approvedFacts).every(
      (key) => before[key] === after[key],
    ),
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
