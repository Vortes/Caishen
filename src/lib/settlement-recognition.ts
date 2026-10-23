// Recognizing money between people in bank imports: payments between the
// partners (src/domain/partner-settlements.ts) and repayments from anyone
// else. Pure, so the server's matching and the register's labels agree.

const words = (text: string) =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Whether bank text names a person: their first name, as a whole word. */
export function namesPerson(text: string, name: string): boolean {
  const first = words(name).find((word) => word.length >= 3);
  return first !== undefined && words(text).includes(first);
}

const methods: [RegExp, string][] = [
  [/\bzelle\b/i, "Zelle"],
  [/\bvenmo\b/i, "Venmo"],
  [/\bpaypal\b/i, "PayPal"],
  [/\bcash\s?app\b/i, "Cash App"],
  [/\bapple\s?cash\b/i, "Apple Cash"],
];

/** The person-to-person service bank text names, if any. */
export function transferMethod(text: string): string | undefined {
  return methods.find(([pattern]) => pattern.test(text))?.[1];
}

const cardPayment = /\b(payment|pmt|epay|epayment|autopay)\b/i;

export type SettlementCandidate = {
  key: string;
  userId: string;
  accountKind: "cash" | "credit";
  date: string;
  // Signed as the account records it: negative is money out.
  amount: number;
  text: string;
};

export type SettlementMatch = {
  paid: SettlementCandidate;
  received: SettlementCandidate;
  method: string;
};

// How far apart the two banks can date one payment.
export const SETTLEMENT_MATCH_DAYS = 4;

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * Pairs one partner's payment out with the other's payment in: the same
 * amount, opposite directions, dated at most SETTLEMENT_MATCH_DAYS apart,
 * and each recognizably a payment between people. A pair is made only when
 * neither side could pair with anything else; ambiguous imports wait.
 *
 * - Out: from a cash account, naming the partner, a person-to-person
 *   service, or a card payment.
 * - In: into a cash account naming the partner or a person-to-person
 *   service, or any payment into a credit card.
 * - The pair needs one side to name the other partner, or both sides to
 *   name a person-to-person service, or a card payment that neither
 *   partner's own accounts explain (`ownCardPayment`: the payer's own card
 *   took the same amount, or the recipient's own cash account paid it).
 */
export function matchSettlements(
  candidates: SettlementCandidate[],
  partnerName: (userId: string) => string,
  ownCardPayment: (candidate: SettlementCandidate) => boolean,
): SettlementMatch[] {
  const names = (candidate: SettlementCandidate, otherId: string) =>
    namesPerson(candidate.text, partnerName(otherId));
  const service = (candidate: SettlementCandidate) =>
    transferMethod(candidate.text) !== undefined;
  const outs = candidates.filter(
    (item) =>
      item.accountKind === "cash" &&
      item.amount < 0 &&
      (service(item) ||
        cardPayment.test(item.text) ||
        candidates.some(
          (other) => other.userId !== item.userId && names(item, other.userId),
        )),
  );
  const ins = candidates.filter(
    (item) =>
      item.amount > 0 &&
      (item.accountKind === "credit" ||
        service(item) ||
        candidates.some(
          (other) => other.userId !== item.userId && names(item, other.userId),
        )),
  );
  const pairs = (paid: SettlementCandidate) =>
    ins.filter(
      (received) =>
        received.userId !== paid.userId &&
        received.amount === -paid.amount &&
        Math.abs(day(received.date) - day(paid.date)) <=
          SETTLEMENT_MATCH_DAYS &&
        (names(paid, received.userId) ||
          names(received, paid.userId) ||
          (service(paid) && service(received)) ||
          (received.accountKind === "credit" &&
            cardPayment.test(paid.text) &&
            !ownCardPayment(paid) &&
            !ownCardPayment(received))),
    );
  return outs.flatMap((paid): SettlementMatch[] => {
    const found = pairs(paid);
    if (found.length !== 1) return [];
    const received = found[0]!;
    if (outs.filter((other) => pairs(other).includes(received)).length !== 1)
      return [];
    return [
      {
        paid,
        received,
        method:
          transferMethod(paid.text) ??
          transferMethod(received.text) ??
          (received.accountKind === "credit" ? "Card payment" : "Transfer"),
      },
    ];
  });
}
