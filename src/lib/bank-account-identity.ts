/** The ranked account identity rules shared by Link, refresh, setup, and recovery (ADR 0009). */
export type BankAccountIdentity = {
  accountId: string;
  persistentAccountId?: string;
  name: string | null;
  mask: string | null;
  /** Undefined or null when the source did not report the type (older Link clients). */
  type?: string | null;
  /** Undefined when the source did not report it; null when Plaid has none. */
  subtype?: string | null;
};

/** A stored account the incoming one may be, as the ladder needs to see it. */
export type BankAccountCandidate<T extends BankAccountIdentity> = {
  account: T;
  /** Of the connection that holds the stored account. */
  institutionId: string | null;
  /** The stored account is on the connection that reported the incoming one. */
  sameConnection: boolean;
  /** The stored account's Plaid id is absent from the current response. */
  absent: boolean;
};

export type BankAccountResolution<T> =
  | { rung: 1; existing: T }
  | { rung: 2; existing: T }
  | { rung: 3; candidate: T }
  | {
      rung: 4;
      reason: "ambiguous" | "unknown" | "no-match";
      /** The stored accounts to ask the user about, masks shown. */
      candidates: T[];
    };

const normalizedName = (value: string | null | undefined) =>
  value?.trim().toLowerCase() ?? "";
const normalizedMask = (value: string | null | undefined) =>
  value?.trim() ?? "";

// Rung 3's field comparison. Type and subtype decide first because a
// different kind of account is different whatever its label; a missing mask,
// name, or type leaves the question open rather than answering it.
function compareFields(
  incoming: BankAccountIdentity,
  stored: BankAccountIdentity,
): "same" | "unknown" | "different" {
  const typeKnown =
    incoming.type != null &&
    stored.type != null &&
    incoming.subtype !== undefined &&
    stored.subtype !== undefined;
  if (
    typeKnown &&
    (incoming.type !== stored.type || incoming.subtype !== stored.subtype)
  )
    return "different";
  if (!normalizedMask(incoming.mask) || !normalizedMask(stored.mask))
    return "unknown";
  if (normalizedMask(incoming.mask) !== normalizedMask(stored.mask))
    return "different";
  if (
    !normalizedName(incoming.name) ||
    !normalizedName(stored.name) ||
    normalizedName(incoming.name) !== normalizedName(stored.name) ||
    !typeKnown
  )
    return "unknown";
  return "same";
}

export function resolveBankAccountIdentity<T extends BankAccountIdentity>(
  incoming: BankAccountIdentity,
  context: {
    /** The institution that reported the incoming account. */
    institutionId: string | null;
    /** Every account in the current response, the incoming one included. */
    reported: readonly BankAccountIdentity[];
    candidates: readonly BankAccountCandidate<T>[];
  },
): BankAccountResolution<T> {
  const byId = context.candidates.find(
    ({ account, sameConnection }) =>
      sameConnection && account.accountId === incoming.accountId,
  );
  if (byId) return { rung: 1, existing: byId.account };
  if (incoming.persistentAccountId) {
    const storedIds = new Set(
      context.candidates.map(({ account }) => account.accountId),
    );
    const superseded = context.candidates.filter(
      ({ account, sameConnection, absent }) =>
        sameConnection &&
        absent &&
        account.persistentAccountId === incoming.persistentAccountId,
    );
    const arrived = context.reported.filter(
      (account) =>
        !storedIds.has(account.accountId) &&
        account.persistentAccountId === incoming.persistentAccountId,
    );
    if (superseded.length === 1 && arrived.length === 1)
      return { rung: 2, existing: superseded[0]!.account };
  }
  const comparable = context.candidates.filter(
    ({ institutionId, absent }) =>
      Boolean(context.institutionId) &&
      institutionId === context.institutionId &&
      absent,
  );
  const exact = comparable.filter(
    ({ account }) => compareFields(incoming, account) === "same",
  );
  const unknown = comparable.filter(
    ({ account }) => compareFields(incoming, account) === "unknown",
  );
  if (exact.length > 1)
    return {
      rung: 4,
      reason: "ambiguous",
      candidates: exact.map(({ account }) => account),
    };
  if (exact.length === 1) return { rung: 3, candidate: exact[0]!.account };
  if (unknown.length)
    return {
      rung: 4,
      reason: "unknown",
      candidates: unknown.map(({ account }) => account),
    };
  return { rung: 4, reason: "no-match", candidates: [] };
}

export type BankLinkVerdict<T> = {
  /** How much of what Link reported is already connected here. */
  verdict: "none" | "some" | "all" | "unknown";
  accounts: {
    account: BankAccountIdentity;
    resolution: BankAccountResolution<T>;
  }[];
};

/** Compare Link metadata before exchange; incomplete or ambiguous evidence remains unknown. */
export function bankLinkVerdict<T extends BankAccountIdentity>(
  reported: readonly BankAccountIdentity[],
  institutionId: string,
  connection: { institutionId: string | null; accounts: readonly T[] },
): BankLinkVerdict<T> {
  const candidates = connection.accounts.map((account) => ({
    account,
    institutionId: connection.institutionId,
    sameConnection: reported.some(
      (item) => item.accountId === account.accountId,
    ),
    absent: !reported.some((item) => item.accountId === account.accountId),
  }));
  const accounts = reported.map((account) => ({
    account,
    resolution: resolveBankAccountIdentity(account, {
      institutionId,
      reported,
      candidates,
    }),
  }));
  const connected = ({ resolution }: (typeof accounts)[number]) =>
    resolution.rung !== 4;
  const open = ({ resolution }: (typeof accounts)[number]) =>
    resolution.rung === 4 && resolution.reason !== "no-match";
  const verdict = !connection.accounts.length
    ? "unknown"
    : accounts.every(connected)
      ? "all"
      : accounts.some(connected)
        ? "some"
        : accounts.some(open)
          ? "unknown"
          : "none";
  return { verdict, accounts };
}

export function sameBankAccount(
  incoming: BankAccountIdentity,
  existing: BankAccountIdentity,
  institutionId: string | null,
  existingInstitutionId: string | null,
) {
  const resolution = resolveBankAccountIdentity(incoming, {
    institutionId,
    reported: [incoming],
    candidates: [
      {
        account: existing,
        institutionId: existingInstitutionId,
        sameConnection: incoming.accountId === existing.accountId,
        absent: incoming.accountId !== existing.accountId,
      },
    ],
  });
  return resolution.rung !== 4;
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
  const candidates = connections.flatMap((connection) => {
    if (!institutionId || institutionId !== connection.institutionId) return [];
    return Object.entries(connection.accountMappings).flatMap(
      ([providerId, mapping]) => {
        if (!bankAccountNeedsRecovery(connection, providerId)) return [];
        const saved = connection.accounts.find(
          (account) => account.accountId === providerId,
        );
        const kind = incoming.type === "depository" ? "cash" : incoming.type;
        const savedKind = budgetAccountKinds.get(mapping.accountId);
        if (!saved && savedKind && savedKind !== kind) return [];
        return [
          {
            account: {
              ...(saved ?? { accountId: providerId, name: null, mask: null }),
              budgetAccountId: mapping.accountId,
            },
            institutionId: connection.institutionId,
            sameConnection: false,
            absent: true,
          },
        ];
      },
    );
  });
  const resolution = resolveBankAccountIdentity(incoming, {
    institutionId,
    reported: [incoming],
    candidates,
  });
  if (resolution.rung === 3)
    return [{ accountId: resolution.candidate.budgetAccountId, exact: true }];
  if (resolution.rung !== 4) return [];
  return resolution.candidates.map((account) => ({
    accountId: account.budgetAccountId,
    exact: false,
  }));
}
