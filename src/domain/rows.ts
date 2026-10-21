import type {
  Account,
  Assignment,
  Book,
  Budget,
  Category,
  Loan,
  Obligation,
  Reimbursement,
  Settlement,
  SharedCategory,
  Target,
  Transaction,
  TransactionHistory,
} from "./engine";
import {
  deriveObligations,
  settlementReceiptDate,
  type PersonalLedger,
  type SharedPurchaseFact,
} from "./shared-ledger";

// Personal budgets and household data stored as rows (ADR 0006). The engine
// still runs over an in-memory Book or personal ledger; this module maps
// between that and rows, both ways, so the server and the browser hold the
// same rows and build the same ledger from them.

/** Every row table. A closed set that only grows. */
export const tableNames = [
  "member",
  "budgetSettings",
  "account",
  "categoryGroup",
  "category",
  "target",
  "assignment",
  "expectedIncome",
  "transaction",
  "transactionShare",
  "transactionHistory",
  "loan",
  "loanRate",
  "loanPayment",
  "reimbursement",
  "reimbursementReceipt",
  "rule",
  "bankImport",
  "sharedCategory",
  "obligation",
  "settlement",
  "settlementAllocation",
  "partnerFact",
] as const;
export type TableName = (typeof tableNames)[number];

// The partner's data a personal ledger's numbers use, derived from the
// partner's transactions and settlements for one viewer
// (src/domain/shared-ledger.ts).
export type PartnerFact = { viewerId: string } & (
  | ({ kind: "purchase"; sort: number } & SharedPurchaseFact)
  | { kind: "receipt"; settlementId: string; date: string }
  | {
      kind: "activity";
      payerId: string;
      sharedCategoryId: string;
      sort: number;
    }
);

// `userId` is the owner of the personal budget the row belongs to. `sort`
// orders a collection: the order items were added shows in projections.
type Owned = { userId: string };
type Sorted = { sort: number };
export type TableData = {
  member: Owned & Sorted & { name: string };
  budgetSettings: Owned & { startMonth: string } & Budget["settings"];
  account: Owned & Sorted & Account;
  // Listed newest first, so the oldest group has sort 0.
  categoryGroup: Owned & Sorted & { name: string };
  category: Owned & Sorted & Omit<Category, "target">;
  target: Owned & { categoryId: string } & Target;
  assignment: Owned & Sorted & Assignment;
  expectedIncome: Owned & { month: string; amount: number };
  transaction: Owned &
    Sorted &
    Omit<Transaction, "history" | "shares" | "splitWeights">;
  transactionShare: Owned & {
    transactionId: string;
    participantId: string;
    share?: number;
    weight?: number;
  };
  // Keyed by position, not revision: combining records repeats revisions.
  transactionHistory: Owned & {
    transactionId: string;
    sequence: number;
  } & TransactionHistory;
  loan: Owned & Sorted & Omit<Loan, "rates" | "payments">;
  loanRate: Owned & {
    loanId: string;
    sequence: number;
  } & Loan["rates"][number];
  loanPayment: Owned & Sorted & { loanId: string } & Loan["payments"][number];
  reimbursement: Owned & Sorted & Omit<Reimbursement, "receipts">;
  reimbursementReceipt: Owned &
    Sorted & { reimbursementId: string } & Reimbursement["receipts"][number];
  rule: Owned & Sorted & Budget["rules"][number];
  // Written by the server's bank import state, never by the engine.
  bankImport: Owned & Record<string, unknown>;
  sharedCategory: Sorted & SharedCategory;
  // Opening shared balances only; generated obligations are derived.
  obligation: Sorted & Obligation;
  settlement: Sorted & Omit<Settlement, "allocations">;
  settlementAllocation: {
    settlementId: string;
    sequence: number;
  } & Settlement["allocations"][number];
  partnerFact: PartnerFact;
};

/**
 * A row as the server sends it. `revision` is the household revision at
 * which it last changed; a deleted row (tombstone) has no data. Rows the
 * engine produces carry revision 0 until the server stamps them.
 */
export type WireRow = {
  [T in TableName]: {
    table: T;
    id: string;
    revision: number;
    deleted: boolean;
    data: TableData[T] | null;
  };
}[TableName];

/**
 * What one operation changed. `before[i]` and `after[i]` are the same row;
 * a row the operation created has a deleted `before`, and one it removed a
 * deleted `after`, so reverting is applying `before`.
 */
export type ChangeSet = {
  operationId: string;
  revision: number;
  after: WireRow[];
  before: WireRow[];
};

/** Rows by table and id, deleted rows included. */
export type RowSet = ReadonlyMap<TableName, ReadonlyMap<string, WireRow>>;

// A row id joins its key's parts with "/". Budget rows start with the
// budget owner's id and partner facts with the viewer's.
export function rowKey(...parts: string[]): string {
  return parts
    .map((part) => part.replaceAll("%", "%25").replaceAll("/", "%2F"))
    .join("/");
}
export function rowKeyParts(id: string): string[] {
  return id
    .split("/")
    .map((part) =>
      part.replace(/%(25|2F)/g, (code) => (code === "%25" ? "%" : "/")),
    );
}

const budgetTables = new Set<TableName>([
  "budgetSettings",
  "account",
  "categoryGroup",
  "category",
  "target",
  "assignment",
  "expectedIncome",
  "transaction",
  "transactionShare",
  "transactionHistory",
  "loan",
  "loanRate",
  "loanPayment",
  "reimbursement",
  "reimbursementReceipt",
  "rule",
  "bankImport",
]);

/**
 * Whether a partner's browser holds the row: their own budget's rows, the
 * household's shared rows, and the partner facts derived for them.
 */
export function rowVisibleTo(
  row: Pick<WireRow, "table" | "id">,
  viewerId: string,
): boolean {
  return budgetTables.has(row.table) || row.table === "partnerFact"
    ? rowKeyParts(row.id)[0] === viewerId
    : true;
}

// A deep copy of a JSON value without undefined fields, which JSON storage
// can't hold, and without the given top-level keys. Rows never share
// objects with the ledger they came from.
function plain<T>(value: T, skip?: ReadonlySet<string>): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return (value as unknown[]).map((item) => plain(item)) as T;
  const copy: Record<string, unknown> = {};
  for (const key in value) {
    const item = value[key];
    if (item !== undefined && !skip?.has(key)) copy[key] = plain(item);
  }
  return copy as T;
}

function without<T extends object, K extends string>(
  data: T,
  keys: readonly K[],
): Omit<T, K> {
  return plain(data, new Set<string>(keys));
}

function row<T extends TableName>(
  table: T,
  id: string,
  data: TableData[T],
): WireRow {
  return {
    table,
    id,
    revision: 0,
    deleted: false,
    data: plain(data),
  } as WireRow;
}

const safe = (amount: number): number => {
  if (!Number.isSafeInteger(amount))
    throw new Error("Amount exceeds safe integer cents");
  return amount;
};

/**
 * Folds assignments to one per budget category and month, holding their
 * total, at the position and with the id of the first. Month figures only
 * ever sum a month's assignments, so folding changes none of them. Budgets
 * saved before assignments were folded can hold several.
 */
export function foldAssignments(assignments: Assignment[]): Assignment[] {
  const folded = new Map<string, Assignment>();
  for (const assignment of assignments) {
    const key = `${assignment.month}:${assignment.categoryId}`;
    const found = folded.get(key);
    if (found) found.amount = safe(found.amount + assignment.amount);
    else folded.set(key, { ...assignment });
  }
  return folded.size === assignments.length
    ? assignments
    : [...folded.values()];
}

// The rows of one part of a ledger. The change tracker builds the same rows
// for the parts a command touched.

export function memberRows(budget: Budget, sort: number): WireRow[] {
  return [
    row("member", rowKey(budget.userId), {
      userId: budget.userId,
      name: budget.name,
      sort,
    }),
    row("budgetSettings", rowKey(budget.userId), {
      userId: budget.userId,
      startMonth: budget.startMonth,
      ...budget.settings,
    }),
  ];
}

export function accountRow(
  userId: string,
  account: Account,
  sort: number,
): WireRow {
  return row("account", rowKey(userId, account.id), {
    ...account,
    userId,
    sort,
  });
}

export function groupRows(budget: Budget): WireRow[] {
  const groups = budget.groups ?? [];
  return groups.map((name, index) =>
    row("categoryGroup", rowKey(budget.userId, name), {
      userId: budget.userId,
      name,
      sort: groups.length - 1 - index,
    }),
  );
}

export function categoryRows(
  userId: string,
  category: Category,
  sort: number,
): WireRow[] {
  const rows = [
    row("category", rowKey(userId, category.id), {
      ...without(category, ["target"]),
      userId,
      sort,
    }),
  ];
  if (category.target)
    rows.push(
      row("target", rowKey(userId, category.id), {
        ...category.target,
        userId,
        categoryId: category.id,
      }),
    );
  return rows;
}

export function assignmentRow(
  userId: string,
  assignment: Assignment,
  sort: number,
): WireRow {
  return row(
    "assignment",
    rowKey(userId, assignment.categoryId, assignment.month),
    { ...assignment, userId, sort },
  );
}

export function expectedIncomeRows(
  userId: string,
  month: string,
  amount: number | undefined,
): WireRow[] {
  return amount === undefined
    ? []
    : [row("expectedIncome", rowKey(userId, month), { userId, month, amount })];
}

export function transactionRows(
  userId: string,
  transaction: Transaction,
  sort: number,
): WireRow[] {
  const id = transaction.id;
  const rows = [
    row("transaction", rowKey(userId, id), {
      ...without(transaction, ["history", "shares", "splitWeights"]),
      userId,
      sort,
    }),
  ];
  const participants = [
    ...new Set([
      ...Object.keys(transaction.shares ?? {}),
      ...Object.keys(transaction.splitWeights ?? {}),
    ]),
  ].sort();
  for (const participantId of participants)
    rows.push(
      row("transactionShare", rowKey(userId, id, participantId), {
        userId,
        transactionId: id,
        participantId,
        share: transaction.shares?.[participantId],
        weight: transaction.splitWeights?.[participantId],
      }),
    );
  transaction.history.forEach((entry, sequence) =>
    rows.push(
      row("transactionHistory", rowKey(userId, id, String(sequence)), {
        ...entry,
        userId,
        transactionId: id,
        sequence,
      }),
    ),
  );
  return rows;
}

export function loanRows(userId: string, loan: Loan, sort: number): WireRow[] {
  return [
    row("loan", rowKey(userId, loan.id), {
      ...without(loan, ["rates", "payments"]),
      userId,
      sort,
    }),
    ...loan.rates.map((rate, sequence) =>
      row("loanRate", rowKey(userId, loan.id, String(sequence)), {
        ...rate,
        userId,
        loanId: loan.id,
        sequence,
      }),
    ),
    ...loan.payments.map((payment, index) =>
      row("loanPayment", rowKey(userId, loan.id, payment.id), {
        ...payment,
        userId,
        loanId: loan.id,
        sort: index,
      }),
    ),
  ];
}

export function reimbursementRows(
  userId: string,
  claim: Reimbursement,
  sort: number,
): WireRow[] {
  return [
    row("reimbursement", rowKey(userId, claim.id), {
      ...without(claim, ["receipts"]),
      userId,
      sort,
    }),
    ...claim.receipts.map((receipt, index) =>
      row("reimbursementReceipt", rowKey(userId, claim.id, receipt.id), {
        ...receipt,
        userId,
        reimbursementId: claim.id,
        sort: index,
      }),
    ),
  ];
}

export function ruleRows(budget: Budget): WireRow[] {
  return budget.rules.map((rule, sort) =>
    row("rule", rowKey(budget.userId, rule.id), {
      ...rule,
      userId: budget.userId,
      sort,
    }),
  );
}

export function sharedCategoryRows(shared: SharedCategory[]): WireRow[] {
  return shared.map((category, sort) =>
    row("sharedCategory", rowKey(category.id), { ...category, sort }),
  );
}

export function openingObligationRows(obligations: Obligation[]): WireRow[] {
  return obligations
    .filter((obligation) => obligation.opening)
    .map((obligation, sort) =>
      row("obligation", rowKey(obligation.id), { ...obligation, sort }),
    );
}

export function settlementRows(
  settlement: Settlement,
  sort: number,
): WireRow[] {
  return [
    row("settlement", rowKey(settlement.id), {
      ...without(settlement, ["allocations"]),
      sort,
    }),
    ...settlement.allocations.map((allocation, sequence) =>
      row("settlementAllocation", rowKey(settlement.id, String(sequence)), {
        ...allocation,
        settlementId: settlement.id,
        sequence,
      }),
    ),
  ];
}

/**
 * The partner facts one viewer's personal ledger needs, derived from the
 * other partners' budgets as projectSharedLedger derives them: their shared
 * purchases, when they received settlements, and which shared categories
 * they have activity in.
 */
export function partnerFactRows(book: Book, viewerId: string): WireRow[] {
  const sharedIds = new Set(
    book.sharedCategories
      .filter((category) => category.participants.includes(viewerId))
      .map((category) => category.id),
  );
  const rows: WireRow[] = [];
  const active = new Set<string>();
  for (const budget of Object.values(book.budgets)) {
    if (budget.userId === viewerId) continue;
    budget.transactions.forEach((transaction, sort) => {
      const sharedCategoryId = transaction.sharedCategoryId;
      if (!sharedCategoryId || !sharedIds.has(sharedCategoryId)) return;
      if (!active.has(sharedCategoryId)) {
        active.add(sharedCategoryId);
        rows.push(
          row("partnerFact", rowKey(viewerId, "activity", sharedCategoryId), {
            viewerId,
            kind: "activity",
            payerId: budget.userId,
            sharedCategoryId,
            sort,
          }),
        );
      }
      if (transaction.removed || !transaction.shares || transaction.amount >= 0)
        return;
      rows.push(
        row(
          "partnerFact",
          rowKey(viewerId, "purchase", budget.userId, transaction.id),
          {
            viewerId,
            kind: "purchase",
            sort,
            id: transaction.id,
            payerId: budget.userId,
            sharedCategoryId,
            date: transaction.date,
            expenseMonth: transaction.expenseMonth,
            amount: transaction.amount,
            payee: transaction.payee,
            status: transaction.status,
            shares: transaction.shares,
          },
        ),
      );
    });
  }
  for (const settlement of book.settlements) {
    if (settlement.recipientId === viewerId || settlement.payerId !== viewerId)
      continue;
    const recipient = Object.hasOwn(book.budgets, settlement.recipientId)
      ? book.budgets[settlement.recipientId]
      : undefined;
    const date =
      settlement.amount === 0
        ? settlement.date
        : recipient && settlementReceiptDate(recipient, settlement.id);
    if (date)
      rows.push(
        row("partnerFact", rowKey(viewerId, "receipt", settlement.id), {
          viewerId,
          kind: "receipt",
          settlementId: settlement.id,
          date,
        }),
      );
  }
  return rows;
}

function budgetRows(budget: Budget, sort: number): WireRow[] {
  const userId = budget.userId;
  return [
    ...memberRows(budget, sort),
    ...budget.accounts.map((account, index) =>
      accountRow(userId, account, index),
    ),
    ...groupRows(budget),
    ...budget.categories.flatMap((category, index) =>
      categoryRows(userId, category, index),
    ),
    ...foldAssignments(budget.assignments).map((assignment, index) =>
      assignmentRow(userId, assignment, index),
    ),
    ...Object.entries(budget.expectedIncome).flatMap(([month, amount]) =>
      expectedIncomeRows(userId, month, amount),
    ),
    ...budget.transactions.flatMap((transaction, index) =>
      transactionRows(userId, transaction, index),
    ),
    ...budget.loans.flatMap((loan, index) => loanRows(userId, loan, index)),
    ...budget.reimbursements.flatMap((claim, index) =>
      reimbursementRows(userId, claim, index),
    ),
    ...ruleRows(budget),
  ];
}

/** Whether two JSON values are equal, whatever order their keys are in. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  if (Array.isArray(a))
    return (
      a.length === (b as unknown[]).length &&
      a.every((item, index) => sameJson(item, (b as unknown[])[index]))
    );
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = b as Record<string, unknown>;
  return (
    left.length ===
      Object.values(right).filter((value) => value !== undefined).length &&
    left.every(([key, value]) => sameJson(value, right[key]))
  );
}

/** A row that does not exist: before its creation or after its removal. */
export function tombstone(row: Pick<WireRow, "table" | "id">): WireRow {
  return {
    table: row.table,
    id: row.id,
    revision: 0,
    deleted: true,
    data: null,
  };
}

/**
 * The change from one set of rows to another, as pairs of the same row
 * before and after. Rows whose content is equal are left out.
 */
export function diffRows(
  before: Iterable<WireRow>,
  after: Iterable<WireRow>,
): { before: WireRow[]; after: WireRow[] } {
  const key = (row: WireRow) => `${row.table} ${row.id}`;
  const previous = new Map<string, WireRow>();
  for (const row of before) if (!row.deleted) previous.set(key(row), row);
  const changes = { before: [] as WireRow[], after: [] as WireRow[] };
  const seen = new Set<string>();
  for (const row of after) {
    if (row.deleted) continue;
    seen.add(key(row));
    const old = previous.get(key(row));
    if (old && sameJson(old.data, row.data)) continue;
    changes.before.push(old ?? tombstone(row));
    changes.after.push(row);
  }
  for (const [id, row] of previous)
    if (!seen.has(id)) {
      changes.before.push(row);
      changes.after.push(tombstone(row));
    }
  return changes;
}

function unique(rows: WireRow[]): WireRow[] {
  const seen = new Set<string>();
  for (const item of rows) {
    const key = `${item.table} ${item.id}`;
    if (seen.has(key))
      throw new Error(`Two ${item.table} rows share the id ${item.id}`);
    seen.add(key);
  }
  return rows;
}

/**
 * Every row of a household. The command audit is not part of the rows; it
 * moves to the operations table. Assignments are folded.
 */
export function bookToRows(book: Book): WireRow[] {
  const members = Object.values(book.budgets);
  return unique([
    ...members.flatMap((budget, sort) => budgetRows(budget, sort)),
    ...sharedCategoryRows(book.sharedCategories),
    ...openingObligationRows(book.obligations),
    ...book.settlements.flatMap((settlement, sort) =>
      settlementRows(settlement, sort),
    ),
    ...members.flatMap((budget) => partnerFactRows(book, budget.userId)),
  ]);
}

/**
 * The rows one partner's browser holds for a personal ledger: their budget,
 * the household's shared rows, and their partner facts.
 */
export function personalLedgerToRows(ledger: PersonalLedger): WireRow[] {
  const userId = ledger.budget.userId;
  const memberSort = new Map(
    ledger.members.map((member, sort) => [member.userId, sort]),
  );
  return unique([
    ...budgetRows(ledger.budget, memberSort.get(userId) ?? 0).filter(
      (item) => item.table !== "member",
    ),
    ...ledger.members.map((member, sort) =>
      row("member", rowKey(member.userId), {
        userId: member.userId,
        name: member.userId === userId ? ledger.budget.name : member.name,
        sort,
      }),
    ),
    ...sharedCategoryRows(ledger.sharedCategories),
    ...openingObligationRows(ledger.obligations),
    ...ledger.settlements.flatMap((settlement, sort) =>
      settlementRows(settlement, sort),
    ),
    ...ledger.partnerPurchases.map((purchase, sort) =>
      row(
        "partnerFact",
        rowKey(userId, "purchase", purchase.payerId, purchase.id),
        { ...purchase, viewerId: userId, kind: "purchase", sort },
      ),
    ),
    ...Object.entries(ledger.partnerReceiptDates).map(([settlementId, date]) =>
      row("partnerFact", rowKey(userId, "receipt", settlementId), {
        viewerId: userId,
        kind: "receipt",
        settlementId,
        date,
      }),
    ),
    ...ledger.partnerActivityCategoryIds.map((sharedCategoryId, sort) =>
      row("partnerFact", rowKey(userId, "activity", sharedCategoryId), {
        viewerId: userId,
        kind: "activity",
        // The ledger doesn't say which partner the activity came from.
        payerId: "",
        sharedCategoryId,
        sort,
      }),
    ),
  ]);
}

type Tables = { [T in TableName]: TableData[T][] };

function tables(rows: Iterable<WireRow>): Tables {
  const grouped = Object.fromEntries(
    tableNames.map((table) => [table, []]),
  ) as unknown as Record<TableName, unknown[]>;
  for (const item of rows)
    if (!item.deleted && item.data) grouped[item.table].push(item.data);
  for (const table of tableNames)
    (grouped[table] as Partial<Sorted>[]).sort(
      (a, b) => (a.sort ?? 0) - (b.sort ?? 0),
    );
  return grouped as Tables;
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

const owner = (item: { userId: string }) => item.userId;
const childKey = (userId: string, parentId: string) => rowKey(userId, parentId);

function budgetsFrom(data: Tables, userIds: string[]): Budget[] {
  const accounts = groupBy(data.account, owner);
  const groups = groupBy(data.categoryGroup, owner);
  const categories = groupBy(data.category, owner);
  const targets = new Map(
    data.target.map((target) => [
      childKey(target.userId, target.categoryId),
      target,
    ]),
  );
  const assignments = groupBy(data.assignment, owner);
  const income = groupBy(data.expectedIncome, owner);
  const transactions = groupBy(data.transaction, owner);
  const shares = groupBy(data.transactionShare, (share) =>
    childKey(share.userId, share.transactionId),
  );
  const history = groupBy(
    [...data.transactionHistory].sort((a, b) => a.sequence - b.sequence),
    (entry) => childKey(entry.userId, entry.transactionId),
  );
  const loans = groupBy(data.loan, owner);
  const rates = groupBy(
    [...data.loanRate].sort((a, b) => a.sequence - b.sequence),
    (rate) => childKey(rate.userId, rate.loanId),
  );
  const payments = groupBy(data.loanPayment, (payment) =>
    childKey(payment.userId, payment.loanId),
  );
  const claims = groupBy(data.reimbursement, owner);
  const receipts = groupBy(data.reimbursementReceipt, (receipt) =>
    childKey(receipt.userId, receipt.reimbursementId),
  );
  const rules = groupBy(data.rule, owner);
  const settings = new Map(
    data.budgetSettings.map((item) => [item.userId, item]),
  );
  const names = new Map(data.member.map((member) => [member.userId, member]));
  return userIds.map((userId): Budget => {
    const setting =
      settings.get(userId) ??
      (() => {
        throw new Error(`The rows hold no budget settings for ${userId}`);
      })();
    const groupNames = (groups.get(userId) ?? [])
      .reverse()
      .map((group) => group.name);
    const record = (values: Record<string, number> | undefined) =>
      values && Object.keys(values).length ? values : undefined;
    return {
      userId,
      name: names.get(userId)?.name ?? "",
      startMonth: setting.startMonth,
      accounts: (accounts.get(userId) ?? []).map((account) =>
        without(account, ["userId", "sort"]),
      ),
      ...(groupNames.length ? { groups: groupNames } : {}),
      categories: (categories.get(userId) ?? []).map((category) => {
        const target = targets.get(childKey(userId, category.id));
        return {
          ...without(category, ["userId", "sort"]),
          ...(target
            ? { target: without(target, ["userId", "categoryId"]) }
            : {}),
        };
      }),
      transactions: (transactions.get(userId) ?? []).map((transaction) => {
        const key = childKey(userId, transaction.id);
        const parts = shares.get(key) ?? [];
        const values = (field: "share" | "weight") =>
          record(
            Object.fromEntries(
              parts.flatMap((part) =>
                part[field] === undefined
                  ? []
                  : [[part.participantId, part[field]]],
              ),
            ),
          );
        const shared = values("share");
        const weights = values("weight");
        return {
          ...without(transaction, ["userId", "sort"]),
          ...(shared ? { shares: shared } : {}),
          ...(weights ? { splitWeights: weights } : {}),
          history: (history.get(key) ?? []).map((entry) =>
            without(entry, ["userId", "transactionId", "sequence"]),
          ),
        };
      }),
      assignments: (assignments.get(userId) ?? []).map((assignment) =>
        without(assignment, ["userId", "sort"]),
      ),
      loans: (loans.get(userId) ?? []).map((loan) => {
        const key = childKey(userId, loan.id);
        return {
          ...without(loan, ["userId", "sort"]),
          rates: (rates.get(key) ?? []).map((rate) =>
            without(rate, ["userId", "loanId", "sequence"]),
          ),
          payments: (payments.get(key) ?? []).map((payment) =>
            without(payment, ["userId", "loanId", "sort"]),
          ),
        };
      }),
      reimbursements: (claims.get(userId) ?? []).map((claim) => ({
        ...without(claim, ["userId", "sort"]),
        receipts: (receipts.get(childKey(userId, claim.id)) ?? []).map(
          (receipt) => without(receipt, ["userId", "reimbursementId", "sort"]),
        ),
      })),
      rules: (rules.get(userId) ?? []).map((rule) =>
        without(rule, ["userId", "sort"]),
      ),
      settings: {
        timezone: setting.timezone,
        emailEnabled: setting.emailEnabled,
        emailHour: setting.emailHour,
      },
      expectedIncome: Object.fromEntries(
        (income.get(userId) ?? []).map((item) => [item.month, item.amount]),
      ),
    };
  });
}

function settlementsFrom(data: Tables): Settlement[] {
  const allocations = groupBy(
    [...data.settlementAllocation].sort((a, b) => a.sequence - b.sequence),
    (allocation) => allocation.settlementId,
  );
  return data.settlement.map((settlement) => ({
    ...without(settlement, ["sort"]),
    allocations: (allocations.get(settlement.id) ?? []).map((allocation) =>
      without(allocation, ["settlementId", "sequence"]),
    ),
  }));
}

/**
 * The household a set of rows holds. Generated obligations are derived from
 * the shared purchases; the audit is empty, since operations are recorded
 * outside the rows.
 */
export function rowsToBook(rows: Iterable<WireRow>): Book {
  const data = tables(rows);
  const budgets = budgetsFrom(
    data,
    data.member.map((member) => member.userId),
  );
  const book: Book = {
    version: 1,
    budgets: Object.fromEntries(
      budgets.map((budget) => [budget.userId, budget]),
    ),
    sharedCategories: data.sharedCategory.map((category) =>
      without(category, ["sort"]),
    ),
    obligations: data.obligation.map((obligation) =>
      without(obligation, ["sort"]),
    ),
    settlements: settlementsFrom(data),
    audit: [],
  };
  book.obligations = deriveObligations(book);
  return book;
}

/**
 * One partner's personal ledger from the rows their browser holds, equal to
 * the one built from the whole household (personalLedger in engine.ts).
 */
export function rowsToPersonalLedger(
  rows: Iterable<WireRow>,
  viewerId: string,
): PersonalLedger {
  const data = tables([...rows].filter((item) => rowVisibleTo(item, viewerId)));
  const [budget] = budgetsFrom(data, [viewerId]);
  const memberSort = new Map(
    data.member.map((member) => [member.userId, member.sort]),
  );
  const facts = data.partnerFact.filter((fact) => fact.viewerId === viewerId);
  const ordered = <T extends { payerId: string; sort: number }>(items: T[]) =>
    items.sort(
      (a, b) =>
        (memberSort.get(a.payerId) ?? 0) - (memberSort.get(b.payerId) ?? 0) ||
        a.sort - b.sort,
    );
  const sharedCategories = data.sharedCategory
    .filter((category) => category.participants.includes(viewerId))
    .map((category) => without(category, ["sort"]));
  const ledger: PersonalLedger = {
    kind: "personal",
    version: 1,
    budget: budget!,
    members: data.member.map((member) => ({
      userId: member.userId,
      name: member.name,
    })),
    sharedCategories,
    obligations: data.obligation.map((obligation) =>
      without(obligation, ["sort"]),
    ),
    settlements: settlementsFrom(data),
    partnerPurchases: ordered(
      facts.flatMap((fact) => (fact.kind === "purchase" ? [fact] : [])),
    ).map((fact) => without(fact, ["viewerId", "kind", "sort"])),
    partnerReceiptDates: Object.fromEntries(
      facts.flatMap((fact) =>
        fact.kind === "receipt" ? [[fact.settlementId, fact.date]] : [],
      ),
    ),
    partnerActivityCategoryIds: ordered(
      facts.flatMap((fact) => (fact.kind === "activity" ? [fact] : [])),
    ).map((fact) => fact.sharedCategoryId),
    audit: [],
  };
  // What the viewer's numbers use, as projectSharedLedger selects it.
  const sharedIds = new Set(sharedCategories.map((category) => category.id));
  const obligations = deriveObligations(ledger).filter(
    (obligation) =>
      sharedIds.has(obligation.sharedCategoryId) &&
      (obligation.debtorId === viewerId || obligation.creditorId === viewerId),
  );
  const obligationIds = new Set(obligations.map((obligation) => obligation.id));
  ledger.obligations = obligations;
  ledger.settlements = ledger.settlements
    .filter(
      (settlement) =>
        settlement.payerId === viewerId || settlement.recipientId === viewerId,
    )
    .map((settlement) => ({
      ...settlement,
      allocations: settlement.allocations.filter((allocation) =>
        obligationIds.has(allocation.obligationId),
      ),
    }));
  return ledger;
}
