import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bookSchema } from "../../src/domain/engine";
import {
  bookToRows,
  rowKey,
  rowVisibleTo,
  tableNames,
  type WireRow,
} from "../../src/domain/rows";
import { Prisma } from "../../src/generated/prisma";
import { buildDevelopmentSeed } from "../../src/server/dev/seed-scenarios";
import { importStateRows } from "../../src/server/services/bank-import-rows";
import { importStateSchema } from "../../src/server/services/banks";
import {
  fromColumns,
  keyColumns,
  keyOf,
  tableSpec,
  tableSpecs,
  toColumns,
} from "../../src/server/storage/row-tables";
import { buildCommandCorpus } from "../domain/fixtures/command-corpus";

const sample = (path: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../stored-data/samples/${path}`, import.meta.url), {
      encoding: "utf8",
    }),
  );

// Rows of every table, with every optional field used somewhere.
function everyRow(): WireRow[] {
  const corpus = buildCommandCorpus();
  const seed = buildDevelopmentSeed({
    userId: "alex",
    partnerId: "jordan",
    asOf: "2026-10-21",
  });
  const rows = [
    ...bookToRows(seed.book),
    ...bookToRows(
      bookSchema.parse(
        JSON.parse(
          readFileSync(
            new URL(
              "../domain/fixtures/every-stored-value-book.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      ),
    ),
    ...corpus.steps.flatMap((step) => bookToRows(step.after)),
    ...importStateRows(
      "alex",
      "connection",
      importStateSchema.parse(
        sample("BankConnection.imports/synced-with-reviews.json"),
      ),
    ),
  ];
  // Standing rules are no longer kept, but their stored rows still read.
  const rule = sample("rows.rule/stored.json") as { id: string };
  rows.push({
    table: "rule",
    id: rowKey("alex", rule.id),
    revision: 0,
    deleted: false,
    data: rule,
  } as WireRow);
  // Optional fields no stored book sets yet.
  const extend = (table: WireRow["table"], fields: Record<string, unknown>) => {
    const row = rows.find((item) => item.table === table)!;
    rows.push({ ...row, data: { ...row.data!, ...fields } } as WireRow);
  };
  extend("target", { cadence: "monthly", monthDay: 15 });
  extend("transaction", {
    providerId: "plaid:item:transaction",
    refundOfTransactionId: "original-purchase",
  });
  extend("partnerEntry", { removed: true });
  extend("partnerSettlement", { removed: true });
  return rows;
}

const prismaTypes = {
  text: "String",
  int: "Int",
  cents: "BigInt",
  bool: "Boolean",
  json: "Json",
  texts: "String",
};

void test("each row table has a database table with a column per field", () => {
  assert.deepEqual(
    tableSpecs.map((spec) => spec.table),
    tableNames,
  );
  for (const spec of tableSpecs) {
    const model = Prisma.dmmf.datamodel.models.find(
      (item) => item.name === spec.model,
    );
    assert.ok(model, spec.model);
    const scalars = model.fields.filter((field) => field.kind !== "object");
    const columns = [
      ...(spec.key === "key" ? keyColumns(spec) : []),
      ...spec.columns,
    ];
    assert.deepEqual(
      scalars.map((field) => field.name).sort(),
      [
        "workspaceId",
        "revision",
        "deleted",
        ...columns.map((c) => c.name),
      ].sort(),
      spec.model,
    );
    for (const column of columns) {
      const field = scalars.find((item) => item.name === column.name)!;
      assert.equal(
        field.type,
        prismaTypes[column.type],
        `${spec.model}.${column.name}`,
      );
      assert.equal(
        field.isList,
        column.type === "texts",
        `${spec.model}.${column.name}`,
      );
      assert.equal(
        field.isRequired,
        !column.optional && !column.within,
        `${spec.model}.${column.name}`,
      );
    }
    assert.deepEqual(
      model.primaryKey?.fields,
      ["workspaceId", ...keyColumns(spec).map((column) => column.name)],
      spec.model,
    );
  }
});

void test("the rows a partner's browser holds are read by the column naming them", () => {
  for (const spec of tableSpecs) {
    const id = rowKey("alex", "x", "y", "z");
    assert.equal(
      rowVisibleTo({ table: spec.table, id }, "jordan"),
      !spec.visibleTo,
      spec.table,
    );
    if (spec.visibleTo && spec.key !== "key")
      assert.equal(spec.key[0], spec.visibleTo, spec.table);
  }
});

void test("every row is stored whole and read back the same", () => {
  const rows = everyRow();
  const used = new Map<string, Set<string>>();
  for (const row of rows) {
    const spec = tableSpec(row.table);
    const columns = toColumns(spec, row);
    for (const [name, value] of Object.entries(columns))
      if (value !== null) {
        if (!used.has(spec.model)) used.set(spec.model, new Set());
        used.get(spec.model)!.add(name);
      }
    // As Postgres's json_agg returns them.
    const stored = JSON.parse(
      JSON.stringify({
        ...columns,
        workspaceId: "w",
        revision: 3,
        deleted: false,
      }),
    ) as Record<string, unknown>;
    assert.deepStrictEqual(fromColumns(spec, stored), { ...row, revision: 3 });
    assert.deepStrictEqual(fromColumns(spec, { ...stored, deleted: true }), {
      table: row.table,
      id: row.id,
      revision: 3,
      deleted: true,
      data: null,
    });
    assert.deepStrictEqual(
      keyOf(spec, row.id),
      Object.fromEntries(
        keyColumns(spec).map((column) => [column.name, stored[column.name]]),
      ),
    );
  }
  // Every column holds a value in some row, so the round trip covers it.
  for (const spec of tableSpecs)
    assert.deepEqual(
      [...(used.get(spec.model) ?? [])].sort(),
      [
        ...(spec.key === "key" ? ["key"] : []),
        ...spec.columns.map((column) => column.name),
      ].sort(),
      spec.model,
    );
});

void test("rows that can't be stored whole are refused", () => {
  const account = everyRow().find((row) => row.table === "account")!;
  const spec = tableSpec("account");
  const data = account.data as Record<string, unknown>;
  const refused = (changed: Record<string, unknown>, message: RegExp) =>
    assert.throws(
      () => toColumns(spec, { ...account, data: changed } as WireRow),
      message,
    );
  refused({ ...data, nickname: "Checking" }, /no column holds nickname/);
  refused({ ...data, name: undefined }, /name is missing/);
  refused(
    { ...data, openingBalance: 1.5 },
    /openingBalance is not a valid cents/,
  );
  refused(
    { ...data, openingBalance: 2 ** 53 },
    /openingBalance is not a valid cents/,
  );
  refused(
    { ...data, reconciled: { date: "2026-10-01" } },
    /reconciled is missing balance/,
  );
  refused(
    { ...data, reconciled: { date: "2026-10-01", balance: 1, note: "x" } },
    /no column holds a field of reconciled/,
  );
  refused({ ...data, id: "other" }, /the id doesn't match its data/);
  assert.throws(
    () => keyOf(spec, rowKey("alex")),
    /doesn't match the table's key/,
  );
  assert.throws(
    () => keyOf(tableSpec("transactionHistory"), rowKey("alex", "t", "01")),
    /sequence is not a number/,
  );
});
