-- CreateTable
CREATE TABLE "Member" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateTable
CREATE TABLE "BudgetSettings" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startMonth" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL,
    "emailHour" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BudgetSettings_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateTable
CREATE TABLE "Account" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "openingBalance" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "reconciledDate" TEXT,
    "reconciledBalance" BIGINT,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("workspaceId","userId","id")
);

-- CreateTable
CREATE TABLE "CategoryGroup" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CategoryGroup_pkey" PRIMARY KEY ("workspaceId","userId","name")
);

-- CreateTable
CREATE TABLE "Category" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "pairedAccountId" TEXT,
    "pairedLoanId" TEXT,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("workspaceId","userId","id")
);

-- CreateTable
CREATE TABLE "Target" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "behavior" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "startMonth" TEXT NOT NULL,
    "dueDate" TEXT,
    "weekday" INTEGER,
    "monthDay" INTEGER,
    "repeatEvery" INTEGER,
    "repeatUnit" TEXT,
    "snoozedMonths" TEXT[],
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("workspaceId","userId","categoryId")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("workspaceId","userId","categoryId","month")
);

-- CreateTable
CREATE TABLE "ExpectedIncome" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExpectedIncome_pkey" PRIMARY KEY ("workspaceId","userId","month")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "payee" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "categoryId" TEXT,
    "expenseMonth" TEXT NOT NULL,
    "sharedCategoryId" TEXT,
    "providerId" TEXT,
    "transactionRevision" INTEGER NOT NULL,
    "reviewed" BOOLEAN NOT NULL,
    "kind" TEXT NOT NULL,
    "linkedId" TEXT,
    "removed" BOOLEAN,
    "reconciled" BOOLEAN,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("workspaceId","userId","id")
);

-- CreateTable
CREATE TABLE "TransactionShare" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "share" BIGINT,
    "weight" BIGINT,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TransactionShare_pkey" PRIMARY KEY ("workspaceId","userId","transactionId","participantId")
);

-- CreateTable
CREATE TABLE "TransactionHistory" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "transactionRevision" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "combinedId" TEXT,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TransactionHistory_pkey" PRIMARY KEY ("workspaceId","userId","transactionId","sequence")
);

-- CreateTable
CREATE TABLE "Loan" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "principal" BIGINT NOT NULL,
    "minimumPayment" BIGINT NOT NULL,
    "variable" BOOLEAN NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("workspaceId","userId","id")
);

-- CreateTable
CREATE TABLE "LoanRate" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "effectiveDate" TEXT NOT NULL,
    "annualRateBps" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LoanRate_pkey" PRIMARY KEY ("workspaceId","userId","loanId","sequence")
);

-- CreateTable
CREATE TABLE "LoanPayment" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "principal" BIGINT NOT NULL,
    "interest" BIGINT NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("workspaceId","userId","loanId","id")
);

-- CreateTable
CREATE TABLE "Reimbursement" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Reimbursement_pkey" PRIMARY KEY ("workspaceId","userId","id")
);

-- CreateTable
CREATE TABLE "ReimbursementReceipt" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reimbursementId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReimbursementReceipt_pkey" PRIMARY KEY ("workspaceId","userId","reimbursementId","id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "fromCategoryId" TEXT NOT NULL,
    "toCategoryId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("workspaceId","userId","id")
);

-- CreateTable
CREATE TABLE "BankImport" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "logicalId" TEXT NOT NULL,
    "record" JSONB,
    "resolved" JSONB,
    "error" TEXT,
    "reviews" JSONB,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BankImport_pkey" PRIMARY KEY ("workspaceId","userId","connectionId","logicalId")
);

-- CreateTable
CREATE TABLE "SharedCategory" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "participants" TEXT[],
    "weights" JSONB NOT NULL,
    "categoryIds" JSONB NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SharedCategory_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sharedCategoryId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "expenseMonth" TEXT,
    "transactionId" TEXT,
    "payerId" TEXT,
    "payee" TEXT,
    "date" TEXT,
    "opening" BOOLEAN NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "received" BOOLEAN NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "SettlementAllocation" (
    "workspaceId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "obligationId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SettlementAllocation_pkey" PRIMARY KEY ("workspaceId","settlementId","sequence")
);

-- CreateTable
CREATE TABLE "PartnerFact" (
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payerId" TEXT,
    "sharedCategoryId" TEXT,
    "settlementId" TEXT,
    "transactionId" TEXT,
    "date" TEXT,
    "expenseMonth" TEXT,
    "amount" BIGINT,
    "payee" TEXT,
    "status" TEXT,
    "shares" JSONB,
    "sort" INTEGER,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartnerFact_pkey" PRIMARY KEY ("workspaceId","key")
);

-- CreateTable
CREATE TABLE "Operation" (
    "workspaceId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "command" JSONB,
    "changeSet" JSONB,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("workspaceId","operationId")
);

-- CreateIndex
CREATE INDEX "Member_workspaceId_revision_idx" ON "Member"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "BudgetSettings_workspaceId_revision_idx" ON "BudgetSettings"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Account_workspaceId_revision_idx" ON "Account"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "CategoryGroup_workspaceId_revision_idx" ON "CategoryGroup"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Category_workspaceId_revision_idx" ON "Category"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Target_workspaceId_revision_idx" ON "Target"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Assignment_workspaceId_revision_idx" ON "Assignment"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "ExpectedIncome_workspaceId_revision_idx" ON "ExpectedIncome"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_revision_idx" ON "Transaction"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "TransactionShare_workspaceId_revision_idx" ON "TransactionShare"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "TransactionHistory_workspaceId_revision_idx" ON "TransactionHistory"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Loan_workspaceId_revision_idx" ON "Loan"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "LoanRate_workspaceId_revision_idx" ON "LoanRate"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "LoanPayment_workspaceId_revision_idx" ON "LoanPayment"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Reimbursement_workspaceId_revision_idx" ON "Reimbursement"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "ReimbursementReceipt_workspaceId_revision_idx" ON "ReimbursementReceipt"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Rule_workspaceId_revision_idx" ON "Rule"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "BankImport_workspaceId_revision_idx" ON "BankImport"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "BankImport_connectionId_idx" ON "BankImport"("connectionId");

-- CreateIndex
CREATE INDEX "SharedCategory_workspaceId_revision_idx" ON "SharedCategory"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Obligation_workspaceId_revision_idx" ON "Obligation"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Settlement_workspaceId_revision_idx" ON "Settlement"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "SettlementAllocation_workspaceId_revision_idx" ON "SettlementAllocation"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "PartnerFact_workspaceId_revision_idx" ON "PartnerFact"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Operation_workspaceId_revision_idx" ON "Operation"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "Operation_workspaceId_actorId_revision_idx" ON "Operation"("workspaceId", "actorId", "revision");

-- CreateIndex
CREATE INDEX "Operation_createdAt_idx" ON "Operation"("createdAt");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetSettings" ADD CONSTRAINT "BudgetSettings_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryGroup" ADD CONSTRAINT "CategoryGroup_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_workspaceId_userId_categoryId_fkey" FOREIGN KEY ("workspaceId", "userId", "categoryId") REFERENCES "Category"("workspaceId", "userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_workspaceId_userId_categoryId_fkey" FOREIGN KEY ("workspaceId", "userId", "categoryId") REFERENCES "Category"("workspaceId", "userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpectedIncome" ADD CONSTRAINT "ExpectedIncome_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionShare" ADD CONSTRAINT "TransactionShare_workspaceId_userId_transactionId_fkey" FOREIGN KEY ("workspaceId", "userId", "transactionId") REFERENCES "Transaction"("workspaceId", "userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionHistory" ADD CONSTRAINT "TransactionHistory_workspaceId_userId_transactionId_fkey" FOREIGN KEY ("workspaceId", "userId", "transactionId") REFERENCES "Transaction"("workspaceId", "userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRate" ADD CONSTRAINT "LoanRate_workspaceId_userId_loanId_fkey" FOREIGN KEY ("workspaceId", "userId", "loanId") REFERENCES "Loan"("workspaceId", "userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_workspaceId_userId_loanId_fkey" FOREIGN KEY ("workspaceId", "userId", "loanId") REFERENCES "Loan"("workspaceId", "userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementReceipt" ADD CONSTRAINT "ReimbursementReceipt_workspaceId_userId_reimbursementId_fkey" FOREIGN KEY ("workspaceId", "userId", "reimbursementId") REFERENCES "Reimbursement"("workspaceId", "userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImport" ADD CONSTRAINT "BankImport_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImport" ADD CONSTRAINT "BankImport_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedCategory" ADD CONSTRAINT "SharedCategory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAllocation" ADD CONSTRAINT "SettlementAllocation_workspaceId_settlementId_fkey" FOREIGN KEY ("workspaceId", "settlementId") REFERENCES "Settlement"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerFact" ADD CONSTRAINT "PartnerFact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerFact" ADD CONSTRAINT "PartnerFact_workspaceId_viewerId_fkey" FOREIGN KEY ("workspaceId", "viewerId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("clerkUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
