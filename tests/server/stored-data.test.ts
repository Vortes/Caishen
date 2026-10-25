import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { type ZodTypeAny } from "zod";
import { rowDataSchemas } from "../../src/domain/row-schemas";
import {
  counterpartyShareSchema,
  transactionHistorySchema,
} from "../../src/domain/engine";
import { partnerEntryObject } from "../../src/domain/partner-ledger";
import { partnerSettlementSchema } from "../../src/domain/partner-settlements";
import { tableNames } from "../../src/domain/rows";
import {
  reconciliationResultSchema,
  savedEvidenceSchema,
} from "../../src/server/storage/review-evidence";
import { plaidLinkMetadataSchema } from "../../src/lib/plaid-link-metadata";
import { bankMappingsSchema } from "../../src/server/services/bank-account-setup";
import { bankImportColumnSchemas } from "../../src/server/services/bank-import-rows";
import { connectionColumnSchema } from "../../src/server/services/banks";
import { bankProviderEventDetailSchema } from "../../src/server/services/bank-provider-events";
import { dailyDeliveryPayloadSchema } from "../../src/server/services/daily-delivery";
import {
  changeSetSchema,
  operationCommandSchema,
} from "../../src/server/storage/rows";

// Compare readers with the committed contracts and literal samples. ADR 0008
// suspends ADR 0006's additive-only rule until the first production launch;
// removed shapes must be removed from these contracts and samples as well.
const jsonColumns: Record<string, ZodTypeAny> = {
  "BankConnection.imports": connectionColumnSchema,
  "BankConnection.accountMappings": bankMappingsSchema,
  "BankProviderEvent.detail": bankProviderEventDetailSchema.nullable(),
  "ReviewEvidence.evidence": savedEvidenceSchema,
  "ReviewEvidence.result": reconciliationResultSchema,
  "DailyDelivery.payload": dailyDeliveryPayloadSchema,
  "BankImport.record": bankImportColumnSchemas.record,
  "BankImport.resolved": bankImportColumnSchemas.resolved,
  "BankImport.reviews": bankImportColumnSchemas.reviews,
  "Operation.command": operationCommandSchema,
  "Operation.changeSet": changeSetSchema,
  "Transaction.counterpartyShare": counterpartyShareSchema.nullable(),
  "TransactionLine.counterpartyShare": counterpartyShareSchema.nullable(),
  "PayeeMemory.counterpartyShare": counterpartyShareSchema.nullable(),
  "TransactionHistory.shareChanges": transactionHistorySchema.shape.shareChanges
    .unwrap()
    .nullable(),
  "PartnerEntry.history": partnerEntryObject.shape.history,
  "PartnerSettlement.history": partnerSettlementSchema.shape.history,
};
// Row tables store their data as columns: kinds and statuses are text, and
// their values may only grow like any stored enum.
const rowTables: Record<string, ZodTypeAny> = Object.fromEntries(
  tableNames.map((table) => [`rows.${table}`, rowDataSchemas[table]]),
);
// Shapes the browser sends that a deployed client may keep sending after the
// server changes: Plaid Link's completion metadata. Fields are added only.
const requestShapes: Record<string, ZodTypeAny> = {
  "PlaidLink.metadata": plaidLinkMetadataSchema,
};
const columns = { ...jsonColumns, ...rowTables, ...requestShapes };

const directory = new URL("../stored-data/", import.meta.url);
type Contract = {
  when?: { kind: string };
  fields: string[];
  optional: string[];
  nullable: string[];
  values: Record<string, (string | number | boolean | null)[]>;
};
const contracts = JSON.parse(
  readFileSync(new URL("contracts.json", directory), "utf8"),
) as Record<string, Contract[]>;
type RecordValue = Record<string, unknown>;
function locations(value: unknown, path: string): string[][] {
  const parts = path
    ? path.replaceAll("[]", ".*").replace(/^\./, "").split(".")
    : [];
  function visit(
    current: unknown,
    remaining: string[],
    at: string[],
  ): string[][] {
    if (!remaining.length) return [at];
    if (current === null || typeof current !== "object") return [];
    const [key, ...rest] = remaining;
    const record = current as RecordValue;
    return (
      key === "*"
        ? Object.keys(record)
        : key !== undefined && key in record
          ? [key]
          : []
    ).flatMap((field) => visit(record[field], rest, [...at, field]));
  }
  return visit(value, parts, []);
}
function readAt(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      current !== null && typeof current === "object"
        ? (current as RecordValue)[key]
        : undefined,
    value,
  );
}
function assertRetained(saved: unknown, loaded: unknown, at: string) {
  if (saved === null || typeof saved !== "object") {
    assert.deepEqual(
      loaded,
      saved,
      `${at}: changed or discarded a saved value`,
    );
    return;
  }
  assert.ok(
    loaded !== null && typeof loaded === "object",
    `${at}: discarded a saved record`,
  );
  if (Array.isArray(saved)) {
    assert.ok(Array.isArray(loaded), at);
    assert.equal(loaded.length, saved.length, `${at}: discarded saved entries`);
  }
  for (const [field, value] of Object.entries(saved)) {
    assertRetained(value, (loaded as RecordValue)[field], `${at}.${field}`);
  }
}
function assertLoads(column: string, value: unknown, description: string) {
  const result = columns[column]!.safeParse(value);
  assert.ok(
    result.success,
    `${description} no longer loads. Stored data must remain readable (ADR 0006).\n${result.success ? "" : result.error.message}`,
  );
  if (value === null) assert.equal(result.data, null, description);
  for (const contract of contracts[column] ?? []) {
    if (contract.when && (value as RecordValue).kind !== contract.when.kind)
      continue;
    if (!contract.fields.length)
      assertRetained(value, result.data, description);
    for (const path of contract.fields)
      for (const at of locations(value, path)) {
        assertRetained(
          readAt(value, at),
          readAt(result.data, at),
          `${description}.${path}`,
        );
      }
  }
}
function samples(column: string) {
  const folder = new URL(`samples/${column}/`, directory);
  const files = existsSync(folder)
    ? readdirSync(folder).filter((file) => file.endsWith(".json"))
    : [];
  assert.ok(
    files.length,
    `Add a fixed stored ${column} record to tests/stored-data/samples/.`,
  );
  return files.map((file) => ({
    file,
    value: JSON.parse(readFileSync(new URL(file, folder), "utf8")) as unknown,
  }));
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

void test("every stored column and row table has an explicit compatibility contract", () => {
  assert.deepEqual(Object.keys(contracts).sort(), Object.keys(columns).sort());
});
for (const column of Object.keys(columns)) {
  void test(`${column}: every saved record loads without losing stored fields or values`, () => {
    for (const { file, value } of samples(column))
      assertLoads(column, value, `${column}/${file}`);
  });
  if (
    contracts[column]?.some(
      (contract) =>
        contract.fields.length || Object.keys(contract.values).length,
    )
  )
    void test(`${column}: fixtures cover every recorded field and accepted enum value`, () => {
      const missing: string[] = [];
      for (const contract of contracts[column] ?? []) {
        const records = samples(column).filter(
          ({ value }) =>
            !contract.when ||
            (value as RecordValue).kind === contract.when.kind,
        );
        assert.ok(
          records.length,
          `Missing ${column} ${JSON.stringify(contract.when)} records`,
        );
        for (const path of contract.fields) {
          if (!records.some(({ value }) => locations(value, path).length))
            missing.push(path);
        }
        for (const [path, accepted] of Object.entries(contract.values)) {
          const seen = records.flatMap(({ value }) =>
            locations(value, path).map((at) => readAt(value, at)),
          );
          for (const literal of accepted)
            if (!seen.includes(literal))
              missing.push(`${path} = ${JSON.stringify(literal)}`);
        }
      }
      assert.deepEqual(
        missing,
        [],
        `Add literal saved records covering ${column}: ${missing.join(", ")}`,
      );
    });
  if (
    contracts[column]?.some(
      (contract) => contract.optional.length || contract.nullable.length,
    )
  )
    void test(`${column}: historical optional and nullable fields stay readable`, () => {
      for (const contract of contracts[column] ?? []) {
        const records = samples(column).filter(
          ({ value }) =>
            !contract.when ||
            (value as RecordValue).kind === contract.when.kind,
        );
        for (const path of contract.optional) {
          const split = path.lastIndexOf(".");
          const parentPath = split === -1 ? "" : path.slice(0, split);
          const field = path.slice(split + 1);
          const absent = records.find(({ value }) =>
            locations(value, parentPath).some((at) => {
              const parent = readAt(value, at);
              return (
                parent !== null &&
                typeof parent === "object" &&
                !(field in parent)
              );
            }),
          );
          assert.ok(
            absent,
            `${column}: add a historical record with optional ${path} omitted`,
          );
          assertLoads(
            column,
            absent.value,
            `${column}/${absent.file}: ${path} omitted`,
          );
        }
        for (const path of contract.nullable) {
          let checked = 0;
          for (const { file, value } of records)
            for (const at of locations(value, path)) {
              if (!at.length) {
                assertLoads(column, null, `${column}/${file}: value is null`);
                checked++;
                continue;
              }
              const variant = structuredClone(value);
              const parent = readAt(variant, at.slice(0, -1)) as RecordValue;
              parent[at.at(-1)!] = null;
              assertLoads(
                column,
                variant,
                `${column}/${file}: ${path} is null`,
              );
              checked++;
            }
          assert.ok(
            checked,
            `${column}: no fixture exercises nullable ${path}`,
          );
        }
      }
    });
}
