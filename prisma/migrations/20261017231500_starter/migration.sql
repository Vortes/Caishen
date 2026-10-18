-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "CrudItem" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrudItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrudItem_clerkUserId_createdAt_idx" ON "CrudItem"("clerkUserId", "createdAt");

