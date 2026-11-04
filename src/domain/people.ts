import {
  AccountingError,
  PEOPLE_GROUP,
  isCounterparty,
  isLegacyCounterparty,
  isLinkedPerson,
  personAccountId,
  personEnvelopeId,
  type Account,
  type Book,
  type Budget,
  type CounterpartyShare,
} from "./engine";
import { personKey } from "./person-name";

export { personKey } from "./person-name";

// Every counterparty is a person with an account and a paired envelope of
// their own (ADR 0014). Budgets stored before then held one Reimbursements
// account whose entries named their person, a Partner account, and former
// partners' accounts; withPeople converts them.

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
 * two members, under an id of its own (`counterparty:person:linked-<user>`).
 * Adds or converts only what is missing, so it runs on every load and when
 * a budget is created or a partner joins. What it can't convert without a
 * guess it refuses with an AccountingError, changing nothing.
 */
export function withPeople(book: Book): Book {
  const result = structuredClone(book);
  const members = Object.keys(result.budgets);
  for (const budget of Object.values(result.budgets)) {
    const other = members.find((id) => id !== budget.userId);
    migrateLegacyCounterparties(budget, other);
    if (members.length === 2 && other) ensureLinkedPerson(budget, other);
    else if (budget.accounts.some(isLinkedPerson))
      throw new AccountingError(
        "A linked person is stored in a budget without a partner",
      );
  }
  return result;
}

/** Whether withPeople would change the book, or refuse it. */
export function lacksPeople(book: Book): boolean {
  const members = Object.keys(book.budgets);
  return Object.values(book.budgets).some((budget) => {
    if (budget.accounts.some(isLegacyCounterparty)) return true;
    const linked = budget.accounts.filter(isLinkedPerson);
    const other = members.find((id) => id !== budget.userId);
    if (members.length !== 2 || !other) return linked.length > 0;
    return (
      linked.length !== 1 ||
      linked[0]!.linkedUserId !== other ||
      envelopesOf(budget, linked[0]!.id).length !== 1
    );
  });
}

// The partner is whoever is linked to the other member, under any id. A
// budget linked to anyone else, or to them twice, is refused rather than
// relinked, so no money moves to a different person.
function ensureLinkedPerson(budget: Budget, linkedUserId: string): void {
  const linked = budget.accounts.filter(isLinkedPerson);
  if (
    linked.length > 1 ||
    linked.some((account) => account.linkedUserId !== linkedUserId)
  )
    throw new AccountingError(
      "A budget's linked person isn't the other member of its household",
    );
  if (linked[0]) {
    ensureEnvelope(budget, linked[0].id, linked[0].name);
    return;
  }
  let accountId = personAccountId(`linked-${linkedUserId}`);
  for (let n = 2; budget.accounts.some((item) => item.id === accountId); n++)
    accountId = personAccountId(`linked-${linkedUserId}-${n}`);
  // The partner goes ahead of everyone else.
  const first = budget.accounts.findIndex(isCounterparty);
  budget.accounts.splice(first < 0 ? budget.accounts.length : first, 0, {
    id: accountId,
    name: "Partner",
    kind: "person",
    date: `${budget.startMonth}-01`,
    linkedUserId,
  });
  ensureEnvelope(budget, accountId, "Partner");
}

const envelopesOf = (budget: Budget, accountId: string) =>
  budget.categories.filter(
    (category) => category.counterpartyAccountId === accountId,
  );

function ensureEnvelope(budget: Budget, accountId: string, name: string) {
  const envelopes = envelopesOf(budget, accountId);
  if (envelopes.length > 1)
    throw new AccountingError("A person has more than one paired envelope");
  if (envelopes.length) return;
  const envelopeId = personEnvelopeId(accountId);
  if (budget.categories.some((item) => item.id === envelopeId))
    throw new AccountingError("A category already uses a paired envelope's ID");
  budget.categories.push({
    id: envelopeId,
    name,
    group: PEOPLE_GROUP,
    counterpartyAccountId: accountId,
  });
}

/**
 * Converts one budget's legacy counterparty accounts. The Partner account
 * becomes the person linked to the other member and a former partner's an
 * unlinked, closed person, both keeping their ids. Each name the
 * Reimbursements account's entries used becomes a person with their shares,
 * repayments, share history, and remembered shares; the Reimbursements
 * account and its envelope go, and its float moves, every month of it, to
 * that person's envelope, so no month's Ready to Assign changes. Only the
 * shapes stored budgets are known to hold convert: an entry without a name,
 * a name spelled two ways, a float more than one person or nobody could
 * hold, or a Partner account without a partner is refused, and the budget
 * stays as it was.
 */
function migrateLegacyCounterparties(
  budget: Budget,
  linkedUserId: string | undefined,
): void {
  budget.accounts = budget.accounts.map((account) => {
    if (account.kind === "partner") {
      if (!linkedUserId)
        throw new AccountingError(
          "A Partner account is stored in a budget without a partner",
        );
      return { ...account, kind: "person", linkedUserId };
    }
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
  type Person = { name: string; spelling: string; id: string };
  const people = new Map<string, Person>();
  const taken = new Set(budget.accounts.map((account) => account.id));
  const personFor = (name: string | undefined): Person => {
    const shown = name?.trim().replace(/\s+/g, " ");
    if (!shown)
      throw new AccountingError(
        "A Reimbursements entry is stored without a name",
      );
    const key = personKey(shown);
    let person = people.get(key);
    if (person && person.spelling !== name)
      throw new AccountingError(
        "Reimbursements entries name one person spelled more than one way",
      );
    if (!person) {
      if (
        budget.accounts.some(
          (account) =>
            isCounterparty(account) && personKey(account.name) === key,
        )
      )
        throw new AccountingError(
          "Reimbursements entries name someone who is already a person",
        );
      let id = personAccountId(slug(shown));
      for (let n = 2; taken.has(id); n++)
        id = personAccountId(`${slug(shown)}-${n}`);
      taken.add(id);
      person = { name: shown, spelling: name!, id };
      people.set(key, person);
    }
    return person;
  };
  const transactions = [...budget.transactions].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  for (const transaction of transactions) {
    if (transaction.linkedCounterpartyAccountId === legacy.id)
      personFor(transaction.counterpartyName);
    for (const line of transaction.lines ?? [transaction])
      if (line.counterpartyShare?.accountId === legacy.id)
        personFor(line.counterpartyShare.counterpartyName);
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
    const float = budget.assignments.some(
      (assignment) => assignment.categoryId === envelope.id,
    );
    if (float && created.length !== 1)
      throw new AccountingError(
        "A Reimbursements float needs exactly one person to hold it",
      );
    budget.assignments = budget.assignments.map((assignment) =>
      assignment.categoryId === envelope.id
        ? { ...assignment, categoryId: personEnvelopeId(created[0]!.id) }
        : assignment,
    );
  }
}
