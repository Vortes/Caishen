import {
  rowKey,
  rowKeyParts,
  tableNames,
  tombstone,
  type TableName,
  type WireRow,
} from "~/domain/rows";

// How each row table in src/domain/rows.ts is stored: one database table per
// row table with a column per field (ADR 0006). This module converts between
// a row's data and its columns; src/server/storage/rows.ts reads and writes
// them. A test checks these columns against prisma/schema.prisma.

type ColumnType = "text" | "int" | "cents" | "bool" | "json" | "texts";

type Column = {
  name: string;
  type: ColumnType;
  /** The data field, when it differs from the column name. */
  field?: string;
  optional?: true;
  /**
   * The optional object field this column is part of. The object is present
   * when its columns are set, and its own fields are all required.
   */
  within?: string;
};

export type TableSpec = {
  table: TableName;
  /** The database table (Prisma model) name. */
  model: string;
  /**
   * The columns whose values, in order, make the row id. "key" means the id
   * is stored as is in a `key` column.
   */
  key: readonly string[] | "key";
  /** The column naming the partner whose browser alone holds the row. */
  visibleTo?: "userId" | "viewerId";
  columns: readonly Column[];
};

const text = (name: string, optional?: true): Column => ({
  name,
  type: "text",
  optional,
});
const int = (name: string, optional?: true): Column => ({
  name,
  type: "int",
  optional,
});
const cents = (name: string, optional?: true): Column => ({
  name,
  type: "cents",
  optional,
});
const bool = (name: string, optional?: true): Column => ({
  name,
  type: "bool",
  optional,
});
const json = (name: string, optional?: true): Column => ({
  name,
  type: "json",
  optional,
});
const texts = (name: string): Column => ({ name, type: "texts" });
const userId = text("userId");
const sort = int("sort");

const specs: Record<TableName, Omit<TableSpec, "table">> = {
  member: {
    model: "Member",
    key: ["userId"],
    columns: [userId, text("name"), sort],
  },
  budgetSettings: {
    model: "BudgetSettings",
    key: ["userId"],
    visibleTo: "userId",
    columns: [
      userId,
      text("startMonth"),
      text("timezone"),
      bool("emailEnabled"),
      int("emailHour"),
    ],
  },
  account: {
    model: "Account",
    key: ["userId", "id"],
    visibleTo: "userId",
    columns: [
      userId,
      text("id"),
      text("name"),
      text("kind"),
      cents("openingBalance"),
      text("date"),
      {
        name: "reconciledDate",
        field: "date",
        within: "reconciled",
        type: "text",
      },
      {
        name: "reconciledBalance",
        field: "balance",
        within: "reconciled",
        type: "cents",
      },
      sort,
    ],
  },
  categoryGroup: {
    model: "CategoryGroup",
    key: ["userId", "name"],
    visibleTo: "userId",
    columns: [userId, text("name"), sort],
  },
  category: {
    model: "Category",
    key: ["userId", "id"],
    visibleTo: "userId",
    columns: [
      userId,
      text("id"),
      text("name"),
      text("group"),
      text("pairedAccountId", true),
      text("pairedLoanId", true),
      text("counterpartyAccountId", true),
      sort,
    ],
  },
  target: {
    model: "Target",
    key: ["userId", "categoryId"],
    visibleTo: "userId",
    columns: [
      userId,
      text("categoryId"),
      text("cadence"),
      text("behavior"),
      cents("amount"),
      text("startMonth"),
      text("dueDate", true),
      int("weekday", true),
      int("monthDay", true),
      int("repeatEvery", true),
      text("repeatUnit", true),
      texts("snoozedMonths"),
    ],
  },
  assignment: {
    model: "Assignment",
    key: ["userId", "categoryId", "month"],
    visibleTo: "userId",
    columns: [
      userId,
      text("categoryId"),
      text("month"),
      text("id"),
      cents("amount"),
      sort,
    ],
  },
  expectedIncome: {
    model: "ExpectedIncome",
    key: ["userId", "month"],
    visibleTo: "userId",
    columns: [userId, text("month"), cents("amount")],
  },
  transaction: {
    model: "Transaction",
    key: ["userId", "id"],
    visibleTo: "userId",
    columns: [
      userId,
      text("id"),
      text("accountId"),
      text("date"),
      cents("amount"),
      text("payee"),
      text("status"),
      text("categoryId", true),
      text("expenseMonth"),
      text("sharedCategoryId", true),
      text("providerId", true),
      { name: "transactionRevision", field: "revision", type: "int" },
      bool("reviewed"),
      text("kind"),
      text("linkedId", true),
      json("counterpartyShare", true),
      text("refundOfTransactionId", true),
      text("linkedCounterpartyAccountId", true),
      text("counterpartyName", true),
      text("partnerSettlementId", true),
      bool("removed", true),
      bool("reconciled", true),
      sort,
    ],
  },
  transactionShare: {
    model: "TransactionShare",
    key: ["userId", "transactionId", "participantId"],
    visibleTo: "userId",
    columns: [
      userId,
      text("transactionId"),
      text("participantId"),
      cents("share", true),
      cents("weight", true),
    ],
  },
  transactionHistory: {
    model: "TransactionHistory",
    key: ["userId", "transactionId", "sequence"],
    visibleTo: "userId",
    columns: [
      userId,
      text("transactionId"),
      int("sequence"),
      { name: "transactionRevision", field: "revision", type: "int" },
      cents("amount"),
      text("status"),
      text("date"),
      text("payee"),
      text("operationId"),
      text("reason"),
      text("combinedId", true),
      text("actorId", true),
      text("at", true),
      json("shareChanges", true),
    ],
  },
  transactionLine: {
    model: "TransactionLine",
    key: ["userId", "transactionId", "id"],
    visibleTo: "userId",
    columns: [
      userId,
      text("transactionId"),
      text("id"),
      text("categoryId"),
      cents("amount"),
      json("counterpartyShare", true),
      sort,
    ],
  },
  loan: {
    model: "Loan",
    key: ["userId", "id"],
    visibleTo: "userId",
    columns: [
      userId,
      text("id"),
      text("name"),
      text("categoryId"),
      cents("principal"),
      cents("minimumPayment"),
      bool("variable"),
      sort,
    ],
  },
  loanRate: {
    model: "LoanRate",
    key: ["userId", "loanId", "sequence"],
    visibleTo: "userId",
    columns: [
      userId,
      text("loanId"),
      int("sequence"),
      text("effectiveDate"),
      int("annualRateBps"),
    ],
  },
  loanPayment: {
    model: "LoanPayment",
    key: ["userId", "loanId", "id"],
    visibleTo: "userId",
    columns: [
      userId,
      text("loanId"),
      text("id"),
      text("date"),
      cents("principal"),
      cents("interest"),
      sort,
    ],
  },
  reimbursement: {
    model: "Reimbursement",
    key: ["userId", "id"],
    visibleTo: "userId",
    columns: [
      userId,
      text("id"),
      text("transactionId"),
      text("name"),
      cents("amount"),
      text("kind"),
      sort,
    ],
  },
  reimbursementReceipt: {
    model: "ReimbursementReceipt",
    key: ["userId", "reimbursementId", "id"],
    visibleTo: "userId",
    columns: [
      userId,
      text("reimbursementId"),
      text("id"),
      text("date"),
      cents("amount"),
      sort,
    ],
  },
  rule: {
    model: "Rule",
    key: ["userId", "id"],
    visibleTo: "userId",
    columns: [
      userId,
      text("id"),
      text("fromCategoryId"),
      text("toCategoryId"),
      bool("enabled"),
      sort,
    ],
  },
  bankImport: {
    model: "BankImport",
    key: ["userId", "connectionId", "logicalId"],
    visibleTo: "userId",
    columns: [
      userId,
      text("connectionId"),
      text("logicalId"),
      json("record", true),
      json("resolved", true),
      text("error", true),
      json("reviews", true),
      sort,
    ],
  },
  sharedCategory: {
    model: "SharedCategory",
    key: ["id"],
    columns: [
      text("id"),
      texts("participants"),
      json("weights"),
      json("categoryIds"),
      sort,
    ],
  },
  obligation: {
    model: "Obligation",
    key: ["id"],
    columns: [
      text("id"),
      text("sharedCategoryId"),
      text("debtorId"),
      text("creditorId"),
      cents("amount"),
      text("expenseMonth", true),
      text("transactionId", true),
      text("payerId", true),
      text("payee", true),
      text("date", true),
      bool("opening"),
      sort,
    ],
  },
  settlement: {
    model: "Settlement",
    key: ["id"],
    columns: [
      text("id"),
      text("payerId"),
      text("recipientId"),
      text("date"),
      cents("amount"),
      bool("received"),
      sort,
    ],
  },
  settlementAllocation: {
    model: "SettlementAllocation",
    key: ["settlementId", "sequence"],
    columns: [
      text("settlementId"),
      int("sequence"),
      text("obligationId"),
      cents("amount"),
      text("kind"),
    ],
  },
  partnerFact: {
    model: "PartnerFact",
    key: "key",
    visibleTo: "viewerId",
    columns: [
      text("viewerId"),
      text("kind"),
      text("payerId", true),
      text("sharedCategoryId", true),
      text("settlementId", true),
      { name: "transactionId", field: "id", type: "text", optional: true },
      text("date", true),
      text("expenseMonth", true),
      cents("amount", true),
      text("payee", true),
      text("status", true),
      json("shares", true),
      int("sort", true),
    ],
  },
  payeeMemory: {
    model: "PayeeMemory",
    key: ["userId", "payeeKey"],
    visibleTo: "userId",
    columns: [
      userId,
      text("payeeKey"),
      text("payee"),
      text("kind"),
      text("categoryId", true),
      json("counterpartyShare", true),
    ],
  },
  partnerEntry: {
    model: "PartnerEntry",
    key: ["id"],
    columns: [
      text("id"),
      text("payerId"),
      {
        name: "sourceTransactionId",
        field: "transactionId",
        within: "source",
        type: "text",
      },
      {
        name: "sourceLineId",
        field: "lineId",
        within: "source",
        type: "text",
      },
      text("date"),
      text("payee"),
      text("status"),
      cents("amount"),
      cents("share"),
      bool("removed", true),
      json("history"),
      sort,
    ],
  },
  partnerEntrySide: {
    model: "PartnerEntrySide",
    key: ["userId", "entryId"],
    visibleTo: "userId",
    columns: [userId, text("entryId"), text("categoryId", true)],
  },
  partnerSettlement: {
    model: "PartnerSettlement",
    key: ["id"],
    columns: [
      text("id"),
      text("payerId"),
      text("date"),
      cents("amount"),
      text("method"),
      bool("confirmed"),
      bool("removed", true),
      json("history"),
      sort,
    ],
  },
  partnerRequest: {
    model: "PartnerRequest",
    key: ["id"],
    columns: [
      text("id"),
      text("requesterId"),
      text("date"),
      cents("amount"),
      sort,
    ],
  },
};

/** Every table's storage, parents before children. */
export const tableSpecs: readonly TableSpec[] = tableNames.map((table) => ({
  table,
  ...specs[table],
}));

export const tableSpec = (table: TableName): TableSpec => ({
  table,
  ...specs[table],
});

export const postgresTypes: Record<ColumnType, string> = {
  text: "text",
  int: "integer",
  cents: "bigint",
  bool: "boolean",
  json: "jsonb",
  texts: "text[]",
};

/** The columns that identify a row within its household. */
export function keyColumns(spec: TableSpec): Column[] {
  return spec.key === "key"
    ? [text("key")]
    : spec.key.map((name) =>
        spec.columns.find((column) => column.name === name)!,
      );
}

export class StoredRowError extends Error {
  constructor(spec: TableSpec, id: string, problem: string) {
    super(`${spec.table} row ${JSON.stringify(id)}: ${problem}`);
    this.name = "StoredRowError";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function checkValue(
  spec: TableSpec,
  id: string,
  column: Column,
  value: unknown,
): unknown {
  const valid = {
    text: () => typeof value === "string",
    int: () =>
      Number.isSafeInteger(value) && Math.abs(value as number) < 2 ** 31,
    cents: () => Number.isSafeInteger(value),
    bool: () => typeof value === "boolean",
    json: () => value !== null && value !== undefined,
    texts: () =>
      Array.isArray(value) && value.every((item) => typeof item === "string"),
  }[column.type]();
  if (!valid)
    throw new StoredRowError(
      spec,
      id,
      `${column.name} is not a valid ${column.type} value`,
    );
  return value;
}

const fieldOf = (column: Column) => column.field ?? column.name;

/** The id a row's key columns make. */
export function rowIdOf(
  spec: TableSpec,
  columns: Record<string, unknown>,
): string {
  return rowKey(
    ...keyColumns(spec).map((column) => String(columns[column.name])),
  );
}

/** A row's key columns, read from its id. */
export function keyOf(spec: TableSpec, id: string): Record<string, unknown> {
  if (spec.key === "key") return { key: id };
  const parts = rowKeyParts(id);
  const columns = keyColumns(spec);
  if (parts.length !== columns.length)
    throw new StoredRowError(spec, id, "the id doesn't match the table's key");
  const key: Record<string, unknown> = Object.fromEntries(
    columns.map((column, index): [string, unknown] => {
      const part = parts[index]!;
      if (column.type !== "int") return [column.name, part];
      const value = Number(part);
      if (String(value) !== part)
        throw new StoredRowError(spec, id, `${column.name} is not a number`);
      return [column.name, value];
    }),
  );
  if (rowIdOf(spec, key) !== id)
    throw new StoredRowError(spec, id, "the id doesn't match the table's key");
  return key;
}

/**
 * A live row's columns, keyed by column name. Refuses data it can't store
 * whole: an unknown field, a missing required one, or a value of the wrong
 * type, so nothing is ever silently dropped.
 */
export function toColumns(
  spec: TableSpec,
  row: WireRow,
): Record<string, unknown> {
  const data = row.data as unknown;
  if (row.deleted || !isObject(data))
    throw new StoredRowError(spec, row.id, "a live row needs data");
  const known = new Set(
    spec.columns.map((column) => column.within ?? fieldOf(column)),
  );
  for (const [field, value] of Object.entries(data))
    if (value !== undefined && !known.has(field))
      throw new StoredRowError(spec, row.id, `no column holds ${field}`);
  const columns: Record<string, unknown> = {};
  for (const column of spec.columns) {
    let value: unknown;
    if (column.within) {
      const object = data[column.within];
      if (object !== undefined && !isObject(object))
        throw new StoredRowError(
          spec,
          row.id,
          `${column.within} is not an object`,
        );
      if (object) {
        const fields = spec.columns
          .filter((other) => other.within === column.within)
          .map(fieldOf);
        if (
          Object.keys(object).some(
            (field) => object[field] !== undefined && !fields.includes(field),
          )
        )
          throw new StoredRowError(
            spec,
            row.id,
            `no column holds a field of ${column.within}`,
          );
        value = object[fieldOf(column)];
        if (value === undefined)
          throw new StoredRowError(
            spec,
            row.id,
            `${column.within} is missing ${fieldOf(column)}`,
          );
      }
    } else value = data[fieldOf(column)];
    if (value === undefined && (column.optional || column.within)) {
      columns[column.name] = null;
      continue;
    }
    if (value === undefined)
      throw new StoredRowError(spec, row.id, `${fieldOf(column)} is missing`);
    columns[column.name] = checkValue(spec, row.id, column, value);
  }
  if (spec.key === "key") columns.key = row.id;
  else if (rowIdOf(spec, columns) !== row.id)
    throw new StoredRowError(spec, row.id, "the id doesn't match its data");
  return columns;
}

/** A row from its stored columns, keyed by column name. */
export function fromColumns(
  spec: TableSpec,
  stored: Record<string, unknown>,
): WireRow {
  const id = spec.key === "key" ? String(stored.key) : rowIdOf(spec, stored);
  const revision = stored.revision;
  if (!Number.isSafeInteger(revision) || typeof stored.deleted !== "boolean")
    throw new StoredRowError(spec, id, "the row's revision can't be read");
  if (stored.deleted)
    return tombstone({ table: spec.table, id }, revision as number);
  const data: Record<string, unknown> = {};
  for (const column of spec.columns) {
    const value = stored[column.name];
    if (value === null || value === undefined) {
      if (column.optional || column.within) continue;
      throw new StoredRowError(spec, id, `${column.name} is missing`);
    }
    checkValue(spec, id, column, value);
    if (column.within) {
      const object = (data[column.within] ??= {}) as Record<string, unknown>;
      object[fieldOf(column)] = value;
    } else data[fieldOf(column)] = value;
  }
  for (const column of spec.columns)
    if (
      column.within &&
      isObject(data[column.within]) &&
      !(fieldOf(column) in (data[column.within] as object))
    )
      throw new StoredRowError(
        spec,
        id,
        `${column.within} is missing ${fieldOf(column)}`,
      );
  return {
    table: spec.table,
    id,
    revision: revision as number,
    deleted: false,
    data,
  } as WireRow;
}
