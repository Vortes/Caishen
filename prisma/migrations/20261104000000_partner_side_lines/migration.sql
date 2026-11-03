-- CreateTable
CREATE TABLE "PartnerEntrySideLine" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "sort" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartnerEntrySideLine_pkey" PRIMARY KEY ("workspaceId","userId","entryId","id")
);

-- CreateIndex
CREATE INDEX "PartnerEntrySideLine_workspaceId_revision_idx" ON "PartnerEntrySideLine"("workspaceId", "revision");

-- AddForeignKey
ALTER TABLE "PartnerEntrySideLine" ADD CONSTRAINT "PartnerEntrySideLine_workspaceId_userId_entryId_fkey" FOREIGN KEY ("workspaceId", "userId", "entryId") REFERENCES "PartnerEntrySide"("workspaceId", "userId", "entryId") ON DELETE CASCADE ON UPDATE CASCADE;
