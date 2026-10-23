-- CreateTable
CREATE TABLE "PartnerEntry" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "sourceTransactionId" TEXT,
    "sourceLineId" TEXT,
    "date" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "share" BIGINT NOT NULL,
    "removed" BOOLEAN,
    "history" JSONB NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartnerEntry_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "PartnerEntrySide" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "categoryId" TEXT,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartnerEntrySide_pkey" PRIMARY KEY ("workspaceId","userId","entryId")
);

-- CreateIndex
CREATE INDEX "PartnerEntry_workspaceId_revision_idx" ON "PartnerEntry"("workspaceId", "revision");

-- CreateIndex
CREATE INDEX "PartnerEntrySide_workspaceId_revision_idx" ON "PartnerEntrySide"("workspaceId", "revision");

-- AddForeignKey
ALTER TABLE "PartnerEntry" ADD CONSTRAINT "PartnerEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerEntrySide" ADD CONSTRAINT "PartnerEntrySide_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

