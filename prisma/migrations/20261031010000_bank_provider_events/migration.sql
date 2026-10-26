-- The audit trail of every exchange with Plaid: each request the adapter makes,
-- each webhook received, and each Link success or exit. Holds ids and outcomes
-- only, never tokens, account numbers, or bodies. No foreign keys: the trail
-- must outlive the connection and user rows it describes, and the daily job
-- purges rows past the retention window instead.
CREATE TABLE "BankProviderEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "requestId" TEXT,
    "errorCode" TEXT,
    "connectionId" TEXT,
    "clerkUserId" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankProviderEvent_connectionId_createdAt_idx" ON "BankProviderEvent"("connectionId", "createdAt");

CREATE INDEX "BankProviderEvent_clerkUserId_createdAt_idx" ON "BankProviderEvent"("clerkUserId", "createdAt");

CREATE INDEX "BankProviderEvent_createdAt_idx" ON "BankProviderEvent"("createdAt");
