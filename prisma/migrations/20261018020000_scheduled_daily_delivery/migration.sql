ALTER TABLE "DailyDelivery"
ADD COLUMN "providerId" TEXT,
ADD COLUMN "scheduledAt" TIMESTAMP(3),
ADD COLUMN "payload" JSONB,
ADD COLUMN "firstAttemptAt" TIMESTAMP(3);
