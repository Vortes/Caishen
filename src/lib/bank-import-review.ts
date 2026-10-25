import {
  importEligibilityIssue,
  type ImportEligibility,
} from "~/domain/register-entry";

export function bankImportNeedsReview(item: {
  eligibility: ImportEligibility;
  accountId: string | null;
  pending: boolean;
  removed: boolean;
  needsMatchReview: boolean;
  error: string | null;
}): boolean {
  return (
    Boolean(importEligibilityIssue(item.eligibility)) ||
    !item.pending ||
    !item.accountId ||
    item.removed ||
    item.needsMatchReview ||
    Boolean(item.error)
  );
}
