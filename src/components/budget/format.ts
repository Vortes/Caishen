export function currentMonth(timezone = "America/Los_Angeles") {
  return new Date()
    .toLocaleDateString("en-CA", {
      year: "numeric",
      month: "2-digit",
      timeZone: timezone,
    })
    .slice(0, 7);
}
export function today(timezone = "America/Los_Angeles") {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: timezone,
  });
}
export function monthName(month: string) {
  return new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
export function moveMonth(month: string, delta: number) {
  const date = new Date(`${month}-15T12:00:00`);
  date.setMonth(date.getMonth() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
// Adds thousands separators to each number in a typed amount, including the
// numbers in a calculation like 1200*12; text with anything else is left as
// typed for the parsers to judge.
export function groupThousands(input: string) {
  const plain = input.replace(/,/g, "");
  if (!/^[-+−*/×÷^()\d.\s]*$/.test(plain)) return input;
  return plain.replace(
    /(^|[^.\d])(\d+)/g,
    (_, before: string, whole: string) =>
      before + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  );
}
// Where the caret goes once groupThousands has added or moved separators:
// after as many characters other than separators as it had before it.
export function caretAfterSameDigit(text: string, at: number, grouped: string) {
  const before = text.slice(0, at).replace(/,/g, "").length;
  let caret = 0;
  for (let seen = 0; caret < grouped.length && seen < before; caret++)
    if (grouped[caret] !== ",") seen++;
  return caret;
}
export function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}
export function newId() {
  return crypto.randomUUID();
}

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
