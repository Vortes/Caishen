"use client";

import { newId } from "~/components/budget/format";
import { personAccountId } from "~/domain/engine";
import type { Account } from "./model";
import { useShellData } from "./shell-data";
import { useTransactionEntry } from "./transaction-entry";

// Every counterparty is a person (ADR 0014): someone who owes you, or whom
// you owe. The one linked to the other member of the household is also on
// Caishen, so what you share with them shows in their budget too.

export const isPerson = (account: Pick<Account, "kind">) =>
  account.kind === "person";

/** Whether a person is also on Caishen: the partner. */
export const isLinked = (account: Pick<Account, "linkedUserId" | "closed">) =>
  Boolean(account.linkedUserId) && !account.closed;

/** Whether nothing is owed either way and no money waits for them. */
export const isSettled = (account: Account, float: number) =>
  account.balance === 0 && float === 0;

export function owedSentence(name: string, balance: number) {
  if (balance > 0) return `${name} owes you`;
  if (balance < 0) return `You owe ${name}`;
  return `You and ${name} are even`;
}

// The people a share can be with: the partner first, then whoever you
// shared with or heard back from most recently, then the rest by name.
export function usePeople() {
  const { accounts } = useShellData();
  const { view, saveCommand } = useTransactionEntry();
  const lastUsed = new Map<string, string>();
  for (const transaction of view.budget.transactions) {
    if (transaction.removed) continue;
    for (const id of [
      transaction.linkedCounterpartyAccountId,
      ...(transaction.lines ?? [transaction]).map(
        (line) => line.counterpartyShare?.accountId,
      ),
    ])
      if (id && (lastUsed.get(id) ?? "") < transaction.date)
        lastUsed.set(id, transaction.date);
  }
  const people = accounts
    .filter((item) => isPerson(item) && !item.closed)
    .sort(
      (a, b) =>
        Number(isLinked(b)) - Number(isLinked(a)) ||
        (lastUsed.get(b.id) ?? "").localeCompare(lastUsed.get(a.id) ?? "") ||
        a.name.localeCompare(b.name),
    );
  const partner = people.find(isLinked);
  const nameOf = (accountId: string) =>
    accounts.find((item) => item.id === accountId)?.name ?? "Someone";
  // A new person, with an account and a People envelope of their own.
  const addPerson = (
    name: string,
  ): { accountId: string; failure?: undefined } | { failure: string } => {
    const accountId = personAccountId(newId());
    const failure = saveCommand(
      { type: "person.add", id: newId(), accountId, name },
      `Added ${name} to your people`,
    );
    return failure ? { failure } : { accountId };
  };
  return { view, people, partner, nameOf, addPerson };
}
