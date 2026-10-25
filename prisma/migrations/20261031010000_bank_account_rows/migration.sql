-- One row per provider account per bank connection, and one per feed from a
-- provider account into a budget account (ADR 0009). This release only reads
-- them; the writer release that follows copies each connection's JSON lists
-- (catalog, ready, unavailable, mappings) into rows. Older clients never
-- select these tables, so a rollback leaves them unused.
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "persistentAccountId" TEXT,
    "name" TEXT NOT NULL,
    "officialName" TEXT,
    "mask" TEXT,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "currency" TEXT,
    "currentBalance" DECIMAL(20,4),
    "availableBalance" DECIMAL(20,4),
    "balancesAsOf" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'shared',
    "historyComplete" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankAccount_connectionId_providerAccountId_key" ON "BankAccount"("connectionId", "providerAccountId");

-- Rung 2 of the identity ladder needs one shared row per persistent id on a
-- connection; the rows it retired keep the id for their history. Prisma
-- cannot express a partial index, so it lives only here.
CREATE UNIQUE INDEX "BankAccount_connectionId_persistentAccountId_shared_key" ON "BankAccount"("connectionId", "persistentAccountId") WHERE "status" = 'shared' AND "persistentAccountId" IS NOT NULL;

CREATE INDEX "BankAccount_supersededById_idx" ON "BankAccount"("supersededById");

ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BankAccountLink" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "openingSnapshot" JSONB,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinkedAt" TIMESTAMP(3),

    CONSTRAINT "BankAccountLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankAccountLink_bankAccountId_key" ON "BankAccountLink"("bankAccountId");

CREATE INDEX "BankAccountLink_workspaceId_userId_accountId_idx" ON "BankAccountLink"("workspaceId", "userId", "accountId");

-- A budget account has at most one live feed; feeds that ended stay for
-- history. Partial, so only in SQL.
CREATE UNIQUE INDEX "BankAccountLink_live_budget_account_key" ON "BankAccountLink"("workspaceId", "userId", "accountId") WHERE "unlinkedAt" IS NULL;

ALTER TABLE "BankAccountLink" ADD CONSTRAINT "BankAccountLink_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
