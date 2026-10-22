-- CreateTable
CREATE TABLE "PayeeMemory" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payeeKey" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "categoryId" TEXT,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PayeeMemory_pkey" PRIMARY KEY ("workspaceId","userId","payeeKey")
);

-- CreateIndex
CREATE INDEX "PayeeMemory_workspaceId_revision_idx" ON "PayeeMemory"("workspaceId", "revision");

-- AddForeignKey
ALTER TABLE "PayeeMemory" ADD CONSTRAINT "PayeeMemory_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Member"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

