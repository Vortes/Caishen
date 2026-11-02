// Format 4 reads the partner ledger: its shared entries and each partner's
// private side of them. Format 5 reads entries recorded before the payer's
// import, in the payer's budget too, and entries matched to that import.
// Format 6 reads settling up: settlements, their legs, and requests.
// Format 7 drops the retired shared-cost model's tables, so browsers holding
// their rows start over.
// Format 8 reads category-free full shares and share-only payee memory.
// Format 9 requires source line facts and the unified register command.
// Format 10 reads every counterparty as a person account, and shares and
// repayments without a counterparty name (ADR 0013).
export const CLIENT_FORMAT = 10;
export const MINIMUM_CLIENT_FORMAT = 10;
export const CLIENT_FORMAT_HEADER = "x-caishen-client-format";
