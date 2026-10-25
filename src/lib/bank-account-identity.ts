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
      ((Boolean(incoming.mask?.trim()) && incoming.mask === existing.mask) ||
        !incoming.mask?.trim() ||
        !existing.mask?.trim() ||
        !incoming.name.trim() ||
        !existing.name.trim()),
    )
  );
}

type BankAccountLinks = {
  institutionId: string | null;
  accounts: BankAccountIdentity[];
  accountMappings: Record<string, { accountId: string }>;
  disconnectedAt?: string;
  unavailableAccountIds?: string[];
};

export function bankAccountNeedsRecovery(
  connection: Pick<
    BankAccountLinks,
    "disconnectedAt" | "unavailableAccountIds" | "accounts"
  >,
  providerId: string,
) {
  return (
    Boolean(connection.disconnectedAt) ||
    Boolean(connection.unavailableAccountIds?.includes(providerId)) ||
    !connection.accounts.some((account) => account.accountId === providerId)
  );
}

/** Missing provider identity requires an explicit budget-account choice. */
export function bankRecoveryCandidates(
  incoming: BankAccountIdentity,
  institutionId: string | null,
  connections: BankAccountLinks[],
  budgetAccountKinds: ReadonlyMap<string, string>,
) {
  return connections.flatMap((connection) => {
    if (!institutionId || institutionId !== connection.institutionId) return [];
    return Object.entries(connection.accountMappings).flatMap(
      ([providerId, mapping]) => {
        const saved = connection.accounts.find(
          (account) => account.accountId === providerId,
        );
        const kind = incoming.type === "depository" ? "cash" : incoming.type;
        const savedKind = budgetAccountKinds.get(mapping.accountId);
        if (!saved && savedKind && savedKind !== kind) return [];
        if (
          !bankAccountNeedsRecovery(connection, providerId) ||
          (saved &&
            !possibleBankAccount(
              incoming,
              saved,
              institutionId,
              connection.institutionId,
            ))
        )
          return [];
        return [
          {
            accountId: mapping.accountId,
            exact: Boolean(
              saved &&
              sameBankAccount(
                incoming,
                saved,
                institutionId,
                connection.institutionId,
              ),
            ),
          },
        ];
      },
    );
  });
}
