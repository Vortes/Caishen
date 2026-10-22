-- CreateTable
CREATE TABLE "TransactionLine" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TransactionLine_pkey" PRIMARY KEY ("workspaceId","userId","transactionId","id")
);

-- CreateIndex
CREATE INDEX "TransactionLine_workspaceId_revision_idx" ON "TransactionLine"("workspaceId", "revision");

-- AddForeignKey
ALTER TABLE "TransactionLine" ADD CONSTRAINT "TransactionLine_workspaceId_userId_transactionId_fkey" FOREIGN KEY ("workspaceId", "userId", "transactionId") REFERENCES "Transaction"("workspaceId", "userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
