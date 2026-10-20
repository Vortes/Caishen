import { parseMoney } from "~/components/budget/format";

export function parseAssignedAmount(input: string): number {
  const expression = input.replace(/[$,\s]/g, "");
  if (!/^[+-]?\d+(?:\.\d{1,2})?(?:[+-]\d+(?:\.\d{1,2})?)*$/.test(expression))
    throw new Error(
      "Enter an amount or add/subtract amounts, such as 600+1000.",
    );
  const terms = expression.match(/[+-]?\d+(?:\.\d{1,2})?/g)!;
  return terms.reduce((total, term) => {
    const next = total + parseMoney(term.replace(/^\+/, ""));
    if (!Number.isSafeInteger(next))
      throw new Error("That amount is too large.");
    return next;
  }, 0);
}
