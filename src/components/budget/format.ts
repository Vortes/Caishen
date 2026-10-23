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
export function money(data: FormData, key: string) {
  return parseMoney(text(data, key));
}
export function parseMoney(input: string) {
  const value = input.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(value))
    throw new Error(
      "Enter a dollar amount with no more than two decimal places.",
    );
  const sign = value.startsWith("-") ? -1 : 1;
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  const cents = sign * (Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
  if (!Number.isSafeInteger(cents))
    throw new Error("That amount is too large.");
  return cents;
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
