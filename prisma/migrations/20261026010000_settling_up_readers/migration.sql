-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "partnerSettlementId" TEXT;

-- CreateTable
CREATE TABLE "PartnerSettlement" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL,
    "removed" BOOLEAN,
    "history" JSONB NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartnerSettlement_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "PartnerRequest" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartnerRequest_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateIndex
CREATE INDEX "PartnerSettlement_workspaceId_revision_idx" ON "PartnerSettlement"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "PartnerRequest_workspaceId_revision_idx" ON "PartnerRequest"("workspaceId", "revision");

-- AddForeignKey
ALTER TABLE "PartnerSettlement" ADD CONSTRAINT "PartnerSettlement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerRequest" ADD CONSTRAINT "PartnerRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
