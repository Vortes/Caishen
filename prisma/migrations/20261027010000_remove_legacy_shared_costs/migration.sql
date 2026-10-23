-- Removes the retired shared-cost model: shared categories, obligations,
-- net settlements, expected reimbursements, and the partner facts derived
-- from them (ADR 0007). Line shares, the partner ledger, and partner
-- settlements replace them.

-- Stored operations that wrote these records can no longer be undone or
-- replayed: their change sets name tables this migration drops.
UPDATE "Operation"
SET "changeSet" = NULL, "command" = NULL
WHERE "type" IN (
    'shared.create', 'shared.rule', 'shared.remove', 'opening.add',
    'settlement.record', 'settlement.receive',
    'reimbursement.expect', 'reimbursement.receive'
  )
  OR "changeSet"::text ~ '"table": ?"(sharedCategory|obligation|settlement|settlementAllocation|reimbursement|reimbursementReceipt|transactionShare|partnerFact)"'
  OR "changeSet"::text ~ '"kind": ?"settlement"'
  OR "changeSet"::text ~ '"(sharedCategoryId|shares|splitWeights)":';

-- Keep actual bank payments readable after their net-settlement records
-- are removed. Like reimbursements, these payments move account balances
-- without counting as another purchase.
UPDATE "Transaction"
SET "kind" = 'reimbursement', "linkedId" = NULL
WHERE "kind" = 'settlement';

-- DropForeignKey
ALTER TABLE "Obligation" DROP CONSTRAINT "Obligation_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "PartnerFact" DROP CONSTRAINT "PartnerFact_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "PartnerFact" DROP CONSTRAINT "PartnerFact_workspaceId_viewerId_fkey";

-- DropForeignKey
ALTER TABLE "Reimbursement" DROP CONSTRAINT "Reimbursement_workspaceId_userId_fkey";

-- DropForeignKey
ALTER TABLE "ReimbursementReceipt" DROP CONSTRAINT "ReimbursementReceipt_workspaceId_userId_reimbursementId_fkey";

-- DropForeignKey
ALTER TABLE "Settlement" DROP CONSTRAINT "Settlement_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "SettlementAllocation" DROP CONSTRAINT "SettlementAllocation_workspaceId_settlementId_fkey";

-- DropForeignKey
ALTER TABLE "SharedCategory" DROP CONSTRAINT "SharedCategory_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "TransactionShare" DROP CONSTRAINT "TransactionShare_workspaceId_userId_transactionId_fkey";

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "sharedCategoryId";

-- DropTable
DROP TABLE "Obligation";

-- DropTable
DROP TABLE "PartnerFact";

-- DropTable
DROP TABLE "Reimbursement";

-- DropTable
DROP TABLE "ReimbursementReceipt";

-- DropTable
DROP TABLE "Settlement";

-- DropTable
DROP TABLE "SettlementAllocation";

-- DropTable
DROP TABLE "SharedCategory";

-- DropTable
DROP TABLE "TransactionShare";

