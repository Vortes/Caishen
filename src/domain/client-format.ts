// Format 4 reads the partner ledger: its shared entries and each partner's
// private side of them.
export const CLIENT_FORMAT = 4;
// Deploy the format-4 readers before releasing these writers.
export const MINIMUM_CLIENT_FORMAT = 4;
export const CLIENT_FORMAT_HEADER = "x-caishen-client-format";
