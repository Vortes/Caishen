import { randomUUID } from "node:crypto";

// Loaded only by the dedicated bank-Link browser server. Budget/auth traffic
// remains real; every Plaid response is confined to the external HTTP boundary.
if (process.env.CAISHEN_E2E_PLAID_FIXTURE !== "1")
  throw new Error(
    "The Plaid browser fixture requires its dedicated test server.",
  );
const originalFetch = globalThis.fetch;
const prefix = "caishen-e2e-plaid:";
const delivered = new Set();
function decode(token) {
  if (typeof token !== "string" || !token.startsWith(prefix))
    throw new Error(
      "The Plaid fixture only accepts its own disposable tokens.",
    );
  return JSON.parse(
    Buffer.from(token.slice(prefix.length), "base64url").toString(),
  );
}
function accountRows(token) {
  const item = decode(token);
  return item.accounts.map(({ id, name, mask, type, subtype }) => ({
    account_id: id,
    name,
    mask,
    type,
    subtype,
    official_name: null,
    balances: {
      current: balance(item, id),
      available: balance(item, id),
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    },
  }));
}
function balance(item, accountId) {
  return (
    1000 -
    (delivered.has(item.id)
      ? (item.transactions ?? [])
          .filter((transaction) => transaction.account_id === accountId)
          .reduce((total, transaction) => total + transaction.amount, 0)
      : 0)
  );
}
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.hostname !== "sandbox.plaid.com") return originalFetch(input, init);
  const body = JSON.parse(init?.body ?? "{}");
  if (
    body.client_id !== "e2e-plaid-client" ||
    body.secret !== "e2e-plaid-secret"
  )
    throw new Error("Refusing real Plaid credentials in the browser fixture.");
  const request_id = `e2e-${randomUUID()}`;
  let answer;
  switch (url.pathname) {
    case "/link/token/create":
      answer = {
        link_token: body.access_token ? "e2e-update-link" : "e2e-new-link",
        expiration: new Date(Date.now() + 600_000).toISOString(),
      };
      break;
    case "/item/public_token/exchange":
      answer = {
        access_token: body.public_token,
        item_id: `e2e-item-${decode(body.public_token).id}`,
      };
      break;
    case "/accounts/get":
      answer = {
        accounts: accountRows(body.access_token),
        item: { institution_id: "ins-e2e-chase", institution_name: "Chase" },
      };
      break;
    case "/item/get":
      answer = {
        item: { error: null, consent_expiration_time: null },
        status: {
          transactions: {
            last_successful_update: new Date().toISOString(),
            last_failed_update: null,
          },
        },
      };
      break;
    case "/transactions/sync": {
      const item = decode(body.access_token);
      const transactions = item.transactions ?? [];
      // The first update establishes the opening balance. The next brings
      // the payment, after the account has been added to the budget.
      const send =
        transactions.length > 0 &&
        (body.cursor === "e2e-ready" ||
          (!body.cursor && delivered.has(item.id)));
      if (send) delivered.add(item.id);
      answer = {
        accounts: accountRows(body.access_token),
        added: send ? transactions : [],
        modified: [],
        removed: [],
        next_cursor: transactions.length
          ? delivered.has(item.id)
            ? "e2e-complete"
            : "e2e-ready"
          : "e2e-empty",
        has_more: false,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      };
      break;
    }
    case "/item/remove":
      answer = {};
      break;
    default:
      throw new Error(
        `Unhandled external Plaid fixture endpoint: ${url.pathname}`,
      );
  }
  return Response.json({ ...answer, request_id });
};
