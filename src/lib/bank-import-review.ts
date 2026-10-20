export function bankImportNeedsReview(item: {
  accountId: string | null;
  pending: boolean;
  removed: boolean;
  needsMatchReview: boolean;
  error: string | null;
}): boolean {
  return (
    !item.pending ||
    !item.accountId ||
    item.removed ||
    item.needsMatchReview ||
    Boolean(item.error)
  );
}
