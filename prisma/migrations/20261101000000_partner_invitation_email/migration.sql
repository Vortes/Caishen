-- AlterTable
ALTER TABLE "PartnerInvite" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "emails" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "senderName" TEXT,
ADD COLUMN     "signature" JSONB,
ADD COLUMN     "usedAt" TIMESTAMP(3),
ADD COLUMN     "washi" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "inviteSendWindow" TIMESTAMP(3),
ADD COLUMN     "inviteSends" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "PartnerInvite_createdBy_idx" ON "PartnerInvite"("createdBy");
