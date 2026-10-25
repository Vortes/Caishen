type BankAccountIdentity = {
  accountId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
};

export function sameBankAccount(
  incoming: BankAccountIdentity,
  existing: BankAccountIdentity,
  institutionId: string | null,
  existingInstitutionId: string | null,
) {
  return (
    incoming.accountId === existing.accountId ||
    Boolean(
      institutionId &&
      institutionId === existingInstitutionId &&
      incoming.mask?.trim() &&
      incoming.mask === existing.mask &&
      incoming.name.trim().toLowerCase() ===
        existing.name.trim().toLowerCase() &&
      incoming.type === existing.type &&
      incoming.subtype === existing.subtype,
    )
  );
}

export function possibleBankAccount(
  incoming: BankAccountIdentity,
  existing: BankAccountIdentity,
  institutionId: string | null,
  existingInstitutionId: string | null,
) {
  return (
    sameBankAccount(incoming, existing, institutionId, existingInstitutionId) ||
    Boolean(
      institutionId &&
      institutionId === existingInstitutionId &&
      incoming.type === existing.type &&
      incoming.subtype === existing.subtype &&
      (!incoming.mask?.trim() ||
        !existing.mask?.trim() ||
        !incoming.name.trim() ||
        !existing.name.trim()),
    )
  );
}
