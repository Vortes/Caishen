import { getRow } from "./change-sets";
import { AccountingError } from "./engine";
import {
  diffRows,
  rowKey,
  type ChangeSet,
  type RowSet,
  type WireRow,
} from "./rows";

export function rejectImportChange(
  rows: RowSet,
  userId: string,
  connectionId: string,
  logicalId: string,
  fingerprint: string,
  decidedAt: string,
): ChangeSet {
  const before = getRow(
    rows,
    "bankImport",
    rowKey(userId, connectionId, logicalId),
  );
  if (before?.table !== "bankImport" || before.deleted || !before.data)
    throw new AccountingError(
      "This bank activity is no longer available. Refresh and try again.",
    );
  const data = { ...before.data };
  delete data.error;
  const after: WireRow = {
    ...before,
    revision: 0,
    data: {
      ...data,
      resolved: { fingerprint, ignored: true, decidedAt },
    },
  };
  return { operationId: "", revision: 0, ...diffRows([before], [after]) };
}
