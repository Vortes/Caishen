import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import { z } from "zod";

import { currentMonth } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";
import { PLAID_LINK_SESSION_KEY } from "../../src/components/banks/plaid-link-session";
import { createBook, projectBook } from "../../src/domain/engine";

const linkToken = "link-production-oauth-fixture";
const publicToken = "public-production-oauth-fixture";
const connectionId = "chase-connection";
const sdkCallsKey = "caishen.test.plaid-calls";

const sdkCallSchema = z.object({
  action: z.enum(["create", "open", "destroy"]),
  token: z.string(),
  receivedRedirectUri: z.string().optional(),
});

async function sdkCalls(page: Page) {
  const recorded = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    sdkCallsKey,
  );
  return recorded
    ? recorded.split("\n").map((line) => sdkCallSchema.parse(JSON.parse(line)))
    : [];
}

async function respond(route: Route, value: unknown) {
  if (route.request().headers()["trpc-accept"] === "application/jsonl") {
    const stream = jsonlStreamProducer({
      data: { 0: { result: { data: value } } },
      serialize: superjson.serialize,
    });
    await route.fulfill({
      contentType: "application/jsonl",
      body: await new Response(stream).text(),
    });
    return;
  }
  const result = { result: { data: superjson.serialize(value) } };
  await route.fulfill({
    json: new URL(route.request().url()).searchParams.has("batch")
      ? [result]
      : result,
  });
}

async function openFixture(
  page: Page,
  options: {
    reconnect?: boolean;
    failFirstSync?: boolean;
    redirectUri?: string;
  } = {},
) {
  await clerkSetup();
  const [user] = z
    .array(z.object({ id: z.string(), email: z.string().email() }))
    .nonempty()
    .parse(
      JSON.parse(
        await readFile(
          process.env.E2E_USERS_FILE ?? "/tmp/caishen-e2e-users.json",
          "utf8",
        ),
      ),
    );
  await page.addInitScript(
    ({ key, publicToken }) => {
      const record = (
        action: "create" | "open" | "destroy",
        token: string,
        receivedRedirectUri?: string,
      ) => {
        const previous = sessionStorage.getItem(key);
        sessionStorage.setItem(
          key,
          `${previous ? `${previous}\n` : ""}${JSON.stringify({ action, token, receivedRedirectUri })}`,
        );
      };
      window.Plaid = {
        create(options) {
          record("create", options.token, options.receivedRedirectUri);
          const succeed = () => options.onSuccess(publicToken);
          window.addEventListener("plaid-test-success", succeed);
          return {
            open() {
              record("open", options.token, options.receivedRedirectUri);
            },
            destroy() {
              record("destroy", options.token, options.receivedRedirectUri);
              window.removeEventListener("plaid-test-success", succeed);
            },
          };
        },
      };
    },
    { key: sdkCallsKey, publicToken },
  );
  const month = currentMonth();
  const book = createBook(user.id, "Plaid OAuth fixture", month);
  const connection: State["connections"][number] = {
    id: connectionId,
    itemId: "chase-item",
    lastSyncedAt: null,
    lastAttemptAt: null,
    error: "Reconnect your bank to resume updates.",
    accountMappings: {},
    transactionStatus: null,
    synchronizedAccountIds: [],
    institutionId: "chase-institution",
    institutionName: "Chase",
    accounts: [],
  };
  const requests: { procedure: string; input: unknown }[] = [];
  const unexpectedRequests: string[] = [];
  let syncAttempts = 0;
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/budget.state")) {
      const state: State = {
        view: projectBook(book, user.id, month),
        revision: 0,
        services: [
          { name: "Plaid", status: "configured", detail: "Test connection" },
        ],
        connections: options.reconnect ? [connection] : [],
        evidence: [],
        imports: [],
      };
      await respond(route, state);
      return;
    }
    const procedure = url.pathname.split("/").at(-1)!;
    const payload: unknown = route.request().postDataJSON();
    const serialized = (
      url.searchParams.has("batch")
        ? z.record(z.unknown()).parse(payload)["0"]
        : payload
    ) as ReturnType<typeof superjson.serialize>;
    const input = superjson.deserialize(serialized);
    requests.push({ procedure, input });
    if (procedure === "budget.plaidLinkToken") {
      await respond(route, {
        linkToken,
        expiration: new Date(Date.now() + 30 * 60_000).toISOString(),
        redirectUri: options.redirectUri,
      });
      return;
    }
    if (
      procedure === "budget.plaidExchange" ||
      procedure === "budget.plaidReconnect"
    ) {
      await respond(route, { id: connectionId });
      return;
    }
    if (procedure === "budget.sync") {
      syncAttempts++;
      if (options.failFirstSync && syncAttempts === 1) {
        await route.abort("failed");
        return;
      }
      await respond(route, { updated: 1 });
      return;
    }
    unexpectedRequests.push(procedure);
    await route.abort("blockedbyclient");
  });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your budget", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Bank connections", exact: true }),
  ).toBeVisible();
  return { userId: user.id, requests, unexpectedRequests };
}

test("bank OAuth resumes the original token and exchanges and syncs once", async ({
  page,
}) => {
  const { userId, requests, unexpectedRequests } = await openFixture(page);
  await page
    .getByRole("button", { name: "Connect a bank", exact: true })
    .click();
  await expect
    .poll(async () => sdkCalls(page))
    .toEqual([
      { action: "create", token: linkToken },
      { action: "open", token: linkToken },
    ]);
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    PLAID_LINK_SESSION_KEY,
  );
  expect(JSON.parse(stored!)).toMatchObject({ version: 1, userId, linkToken });
  const returnUrl = new URL(
    "/banks/oauth?oauth_state_id=state%2Fwith%2Bencoding",
    page.url(),
  ).href;
  await page.goto(returnUrl);
  await expect
    .poll(async () =>
      (await sdkCalls(page)).filter((call) => call.action === "open").at(-1),
    )
    .toEqual({
      action: "open",
      token: linkToken,
      receivedRedirectUri: returnUrl,
    });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("plaid-test-success"));
    window.dispatchEvent(new Event("plaid-test-success"));
  });
  await expect(
    page.getByRole("heading", { name: "Your bank is connected.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Bank connected." }),
  ).toBeVisible();
  expect(requests).toEqual([
    { procedure: "budget.plaidLinkToken", input: undefined },
    { procedure: "budget.plaidExchange", input: { publicToken } },
    { procedure: "budget.sync", input: undefined },
  ]);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      PLAID_LINK_SESSION_KEY,
    ),
  ).toBeNull();
  expect(unexpectedRequests).toEqual([]);
});

test("reconnecting through OAuth repairs the saved connection without exchanging", async ({
  page,
}) => {
  const { requests, unexpectedRequests } = await openFixture(page, {
    reconnect: true,
  });
  await page
    .getByRole("button", { name: "Reconnect Chase", exact: true })
    .click();
  await expect
    .poll(async () => sdkCalls(page))
    .toContainEqual({
      action: "open",
      token: linkToken,
    });
  await page.goto("/banks/oauth?oauth_state_id=reconnect-state");
  await expect
    .poll(async () =>
      (await sdkCalls(page)).filter((call) => call.action === "open").at(-1),
    )
    .toEqual({
      action: "open",
      token: linkToken,
      receivedRedirectUri: page.url(),
    });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("plaid-test-success")),
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Bank connected." }),
  ).toBeVisible();
  expect(requests).toEqual([
    { procedure: "budget.plaidLinkToken", input: { connectionId } },
    { procedure: "budget.plaidReconnect", input: { connectionId } },
    { procedure: "budget.sync", input: undefined },
  ]);
  expect(unexpectedRequests).toEqual([]);
});

test("a saved bank connection retries a failed update without exchanging twice", async ({
  page,
}) => {
  const { requests, unexpectedRequests } = await openFixture(page, {
    failFirstSync: true,
  });
  await page
    .getByRole("button", { name: "Connect a bank", exact: true })
    .click();
  await expect
    .poll(async () => sdkCalls(page))
    .toContainEqual({
      action: "open",
      token: linkToken,
    });
  await page.goto("/banks/oauth?oauth_state_id=retry-sync-state");
  await expect
    .poll(async () =>
      (await sdkCalls(page)).filter((call) => call.action === "open").at(-1),
    )
    .toMatchObject({ receivedRedirectUri: page.url() });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("plaid-test-success"));
    window.dispatchEvent(new Event("plaid-test-success"));
  });
  await expect(
    page.getByRole("heading", { name: "Your bank is connected.", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Your bank connection is saved, but its activity could not update.",
  );
  await page
    .getByRole("button", { name: "Retry bank update", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Bank activity updated.",
  );
  expect(requests).toEqual([
    { procedure: "budget.plaidLinkToken", input: undefined },
    { procedure: "budget.plaidExchange", input: { publicToken } },
    { procedure: "budget.sync", input: undefined },
    { procedure: "budget.sync", input: undefined },
  ]);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      PLAID_LINK_SESSION_KEY,
    ),
  ).toBeNull();
  expect(unexpectedRequests).toEqual([]);
});

test("bank linking directs alternate domains to the registered OAuth origin", async ({
  page,
}) => {
  const { requests, unexpectedRequests } = await openFixture(page, {
    redirectUri: "https://curate.is/banks/oauth",
  });
  await page
    .getByRole("button", { name: "Connect a bank", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: /curate\.is/ })).toHaveAttribute(
    "href",
    "https://curate.is",
  );
  expect(await sdkCalls(page)).toEqual([]);
  expect(requests).toEqual([
    { procedure: "budget.plaidLinkToken", input: undefined },
  ]);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      PLAID_LINK_SESSION_KEY,
    ),
  ).toBeNull();
  expect(unexpectedRequests).toEqual([]);
});

for (const scenario of ["missing", "expired", "wrong-user"] as const) {
  test(`OAuth return recovers from ${scenario} session data without contacting Plaid`, async ({
    page,
  }) => {
    const { userId, requests, unexpectedRequests } = await openFixture(page);
    if (scenario !== "missing") {
      await page.evaluate(
        ({ key, userId, linkToken, scenario }) =>
          localStorage.setItem(
            key,
            JSON.stringify({
              version: 1,
              userId: scenario === "wrong-user" ? "different-user" : userId,
              linkToken,
              expiration: new Date(
                Date.now() + (scenario === "expired" ? -60_000 : 30 * 60_000),
              ).toISOString(),
            }),
          ),
        { key: PLAID_LINK_SESSION_KEY, userId, linkToken, scenario },
      );
    }
    await page.goto("/banks/oauth?oauth_state_id=recovery-state");
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toContainText(
      scenario === "wrong-user"
        ? "started by another Caishen account"
        : `session ${scenario === "missing" ? "is missing" : "expired"}`,
    );
    await expect(alert).toContainText("Connect a bank");
    await expect(
      page.getByRole("link", { name: "Back to your budget" }),
    ).toBeVisible();
    expect(await sdkCalls(page)).toEqual([]);
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        PLAID_LINK_SESSION_KEY,
      ),
    ).toBeNull();
    expect(unexpectedRequests).toEqual([]);
  });
}
