// Format 4 reads the partner ledger: its shared entries and each partner's
// private side of them. Format 5 reads entries recorded before the payer's
// import, in the payer's budget too, and entries matched to that import.
// Format 6 reads settling up: settlements, their legs, and requests.
// Format 7 drops the retired shared-cost model's tables, so browsers holding
// their rows start over.
export const CLIENT_FORMAT = 7;
export const MINIMUM_CLIENT_FORMAT = 7;
export const CLIENT_FORMAT_HEADER = "x-caishen-client-format";
