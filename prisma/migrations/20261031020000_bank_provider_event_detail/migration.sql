-- Small structured detail for events that are not Plaid requests: a webhook's
-- type, code, and verification result, or a Link outcome's institution and
-- account count. Older readers select only their known columns.
ALTER TABLE "BankProviderEvent" ADD COLUMN "detail" JSONB;
