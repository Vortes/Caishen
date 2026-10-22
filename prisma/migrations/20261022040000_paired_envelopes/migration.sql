-- A paired envelope names the counterparty account whose cash it holds.
ALTER TABLE "Category" ADD COLUMN "counterpartyAccountId" TEXT;
