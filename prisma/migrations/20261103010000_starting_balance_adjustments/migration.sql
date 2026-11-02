BEGIN;

LOCK TABLE "Workspace", "Account", "Transaction", "TransactionHistory", "Operation" IN ACCESS EXCLUSIVE MODE;

INSERT INTO "Transaction" (
  "workspaceId", "userId", "id", "accountId", "date", "amount", "payee",
  "status", "expenseMonth", "transactionRevision", "reviewed", "kind",
  "cleared", "sort", "revision", "deleted"
)
SELECT a."workspaceId", a."userId", 'starting-balance:' || CASE WHEN octet_length(a."id") > 143 THEN md5(a."id") ELSE a."id" END, a."id",
  a."date", a."openingBalance", 'Starting Balance', 'posted',
  left(a."date", 7), 1, true, 'adjustment', true,
  COALESCE((SELECT max(t."sort") FROM "Transaction" t
    WHERE t."workspaceId" = a."workspaceId" AND t."userId" = a."userId"), -1)
    + (row_number() OVER (PARTITION BY a."workspaceId", a."userId" ORDER BY a."sort", a."id"))::integer,
  w."revision" + 1, false
FROM "Account" a JOIN "Workspace" w ON w."id" = a."workspaceId"
WHERE NOT a."deleted" AND a."kind" IN ('cash', 'credit', 'tracking');

INSERT INTO "TransactionHistory" (
  "workspaceId", "userId", "transactionId", "sequence", "transactionRevision",
  "amount", "status", "date", "payee", "operationId", "reason", "revision", "deleted"
)
SELECT a."workspaceId", a."userId", 'starting-balance:' || CASE WHEN octet_length(a."id") > 143 THEN md5(a."id") ELSE a."id" END, 0, 1,
  a."openingBalance", 'posted', a."date", 'Starting Balance',
  'migration:starting-balance', 'created', w."revision" + 1, false
FROM "Account" a JOIN "Workspace" w ON w."id" = a."workspaceId"
WHERE NOT a."deleted" AND a."kind" IN ('cash', 'credit', 'tracking');

-- Old account change sets cannot restore the retired shape or undo an
-- account creation without its new transaction. Retain operation identities
-- for retries, as when the retired shared-cost tables were removed.
UPDATE "Operation" SET "changeSet" = NULL, "command" = NULL
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(
    COALESCE("changeSet"->'before', '[]'::jsonb) ||
    COALESCE("changeSet"->'after', '[]'::jsonb)
  ) AS r WHERE r->>'table' = 'account'
);

ALTER TABLE "Account" DROP COLUMN "openingBalance";
UPDATE "Workspace" SET "revision" = "revision" + 1, "resetRevision" = "revision" + 1;

COMMIT;
