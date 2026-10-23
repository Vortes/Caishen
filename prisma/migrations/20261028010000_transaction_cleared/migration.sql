-- YNAB's cleared status, apart from the bank's pending status. Existing rows
-- stay null and read as cleared once posted, so no balance changes.
ALTER TABLE "Transaction" ADD COLUMN "cleared" BOOLEAN;
