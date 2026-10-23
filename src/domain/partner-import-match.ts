import type { Budget } from "./engine";
import {
  awaitingImport,
  partnerAccountOf,
  spendingCategory,
  type PartnerEntry,
} from "./partner-ledger";
import { payeeKey, rememberedCategory } from "./payee-memory";
import type { AccountingState } from "./shared-ledger";

// Matching a payer's bank import to a purchase recorded before it arrived
// (src/domain/partner-ledger.ts), so the purchase counts once.
//
// An import may be the purchase when it's money out of one of the payer's
// own cash or card accounts, of exactly the recorded amount, dated within
// PARTNER_MATCH_DAYS of it: the same window as matching an import to a
// transaction entered by hand. A match is certain only when it's the
// import's one possible entry, the entry's one possible import, and the
// payees look alike. Anything less waits for the payer to confirm it, and
// until then the import isn't counted, so nothing counts twice.

export const PARTNER_MATCH_DAYS = 10;

export type ImportFacts = {
  accountId: string;
  date: string;
  // Signed as the account records it: negative for money out.
  amount: number;
  payee: string;
};

export type PartnerMatch = {
  entry: PartnerEntry;
  // Days between the recorded purchase and the import.
  days: number;
  payeesAlike: boolean;
};

const dayNumber = (date: string) =>
  Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * The recorded purchases a payer's import may be, closest first: payees
 * that look alike before those that don't, then the nearest date.
 */
export function partnerMatches(
  state: Pick<AccountingState, "partnerEntries">,
  budget: Pick<Budget, "userId" | "accounts">,
  facts: ImportFacts,
): PartnerMatch[] {
  const account = budget.accounts.find((item) => item.id === facts.accountId);
  if (
    !partnerAccountOf(budget) ||
    (account?.kind !== "cash" && account?.kind !== "credit") ||
    facts.amount >= 0
  )
    return [];
  return (state.partnerEntries ?? [])
    .flatMap((entry) => {
      if (
        entry.removed ||
        !awaitingImport(entry) ||
        entry.payerId !== budget.userId ||
        entry.amount !== facts.amount
      )
        return [];
      const days = Math.abs(dayNumber(entry.date) - dayNumber(facts.date));
      return days > PARTNER_MATCH_DAYS
        ? []
        : [{ entry, days, payeesAlike: payeesAlike(entry.payee, facts.payee) }];
    })
    .sort(
      (a, b) =>
        Number(b.payeesAlike) - Number(a.payeesAlike) ||
        a.days - b.days ||
        a.entry.id.localeCompare(b.entry.id),
    );
}

/**
 * Whether a recorded payee and a bank's look like the same merchant:
 * "Bi-Rite Market" and "BI-RITE MARKET #2 SAN FRANCISCO" do; "Bi-Rite" and
 * "Safeway" don't.
 */
export function payeesAlike(recorded: string, imported: string): boolean {
  const [a, b] = [payeeKey(recorded), payeeKey(imported)];
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)))
    return true;
  const theirs = new Set(words(imported));
  return words(recorded).some((word) => theirs.has(word));
}

// Words that name a merchant, without the ones that name every merchant.
const generic = new Set([
  "the",
  "and",
  "inc",
  "llc",
  "ltd",
  "corp",
  "company",
  "store",
  "shop",
  "market",
  "pos",
  "purchase",
  "debit",
  "card",
  "payment",
]);

function words(payee: string): string[] {
  return payee
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (word) => word.length >= 3 && !/^\d+$/.test(word) && !generic.has(word),
    );
}

/**
 * The category the payer's part of a matched purchase takes without asking:
 * the one they chose when they recorded it, or their payee memory's.
 */
export function payerCategory(
  budget: Budget,
  entry: PartnerEntry,
  facts: ImportFacts,
): string | undefined {
  const chosen = budget.partnerSides?.[entry.id]?.categoryId;
  if (chosen) return chosen;
  for (const payee of [entry.payee, facts.payee]) {
    const remembered = budget.categories.find(
      (category) =>
        category.id ===
        rememberedCategory(budget, {
          payee,
          accountId: facts.accountId,
          amount: facts.amount,
        }),
    );
    if (remembered && spendingCategory(remembered)) return remembered.id;
  }
  return undefined;
}

/**
 * For each new import, by its id: the entry it certainly is, or "confirm"
 * when it may be one but the payer has to say which. Imports that can't
 * be a recorded purchase are left out. An entry two imports could be is
 * certain for neither.
 */
export function planPartnerMatches(
  state: Pick<AccountingState, "partnerEntries">,
  budget: Pick<Budget, "userId" | "accounts">,
  imports: { id: string; facts: ImportFacts }[],
): Map<string, PartnerEntry | "confirm"> {
  const matches = imports.map((item) => ({
    id: item.id,
    matches: partnerMatches(state, budget, item.facts),
  }));
  const claims = new Map<string, number>();
  for (const { matches: found } of matches)
    for (const { entry } of found)
      claims.set(entry.id, (claims.get(entry.id) ?? 0) + 1);
  const plan = new Map<string, PartnerEntry | "confirm">();
  for (const { id, matches: found } of matches) {
    if (!found.length) continue;
    const [only] = found;
    plan.set(
      id,
      found.length === 1 &&
        only!.payeesAlike &&
        claims.get(only!.entry.id) === 1
        ? only!.entry
        : "confirm",
    );
  }
  return plan;
}
