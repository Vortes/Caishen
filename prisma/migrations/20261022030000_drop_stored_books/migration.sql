-- Budgets are stored as rows (ADR 0006). Refuse to drop the stored books
-- while any household still holds its budget only there: run
-- `npm run db:rows:copy` (and `-- --verify-only`) from the release before
-- this one against this database first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Workspace" w
    WHERE w."book" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "WorkspaceMember" m WHERE m."workspaceId" = w."id")
      AND NOT EXISTS (SELECT 1 FROM "Member" r WHERE r."workspaceId" = w."id")
  ) THEN
    RAISE EXCEPTION 'Households still hold their budget only in Workspace.book. Copy them into rows with npm run db:rows:copy (from the release before this migration), then deploy again.';
  END IF;
END $$;

-- Import state moved to BankImport rows; connections keep their details.
UPDATE "BankConnection"
SET "imports" = "imports" - 'records' - 'resolved' - 'errors' - 'reviews';

ALTER TABLE "Workspace" DROP COLUMN "book";

DROP TABLE "BudgetOperation";
