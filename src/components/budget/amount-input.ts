import { groupThousands } from "./format";

// Groups the thousands in an amount field as it is typed and keeps the caret
// after the same digit once the commas shift. Returns the grouped text.
export function groupAmountInput(input: HTMLInputElement) {
  const next = groupThousands(input.value);
  const before = input.value
    .slice(0, input.selectionStart ?? input.value.length)
    .replace(/,/g, "").length;
  let caret = 0;
  for (let seen = 0; caret < next.length && seen < before; caret++)
    if (next[caret] !== ",") seen++;
  requestAnimationFrame(() => input.setSelectionRange(caret, caret));
  return next;
}
