-- Item health learned from Plaid webhooks and /item/get (ADR 0009). Additive:
-- every column has a default or is nullable, so older code keeps working.
ALTER TABLE "BankConnection"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'connected',
  ADD COLUMN "consentExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastSuccessfulUpdateAt" TIMESTAMP(3),
  ADD COLUMN "lastFailedUpdateAt" TIMESTAMP(3),
  ADD COLUMN "newAccountsAvailable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "updateRequestedAt" TIMESTAMP(3);
