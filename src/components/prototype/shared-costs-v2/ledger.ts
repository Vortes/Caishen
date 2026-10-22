import type { Funding } from "../app-shell/model";
import {
  accounts as accountDefs,
  categories as categoryDefs,
  initialState,
  names,
  PARTNER,
  partnerOf,
  readyToAssign,
  type AccountDef,
  type Change,
  type Line,
  type Person,
  type Request,
  type State,
  type Txn,
} from "./data";

// One person's budget, derived from the shared state the way the model
// says: the share on each line moves the counterparty account and its
// paired envelope; only the personal share is category activity.

export type CategoryView = {
  id: string;
  name: string;
  group: string;
  assigned: number;
  activity: number;
  available: number;
  funding: Funding;
  status: string;
  paired?: "partner" | "reimbursements" | "card";
  // This month's outflows and the part of them others consumed, for the
  // "paid vs. your spending" breakdown.
  paid: number;
  othersShare: number;
  fromPartner: number;
};

export type AccountView = AccountDef & { balance: number; toReview: boolean };

export type ShareSummary = { with: string; label: string; amount: number };

export type BankRow = {
  id: string;
  kind: "spend" | "income" | "settlement" | "reimbursement";
  txn?: Txn;
  settlementId?: string;
  accountId: string;
  date: string;
  payee: string;
  amount: number;
  status: "pending" | "posted";
  reviewed: boolean;
  categoryLabel: string;
  needsCategory: boolean;
  share: ShareSummary | null;
  split: boolean;
};

export type LedgerRow = {
  id: string;
  kind: "opening" | "purchase" | "settlement" | "expected";
  date: string;
  payee: string;
  paidBy: Person | null;
  recordedBy: Person;
  shared: number;
  // What each person consumed of the shared amount.
  mine: number;
  theirs: number;
  // Signed: positive means the partner owes you more.
  change: number;
  balance: number;
  categoryId: string | null;
  // The viewer's side still needs a category.
  needsCategory: boolean;
  // Only the non-payer picks a category here; the payer's is on their line.
  categorizable: boolean;
  txn?: Txn;
  settlementId?: string;
  confirmed?: boolean;
  source: string;
  history: Change[];
};

export type ReimbursementRow = {
  id: string;
  date: string;
  payee: string;
  who: string;
  categoryLabel: string;
  change: number;
  balance: number;
  txn: Txn;
};

export type RequestView = Request & { paid: number; left: number };

export type Budget = {
  person: Person;
  partner: Person;
  partnerName: string;
  accounts: AccountView[];
  categories: CategoryView[];
  groups: { name: string; categories: CategoryView[] }[];
  readyToAssign: number;
  bank: BankRow[];
  ledger: LedgerRow[];
  upcoming: LedgerRow[];
  partnerBalance: number;
  reimbursements: ReimbursementRow[];
  reimbursementBalance: number;
  owedBy: { who: string; balance: number }[];
  request: RequestView | null;
};

const sign = (amount: number) => (amount < 0 ? -1 : 1);
const shareOf = (line: Line) => line.share?.amount ?? 0;

export function partnerAccountId(person: Person) {
  return `${person}-partner`;
}
export function reimbursementsAccountId(person: Person) {
  return `${person}-reimbursements`;
}

// The other person's partner-side line amounts, signed for the viewer:
// positive means the partner owes the viewer more.
function partnerChange(txn: Txn, viewer: Person) {
  const dir = sign(txn.amount);
  const shared = txn.lines
    .filter((line) => line.share?.with === PARTNER)
    .reduce((sum, line) => sum + shareOf(line), 0);
  return txn.owner === viewer ? -dir * shared : dir * shared;
}

export function sharedLines(txn: Txn) {
  return txn.lines.filter((line) => line.share?.with === PARTNER);
}

export function categoryName(id: string | null | undefined) {
  return categoryDefs.find((item) => item.id === id)?.name;
}

export function accountName(id: string | null) {
  return accountDefs.find((item) => item.id === id)?.name;
}

export function counterpartyLabel(viewer: Person, who: string) {
  return who === PARTNER ? names[partnerOf(viewer)] : who;
}

export function derive(state: State, viewer: Person): Budget {
  const partner = partnerOf(viewer);
  const mineDefs = categoryDefs.filter((item) => item.owner === viewer);
  const activity = new Map<string, number>();
  const paid = new Map<string, number>();
  const others = new Map<string, number>();
  const fromPartner = new Map<string, number>();
  const cashOut = new Map<string, number>();
  const add = (map: Map<string, number>, id: string, value: number) =>
    map.set(id, (map.get(id) ?? 0) + value);
  const isCash = (id: string | null) =>
    accountDefs.find((item) => item.id === id)?.kind === "cash";

  let partnerBalance =
    viewer === "alan" ? state.opening.amount : -state.opening.amount;
  let reimbursementBalance = 0;
  // Fronted from cash rather than a card, so a negative paired envelope
  // shows as cash overspending (red) instead of credit (amber).
  let partnerCashFront = 0;
  let reimbursementCashFront = 0;
  let cardReserve = 0;
  const owed = new Map<string, number>();

  for (const txn of state.txns) {
    if (txn.kind === "reimbursement") {
      if (txn.owner !== viewer) continue;
      reimbursementBalance -= txn.amount;
      reimbursementCashFront -= txn.amount;
      add(owed, txn.from!, -txn.amount);
      continue;
    }
    if (txn.kind !== "spend") continue;
    const dir = sign(txn.amount);
    if (txn.owner === viewer) {
      for (const line of txn.lines) {
        const share = shareOf(line);
        if (txn.accountId) {
          if (line.categoryId) {
            add(activity, line.categoryId, dir * (line.amount - share));
            add(paid, line.categoryId, -dir * line.amount);
            add(others, line.categoryId, -dir * share);
            if (isCash(txn.accountId) && dir < 0)
              add(cashOut, line.categoryId, line.amount - share);
          }
        }
        if (!line.share) continue;
        if (line.share.with === PARTNER) {
          partnerBalance += -dir * share;
          if (isCash(txn.accountId)) partnerCashFront += -dir * share;
        } else {
          reimbursementBalance += -dir * share;
          add(owed, line.share.with, -dir * share);
          if (isCash(txn.accountId)) reimbursementCashFront += -dir * share;
        }
      }
      if (
        txn.accountId &&
        accountDefs.find((item) => item.id === txn.accountId)?.kind === "credit"
      )
        cardReserve += -txn.amount;
    } else {
      for (const line of sharedLines(txn)) {
        partnerBalance += dir * shareOf(line);
        if (line.partnerCategoryId) {
          add(activity, line.partnerCategoryId, dir * shareOf(line));
          add(fromPartner, line.partnerCategoryId, -dir * shareOf(line));
        }
      }
    }
  }
  for (const settlement of state.settlements) {
    const change =
      settlement.from === viewer ? settlement.amount : -settlement.amount;
    partnerBalance += change;
    partnerCashFront += change;
  }

  const floats = state.floats[viewer];
  const categories = mineDefs.map((def): CategoryView => {
    if (def.paired === "partner" || def.paired === "reimbursements") {
      const balance =
        def.paired === "partner" ? partnerBalance : reimbursementBalance;
      const float =
        def.paired === "partner" ? floats.partner : floats.reimbursements;
      const front =
        def.paired === "partner" ? partnerCashFront : reimbursementCashFront;
      const available = float - balance;
      return {
        id: def.id,
        name: def.name,
        group: def.group,
        assigned: float,
        // No receivable shows as $0.00, never -$0.00.
        activity: balance === 0 ? 0 : -balance,
        available,
        funding:
          available < 0
            ? front > 0
              ? "overspent"
              : "credit"
            : available > 0
              ? "funded"
              : "empty",
        status: pairedStatus(def.paired, balance, viewer, owed),
        paired: def.paired,
        paid: 0,
        othersShare: 0,
        fromPartner: 0,
      };
    }
    if (def.paired === "card") {
      return {
        id: def.id,
        name: def.name,
        group: def.group,
        assigned: 0,
        activity: cardReserve,
        available: cardReserve,
        funding: cardReserve > 0 ? "funded" : "empty",
        status: "",
        paired: "card",
        paid: 0,
        othersShare: 0,
        fromPartner: 0,
      };
    }
    const spent = activity.get(def.id) ?? 0;
    const available = def.assigned + spent;
    return {
      id: def.id,
      name: def.name,
      group: def.group,
      assigned: def.assigned,
      activity: spent,
      available,
      funding:
        available < 0
          ? (cashOut.get(def.id) ?? 0) > 0
            ? "overspent"
            : "credit"
          : available > 0 || spent < 0
            ? "funded"
            : "empty",
      status: available < 0 ? `Overspent by ${money(-available)}` : "",
      paid: paid.get(def.id) ?? 0,
      othersShare: others.get(def.id) ?? 0,
      fromPartner: fromPartner.get(def.id) ?? 0,
    };
  });
  const groups: Budget["groups"] = [];
  for (const item of categories) {
    const group = groups.find((entry) => entry.name === item.group);
    if (group) group.categories.push(item);
    else groups.push({ name: item.group, categories: [item] });
  }

  const bank = bankRows(state, viewer);
  const { rows: ledger, upcoming } = ledgerRows(state, viewer);
  const reimbursements = reimbursementRows(state, viewer);

  const accounts = accountDefs
    .filter((item) => item.owner === viewer)
    .map((def): AccountView => {
      if (def.kind === "partner")
        return {
          ...def,
          balance: partnerBalance,
          toReview: ledger.some((row) => row.needsCategory),
        };
      if (def.kind === "reimbursements")
        return { ...def, balance: reimbursementBalance, toReview: false };
      const rows = bank.filter((row) => row.accountId === def.id);
      return {
        ...def,
        balance: def.start + rows.reduce((sum, row) => sum + row.amount, 0),
        toReview: rows.some((row) => !row.reviewed),
      };
    });

  return {
    person: viewer,
    partner,
    partnerName: names[partner],
    accounts,
    categories,
    groups,
    // Assigning a float takes it from Ready to Assign like any category.
    readyToAssign:
      readyToAssign[viewer] -
      (floats.partner - initialState.floats[viewer].partner) -
      (floats.reimbursements - initialState.floats[viewer].reimbursements),
    bank,
    ledger,
    upcoming,
    partnerBalance,
    reimbursements,
    reimbursementBalance,
    owedBy: [...owed.entries()].map(([who, balance]) => ({ who, balance })),
    request: openRequest(state),
  };
}

function pairedStatus(
  paired: "partner" | "reimbursements",
  balance: number,
  viewer: Person,
  owed: Map<string, number>,
) {
  const partner = names[partnerOf(viewer)];
  if (paired === "partner") {
    if (balance > 0) return `${partner} owes you ${money(balance)}`;
    if (balance < 0)
      return `Held for the ${money(-balance)} you owe ${partner}`;
    return `You and ${partner} are even`;
  }
  const open = [...owed.entries()].filter(([, value]) => value > 0);
  if (open.length === 1) return `${open[0]![0]} owes you ${money(open[0]![1])}`;
  if (balance > 0) return `${money(balance)} owed to you`;
  return "Nobody owes you anything";
}

function bankRows(state: State, viewer: Person): BankRow[] {
  const rows: BankRow[] = [];
  for (const txn of state.txns) {
    if (txn.owner !== viewer || !txn.accountId) continue;
    const shared = txn.lines.filter((line) => shareOf(line) > 0);
    const share: ShareSummary | null = shared.length
      ? {
          with: shared[0]!.share!.with,
          label: counterpartyLabel(viewer, shared[0]!.share!.with),
          amount: shared.reduce((sum, line) => sum + shareOf(line), 0),
        }
      : null;
    const uncategorized =
      txn.kind === "spend" && txn.lines.some((line) => !line.categoryId);
    rows.push({
      id: txn.id,
      kind: txn.kind,
      txn,
      accountId: txn.accountId,
      date: txn.date,
      payee: txn.payee,
      amount: txn.amount,
      status: txn.status,
      reviewed: txn.reviewed,
      categoryLabel:
        txn.kind === "income"
          ? "Ready to Assign"
          : txn.kind === "reimbursement"
            ? `Transfer: Reimbursements`
            : uncategorized
              ? "Needs category"
              : txn.lines.length > 1
                ? `Split (${txn.lines.length})`
                : (categoryName(txn.lines[0]?.categoryId) ?? ""),
      needsCategory: uncategorized,
      share,
      split: txn.lines.length > 1,
    });
  }
  const cash = accountDefs.find(
    (item) => item.owner === viewer && item.kind === "cash",
  )!;
  const partner = names[partnerOf(viewer)];
  for (const settlement of state.settlements) {
    const out = settlement.from === viewer;
    rows.push({
      id: `${settlement.id}-${viewer}`,
      kind: "settlement",
      settlementId: settlement.id,
      accountId: cash.id,
      date: settlement.date,
      payee: `${settlement.method} ${out ? "to" : "from"} ${partner}`,
      amount: out ? -settlement.amount : settlement.amount,
      status: "posted",
      reviewed: settlement.confirmed,
      categoryLabel: `Transfer: ${partner}`,
      needsCategory: false,
      share: null,
      split: false,
    });
  }
  return rows.sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
}

function ledgerRows(state: State, viewer: Person) {
  const partner = partnerOf(viewer);
  const rows: Omit<LedgerRow, "balance">[] = [];
  const opening =
    viewer === "alan" ? state.opening.amount : -state.opening.amount;
  rows.push({
    id: "opening",
    kind: "opening",
    date: state.opening.date,
    payee: "Opening balance",
    paidBy: null,
    recordedBy: state.opening.by,
    shared: 0,
    mine: 0,
    theirs: 0,
    change: opening,
    categoryId: null,
    needsCategory: false,
    categorizable: false,
    source: `Entered by ${who(viewer, state.opening.by)} when you linked budgets`,
    history: [],
  });
  for (const txn of state.txns) {
    if (txn.kind !== "spend") continue;
    const lines = sharedLines(txn);
    if (!lines.length) continue;
    const shared = lines.reduce((sum, line) => sum + line.amount, 0);
    const consumed = lines.reduce((sum, line) => sum + shareOf(line), 0);
    const payer = txn.owner === viewer;
    const categoryId = payer
      ? (lines[0]!.categoryId ?? null)
      : (lines[0]!.partnerCategoryId ?? null);
    rows.push({
      id: txn.id,
      kind: "purchase",
      date: txn.date,
      payee: txn.payee,
      paidBy: txn.owner,
      recordedBy: txn.recordedBy,
      shared,
      mine: payer ? shared - consumed : consumed,
      theirs: payer ? consumed : shared - consumed,
      change: partnerChange(txn, viewer),
      categoryId,
      needsCategory: !payer && !categoryId && consumed > 0,
      categorizable: !payer,
      txn,
      source: sourceOf(txn, viewer),
      history: txn.history,
    });
  }
  for (const settlement of state.settlements) {
    const out = settlement.from === viewer;
    rows.push({
      id: settlement.id,
      kind: "settlement",
      date: settlement.date,
      payee: `${settlement.method} ${out ? `to ${names[partner]}` : `from ${names[partner]}`}`,
      paidBy: settlement.from,
      recordedBy: settlement.from,
      shared: settlement.amount,
      mine: 0,
      theirs: 0,
      change: out ? settlement.amount : -settlement.amount,
      categoryId: null,
      needsCategory: false,
      categorizable: false,
      settlementId: settlement.id,
      confirmed: settlement.confirmed,
      source: settlement.confirmed
        ? "Matched in both budgets"
        : "Imported in both budgets. Confirm it in either one.",
      history: [],
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));
  let balance = 0;
  const withBalance = rows.map((row) => {
    balance += row.change;
    return { ...row, balance };
  });
  const upcoming = state.scheduled.map((item): LedgerRow => {
    const payer = item.owner === viewer;
    const change = payer ? item.share : -item.share;
    balance += change;
    return {
      id: item.id,
      kind: "expected",
      date: item.date,
      payee: item.payee,
      paidBy: item.owner,
      recordedBy: item.owner,
      shared: item.amount,
      mine: payer ? item.amount - item.share : item.share,
      theirs: payer ? item.share : item.amount - item.share,
      change,
      balance,
      categoryId: payer ? item.categoryId : null,
      needsCategory: false,
      categorizable: false,
      source: `Scheduled by ${who(viewer, item.owner)}. It joins the balance when it posts.`,
      history: [],
    };
  });
  return { rows: withBalance.reverse(), upcoming };
}

const order = (row: { kind: string }) => (row.kind === "opening" ? -1 : 0);

function sourceOf(txn: Txn, viewer: Person) {
  const partner = names[partnerOf(viewer)];
  const payer = txn.owner === viewer;
  if (!txn.accountId) {
    return txn.recordedBy === viewer
      ? `You recorded this. ${partner}'s bank import will match it when it arrives.`
      : `${names[txn.recordedBy]} recorded this. Your bank import will match it when it arrives.`;
  }
  if (txn.matched)
    return payer
      ? `${partner} recorded this first. Matched to your ${accountName(txn.accountId)} import.`
      : `You recorded this first. Matched to ${partner}'s bank import.`;
  return payer
    ? `From your ${accountName(txn.accountId)} import`
    : `From ${partner}'s bank import`;
}

function who(viewer: Person, person: Person) {
  return person === viewer ? "you" : names[person];
}

function reimbursementRows(state: State, viewer: Person): ReimbursementRow[] {
  const rows: Omit<ReimbursementRow, "balance">[] = [];
  for (const txn of state.txns) {
    if (txn.owner !== viewer) continue;
    if (txn.kind === "reimbursement") {
      rows.push({
        id: txn.id,
        date: txn.date,
        payee: txn.payee,
        who: txn.from!,
        categoryLabel: `Transfer from ${accountName(txn.accountId)}`,
        change: -txn.amount,
        txn,
      });
      continue;
    }
    if (txn.kind !== "spend") continue;
    for (const line of txn.lines) {
      if (!line.share || line.share.with === PARTNER) continue;
      rows.push({
        id: `${txn.id}-${line.id}`,
        date: txn.date,
        payee: txn.payee,
        who: line.share.with,
        categoryLabel: categoryName(line.categoryId) ?? "Needs category",
        change: -sign(txn.amount) * line.share.amount,
        txn,
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  let balance = 0;
  return rows
    .map((row) => {
      balance += row.change;
      return { ...row, balance };
    })
    .reverse();
}

function openRequest(state: State): RequestView | null {
  const latest = [...state.requests].sort((a, b) =>
    b.date.localeCompare(a.date),
  )[0];
  if (!latest) return null;
  const paid = state.settlements
    .filter((item) => item.from !== latest.by && item.date >= latest.date)
    .reduce((sum, item) => sum + item.amount, 0);
  return { ...latest, paid, left: Math.max(0, latest.amount - paid) };
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const signed = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  signDisplay: "exceptZero",
});

export function money(cents: number, withSign = false) {
  return (withSign ? signed : currency).format(cents / 100);
}

export function shortDay(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// What an equal split of an amount gives the other person, rounded down to
// the cent so the payer absorbs the odd cent.
export function equalShare(amount: number, ratio: number) {
  return Math.floor(amount * ratio);
}

export function parseCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
