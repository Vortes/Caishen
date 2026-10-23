// Format 6 reads settling up: settlements, their legs, and requests. Format
// 5 is left to the partner-paid entries (shared costs phase 3b).
export const CLIENT_FORMAT = 6;
// Format 4 still reads everything stored until settling-up writers ship.
export const MINIMUM_CLIENT_FORMAT = 4;
export const CLIENT_FORMAT_HEADER = "x-caishen-client-format";
