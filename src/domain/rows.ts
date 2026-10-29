import type {
  Account,
  Assignment,
  Book,
  Budget,
  Category,
  Loan,
  PayeeMemory,
  Target,
  Transaction,
  TransactionHistory,
  TransactionLine,
} from "./engine";
import type {
  FormerPartnerEntry,
  PartnerEntry,
  PartnerSide,
} from "./partner-ledger";
import type { PartnerRequest, PartnerSettlement } from "./partner-settlements";
import type { PersonalLedger } from "./shared-ledger";

// Personal budgets and household data stored as rows (ADR 0006). The engine
// still runs over an in-memory Book or personal ledger; this module maps
// between that and rows, both ways, so the server and the browser hold the
// same rows and build the same ledger from them.

/** Every row table. */
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
  "transactionHistory",
  "loan",
  "loanRate",
  "loanPayment",
  // Standing rules, which are no longer kept: stored rows still read, and
  // the engine leaves them out of every budget.
  "rule",
  "bankImport",
  "transactionLine",
  "payeeMemory",
  "partnerEntry",
  "partnerEntrySide",
  "partnerSettlement",
  "partnerRequest",
  "formerPartnerEntry",
] as const;
export type TableName = (typeof tableNames)[number];

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
  transaction: Owned & Sorted & Omit<Transaction, "history" | "lines">;
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
  rule: Owned &
    Sorted & {
      id: string;
      fromCategoryId: string;
      toCategoryId: string;
      enabled: boolean;
    };
  // One bank connection's import state for one logical bank transaction,
  // written by the server, never by the engine. The server validates the
  // parts it holds (src/server/services/bank-import-rows.ts).
  bankImport: Owned &
    Sorted & {
      connectionId: string;
      logicalId: string;
      record?: unknown;
      resolved?: unknown;
      error?: string;
      reviews?: unknown[];
    };
  // One line of a split transaction, in the transaction's order.
  transactionLine: Owned & Sorted & { transactionId: string } & TransactionLine;
  payeeMemory: Owned & { payeeKey: string } & PayeeMemory;
  // The partner ledger both budgets share, and each partner's private side
  // of its entries (src/domain/partner-ledger.ts).
  partnerEntry: Sorted & PartnerEntry;
  partnerEntrySide: Owned & { entryId: string } & PartnerSide;
  // Settling up between the partners (src/domain/partner-settlements.ts).
  partnerSettlement: Sorted & PartnerSettlement;
  partnerRequest: Sorted & PartnerRequest;
  // A former partner's entry, kept frozen in one budget under its closed
  // account (src/domain/partner-ledger.ts).
  formerPartnerEntry: Owned & Sorted & FormerPartnerEntry;
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
// budget owner's id.
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
  "transactionHistory",
  "transactionLine",
  "loan",
  "loanRate",
  "loanPayment",
  "rule",
  "bankImport",
  "payeeMemory",
  "partnerEntrySide",
  "formerPartnerEntry",
]);

/**
 * The partner whose personal budget a row belongs to, or null for the
 * household's rows (members and everything shared).
 */
export function rowOwner(row: Pick<WireRow, "table" | "id">): string | null {
  return budgetTables.has(row.table) ? rowKeyParts(row.id)[0]! : null;
}

/**
 * Whether a partner's browser holds the row: their own budget's rows and
 * the household's shared rows.
 */
export function rowVisibleTo(
  row: Pick<WireRow, "table" | "id">,
  viewerId: string,
): boolean {
  return budgetTables.has(row.table)
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

export function payeeMemoryRows(
  userId: string,
  payeeKey: string,
  memory: PayeeMemory | undefined,
): WireRow[] {
  return memory
    ? [
        row("payeeMemory", rowKey(userId, payeeKey), {
          ...memory,
          userId,
          payeeKey,
        }),
      ]
    : [];
}

export function partnerSideRows(
  userId: string,
  entryId: string,
  side: PartnerSide | undefined,
): WireRow[] {
  return side
    ? [
        row("partnerEntrySide", rowKey(userId, entryId), {
          ...side,
          userId,
          entryId,
        }),
      ]
    : [];
}

export function partnerEntryRow(entry: PartnerEntry, sort: number): WireRow {
  return row("partnerEntry", rowKey(entry.id), { ...entry, sort });
}

export function partnerSettlementRow(
  settlement: PartnerSettlement,
  sort: number,
): WireRow {
  return row("partnerSettlement", rowKey(settlement.id), {
    ...settlement,
    sort,
  });
}

export function partnerRequestRow(
  request: PartnerRequest,
  sort: number,
): WireRow {
  return row("partnerRequest", rowKey(request.id), { ...request, sort });
}

// What both partners' browsers hold of settling up.
function settlingUpRows(state: {
  partnerSettlements?: PartnerSettlement[];
  partnerRequests?: PartnerRequest[];
}): WireRow[] {
  return [
    ...(state.partnerSettlements ?? []).map(partnerSettlementRow),
    ...(state.partnerRequests ?? []).map(partnerRequestRow),
  ];
}

export function transactionRows(
  userId: string,
  transaction: Transaction,
  sort: number,
): WireRow[] {
  const id = transaction.id;
  const rows = [
    row("transaction", rowKey(userId, id), {
      ...without(transaction, ["history", "lines"]),
      userId,
      sort,
    }),
  ];
  transaction.lines?.forEach((line, sort) =>
    rows.push(
      row("transactionLine", rowKey(userId, id, line.id), {
        ...line,
        userId,
        transactionId: id,
        sort,
      }),
    ),
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
    ...Object.entries(budget.payeeMemory ?? {}).flatMap(([key, memory]) =>
      payeeMemoryRows(userId, key, memory),
    ),
    ...Object.entries(budget.partnerSides ?? {}).flatMap(([entryId, side]) =>
      partnerSideRows(userId, entryId, side),
    ),
    ...(budget.formerPartnerEntries ?? []).map((entry, sort) =>
      row("formerPartnerEntry", rowKey(userId, entry.accountId, entry.id), {
        ...entry,
        userId,
        sort,
      }),
    ),
  ];
}

// Each child table's parent, and the parts of a child's key that name it.
const parents: Partial<Record<TableName, [TableName, number]>> = {
  target: ["category", 2],
  transactionHistory: ["transaction", 2],
  transactionLine: ["transaction", 2],
  loanRate: ["loan", 2],
  loanPayment: ["loan", 2],
};

/** Child rows whose parent row is missing or deleted. */
export function orphanRows(rows: Iterable<WireRow>): WireRow[] {
  const all = [...rows].filter((row) => !row.deleted);
  const present = new Set(all.map((row) => `${row.table} ${row.id}`));
  return all.filter((row) => {
    const parent = parents[row.table];
    return (
      parent &&
      !present.has(
        `${parent[0]} ${rowKey(...rowKeyParts(row.id).slice(0, parent[1]))}`,
      )
    );
  });
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
export function tombstone(
  row: Pick<WireRow, "table" | "id">,
  revision = 0,
): WireRow {
  return {
    table: row.table,
    id: row.id,
    revision,
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
    ...(book.partnerEntries ?? []).map(partnerEntryRow),
    ...settlingUpRows(book),
  ]);
}

/**
 * The rows one partner's browser holds for a personal ledger: their budget,
 * and the household's shared rows.
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
    ...(ledger.partnerEntries ?? []).map(partnerEntryRow),
    ...settlingUpRows(ledger),
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
  const lines = groupBy(
    [...data.transactionLine].sort((a, b) => a.sort - b.sort),
    (line) => childKey(line.userId, line.transactionId),
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
  const settings = new Map(
    data.budgetSettings.map((item) => [item.userId, item]),
  );
  const memory = groupBy(data.payeeMemory, owner);
  const sides = groupBy(data.partnerEntrySide, owner);
  const former = groupBy(data.formerPartnerEntry, owner);
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
    const payees = memory.get(userId);
    const partnerSides = sides.get(userId);
    const formerPartnerEntries = former.get(userId);
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
        const split = lines.get(key);
        return {
          ...without(transaction, ["userId", "sort"]),
          ...(split
            ? {
                lines: split.map((line) =>
                  without(line, ["userId", "transactionId", "sort"]),
                ),
              }
            : {}),
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
      settings: {
        timezone: setting.timezone,
        emailEnabled: setting.emailEnabled,
        emailHour: setting.emailHour,
      },
      expectedIncome: Object.fromEntries(
        (income.get(userId) ?? []).map((item) => [item.month, item.amount]),
      ),
      ...(payees
        ? {
            payeeMemory: Object.fromEntries(
              payees.map((item) => [
                item.payeeKey,
                without(item, ["userId", "payeeKey"]),
              ]),
            ),
          }
        : {}),
      ...(partnerSides
        ? {
            partnerSides: Object.fromEntries(
              partnerSides.map((side) => [
                side.entryId,
                without(side, ["userId", "entryId"]),
              ]),
            ),
          }
        : {}),
      ...(formerPartnerEntries
        ? {
            formerPartnerEntries: formerPartnerEntries.map((entry) =>
              without(entry, ["userId", "sort"]),
            ),
          }
        : {}),
    };
  });
}

// The partner ledger's entries, when the household has any.
function partnerEntriesFrom(data: Tables): { partnerEntries?: PartnerEntry[] } {
  return data.partnerEntry.length
    ? {
        partnerEntries: data.partnerEntry.map((entry) =>
          without(entry, ["sort"]),
        ),
      }
    : {};
}

// Settling up, when the household has settled or asked.
function settlingUpFrom(data: Tables): {
  partnerSettlements?: PartnerSettlement[];
  partnerRequests?: PartnerRequest[];
} {
  return {
    ...(data.partnerSettlement.length
      ? {
          partnerSettlements: data.partnerSettlement.map((settlement) =>
            without(settlement, ["sort"]),
          ),
        }
      : {}),
    ...(data.partnerRequest.length
      ? {
          partnerRequests: data.partnerRequest.map((request) =>
            without(request, ["sort"]),
          ),
        }
      : {}),
  };
}

/**
 * The household a set of rows holds. The audit is empty, since operations
 * are recorded outside the rows.
 */
export function rowsToBook(rows: Iterable<WireRow>): Book {
  const data = tables(rows);
  const budgets = budgetsFrom(
    data,
    data.member.map((member) => member.userId),
  );
  return {
    version: 1,
    budgets: Object.fromEntries(
      budgets.map((budget) => [budget.userId, budget]),
    ),
    audit: [],
    ...partnerEntriesFrom(data),
    ...settlingUpFrom(data),
  };
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
  return {
    kind: "personal",
    version: 1,
    budget: budget!,
    members: data.member.map((member) => ({
      userId: member.userId,
      name: member.name,
    })),
    audit: [],
    ...partnerEntriesFrom(data),
    ...settlingUpFrom(data),
  };
}
