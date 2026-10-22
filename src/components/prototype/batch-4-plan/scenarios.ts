import type { PlanView } from "../app-shell/plan-views";
import { initialState, type PrototypeState } from "./fixture";

// What the prototype shows: the budget's state plus the plan's selection,
// focused view, and search.
export type View = {
  state: PrototypeState;
  checked: string[];
  planView: PlanView | null;
  query: string;
};

export type ScenarioId =
  | "snoozed"
  | "snooze-now"
  | "card-payment"
  | "future-month"
  | "past-snoozed"
  | "snoozed-view"
  | "no-income"
  | "income-short"
  | "income-covers"
  | "first-month"
  | "far-future"
  | "search-none";

type Scenario = {
  id: ScenarioId;
  label: string;
  hint: string;
  apply: (base: View) => Partial<View>;
};

const at = (month: string) => ({ ...initialState, month });

export const SCENARIOS: Scenario[] = [
  {
    id: "snoozed",
    label: "A snoozed target",
    hint: "Travel, snoozed for October",
    apply: () => ({ checked: ["travel"] }),
  },
  {
    id: "snooze-now",
    label: "A target to snooze",
    hint: "Emergency fund, $245.74 short",
    apply: () => ({ checked: ["emergency"] }),
  },
  {
    id: "card-payment",
    label: "A card payment target",
    hint: "Can't be snoozed, like YNAB",
    apply: () => ({ checked: ["amex-payment"] }),
  },
  {
    id: "future-month",
    label: "Snooze in a future month",
    hint: "Travel in December 2026",
    apply: () => ({ state: at("2026-12"), checked: ["travel"] }),
  },
  {
    id: "past-snoozed",
    label: "Last month's snooze",
    hint: "Gifts, snoozed in September",
    apply: () => ({ state: at("2026-09"), checked: ["gifts"] }),
  },
  {
    id: "snoozed-view",
    label: "The Snoozed view",
    hint: "Focused view of snoozed targets",
    apply: () => ({ planView: "snoozed" }),
  },
  {
    id: "no-income",
    label: "No expected income",
    hint: "October, September had $6,200",
    apply: () => ({}),
  },
  {
    id: "income-short",
    label: "Income short of targets",
    hint: "October with $3,200 expected",
    apply: () => ({
      state: {
        ...initialState,
        income: { ...initialState.income, "2026-10": 320000 },
      },
    }),
  },
  {
    id: "income-covers",
    label: "Income covers targets",
    hint: "September with $6,200 expected",
    apply: () => ({ state: at("2026-09") }),
  },
  {
    id: "first-month",
    label: "The budget's first month",
    hint: "March 2024, nothing earlier",
    apply: () => ({ state: at("2024-03") }),
  },
  {
    id: "far-future",
    label: "The furthest month",
    hint: "December 2031",
    apply: () => ({ state: at("2031-12") }),
  },
  {
    id: "search-none",
    label: "A search with no matches",
    hint: "“Daycare” (narrowing search)",
    apply: () => ({ query: "Daycare" }),
  },
];

export const scenarioIds = SCENARIOS.map((item) => item.id);
