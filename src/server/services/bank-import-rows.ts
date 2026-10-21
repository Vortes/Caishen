import { z } from "zod";
import { rowKey, type TableData, type WireRow } from "~/domain/rows";
import { storedImportSchema } from "~/server/integrations/transactions";
import { importStateSchema } from "./banks";

// A bank connection's import state as bankImport rows (ADR 0006): one row
// per logical bank transaction, holding its stored import, how it was
// resolved, its error, and its review evidence. The connection's own details
// (accounts, institution, sync status) stay on BankConnection.

type ImportState = z.infer<typeof importStateSchema>;
export type ImportRowState = Pick<
  ImportState,
  "records" | "resolved" | "errors" | "reviews"
>;

const stateShape = importStateSchema.shape;

// Readers for the BankImport table's JSON columns.
export const bankImportColumnSchemas = {
  record: storedImportSchema,
  resolved: stateShape.resolved.valueSchema,
  reviews: stateShape.reviews.removeDefault().valueSchema,
};

/** The rows holding one connection's import state. */
export function importStateRows(
  userId: string,
  connectionId: string,
  state: ImportRowState,
): WireRow[] {
  const rows = new Map<string, TableData["bankImport"]>();
  const entry = (logicalId: string) => {
    let data = rows.get(logicalId);
    if (!data)
      rows.set(
        logicalId,
        (data = { userId, connectionId, logicalId, sort: rows.size }),
      );
    return data;
  };
  for (const record of state.records) {
    const data = entry(record.id);
    if (data.record)
      throw new Error(`Two bank imports share the id ${record.id}`);
    data.record = record;
  }
  for (const [logicalId, resolved] of Object.entries(state.resolved))
    entry(logicalId).resolved = resolved;
  for (const [logicalId, error] of Object.entries(state.errors))
    entry(logicalId).error = error;
  for (const [logicalId, reviews] of Object.entries(state.reviews))
    entry(logicalId).reviews = reviews;
  return [...rows.values()].map((data) => ({
    table: "bankImport",
    id: rowKey(userId, connectionId, data.logicalId),
    revision: 0,
    deleted: false,
    data: JSON.parse(JSON.stringify(data)) as TableData["bankImport"],
  }));
}

/**
 * Each connection's import state from bankImport rows, validated as
 * strictly as the stored column. Deleted rows are ignored.
 */
export function importStatesFromRows(
  rows: Iterable<WireRow>,
): Map<string, ImportRowState> {
  const imports = [...rows]
    .flatMap((row) =>
      row.table === "bankImport" && !row.deleted && row.data ? [row.data] : [],
    )
    .sort((a, b) => a.sort - b.sort);
  const states = new Map<string, ImportRowState>();
  for (const data of imports) {
    let state = states.get(data.connectionId);
    if (!state)
      states.set(
        data.connectionId,
        (state = { records: [], resolved: {}, errors: {}, reviews: {} }),
      );
    if (data.record !== undefined)
      state.records.push(bankImportColumnSchemas.record.parse(data.record));
    if (data.resolved !== undefined)
      state.resolved[data.logicalId] = bankImportColumnSchemas.resolved.parse(
        data.resolved,
      );
    if (data.error !== undefined)
      state.errors[data.logicalId] = z.string().parse(data.error);
    if (data.reviews !== undefined)
      state.reviews[data.logicalId] = bankImportColumnSchemas.reviews.parse(
        data.reviews,
      );
  }
  return states;
}
