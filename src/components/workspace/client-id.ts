// This tab, as budget.execute names the browser that sent a command
// (ADR 0006).
export const clientId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Math.random()).slice(2);
