// Hardcoded people and data for the Batch 1 prototypes. Nothing here talks
// to Clerk, Plaid, or the budget API.

export const me = {
  firstName: "Alex",
  fullName: "Alex Rivera",
  email: "alex.rivera@gmail.com",
  budgetName: "Alex’s budget",
};

export const partner = {
  firstName: "Jordan",
  fullName: "Jordan Lee",
  email: "jordan.lee@fastmail.com",
  connectedOn: "Oct 3, 2026",
};

// Invite codes are 24 random bytes in base64url, as budget.invite makes them.
export const myInviteCode = "q3Jx9vT2mKpL0aZ7cR4wYbN8eH1sUfGd";
export const partnerInviteCode = "Vn6pR2tYb8LqXz0mKc5wHa3sJd7uEf1G";

// The browser's zone, as Intl reports it, picked first in every list.
export const detectedTimezone = "America/Los_Angeles";

// The zones a US-first budget needs, named by a city people recognize.
export const timezones: { id: string; label: string }[] = [
  { id: "America/Los_Angeles", label: "Pacific time (Los Angeles)" },
  { id: "America/Denver", label: "Mountain time (Denver)" },
  { id: "America/Phoenix", label: "Arizona (Phoenix)" },
  { id: "America/Chicago", label: "Central time (Chicago)" },
  { id: "America/New_York", label: "Eastern time (New York)" },
  { id: "America/Anchorage", label: "Alaska (Anchorage)" },
  { id: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Berlin", label: "Central Europe (Berlin)" },
  { id: "Asia/Shanghai", label: "China (Shanghai)" },
  { id: "Asia/Tokyo", label: "Japan (Tokyo)" },
  { id: "Australia/Sydney", label: "Sydney" },
];

export const timezoneLabel = (id: string) =>
  timezones.find((zone) => zone.id === id)?.label ?? id;

// "Los Angeles" from "Pacific time (Los Angeles)", for short sentences.
export const timezoneCity = (id: string) => {
  const label = timezoneLabel(id);
  return /\((.+)\)/.exec(label)?.[1] ?? label;
};

export const hourLabel = (hour: number) => {
  const suffix = hour < 12 ? "a.m." : "p.m.";
  const clock = hour % 12 === 0 ? 12 : hour % 12;
  if (hour === 0) return "Midnight";
  if (hour === 12) return "Noon";
  return `${clock} ${suffix}`;
};

export const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export type BankAccount = {
  id: string;
  name: string;
  mask: string;
  balance: number;
  // Where it lands in the budget; null for accounts the budget can't hold.
  kind: "cash" | "credit" | null;
  reason?: string;
};

export const chaseAccounts: BankAccount[] = [
  {
    id: "chk",
    name: "Total Checking",
    mask: "4421",
    balance: 318055,
    kind: "cash",
  },
  {
    id: "sav",
    name: "Premier Savings",
    mask: "7710",
    balance: 103000,
    kind: "cash",
  },
  {
    id: "csp",
    name: "Sapphire Preferred",
    mask: "1123",
    balance: -61240,
    kind: "credit",
  },
  {
    id: "401k",
    name: "401(k)",
    mask: "0091",
    balance: 4821000,
    kind: null,
    reason: "Retirement accounts aren’t supported yet",
  },
];
