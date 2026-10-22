import {
  categories,
  names,
  PARTNER,
  partnerOf,
  TODAY,
  type Line,
  type Person,
  type Share,
  type State,
  type Txn,
} from "./data";
import { counterpartyLabel, money } from "./ledger";

// Every change applies to both budgets at once: there is one shared state,
// and each budget is derived from it.

export type Action =
  | { type: "reset"; state: State }
  | {
      type: "share";
      txnId: string;
      lineId: string;
      share: Share | null;
      by: Person;
    }
  | {
      type: "save";
      txnId: string;
      lines: Line[];
      by: Person;
    }
  | { type: "review"; txnId: string }
  | {
      type: "categorizeSide";
      txnId: string;
      categoryId: string;
    }
  | { type: "confirmSettlement"; id: string }
  | { type: "request"; by: Person; amount: number }
  | {
      type: "record";
      by: Person;
      paidBy: Person;
      payee: string;
      date: string;
      amount: number;
      // What the non-payer consumed.
      share: number;
      // The recorder's own category for their part.
      categoryId: string | null;
    }
  | {
      type: "float";
      person: Person;
      kind: "partner" | "reimbursements";
      amount: number;
    }
  | { type: "simulate"; event: SimulatedEvent };

export type SimulatedEvent =
  "anna-zelle" | "birite-import" | "costco-refund" | "northwind-reimburses";

// The non-payer's category for a partner share, from their own payee memory:
// their last categorization of this payee, on their own purchase or on a
// partner entry.
export function rememberedCategory(
  state: State,
  person: Person,
  payee: string,
): string | null {
  const past = [...state.txns]
    .filter((txn) => txn.payee === payee && txn.kind === "spend")
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const txn of past) {
    if (txn.owner === person) {
      const id = txn.lines.find((line) => line.categoryId)?.categoryId;
      if (id) return id;
    } else {
      const id = txn.lines.find(
        (line) => line.partnerCategoryId,
      )?.partnerCategoryId;
      if (id) return id;
    }
  }
  return null;
}

function describeShareChange(
  txn: Txn,
  before: Share | null,
  after: Share | null,
) {
  const who = (share: Share | null) =>
    share ? counterpartyLabel(txn.owner, share.with) : "";
  const was = before?.amount ?? 0;
  const now = after?.amount ?? 0;
  if (before && was > 0 && now === 0)
    return `Changed ${who(before)}'s share from ${money(was)} to $0.00 (written off)`;
  if ((!before || was === 0) && after && now > 0)
    return `Shared ${money(now)} with ${who(after)}`;
  if (before && !after)
    return `Changed ${who(before)}'s share from ${money(was)} to $0.00 (written off)`;
  if (before && after && before.with !== after.with)
    return `Moved the share from ${who(before)} to ${who(after)} (${money(now)})`;
  return `Changed ${who(after)}'s share from ${money(was)} to ${money(now)}`;
}

// A partner share set to nothing stays on the ledger at $0.00, so the
// write-off and its history stay visible to both. Any other empty share is
// just no share.
function keepShare(before: Share | null, after: Share | null): Share | null {
  if (after && after.amount > 0) return after;
  if (before?.with === PARTNER && (!after || after.with === PARTNER))
    return { with: PARTNER, amount: 0 };
  return null;
}

function updateTxn(state: State, id: string, change: (txn: Txn) => Txn) {
  return {
    ...state,
    txns: state.txns.map((txn) => (txn.id === id ? change(txn) : txn)),
  };
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return action.state;
    case "share":
      return updateTxn(state, action.txnId, (txn) => {
        const line = txn.lines.find((item) => item.id === action.lineId)!;
        const share = keepShare(line.share, action.share);
        const same =
          (line.share?.amount ?? 0) === (share?.amount ?? 0) &&
          line.share?.with === share?.with;
        if (same) return { ...txn, reviewed: true };
        const partner = partnerOf(txn.owner);
        return {
          ...txn,
          reviewed: true,
          remembered: false,
          lines: txn.lines.map((item) =>
            item.id === line.id
              ? {
                  ...item,
                  share,
                  partnerCategoryId:
                    share?.with === PARTNER
                      ? (item.partnerCategoryId ??
                        rememberedCategory(state, partner, txn.payee))
                      : null,
                }
              : item,
          ),
          history: [
            ...txn.history,
            {
              at: TODAY,
              by: action.by,
              text: describeShareChange(txn, line.share, share),
            },
          ],
        };
      });
    case "save":
      return updateTxn(state, action.txnId, (txn) => {
        const changes = action.lines.flatMap((line) => {
          const before = txn.lines.find((item) => item.id === line.id);
          const was = before?.share ?? null;
          const now = keepShare(was, line.share);
          if (
            (was?.amount ?? 0) === (now?.amount ?? 0) &&
            was?.with === now?.with
          )
            return [];
          return [
            {
              at: TODAY,
              by: action.by,
              text: describeShareChange(txn, was, now),
            },
          ];
        });
        if (action.lines.length !== txn.lines.length)
          changes.unshift({
            at: TODAY,
            by: action.by,
            text: `Split into ${action.lines.length} lines`,
          });
        const partner = partnerOf(txn.owner);
        return {
          ...txn,
          reviewed: true,
          remembered: false,
          lines: action.lines.map((line) => {
            const share = keepShare(
              txn.lines.find((item) => item.id === line.id)?.share ?? null,
              line.share,
            );
            return {
              ...line,
              share,
              partnerCategoryId:
                share?.with === PARTNER
                  ? (line.partnerCategoryId ??
                    rememberedCategory(state, partner, txn.payee))
                  : null,
            };
          }),
          history: [...txn.history, ...changes],
        };
      });
    case "review":
      return updateTxn(state, action.txnId, (txn) => ({
        ...txn,
        reviewed: true,
      }));
    case "categorizeSide":
      return updateTxn(state, action.txnId, (txn) => ({
        ...txn,
        lines: txn.lines.map((line) =>
          line.share?.with === PARTNER
            ? { ...line, partnerCategoryId: action.categoryId }
            : line,
        ),
      }));
    case "confirmSettlement":
      return {
        ...state,
        settlements: state.settlements.map((item) =>
          item.id === action.id ? { ...item, confirmed: true } : item,
        ),
      };
    case "request":
      return {
        ...state,
        requests: [
          ...state.requests,
          {
            id: nextId("request"),
            by: action.by,
            amount: action.amount,
            date: TODAY,
          },
        ],
      };
    case "record": {
      const payerIsRecorder = action.paidBy === action.by;
      const other = partnerOf(action.paidBy);
      const line: Line = {
        id: nextId("line"),
        categoryId: payerIsRecorder ? action.categoryId : null,
        amount: action.amount,
        share: { with: PARTNER, amount: action.share },
        partnerCategoryId: payerIsRecorder
          ? rememberedCategory(state, other, action.payee)
          : action.categoryId,
      };
      return {
        ...state,
        txns: [
          ...state.txns,
          {
            id: nextId("recorded"),
            owner: action.paidBy,
            accountId: null,
            date: action.date,
            payee: action.payee,
            amount: -action.amount,
            kind: "spend",
            lines: [line],
            status: "posted",
            reviewed: false,
            recordedBy: action.by,
            history: [
              {
                at: TODAY,
                by: action.by,
                text: `Recorded: ${names[action.paidBy]} paid ${money(action.amount)}, ${names[other]}'s share ${money(action.share)}`,
              },
            ],
          },
        ],
      };
    }
    case "float":
      return {
        ...state,
        floats: {
          ...state.floats,
          [action.person]: {
            ...state.floats[action.person],
            [action.kind]: action.amount,
          },
        },
      };
    case "simulate":
      return simulate(state, action.event);
  }
}

function simulate(state: State, event: SimulatedEvent): State {
  switch (event) {
    case "anna-zelle":
      return {
        ...state,
        settlements: [
          ...state.settlements,
          {
            id: nextId("settlement"),
            from: "anna",
            amount: 30_000,
            date: TODAY,
            method: "Zelle",
            confirmed: false,
          },
        ],
      };
    case "birite-import":
      return updateTxn(state, "u-birite", (txn) => ({
        ...txn,
        accountId: "anna-amex",
        status: "pending",
        matched: true,
        remembered: true,
        lines: txn.lines.map((line) => ({
          ...line,
          categoryId:
            line.categoryId ??
            rememberedCategory(state, "anna", "Rainbow Grocery") ??
            "n-groceries",
        })),
      }));
    case "costco-refund": {
      // Payee memory proposes the purchase's share, in proportion.
      const amount = 3_500;
      return {
        ...state,
        txns: [
          ...state.txns,
          {
            id: nextId("refund"),
            owner: "alan",
            accountId: "alan-sapphire",
            date: TODAY,
            payee: "Costco",
            amount,
            kind: "spend",
            lines: [
              {
                id: nextId("line"),
                categoryId: "a-household",
                amount,
                share: { with: PARTNER, amount: amount / 2 },
                partnerCategoryId: "n-household",
              },
            ],
            status: "pending",
            reviewed: false,
            remembered: true,
            recordedBy: "alan",
            history: [],
          },
        ],
      };
    }
    case "northwind-reimburses":
      return {
        ...state,
        txns: [
          ...state.txns,
          {
            id: nextId("reimbursement"),
            owner: "alan",
            accountId: "alan-chase",
            date: TODAY,
            payee: "Northwind Expense Reimbursement",
            amount: 41_200,
            kind: "reimbursement",
            from: "Northwind",
            lines: [],
            status: "pending",
            reviewed: false,
            recordedBy: "alan",
            history: [],
          },
        ],
      };
  }
}

export function categoriesFor(person: Person) {
  return categories.filter((item) => item.owner === person && !item.paired);
}
