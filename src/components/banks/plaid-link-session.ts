export const PLAID_LINK_SESSION_KEY = "caishen.plaid-link.v1";

export type PlaidLinkSession = {
  version: 1;
  linkToken: string;
  userId: string;
  expiration: string;
  connectionId?: string;
};

type LinkStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SessionResult =
  | { session: PlaidLinkSession; error?: never }
  | { session?: never; error: string };

const restart =
  "Return to your budget and choose Connect a bank to start again.";

export function clearPlaidLinkSession(
  storage: LinkStorage,
  linkToken?: string,
) {
  try {
    if (linkToken) {
      const current: unknown = JSON.parse(
        storage.getItem(PLAID_LINK_SESSION_KEY) ?? "null",
      );
      if (
        !current ||
        typeof current !== "object" ||
        !("linkToken" in current) ||
        current.linkToken !== linkToken
      )
        return;
    }
    storage.removeItem(PLAID_LINK_SESSION_KEY);
  } catch {
    // Storage may become unavailable after a bank redirects back to the app.
  }
}

export function savePlaidLinkSession(
  storage: LinkStorage,
  session: Omit<PlaidLinkSession, "version">,
  now = Date.now(),
) {
  if (
    !Number.isFinite(Date.parse(session.expiration)) ||
    Date.parse(session.expiration) <= now
  )
    throw new Error(
      "Your bank connection session expired. Try connecting again.",
    );
  try {
    storage.setItem(
      PLAID_LINK_SESSION_KEY,
      JSON.stringify({
        version: 1,
        linkToken: session.linkToken,
        userId: session.userId,
        expiration: session.expiration,
        ...(session.connectionId ? { connectionId: session.connectionId } : {}),
      }),
    );
  } catch {
    throw new Error(
      "Allow browser storage for Caishen before connecting your bank, then try again.",
    );
  }
}

export function readPlaidLinkSession(
  storage: LinkStorage,
  userId: string,
  now = Date.now(),
): SessionResult {
  let stored: unknown;
  try {
    const raw = storage.getItem(PLAID_LINK_SESSION_KEY);
    if (!raw)
      return { error: `Your bank connection session is missing. ${restart}` };
    stored = JSON.parse(raw);
  } catch {
    clearPlaidLinkSession(storage);
    return {
      error: `Your bank connection session could not be read. ${restart}`,
    };
  }
  if (
    !stored ||
    typeof stored !== "object" ||
    !("version" in stored) ||
    stored.version !== 1 ||
    !("linkToken" in stored) ||
    typeof stored.linkToken !== "string" ||
    !stored.linkToken ||
    !("userId" in stored) ||
    typeof stored.userId !== "string" ||
    !("expiration" in stored) ||
    typeof stored.expiration !== "string" ||
    ("connectionId" in stored &&
      (typeof stored.connectionId !== "string" || !stored.connectionId))
  ) {
    clearPlaidLinkSession(storage);
    return { error: `Your bank connection session is invalid. ${restart}` };
  }
  if (stored.userId !== userId) {
    clearPlaidLinkSession(storage);
    return {
      error: `This bank connection was started by another Caishen account. ${restart}`,
    };
  }
  const expiration = Date.parse(stored.expiration);
  if (!Number.isFinite(expiration) || expiration <= now) {
    clearPlaidLinkSession(storage);
    return { error: `Your bank connection session expired. ${restart}` };
  }
  return {
    session: {
      version: 1,
      linkToken: stored.linkToken,
      userId: stored.userId,
      expiration: stored.expiration,
      ...("connectionId" in stored && typeof stored.connectionId === "string"
        ? { connectionId: stored.connectionId }
        : {}),
    },
  };
}

export function plaidReceivedRedirectUri(href: string) {
  const url = new URL(href);
  if (
    url.pathname !== "/banks/oauth" ||
    !url.searchParams.get("oauth_state_id")
  )
    throw new Error(`This bank return link is incomplete. ${restart}`);
  return href;
}

export function plaidCanonicalOrigin(
  redirectUri: string | undefined,
  currentOrigin: string,
) {
  if (!redirectUri) return undefined;
  const callback = new URL(redirectUri);
  if (!["http:", "https:"].includes(callback.protocol))
    throw new Error("The bank connection return address needs service setup.");
  return callback.origin === currentOrigin ? undefined : callback.origin;
}
