"use client";

import { createContext, useContext } from "react";
import type { Loan, State } from "./data";

export type Variants = {
  // Where Add loan's form opens: the details panel or a row in the list.
  add: "panel" | "row";
  // How the extra-payment preview compares: numbers, or numbers and a chart.
  compare: "numbers" | "chart";
  // What extra the preview takes: one time only, or one time or monthly.
  cadence: "once" | "both";
  // Where a lender payment is entered: the details panel, or the paying
  // account's register.
  pay: "panel" | "register";
};

export const defaultVariants: Variants = {
  add: "panel",
  compare: "chart",
  cadence: "once",
  pay: "panel",
};

export type Screen =
  | { type: "plan" }
  | { type: "reflect" }
  | { type: "register"; accountId: string | null }
  | { type: "loans" };

export type Tab = "extra" | "payments" | "rates";

// The one editor open at a time, like the shell's transaction entry.
export type Editor =
  | { kind: "add" }
  | { kind: "rate"; loanId: string }
  | { kind: "payment"; loanId: string }
  | { kind: "register-payment"; loanId: string; accountId: string };

export type NewPayment = {
  accountId: string;
  date: string;
  principal: number;
  interest: number;
};

export type Store = {
  state: State;
  month: string;
  variants: Variants;
  // Payments recorded in the prototype, by the account that paid.
  paidFrom: Record<string, string>;
  balance: (accountId: string) => number;
  screen: Screen;
  navigate: (screen: Screen, loanId?: string | null) => void;
  selected: string | null;
  select: (loanId: string | null) => void;
  editor: Editor | null;
  open: (editor: Editor | null) => void;
  tab: Tab;
  setTab: (tab: Tab) => void;
  // The row the register just saved, selected like the shell does.
  justSaved: string | null;
  addLoan: (loan: Loan) => void;
  confirmRate: (loanId: string, annualRateBps: number, date: string) => void;
  recordPayment: (loanId: string, payment: NewPayment) => string;
};

const StoreContext = createContext<Store | null>(null);
export const StoreProvider = StoreContext.Provider;

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore needs a StoreProvider.");
  return store;
}
