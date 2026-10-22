ALTER TABLE "Transaction"
    ADD COLUMN "counterpartyShare" JSONB,
    ADD COLUMN "refundOfTransactionId" TEXT,
    ADD COLUMN "linkedCounterpartyAccountId" TEXT,
    ADD COLUMN "counterpartyName" TEXT;

ALTER TABLE "TransactionLine"
    ADD COLUMN "counterpartyShare" JSONB;

ALTER TABLE "TransactionHistory"
    ADD COLUMN "actorId" TEXT,
    ADD COLUMN "at" TEXT,
    ADD COLUMN "shareChanges" JSONB;

ALTER TABLE "PayeeMemory"
    ADD COLUMN "counterpartyShare" JSONB;
