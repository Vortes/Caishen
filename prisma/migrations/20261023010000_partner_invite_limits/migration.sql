ALTER TABLE "User" ADD COLUMN "inviteChecks" INTEGER NOT NULL DEFAULT 0,
                   ADD COLUMN "inviteWindow" TIMESTAMP(3);
