import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { z, type ZodTypeAny } from "zod";
import { householdSchema, transactionSchema } from "../../src/domain/engine";
import { rowDataSchemas } from "../../src/domain/row-schemas";
import { tableNames } from "../../src/domain/rows";
import {
  reconciliationResultSchema,
  savedEvidenceSchema,
} from "../../src/server/integrations/reconciliation";
import { bankMappingsSchema } from "../../src/server/services/bank-account-setup";
import { bankImportColumnSchemas } from "../../src/server/services/bank-import-rows";
import { connectionColumnSchema } from "../../src/server/services/banks";
import { dailyDeliveryPayloadSchema } from "../../src/server/services/daily-delivery";
import {
  changeSetSchema,
  operationCommandSchema,
} from "../../src/server/storage/rows";

// ADR 0006, "Stored data across code versions": data saved by one release
// must load in every later release, and in the release before it. Stored
// shapes therefore change only by addition. Never remove or rename a stored
// enum value or field in one release, never make an optional field required,
// and ship the release that reads a new value before any release writes it.
//
// These tests enforce that for every JSON column and every row table:
// - each column's reader schema is listed below (a new Json column fails
//   until it is); each row table's is its data schema in
//   src/domain/row-schemas.ts,
// - tests/stored-data/shapes.json records every path, field, and enum value
//   readers accept, and may only grow,
// - tests/stored-data/samples holds stored records that must always load,
//   and between them use every recorded enum value.

const jsonColumns: Record<string, ZodTypeAny> = {
  "BankConnection.imports": connectionColumnSchema,
  "BankConnection.accountMappings": bankMappingsSchema,
  "ReviewEvidence.evidence": savedEvidenceSchema,
  "ReviewEvidence.result": reconciliationResultSchema,
  "DailyDelivery.payload": dailyDeliveryPayloadSchema,
  "SharedCategory.weights":
    householdSchema.shape.sharedCategories.element.shape.weights,
  "SharedCategory.categoryIds":
    householdSchema.shape.sharedCategories.element.shape.categoryIds,
  "PartnerFact.shares": transactionSchema.shape.shares.unwrap(),
  "BankImport.record": bankImportColumnSchemas.record,
  "BankImport.resolved": bankImportColumnSchemas.resolved,
  "BankImport.reviews": bankImportColumnSchemas.reviews,
  "Operation.command": operationCommandSchema,
  "Operation.changeSet": changeSetSchema,
};
// Row tables store their data as columns: kinds and statuses are text, and
// their values may only grow like any stored enum.
const rowTables: Record<string, ZodTypeAny> = Object.fromEntries(
  tableNames.map((table) => [`rows.${table}`, rowDataSchemas[table]]),
);
const columns = { ...jsonColumns, ...rowTables };

const directory = new URL("../stored-data/", import.meta.url);
const shapesFile = new URL("shapes.json", directory);
const UPDATE = "UPDATE_STORED_SHAPES";

type Node =
  | { type: "object"; fields: Record<string, "required" | "optional"> }
  | { type: "enum"; values: (string | number | boolean | null)[] }
  | { type: string };
type Described = Node & { nullable?: true };
type Shapes = Record<string, Record<string, Described>>;

function unwrap(schema: ZodTypeAny): { schema: ZodTypeAny; nullable: boolean } {
  let nullable = false;
  for (;;) {
    const def = schema._def as { typeName: string } & Record<string, unknown>;
    switch (def.typeName) {
      case "ZodOptional":
      case "ZodDefault":
      case "ZodReadonly":
      case "ZodCatch":
      case "ZodBranded":
        schema = (def.innerType ?? def.type) as ZodTypeAny;
        continue;
      case "ZodNullable":
        nullable = true;
        schema = def.innerType as ZodTypeAny;
        continue;
      case "ZodEffects":
        schema = def.schema as ZodTypeAny;
        continue;
      case "ZodLazy":
        schema = (def.getter as () => ZodTypeAny)();
        continue;
      case "ZodPipeline":
        schema = def.in as ZodTypeAny;
        continue;
      default:
        return { schema, nullable };
    }
  }
}

// Every path a reader accepts, written as field names, `[]` for array items
// and `*` for record values.
function describe(
  schema: ZodTypeAny,
  path: string,
  out: Record<string, Described>,
) {
  const { schema: inner, nullable } = unwrap(schema);
  const add = (node: Node) => {
    out[path] = nullable ? { ...node, nullable: true } : node;
  };
  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, ZodTypeAny>;
    add({
      type: "object",
      fields: Object.fromEntries(
        Object.entries(shape)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, field]) => [
            name,
            field.isOptional() ? "optional" : "required",
          ]),
      ),
    });
    for (const [name, field] of Object.entries(shape))
      describe(field, `${path}.${name}`, out);
  } else if (inner instanceof z.ZodIntersection) {
    add({ type: "intersection" });
    describe(inner._def.left as ZodTypeAny, `${path}&0`, out);
    describe(inner._def.right as ZodTypeAny, `${path}&1`, out);
  } else if (inner instanceof z.ZodArray) {
    add({ type: "array" });
    describe(inner.element as ZodTypeAny, `${path}[]`, out);
  } else if (inner instanceof z.ZodRecord) {
    add({ type: "record" });
    describe(inner.valueSchema as ZodTypeAny, `${path}.*`, out);
  } else if (inner instanceof z.ZodEnum)
    add({ type: "enum", values: [...(inner.options as string[])].sort() });
  else if (inner instanceof z.ZodLiteral)
    add({ type: "enum", values: [inner.value as string] });
  else if (
    inner instanceof z.ZodUnion &&
    (inner.options as ZodTypeAny[]).every(
      (option) => option instanceof z.ZodLiteral,
    )
  )
    add({
      type: "enum",
      values: (inner.options as z.ZodLiteral<string>[])
        .map((option) => option.value)
        .sort(),
    });
  else if (
    inner instanceof z.ZodUnion ||
    inner instanceof z.ZodDiscriminatedUnion
  ) {
    add({ type: "union" });
    (inner.options as ZodTypeAny[]).forEach((option, index) =>
      describe(option, `${path}|${index}`, out),
    );
  } else
    add({
      type: (inner._def as { typeName: string }).typeName
        .replace(/^Zod/, "")
        .toLowerCase(),
    });
}

function currentShapes(): Shapes {
  return Object.fromEntries(
    Object.entries(columns).map(([column, schema]) => {
      const out: Record<string, Described> = {};
      describe(schema, "$", out);
      return [column, out];
    }),
  );
}

// The enum values a stored record uses, by the same paths as describe().
function observe(
  schema: ZodTypeAny,
  value: unknown,
  path: string,
  out: Map<string, Set<unknown>>,
) {
  if (value === null || value === undefined) return;
  const { schema: inner } = unwrap(schema);
  if (inner instanceof z.ZodObject)
    for (const [name, field] of Object.entries(
      inner.shape as Record<string, ZodTypeAny>,
    ))
      observe(
        field,
        (value as Record<string, unknown>)[name],
        `${path}.${name}`,
        out,
      );
  else if (inner instanceof z.ZodIntersection) {
    observe(inner._def.left as ZodTypeAny, value, `${path}&0`, out);
    observe(inner._def.right as ZodTypeAny, value, `${path}&1`, out);
  } else if (inner instanceof z.ZodArray)
    for (const item of value as unknown[])
      observe(inner.element as ZodTypeAny, item, `${path}[]`, out);
  else if (inner instanceof z.ZodRecord)
    for (const item of Object.values(value as Record<string, unknown>))
      observe(inner.valueSchema as ZodTypeAny, item, `${path}.*`, out);
  else if (
    inner instanceof z.ZodUnion ||
    inner instanceof z.ZodDiscriminatedUnion
  )
    (inner.options as ZodTypeAny[]).forEach((option, index) => {
      if (option.safeParse(value).success)
        observe(option, value, `${path}|${index}`, out);
    });
  if (!out.has(path)) out.set(path, new Set());
  out.get(path)!.add(value);
}

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, "utf8"));
}

function samples() {
  return Object.keys(columns).flatMap((column) => {
    const folder = new URL(`samples/${column}/`, directory);
    const files = existsSync(folder)
      ? readdirSync(folder).filter((file) => file.endsWith(".json"))
      : [];
    assert.ok(
      files.length,
      `Add at least one stored ${column} record to tests/stored-data/samples/${column}/.`,
    );
    return files.map((file) => ({
      column,
      file: `samples/${column}/${file}`,
      value: readJson(new URL(file, folder)),
    }));
  });
}

const rule = `Stored data must stay readable across releases (ADR 0006): stored shapes change only by addition. Instead of removing or renaming a stored enum value or field, keep reading it and stop writing it; add new fields as optional; ship code that reads a new value in a release before code that writes it.`;

function violations(recorded: Shapes, current: Shapes): string[] {
  const found: string[] = [];
  for (const [column, paths] of Object.entries(recorded)) {
    const now = current[column];
    if (!now) {
      found.push(
        `${column}: no reader schema anymore. If a migration dropped the column, remove it from shapes.json and samples/ in the same change.`,
      );
      continue;
    }
    for (const [path, was] of Object.entries(paths)) {
      const is = now[path];
      const at = `${column} ${path}`;
      if (!is) {
        found.push(`${at}: removed or renamed; stored records still have it.`);
        continue;
      }
      if (is.type !== was.type)
        found.push(`${at}: changed from ${was.type} to ${is.type}.`);
      if (was.nullable && !is.nullable)
        found.push(`${at}: no longer accepts null; stored records have null.`);
      if ("values" in was && "values" in is)
        for (const value of was.values)
          if (!is.values.includes(value))
            found.push(
              `${at}: enum value ${JSON.stringify(value)} was removed; stored records still use it.`,
            );
      if ("fields" in was && "fields" in is) {
        for (const [field, presence] of Object.entries(was.fields))
          if (!is.fields[field])
            found.push(
              `${at}: field "${field}" was removed or renamed; stored records still have it.`,
            );
          else if (presence === "optional" && is.fields[field] === "required")
            found.push(
              `${at}: field "${field}" became required; stored records may not have it.`,
            );
        for (const [field, presence] of Object.entries(is.fields))
          if (!was.fields[field] && presence === "required")
            found.push(
              `${at}: new field "${field}" is required; stored records don't have it. Make it optional or give it a default.`,
            );
      }
    }
  }
  return found;
}

void test("every Json column in the Prisma schema has a registered reader schema", () => {
  const prisma = readFileSync(
    new URL("../../prisma/schema.prisma", import.meta.url),
    "utf8",
  );
  const json = [...prisma.matchAll(/model (\w+) \{([^}]*)\}/g)].flatMap(
    ([, model, body]) =>
      [...body!.matchAll(/^\s+(\w+)\s+Json\??(\s|$)/gm)].map(
        ([, field]) => `${model}.${field}`,
      ),
  );
  assert.deepEqual(
    json.sort(),
    Object.keys(jsonColumns).sort(),
    "List each Json column with the schema its readers parse it with in tests/server/stored-data.test.ts, and add a stored sample of it to tests/stored-data/samples/.",
  );
});

void test(`stored shapes only grow (record an additive change with ${UPDATE}=1 npm run test:services)`, () => {
  const current = currentShapes();
  const recorded = existsSync(shapesFile)
    ? (readJson(shapesFile) as Shapes)
    : {};
  const broken = violations(recorded, current);
  assert.deepEqual(
    broken,
    [],
    `${rule}\n\nThis change would make stored data unreadable:\n- ${broken.join("\n- ")}`,
  );
  if (process.env[UPDATE] === "1") {
    writeFileSync(shapesFile, `${JSON.stringify(current, null, 2)}\n`);
    return;
  }
  assert.deepEqual(
    recorded,
    current,
    `Stored shapes grew. Record the addition with ${UPDATE}=1 npm run test:services, add a stored sample that uses it to tests/stored-data/samples/, and commit both. ${rule}`,
  );
});

void test("every stored sample loads, and the samples use every stored enum value", () => {
  const seen = new Map<string, Map<string, Set<unknown>>>();
  for (const { column, file, value } of samples()) {
    const result = columns[column]!.safeParse(value);
    assert.ok(
      result.success,
      `${file} no longer loads. ${rule}\n${result.success ? "" : result.error.message}`,
    );
    if (!seen.has(column)) seen.set(column, new Map());
    observe(columns[column]!, value, "$", seen.get(column)!);
  }
  const missing = Object.entries(currentShapes()).flatMap(([column, paths]) =>
    Object.entries(paths).flatMap(([path, node]) =>
      "values" in node
        ? node.values
            .filter((value) => !seen.get(column)?.get(path)?.has(value))
            .map((value) => `${column} ${path}: ${JSON.stringify(value)}`)
        : [],
    ),
  );
  assert.deepEqual(
    missing,
    [],
    "Add a stored sample using each new enum value to tests/stored-data/samples/, so every later release must keep loading it.",
  );
});
