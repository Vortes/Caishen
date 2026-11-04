// Format 4 reads the partner ledger: its shared entries and each partner's
// private side of them. Format 5 reads entries recorded before the payer's
// import, in the payer's budget too, and entries matched to that import.
// Format 6 reads settling up: settlements, their legs, and requests.
// Format 7 drops the retired shared-cost model's tables, so browsers holding
// their rows start over.
// Format 8 reads category-free full shares and share-only payee memory.
// Format 9 requires source line facts and the unified register command.
// Format 10 stores Starting Balances as adjustments instead of account amounts.
// Format 11 reads every counterparty as a person account, and shares and
// repayments without a counterparty name (ADR 0014).
// Format 12 funds the linked person's purchases like a credit card's
// (ADR 0015).
export const CLIENT_FORMAT = 12;
export const MINIMUM_CLIENT_FORMAT = 12;
export const CLIENT_FORMAT_HEADER = "x-caishen-client-format";
