"use client";

import { createContext, useContext } from "react";
import { money } from "../app-shell/model";
import {
  cashAccounts,
  PARTNER,
  type Scenario,
  type SharedCategory,
} from "./data";

// Each design choice the owner can flip, with the one variable it moves.
export const choices = {
  entry: {
    variable: "Share entry point",
    options: [
      ["card", "Shared card"],
      ["menu", "Title ⋯ menu"],
    ],
  },
  split: {
    variable: "Split input",
    options: [
      ["presets", "Presets"],
      ["percent", "Percent field"],
    ],
  },
  stop: {
    variable: "Stop-sharing confirmation",
    options: [
      ["inline", "Inline"],
      ["dialog", "Dialog"],
      ["undo", "Undo only"],
    ],
  },
  detail: {
    variable: "Statement detail",
    options: [
      ["drill", "Drill in"],
      ["expand", "Expand in place"],
    ],
  },
  amount: {
    variable: "Settle-up amount",
    options: [
      ["editable", "Editable"],
      ["full", "Full net only"],
    ],
  },
  receipt: {
    variable: "Confirm-receipt friction",
    options: [
      ["form", "Inline form"],
      ["one-click", "One click"],
    ],
  },
} as const;

export type ChoiceKey = keyof typeof choices;
export type Variants = {
  [K in ChoiceKey]: (typeof choices)[K]["options"][number][0];
};

export const defaultVariants: Variants = {
  entry: "card",
  split: "presets",
  stop: "inline",
  detail: "drill",
  amount: "editable",
  receipt: "form",
};

export type Notice = {
  id: number;
  message: string;
  tone?: "attention";
  undo?: () => void;
};

// What the prototype's editors call. Each returns why it can't save, or
// null once the change is applied.
export type Actions = {
  share: (categoryId: string, percent: number) => string | null;
  setSplit: (categoryId: string, percent: number) => string | null;
  stopSharing: (categoryId: string) => string | null;
  settle: (amount: number, accountId: string, date: string) => string | null;
  receive: (
    repaymentId: string,
    accountId: string,
    date: string,
  ) => string | null;
  addOpening: (
    sharedId: string,
    youOwe: boolean,
    amount: number,
  ) => string | null;
  inviteHint: () => void;
};

export type Proto = {
  scenario: Scenario;
  variants: Variants;
  actions: Actions;
  // The current month: editing a past month's statement is refused.
  canRecord: boolean;
  // Opens on load from the index's links.
  initialOpen: string | null;
};

const ProtoContext = createContext<Proto | null>(null);
export const ProtoProvider = ProtoContext.Provider;

export function useProto() {
  const value = useContext(ProtoContext);
  if (!value) throw new Error("useProto needs a ProtoProvider.");
  return value;
}

export const BLOCKED =
  "Saving is paused while Caishen is offline. Your entry is kept here; try again once you're back online.";

export const accountName = (id: string) =>
  cashAccounts.find((item) => item.id === id)?.name ?? "your account";

export const splitLabel = (percent: number) => `${percent}/${100 - percent}`;

export function sharedFor(scenario: Scenario, categoryId: string) {
  return scenario.shared.find((item) => item.categoryId === categoryId);
}

// Whether the engine would refuse shared.remove for it.
export function hasActivity(scenario: Scenario, shared: SharedCategory) {
  return (
    shared.history || shared.purchases.length > 0 || shared.opening.length > 0
  );
}

export const net = (scenario: Scenario) => scenario.youOwe - scenario.owedToYou;

export function verdict(scenario: Scenario) {
  const amount = net(scenario);
  if (amount > 0) return `You owe ${PARTNER} ${money(amount)}`;
  if (amount < 0) return `${PARTNER} owes you ${money(-amount)}`;
  return `You and ${PARTNER} are settled up`;
}
