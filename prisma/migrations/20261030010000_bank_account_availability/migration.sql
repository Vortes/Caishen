-- Separate current provider access from the saved account catalog.
-- Older clients select only their known columns; strict imports JSON is unchanged.
ALTER TABLE "BankConnection" ADD COLUMN "unavailableAccountIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
