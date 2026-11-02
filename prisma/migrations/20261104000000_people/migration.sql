-- Every counterparty is a person (ADR 0013). The partner is the person
-- linked to the other member; legacy Partner, Reimbursements, and former
-- partner accounts are converted by the application when a household is
-- next loaded (withPeople in src/domain/people.ts).
ALTER TABLE "Account" ADD COLUMN "linkedUserId" TEXT;
