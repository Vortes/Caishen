import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPlaidLinkSession,
  PLAID_LINK_SESSION_KEY,
  plaidCanonicalOrigin,
  plaidReceivedRedirectUri,
  readPlaidLinkSession,
  savePlaidLinkSession,
} from "../../src/components/banks/plaid-link-session";
import {
  loadPlaid,
  type PlaidSdk,
} from "../../src/components/banks/plaid-link-sdk";

const now = Date.parse("2026-10-20T02:00:00Z");
const session = {
  linkToken: "link-production-original-token",
  userId: "user_alan",
  expiration: "2026-10-20T02:30:00Z",
};

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

void test("OAuth return preserves the original user, token, expiration, and reconnect id", () => {
  const browser = storage();
  const original = { ...session, connectionId: "connection-chase" };
  savePlaidLinkSession(browser, original, now);
  assert.deepEqual(readPlaidLinkSession(browser, session.userId, now), {
    session: { ...original, version: 1 },
  });
  const persisted: unknown = JSON.parse(
    browser.getItem(PLAID_LINK_SESSION_KEY)!,
  );
  assert.deepEqual(persisted, { ...original, version: 1 });
});

void test("expiry is enforced at the exact expiration boundary and expired data is removed", () => {
  const browser = storage();
  savePlaidLinkSession(browser, session, now);
  assert.match(
    readPlaidLinkSession(
      browser,
      session.userId,
      Date.parse(session.expiration),
    ).error!,
    /expired.*Return to your budget/,
  );
  assert.equal(browser.getItem(PLAID_LINK_SESSION_KEY), null);
  assert.throws(
    () =>
      savePlaidLinkSession(browser, session, Date.parse(session.expiration)),
    /expired/,
  );
  assert.throws(
    () =>
      savePlaidLinkSession(browser, { ...session, expiration: "invalid" }, now),
    /expired/,
  );
});

void test("a different signed-in user cannot resume a stored bank authorization", () => {
  const browser = storage();
  savePlaidLinkSession(browser, session, now);
  assert.match(
    readPlaidLinkSession(browser, "user_other", now).error!,
    /another Caishen account/,
  );
  assert.equal(browser.getItem(PLAID_LINK_SESSION_KEY), null);
});

void test("missing, corrupt, and invalid sessions offer a fresh connect action", () => {
  const browser = storage();
  assert.match(
    readPlaidLinkSession(browser, session.userId, now).error!,
    /missing.*Connect a bank/,
  );
  for (const raw of [
    "{",
    "null",
    "{}",
    JSON.stringify({ ...session, version: 1, connectionId: 2 }),
    JSON.stringify({ ...session, version: 1, linkToken: "" }),
  ]) {
    browser.setItem(PLAID_LINK_SESSION_KEY, raw);
    assert.match(
      readPlaidLinkSession(browser, session.userId, now).error!,
      /Connect a bank/,
    );
    assert.equal(browser.getItem(PLAID_LINK_SESSION_KEY), null);
  }
});

void test("storage denial blocks Link before a bank can redirect to an unresumable session", () => {
  const browser = {
    ...storage(),
    setItem: () => {
      throw new Error("Storage blocked");
    },
  };
  assert.throws(
    () => savePlaidLinkSession(browser, session, now),
    /Allow browser storage/,
  );
});

void test("finishing an older Link flow does not clear a newer tab's session", () => {
  const browser = storage();
  savePlaidLinkSession(browser, session, now);
  clearPlaidLinkSession(browser, "link-older-token");
  assert.ok(browser.getItem(PLAID_LINK_SESSION_KEY));
  clearPlaidLinkSession(browser, session.linkToken);
  assert.equal(browser.getItem(PLAID_LINK_SESSION_KEY), null);
});

void test("Plaid receives the complete redirect URL without re-encoding its OAuth state", () => {
  const href =
    "https://caishen.example/banks/oauth?oauth_state_id=state%2Bwith%2Fencoding&extra=keep%20this#return";
  assert.equal(plaidReceivedRedirectUri(href), href);
  assert.throws(
    () => plaidReceivedRedirectUri("https://caishen.example/banks/oauth"),
    /incomplete/,
  );
  assert.throws(
    () =>
      plaidReceivedRedirectUri("https://caishen.example/?oauth_state_id=state"),
    /incomplete/,
  );
});

void test("bank connections start on the same origin as the configured OAuth return", () => {
  assert.equal(
    plaidCanonicalOrigin(undefined, "http://localhost:3000"),
    undefined,
  );
  assert.equal(
    plaidCanonicalOrigin("https://curate.is/banks/oauth", "https://curate.is"),
    undefined,
  );
  assert.equal(
    plaidCanonicalOrigin(
      "https://curate.is/banks/oauth",
      "https://caishen.vercel.app",
    ),
    "https://curate.is",
  );
  assert.throws(
    () => plaidCanonicalOrigin("javascript:alert(1)", "https://curate.is"),
    /needs service setup/,
  );
});

void test("concurrent SDK requests share one script and a failed load can be retried", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  type Script = {
    src: string;
    async: boolean;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    remove: () => void;
    removed: boolean;
  };
  const scripts: Script[] = [];
  const browser: { Plaid?: PlaidSdk } = {};
  const fakeDocument = {
    createElement: () => {
      const script: Script = {
        src: "",
        async: false,
        onload: null,
        onerror: null,
        removed: false,
        remove: () => {
          script.removed = true;
        },
      };
      return script;
    },
    head: { appendChild: (script: Script) => void scripts.push(script) },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browser,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: fakeDocument,
  });
  try {
    const first = loadPlaid();
    const concurrent = loadPlaid();
    assert.equal(first, concurrent);
    assert.equal(scripts.length, 1);
    const failed = assert.rejects(first, /could not load/);
    scripts[0]!.onerror!();
    await failed;
    assert.equal(scripts[0]!.removed, true);
    const retry = loadPlaid();
    assert.equal(scripts.length, 2);
    const sdk: PlaidSdk = {
      create: () => ({ open: () => undefined, destroy: () => undefined }),
    };
    browser.Plaid = sdk;
    scripts[1]!.onload!();
    assert.equal(await retry, sdk);
    assert.equal(await loadPlaid(), sdk);
    assert.equal(scripts.length, 2);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
