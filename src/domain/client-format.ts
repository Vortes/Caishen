// Format 4 reads the partner ledger: its shared entries and each partner's
// private side of them. Format 5 reads entries recorded before the payer's
// import, in the payer's budget too, and entries matched to that import.
// Format 6 reads settling up: settlements, their legs, and requests.
export const CLIENT_FORMAT = 6;
// Format 5 still reads everything stored until settling-up writers ship.
export const MINIMUM_CLIENT_FORMAT = 5;
export const CLIENT_FORMAT_HEADER = "x-caishen-client-format";
