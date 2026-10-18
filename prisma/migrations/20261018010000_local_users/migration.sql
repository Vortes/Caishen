-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "imageUrl" TEXT,
    "primaryEmail" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "clerkUpdatedAt" BIGINT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClerkWebhookEvent" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "applied" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClerkWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE INDEX "ClerkWebhookEvent_clerkUserId_occurredAt_idx" ON "ClerkWebhookEvent"("clerkUserId", "occurredAt");

-- Backfill existing identity anchors before adding non-cascading references.
INSERT INTO "User" ("id", "clerkUserId", "updatedAt")
SELECT 'backfill_' || md5("clerkUserId"), "clerkUserId", CURRENT_TIMESTAMP
FROM (
  SELECT "clerkUserId" FROM "WorkspaceMember"
  UNION SELECT "actorId" FROM "BudgetOperation"
  UNION SELECT "createdBy" FROM "PartnerInvite"
  UNION SELECT "usedBy" FROM "PartnerInvite" WHERE "usedBy" IS NOT NULL
  UNION SELECT "clerkUserId" FROM "BankConnection"
  UNION SELECT "clerkUserId" FROM "ReviewEvidence"
  UNION SELECT "clerkUserId" FROM "DailyDelivery"
) existing_users
ON CONFLICT ("clerkUserId") DO NOTHING;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_clerkUserId_fkey" FOREIGN KEY ("clerkUserId") REFERENCES "User"("clerkUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetOperation" ADD CONSTRAINT "BudgetOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("clerkUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerInvite" ADD CONSTRAINT "PartnerInvite_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("clerkUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerInvite" ADD CONSTRAINT "PartnerInvite_usedBy_fkey" FOREIGN KEY ("usedBy") REFERENCES "User"("clerkUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankConnection" ADD CONSTRAINT "BankConnection_clerkUserId_fkey" FOREIGN KEY ("clerkUserId") REFERENCES "User"("clerkUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvidence" ADD CONSTRAINT "ReviewEvidence_clerkUserId_fkey" FOREIGN KEY ("clerkUserId") REFERENCES "User"("clerkUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyDelivery" ADD CONSTRAINT "DailyDelivery_clerkUserId_fkey" FOREIGN KEY ("clerkUserId") REFERENCES "User"("clerkUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClerkWebhookEvent" ADD CONSTRAINT "ClerkWebhookEvent_clerkUserId_fkey" FOREIGN KEY ("clerkUserId") REFERENCES "User"("clerkUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

