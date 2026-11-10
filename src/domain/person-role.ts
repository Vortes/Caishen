import type { Account, Budget } from "./engine";

// What a person is to you (ADR 0014): someone you track by name, the
// partner, linked to the other member of the household, or a former
// partner, the closed account a disconnect (ADR 0012) leaves behind.
// Disconnecting drops the link and closes the account, so a closed person
// is a former partner whatever else it holds.
export type PersonRole = "person" | "partner" | "former-partner";

/** What a person is to you; nothing for an account that isn't a person's. */
export function personRole(
  account: Pick<Account, "kind" | "linkedUserId" | "closed">,
): PersonRole | undefined {
  if (account.kind !== "person") return undefined;
  if (account.closed) return "former-partner";
  if (account.linkedUserId) return "partner";
  return "person";
}

/**
 * Whether a person's account works like a credit card (ADR 0015): the
 * partner's, and a former partner's whose frozen ledger has entries, which
 * keeps the rules it was recorded under. A ledger frozen with nothing in it
 * has nothing recorded under them, so its envelope keeps other people's.
 */
export function keepsCardRules(
  account: Pick<Account, "id" | "kind" | "linkedUserId" | "closed">,
  budget: Pick<Budget, "formerPartnerEntries">,
): boolean {
  const role = personRole(account);
  return (
    role === "partner" ||
    (role === "former-partner" &&
      (budget.formerPartnerEntries ?? []).some(
        (entry) => entry.accountId === account.id,
      ))
  );
}
