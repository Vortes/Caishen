// Format 6 reads settling up: settlements, their legs, and requests. Format
// 5 is left to the partner-paid entries (shared costs phase 3b).
export const CLIENT_FORMAT = 6;
// Deploy the format-6 readers before releasing these writers.
export const MINIMUM_CLIENT_FORMAT = 6;
export const CLIENT_FORMAT_HEADER = "x-caishen-client-format";
