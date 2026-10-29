-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "closedAt" TEXT,
ADD COLUMN     "closedBy" TEXT;

-- CreateTable
CREATE TABLE "FormerPartnerEntry" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "sourceTransactionId" TEXT,
    "sourceLineId" TEXT,
    "sourceHasPurposeCategory" BOOLEAN,
    "sourceOnSplitPurchase" BOOLEAN,
    "date" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "share" BIGINT NOT NULL,
    "history" JSONB NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FormerPartnerEntry_pkey" PRIMARY KEY ("workspaceId","userId","accountId","id")
);

-- CreateIndex
CREATE INDEX "FormerPartnerEntry_workspaceId_revision_idx" ON "FormerPartnerEntry"("workspaceId", "revision");

-- AddForeignKey
ALTER TABLE "FormerPartnerEntry" ADD CONSTRAINT "FormerPartnerEntry_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

