import { shareContribution } from "./counterparty";
import {
  AccountingError,
  LINKED_PERSON_ACCOUNT_ID,
  PEOPLE_GROUP,
  isCounterparty,
  personAccountId,
  personEnvelopeId,
  type Account,
  type Book,
  type Budget,
  type CounterpartyShare,
} from "./engine";

// Every counterparty is a person with an account and a paired envelope of
// their own (ADR 0013). Budgets stored before then held one Reimbursements
// account whose entries named their person, a Partner account, and former
// partners' accounts; withPeople converts them.

/** How two spellings of one person's name compare. */
export const personKey = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

function slug(name: string): string {
  return (
    personKey(name)
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "person"
  );
}

/** The people in a budget, the partner first, then in the account order. */
export function peopleOf<
  T extends Pick<Account, "kind" | "linkedUserId" | "closed">,
>(accounts: T[]): T[] {
  const people = accounts.filter(isCounterparty);
  return [
    ...people.filter((account) => account.linkedUserId && !account.closed),
    ...people.filter((account) => !account.linkedUserId || account.closed),
  ];
}

/** The person whose name is a payee's, when exactly one is. */
export function personNamed(
  accounts: Account[],
  name: string,
): Account | undefined {
  const named = accounts.filter(
    (account) =>
      isCounterparty(account) &&
      !account.closed &&
      !account.linkedUserId &&
      personKey(account.name) === personKey(name),
  );
  return named.length === 1 ? named[0] : undefined;
}

/**
 * The book with every budget's counterparties as people: legacy accounts
 * converted, and the partner's linked person added once the household has
 * two members. Adds or converts only what is missing, so it runs on every
 * load and when a budget is created or a partner joins.
 */
export function withPeople(book: Book): Book {
  const result = structuredClone(book);
  const members = Object.keys(result.budgets);
  for (const budget of Object.values(result.budgets)) {
    const other = members.find((id) => id !== budget.userId);
    migrateLegacyCounterparties(budget, other);
    if (members.length === 2 && other) ensureLinkedPerson(budget, other);
  }
  return result;
}

/** Whether withPeople would change the book. */
export function lacksPeople(book: Book): boolean {
  const members = Object.keys(book.budgets);
  return Object.values(book.budgets).some(
    (budget) =>
      budget.accounts.some(
        (account) =>
          account.kind === "partner" ||
          account.kind === "reimbursements" ||
          account.kind === "former-partner",
      ) ||
      (members.length === 2 &&
        !budget.accounts.some(
          (account) =>
            account.id === LINKED_PERSON_ACCOUNT_ID &&
            account.kind === "person" &&
            account.linkedUserId &&
            members.includes(account.linkedUserId),
        )),
  );
}

function ensureLinkedPerson(budget: Budget, linkedUserId: string): void {
  const accountId = LINKED_PERSON_ACCOUNT_ID;
  const existing = budget.accounts.find((account) => account.id === accountId);
  if (existing && existing.kind !== "person")
    throw new AccountingError(
      "A budget account already uses the partner's account ID",
    );
  if (existing) existing.linkedUserId = linkedUserId;
  else {
    // The partner goes ahead of everyone else.
    const first = budget.accounts.findIndex(isCounterparty);
    budget.accounts.splice(first < 0 ? budget.accounts.length : first, 0, {
      id: accountId,
      name: "Partner",
      kind: "person",
      openingBalance: 0,
      date: `${budget.startMonth}-01`,
      linkedUserId,
    });
  }
  ensureEnvelope(budget, accountId, "Partner");
}

function ensureEnvelope(budget: Budget, accountId: string, name: string) {
  const envelopeId = personEnvelopeId(accountId);
  const envelope = budget.categories.find((item) => item.id === envelopeId);
  if (envelope && envelope.counterpartyAccountId !== accountId)
    throw new AccountingError("A category already uses a paired envelope's ID");
  if (!envelope)
    budget.categories.push({
      id: envelopeId,
      name,
      group: PEOPLE_GROUP,
      counterpartyAccountId: accountId,
    });
}

/**
 * Converts one budget's legacy counterparty accounts. The Partner account
 * becomes the linked person and a former partner's an unlinked, closed
 * person, both keeping their ids. Each name the Reimbursements account's
 * entries used, trimmed and compared without case, becomes a person with
 * their shares, repayments, and remembered shares; the Reimbursements
 * account and its envelope go. Its float moves, every month of it, to the
 * person who owes you most, so no month's Ready to Assign changes; with
 * nobody to move it to, it returns to Ready to Assign.
 */
function migrateLegacyCounterparties(
  budget: Budget,
  linkedUserId: string | undefined,
): void {
  budget.accounts = budget.accounts.map((account) => {
    if (account.kind === "partner")
      return {
        ...account,
        kind: "person",
        ...(linkedUserId ? { linkedUserId } : {}),
      };
    if (account.kind === "former-partner")
      return { ...account, kind: "person" };
    return account;
  });
  const legacy = budget.accounts.find(
    (account) => account.kind === "reimbursements",
  );
  if (!legacy) return;
  const envelope = budget.categories.find(
    (category) => category.counterpartyAccountId === legacy.id,
  );

  // Every name, in the order the entries first used it.
  type Person = { key: string; name: string; id: string; owed: number };
  const people = new Map<string, Person>();
  const taken = new Set(budget.accounts.map((account) => account.id));
  const personFor = (name: string | undefined): Person => {
    // A share stored without a name still needs someone to owe it.
    const trimmed = name?.trim().replace(/\s+/g, " ");
    const shown = trimmed?.length ? trimmed : "Someone";
    const key = personKey(shown);
    let person = people.get(key);
    if (!person) {
      let id = personAccountId(slug(shown));
      for (let n = 2; taken.has(id); n++)
        id = personAccountId(`${slug(shown)}-${n}`);
      taken.add(id);
      person = { key, name: shown, id, owed: 0 };
      people.set(key, person);
    }
    return person;
  };
  const transactions = [...budget.transactions].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  for (const transaction of transactions) {
    if (transaction.linkedCounterpartyAccountId === legacy.id) {
      const person = personFor(transaction.counterpartyName);
      if (!transaction.removed) person.owed -= transaction.amount;
    }
    for (const line of transaction.lines ?? [transaction]) {
      const share = line.counterpartyShare;
      if (share?.accountId !== legacy.id) continue;
      const person = personFor(share.counterpartyName);
      if (!transaction.removed)
        person.owed += shareContribution(line.amount, share);
    }
    for (const change of transaction.history)
      for (const share of change.shareChanges ?? [])
        for (const side of [share.previous, share.next])
          if (side?.accountId === legacy.id) personFor(side.counterpartyName);
  }

  const point = (share: CounterpartyShare): CounterpartyShare => {
    if (share.accountId !== legacy.id) {
      const kept = { ...share };
      delete kept.counterpartyName;
      return kept;
    }
    return {
      accountId: personFor(share.counterpartyName).id,
      amount: share.amount,
    };
  };
  budget.transactions = budget.transactions.map((transaction) => {
    const next = { ...transaction };
    if (next.counterpartyShare)
      next.counterpartyShare = point(next.counterpartyShare);
    if (next.lines)
      next.lines = next.lines.map((line) =>
        line.counterpartyShare
          ? { ...line, counterpartyShare: point(line.counterpartyShare) }
          : line,
      );
    if (next.linkedCounterpartyAccountId === legacy.id)
      next.linkedCounterpartyAccountId = personFor(next.counterpartyName).id;
    delete next.counterpartyName;
    next.history = next.history.map((change) =>
      change.shareChanges
        ? {
            ...change,
            shareChanges: change.shareChanges.map((share) => ({
              ...share,
              previous: share.previous && point(share.previous),
              next: share.next && point(share.next),
            })),
          }
        : change,
    );
    return next;
  });
  if (budget.payeeMemory)
    budget.payeeMemory = Object.fromEntries(
      Object.entries(budget.payeeMemory).flatMap(([key, memory]) => {
        const share = memory.counterpartyShare;
        if (!share) return [[key, memory]];
        if (share.accountId === legacy.id && !share.counterpartyName?.trim()) {
          if (memory.kind === "share") return [];
          const kept = { ...memory };
          delete kept.counterpartyShare;
          return [[key, kept]];
        }
        return [[key, { ...memory, counterpartyShare: point(share) }]];
      }),
    );

  const created = [...people.values()];
  const at = budget.accounts.indexOf(legacy);
  budget.accounts.splice(
    at,
    1,
    ...created.map((person): Account => ({
      id: person.id,
      name: person.name,
      kind: "person",
      openingBalance: 0,
      date: legacy.date,
    })),
  );
  const envelopeAt = envelope ? budget.categories.indexOf(envelope) : -1;
  const envelopes = created.map((person) => ({
    id: personEnvelopeId(person.id),
    name: person.name,
    group: envelope?.group ?? PEOPLE_GROUP,
    counterpartyAccountId: person.id,
  }));
  if (envelopeAt < 0) budget.categories.push(...envelopes);
  else budget.categories.splice(envelopeAt, 1, ...envelopes);

  if (envelope) {
    // Ties go to whoever came first.
    const heir = created.reduce<Person | undefined>(
      (best, person) => (!best || person.owed > best.owed ? person : best),
      undefined,
    );
    budget.assignments = budget.assignments.flatMap((assignment) =>
      assignment.categoryId !== envelope.id
        ? [assignment]
        : heir
          ? [{ ...assignment, categoryId: personEnvelopeId(heir.id) }]
          : [],
    );
  }
}
