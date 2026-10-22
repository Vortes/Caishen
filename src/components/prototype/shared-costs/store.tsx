"use client";

import { createContext, use, useEffect, useRef } from "react";
import type { Budget, Person, World } from "./model";

// Each variant moves one variable; the recommended value of each leads.
export type Variants = {
  // Where a line's share is entered.
  entry: "row" | "panel";
  // How the share's amount is chosen.
  input: "presets" | "amount";
  // How the partner balance reads.
  balance: "sentence" | "signed";
  // Where the two counterparty accounts sit in the sidebar.
  placement: "section" | "tracking";
};

export const defaultVariants: Variants = {
  entry: "row",
  input: "presets",
  balance: "sentence",
  placement: "section",
};

export type Screen =
  | { type: "plan" }
  | { type: "register"; accountId: string | null }
  | { type: "partner" }
  | { type: "reimbursements" };

export type Store = {
  world: World;
  viewer: Person;
  budget: Budget;
  variants: Variants;
  screen: Screen;
  // Applies a change to both budgets at once, with an optional notice.
  update: (change: (world: World) => World, message?: string) => void;
  notify: (message: string) => void;
  navigate: (screen: Screen) => void;
};

const Context = createContext<Store | null>(null);

export const StoreProvider = Context.Provider;

export function useStore() {
  const store = use(Context);
  if (!store) throw new Error("useStore needs a StoreProvider.");
  return store;
}

// An editor or detail card that opens in a list scrolls itself into view.
export function useRevealed<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return ref;
}
