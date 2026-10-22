-- DropForeignKey
ALTER TABLE "BankImport" DROP CONSTRAINT "BankImport_connectionId_fkey";

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "resetRevision" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "book" DROP NOT NULL;
