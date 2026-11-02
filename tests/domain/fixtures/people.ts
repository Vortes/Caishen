import {
  execute,
  personAccountId,
  personEnvelopeId,
  type Book,
  type CounterpartyShare,
} from "../../../src/domain/engine";

// A person's account and envelope ids as these tests name them.
export const personId = (name: string) =>
  personAccountId(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
export const envelopeOf = (name: string) => personEnvelopeId(personId(name));

/** The book with one more person in a member's budget. */
export function withPerson(book: Book, userId: string, name: string): Book {
  return execute(book, userId, {
    type: "person.add",
    id: `person:${userId}:${name}`,
    accountId: personId(name),
    name,
  });
}

const LEGACY_ACCOUNT = "counterparty:reimbursements";
const LEGACY_ENVELOPE = "envelope:reimbursements";

/**
 * The book as it was stored before people: a member's unlinked people
 * folded into one Reimbursements account whose entries name them, by the
 * names given or their account names, with their float in its envelope.
 * A budget with nobody still gets the empty account and envelope.
 */
export function asLegacyReimbursements(
  book: Book,
  userId: string,
  names: Record<string, string> = {},
): Book {
  const legacy = structuredClone(book);
  const budget = legacy.budgets[userId]!;
  const people = budget.accounts.filter(
    (account) => account.kind === "person" && !account.linkedUserId,
  );
  const nameOf = new Map(
    people.map((person) => [person.id, names[person.id] ?? person.name]),
  );
  const named = (share: CounterpartyShare): CounterpartyShare =>
    nameOf.has(share.accountId)
      ? {
          accountId: LEGACY_ACCOUNT,
          amount: share.amount,
          counterpartyName: nameOf.get(share.accountId),
        }
      : share;
  const first = budget.accounts.findIndex((item) => nameOf.has(item.id));
  budget.accounts = budget.accounts.filter((item) => !nameOf.has(item.id));
  budget.accounts.splice(first < 0 ? budget.accounts.length : first, 0, {
    id: LEGACY_ACCOUNT,
    name: "Reimbursements",
    kind: "reimbursements",
    openingBalance: 0,
    date: `${budget.startMonth}-01`,
  });
  const envelopes = new Set(
    budget.categories
      .filter((item) => nameOf.has(item.counterpartyAccountId ?? ""))
      .map((item) => item.id),
  );
  budget.categories = budget.categories.filter(
    (item) => !envelopes.has(item.id),
  );
  budget.categories.push({
    id: LEGACY_ENVELOPE,
    name: "Reimbursements",
    group: "People",
    counterpartyAccountId: LEGACY_ACCOUNT,
  });
  budget.assignments = budget.assignments.map((assignment) =>
    envelopes.has(assignment.categoryId)
      ? { ...assignment, categoryId: LEGACY_ENVELOPE }
      : assignment,
  );
  budget.transactions = budget.transactions.map((transaction) => ({
    ...transaction,
    ...(transaction.counterpartyShare
      ? { counterpartyShare: named(transaction.counterpartyShare) }
      : {}),
    ...(transaction.lines
      ? {
          lines: transaction.lines.map((line) =>
            line.counterpartyShare
              ? { ...line, counterpartyShare: named(line.counterpartyShare) }
              : line,
          ),
        }
      : {}),
    ...(transaction.linkedCounterpartyAccountId &&
    nameOf.has(transaction.linkedCounterpartyAccountId)
      ? {
          counterpartyName: nameOf.get(transaction.linkedCounterpartyAccountId),
          linkedCounterpartyAccountId: LEGACY_ACCOUNT,
        }
      : {}),
    history: transaction.history.map((change) =>
      change.shareChanges
        ? {
            ...change,
            shareChanges: change.shareChanges.map((share) => ({
              ...share,
              previous: share.previous && named(share.previous),
              next: share.next && named(share.next),
            })),
          }
        : change,
    ),
  }));
  if (budget.payeeMemory)
    budget.payeeMemory = Object.fromEntries(
      Object.entries(budget.payeeMemory).map(([key, memory]) => [
        key,
        memory.counterpartyShare
          ? { ...memory, counterpartyShare: named(memory.counterpartyShare) }
          : memory,
      ]),
    );
  return legacy;
}
