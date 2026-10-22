import { newWorld, seedWorld, type Person, type World } from "./model";
import type { Screen } from "./store";

// A state to open the prototype in: whose budget, which screen, what's open.
export type Scenario = {
  id: string;
  label: string;
  hint: string;
  viewer: Person;
  screen: Screen;
  world?: () => World;
  openId?: string;
  selectedId?: string;
  adding?: boolean;
  who?: string;
};

const noFloat = () => {
  const world = seedWorld();
  return {
    ...world,
    floatBefore: {
      ...world.floatBefore,
      alan: { ...world.floatBefore.alan, "env-partner": 0 },
    },
  };
};

export const SCENARIOS: Scenario[] = [
  {
    id: "share-new",
    label: "A new payee",
    hint: "Safeway on Amex, no history: starts as all yours",
    viewer: "alan",
    screen: { type: "register", accountId: "amex" },
    openId: "t-safeway",
  },
  {
    id: "share-memory",
    label: "Payee memory fills the share",
    hint: "Trader Joe's, pending, half with Anna",
    viewer: "alan",
    screen: { type: "register", accountId: "amex" },
    openId: "t-tj2",
  },
  {
    id: "share-schedule",
    label: "A scheduled shared bill",
    hint: "Rent: October's import, November's schedule",
    viewer: "alan",
    screen: { type: "register", accountId: "checking" },
    openId: "t-rent-oct",
  },
  {
    id: "share-add",
    label: "Add a transaction",
    hint: "Type Trader Joe's or a new payee",
    viewer: "alan",
    screen: { type: "register", accountId: "amex" },
    adding: true,
  },
  {
    id: "split",
    label: "A mixed Costco receipt",
    hint: "One personal line, one shared line",
    viewer: "alan",
    screen: { type: "register", accountId: "amex" },
    openId: "t-costco",
  },
  {
    id: "ledger",
    label: "Alan's ledger with Anna",
    hint: "Anna owes Alan $360.00",
    viewer: "alan",
    screen: { type: "partner" },
  },
  {
    id: "ledger-anna",
    label: "Anna's ledger with Alan",
    hint: "The mirror: she owes $360.00",
    viewer: "anna",
    screen: { type: "partner" },
  },
  {
    id: "unmatched",
    label: "Recorded, not yet imported",
    hint: "PG&E: Anna paid, Alan recorded it",
    viewer: "alan",
    screen: { type: "partner" },
    openId: "t-pge",
  },
  {
    id: "nonpayer",
    label: "Dinner Anna paid, Alan's side",
    hint: "Nopa, prefilled Dining out, to approve",
    viewer: "alan",
    screen: { type: "partner" },
    openId: "t-nopa",
  },
  {
    id: "nonpayer-anna",
    label: "Costco, Anna's side",
    hint: "No history, so it needs her category",
    viewer: "anna",
    screen: { type: "partner" },
    openId: "t-costco",
  },
  {
    id: "env-float",
    label: "Paired envelope with a float",
    hint: "Anna envelope, $500 float, $140 left",
    viewer: "alan",
    screen: { type: "plan" },
    selectedId: "env-partner",
  },
  {
    id: "env-cash",
    label: "No float, fronted in cash",
    hint: "Red: overspent in cash",
    viewer: "alan",
    screen: { type: "plan" },
    selectedId: "env-partner",
    world: noFloat,
  },
  {
    id: "env-credit",
    label: "Float too small, fronted on credit",
    hint: "Reimbursements, amber",
    viewer: "alan",
    screen: { type: "plan" },
    selectedId: "env-reimb",
  },
  {
    id: "env-reserve",
    label: "A reserve for what you owe",
    hint: "Anna's Alan envelope",
    viewer: "anna",
    screen: { type: "plan" },
    selectedId: "env-partner",
  },
  {
    id: "settle",
    label: "Settlement to confirm",
    hint: "Venmo from Anna in Chase Checking",
    viewer: "alan",
    screen: { type: "register", accountId: "checking" },
    openId: "s-venmo",
  },
  {
    id: "settle-anna",
    label: "The same settlement, Anna's side",
    hint: "Her Venmo outflow",
    viewer: "anna",
    screen: { type: "register", accountId: "ally" },
    openId: "s-venmo",
  },
  {
    id: "card-direct",
    label: "Anna paid Alan's card",
    hint: "Payment on Amex Gold",
    viewer: "alan",
    screen: { type: "register", accountId: "amex" },
    openId: "s-card",
  },
  {
    id: "reimb",
    label: "Reimbursements, everyone",
    hint: "Sam and Acme Corp",
    viewer: "alan",
    screen: { type: "reimbursements" },
  },
  {
    id: "reimb-sam",
    label: "Reimbursements, Sam only",
    hint: "Concert tickets, half paid back",
    viewer: "alan",
    screen: { type: "reimbursements" },
    who: "Sam Ortiz",
    openId: "t-ticket:l1",
  },
  {
    id: "reimb-received",
    label: "Sam's payback",
    hint: "Refills the envelope, not Ready to Assign",
    viewer: "alan",
    screen: { type: "register", accountId: "checking" },
    openId: "r-sam",
  },
  {
    id: "edit-share",
    label: "Edit a share, with history",
    hint: "Costco, changed once already",
    viewer: "alan",
    screen: { type: "partner" },
    openId: "t-costco",
  },
  {
    id: "writeoff",
    label: "Write off a share",
    hint: "Trader Joe's, Oct 3",
    viewer: "alan",
    screen: { type: "partner" },
    openId: "t-tj",
  },
  {
    id: "refund",
    label: "Refund after settling",
    hint: "Target: bought in September, refunded in October",
    viewer: "alan",
    screen: { type: "partner" },
    openId: "t-target-refund",
  },
  {
    id: "request",
    label: "An open request",
    hint: "Alan asked for $1,350.00",
    viewer: "alan",
    screen: { type: "partner" },
  },
  {
    id: "request-anna",
    label: "The request, Anna's side",
    hint: "$350.00 to go",
    viewer: "anna",
    screen: { type: "partner" },
  },
  {
    id: "opening",
    label: "Opening balance",
    hint: "Entered once, Sep 1",
    viewer: "alan",
    screen: { type: "partner" },
    openId: "opening",
  },
  {
    id: "new",
    label: "Before partnering",
    hint: "No partner, nobody owes anything",
    viewer: "alan",
    screen: { type: "plan" },
    world: newWorld,
  },
  {
    id: "new-partner",
    label: "Partnering and the opening balance",
    hint: "Invite, join, enter what's owed",
    viewer: "alan",
    screen: { type: "partner" },
    world: newWorld,
  },
  {
    id: "new-reimb",
    label: "Reimbursements, empty",
    hint: "Nobody owes you yet",
    viewer: "alan",
    screen: { type: "reimbursements" },
    world: newWorld,
  },
];

export const scenarioIds = SCENARIOS.map((item) => item.id);
