// Format 4 reads the partner ledger: its shared entries and each partner's
// private side of them.
export const CLIENT_FORMAT = 4;
// Format 3 still reads everything stored until partner ledger writers ship.
export const MINIMUM_CLIENT_FORMAT = 3;
export const CLIENT_FORMAT_HEADER = "x-caishen-client-format";
