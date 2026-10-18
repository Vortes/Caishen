-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "book" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "clerkUserId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("clerkUserId")
);

-- CreateTable
CREATE TABLE "BudgetOperation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "commandHash" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerInvite" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankConnection" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "cursor" TEXT,
    "imports" JSONB NOT NULL,
    "accountMappings" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvidence" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cutoff" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyDelivery" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");

-- CreateIndex
CREATE INDEX "BudgetOperation_workspaceId_actorId_createdAt_idx" ON "BudgetOperation"("workspaceId", "actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetOperation_workspaceId_operationId_key" ON "BudgetOperation"("workspaceId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerInvite_tokenHash_key" ON "PartnerInvite"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "BankConnection_itemId_key" ON "BankConnection"("itemId");

-- CreateIndex
CREATE INDEX "BankConnection_clerkUserId_idx" ON "BankConnection"("clerkUserId");

-- CreateIndex
CREATE INDEX "ReviewEvidence_clerkUserId_accountId_createdAt_idx" ON "ReviewEvidence"("clerkUserId", "accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyDelivery_clerkUserId_localDate_key" ON "DailyDelivery"("clerkUserId", "localDate");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetOperation" ADD CONSTRAINT "BudgetOperation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerInvite" ADD CONSTRAINT "PartnerInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

