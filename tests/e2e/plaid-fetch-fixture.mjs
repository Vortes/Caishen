import { randomUUID } from "node:crypto";

// Loaded only by the dedicated bank-Link browser server. Budget/auth traffic
// remains real; every Plaid response is confined to the external HTTP boundary.
if (process.env.CAISHEN_E2E_PLAID_FIXTURE !== "1")
  throw new Error(
    "The Plaid browser fixture requires its dedicated test server.",
  );
const originalFetch = globalThis.fetch;
const prefix = "caishen-e2e-plaid:";
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
  return decode(token).accounts.map(({ id, name, mask, type, subtype }) => ({
    account_id: id,
    name,
    mask,
    type,
    subtype,
    official_name: null,
    balances: {
      current: 1000,
      available: 1000,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    },
  }));
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
    case "/transactions/sync":
      answer = {
        accounts: accountRows(body.access_token),
        added: [],
        modified: [],
        removed: [],
        next_cursor: "e2e-empty",
        has_more: false,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      };
      break;
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
