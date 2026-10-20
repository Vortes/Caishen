import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import { z } from "zod";

import { currentMonth, today } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";
import { createBook, execute, projectBook } from "../../src/domain/engine";

const connectionId = "chase-account-setup";
const linkToken = "link-account-setup-fixture";
const publicToken = "public-account-setup-fixture";
const setupSchema = z
  .object({
    connectionId: z.literal(connectionId),
    operationId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    accounts: z.array(
      z
        .object({
          providerAccountId: z.string(),
          name: z.string().min(1),
          expectedBalance: z.number(),
        })
        .strict(),
    ),
  })
  .strict();

async function respond(route: Route, value: unknown) {
  const url = new URL(route.request().url());
  const count = url.pathname.split("/").at(-1)!.split(",").length;
  if (route.request().headers()["trpc-accept"] === "application/jsonl") {
    const stream = jsonlStreamProducer({
      data: Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          index,
          { result: { data: value } },
        ]),
      ),
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
    json: url.searchParams.has("batch")
      ? Array.from({ length: count }, () => result)
      : result,
  });
}

async function openFixture(
  page: Page,
  options: {
    connected?: boolean;
    failFirstSetup?: boolean;
    unsynchronizedCard?: boolean;
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
  await page.addInitScript((token) => {
    window.Plaid = {
      create(options) {
        const succeed = () => options.onSuccess(token);
        window.addEventListener("plaid-test-success", succeed);
        return {
          open() {
            document.documentElement.dataset.plaidOpen = "true";
          },
          destroy() {
            window.removeEventListener("plaid-test-success", succeed);
          },
        };
      },
    };
  }, publicToken);
  const month = currentMonth();
  let book = createBook(user.id, "Bank account setup fixture", month);
  let revision = 0;
  let connected = options.connected ?? true;
  const connection: State["connections"][number] = {
    id: connectionId,
    itemId: "chase-setup-item",
    lastSyncedAt: new Date(),
    lastAttemptAt: new Date(),
    error: null,
    accountMappings: {},
    transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
    synchronizedAccountIds: options.unsynchronizedCard
      ? ["provider-checking"]
      : ["provider-checking", "provider-card"],
    institutionId: "chase-institution",
    institutionName: "Chase",
    accounts: [
      {
        accountId: "provider-checking",
        name: "Chase checking",
        officialName: "Chase Total Checking",
        mask: "1111",
        type: "depository",
        subtype: "checking",
        currentBalance: 1200.5,
        availableBalance: 1200.5,
        currency: "USD",
      },
      {
        accountId: "provider-card",
        name: "Chase credit card",
        officialName: "Chase credit card",
        mask: "2222",
        type: "credit",
        subtype: "credit card",
        currentBalance: 200.25,
        availableBalance: 10_000,
        currency: "USD",
      },
    ],
  };
  const setupRequests: z.infer<typeof setupSchema>[] = [];
  const requests: string[] = [];
  const unexpectedRequests: string[] = [];
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    const procedure = url.pathname.split("/").at(-1)!;
    if (procedure.split(",").every((name) => name === "budget.state")) {
      const state: State = {
        view: projectBook(book, user.id, month),
        revision,
        services: [
          { name: "Plaid", status: "configured", detail: "Test connection" },
        ],
        connections: connected ? [connection] : [],
        imports: [],
        evidence: [],
      };
      await respond(route, state);
      return;
    }
    requests.push(procedure);
    const payload: unknown = route.request().postDataJSON();
    const serialized = (
      url.searchParams.has("batch")
        ? z.record(z.unknown()).parse(payload)["0"]
        : payload
    ) as ReturnType<typeof superjson.serialize>;
    const input = superjson.deserialize(serialized);
    if (procedure === "budget.setupBankAccounts") {
      const setup = setupSchema.parse(input);
      setupRequests.push(setup);
      expect(setup.expectedRevision).toBe(revision);
      if (options.failFirstSetup && setupRequests.length === 1) {
        await route.abort("failed");
        return;
      }
      const mappings: Record<
        string,
        {
          accountId: string;
          startDate: string;
          openingSnapshot: {
            postedImportIds: string[];
            fingerprints: Record<string, string>;
          };
        }
      > = {};
      const accountIds: string[] = [];
      for (const selected of setup.accounts) {
        const provider = connection.accounts.find(
          (account) => account.accountId === selected.providerAccountId,
        )!;
        expect(selected.expectedBalance).toBe(provider.currentBalance);
        const accountId = `budget-${provider.accountId}`;
        accountIds.push(accountId);
        book = execute(book, user.id, {
          type: "account.add",
          id: `setup-${provider.accountId}`,
          accountId,
          name: selected.name,
          kind: provider.type === "credit" ? "credit" : "cash",
          openingBalance:
            Math.round(provider.currentBalance! * 100) *
            (provider.type === "credit" ? -1 : 1),
          date: today(),
        });
        mappings[provider.accountId] = {
          accountId,
          startDate: today(),
          openingSnapshot: { postedImportIds: [], fingerprints: {} },
        };
      }
      connection.accountMappings = mappings;
      revision++;
      await respond(route, { revision, accountIds });
      return;
    }
    if (procedure === "budget.plaidLinkToken") {
      await respond(route, {
        linkToken,
        expiration: new Date(Date.now() + 30 * 60_000).toISOString(),
      });
      return;
    }
    if (procedure === "budget.plaidExchange") {
      expect(input).toEqual({ publicToken });
      connected = true;
      await respond(route, { id: connectionId });
      return;
    }
    if (procedure === "budget.sync") {
      await respond(route, { imported: 0, updated: 0 });
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
  if (connected) await expect(setupDialog(page)).toBeVisible();
  else
    await expect(
      page.getByRole("heading", { name: "Bank connections", exact: true }),
    ).toBeVisible();
  return {
    setupRequests,
    requests,
    unexpectedRequests,
    getAccounts: () => book.budgets[user.id]!.accounts,
    getMappings: () => connection.accountMappings,
  };
}

function setupDialog(page: Page) {
  return page.getByRole("dialog", { name: "Name your bank accounts" });
}

async function nameAccounts(page: Page) {
  const dialog = setupDialog(page);
  await dialog
    .getByRole("group", { name: /Chase checking/ })
    .getByRole("textbox", { name: "Account name", exact: true })
    .fill("Everyday checking");
  await dialog
    .getByRole("group", { name: /Chase credit card/ })
    .getByRole("textbox", { name: "Account name", exact: true })
    .fill("Travel card");
}

test("connected accounts can be named later and appear in Cash and Credit once", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  const dialog = setupDialog(page);
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeInViewport();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(
    dialog
      .getByRole("group", { name: /Chase checking/ })
      .getByRole("textbox", { name: "Account name", exact: true }),
  ).toHaveValue(/Chase checking/);
  await expect(
    dialog
      .getByRole("group", { name: /Chase credit card/ })
      .getByRole("textbox", { name: "Account name", exact: true }),
  ).toHaveValue(/Chase credit card/);
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  const addAccounts = dialog.getByRole("button", {
    name: "Add accounts",
    exact: true,
  });
  await addAccounts.scrollIntoViewIfNeeded();
  await expect(addAccounts).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 720 });
  await dialog.getByRole("button", { name: "Later", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(fixture.setupRequests).toEqual([]);
  await page
    .getByRole("button", { name: "Set up accounts", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await nameAccounts(page);
  await dialog
    .getByRole("button", { name: "Add accounts", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const navigation = page.getByRole("complementary", {
    name: "Budget navigation",
  });
  await expect(
    navigation.getByRole("button", { name: "Cash $1,200.50", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("button", { name: "Credit -$200.25", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("button", {
      name: "Everyday checking $1,200.50",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    navigation.getByRole("button", {
      name: "Travel card -$200.25",
      exact: true,
    }),
  ).toHaveCount(1);
  expect(fixture.setupRequests).toHaveLength(1);
  expect(fixture.setupRequests[0]!.accounts).toEqual([
    {
      providerAccountId: "provider-checking",
      name: "Everyday checking",
      expectedBalance: 1200.5,
    },
    {
      providerAccountId: "provider-card",
      name: "Travel card",
      expectedBalance: 200.25,
    },
  ]);
  expect(
    fixture.getAccounts().map(({ name, kind, openingBalance }) => ({
      name,
      kind,
      openingBalance,
    })),
  ).toEqual([
    { name: "Everyday checking", kind: "cash", openingBalance: 120050 },
    { name: "Travel card", kind: "credit", openingBalance: -20025 },
  ]);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Bank connections", exact: true }),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Set up accounts", exact: true }),
  ).toHaveCount(0);
  expect(fixture.setupRequests).toHaveLength(1);
  expect(fixture.getAccounts()).toHaveLength(2);
  expect(fixture.unexpectedRequests).toEqual([]);
});

test("a failed account setup preserves names and can be retried", async ({
  page,
}) => {
  const fixture = await openFixture(page, { failFirstSetup: true });
  const dialog = setupDialog(page);
  await expect(dialog).toBeVisible();
  await nameAccounts(page);
  await dialog
    .getByRole("button", { name: "Add accounts", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog
      .getByRole("group", { name: /Chase checking/ })
      .getByRole("textbox", { name: "Account name", exact: true }),
  ).toHaveValue("Everyday checking");
  await expect(
    dialog
      .getByRole("group", { name: /Chase credit card/ })
      .getByRole("textbox", { name: "Account name", exact: true }),
  ).toHaveValue("Travel card");
  expect(fixture.getAccounts()).toEqual([]);
  await dialog
    .getByRole("button", { name: "Add accounts", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(fixture.setupRequests).toHaveLength(2);
  expect(fixture.setupRequests[1]!.accounts).toEqual(
    fixture.setupRequests[0]!.accounts,
  );
  expect(fixture.getAccounts()).toHaveLength(2);
  expect(fixture.unexpectedRequests).toEqual([]);
});

test("an account awaiting aligned bank activity does not block adding a ready account", async ({
  page,
}) => {
  const fixture = await openFixture(page, { unsynchronizedCard: true });
  const dialog = setupDialog(page);
  const deferredCard = dialog.getByRole("group", {
    name: "Chase credit card",
    exact: true,
  });
  await expect(deferredCard).toContainText(
    "The bank is still preparing this account’s balance and activity. Update again shortly.",
  );
  const deferredSelection = deferredCard.getByRole("checkbox", {
    name: "Add Chase credit card",
    exact: true,
  });
  await expect(deferredSelection).not.toBeChecked();
  await expect(deferredSelection).toBeDisabled();
  await dialog
    .getByRole("group", { name: "Chase checking", exact: true })
    .getByRole("textbox", { name: "Account name", exact: true })
    .fill("Everyday checking");
  await dialog
    .getByRole("button", { name: "Add accounts", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const navigation = page.getByRole("complementary", {
    name: "Budget navigation",
  });
  await expect(
    navigation.getByRole("button", {
      name: "Everyday checking $1,200.50",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("button", { name: "Credit $0.00", exact: true }),
  ).toBeVisible();
  expect(fixture.setupRequests).toHaveLength(1);
  expect(fixture.setupRequests[0]!.accounts).toEqual([
    {
      providerAccountId: "provider-checking",
      name: "Everyday checking",
      expectedBalance: 1200.5,
    },
  ]);
  expect(fixture.getAccounts()).toHaveLength(1);
  expect(fixture.getMappings()).not.toHaveProperty("provider-card");
  await page
    .getByRole("button", { name: "Set up accounts", exact: true })
    .click();
  await expect(deferredCard).toContainText(
    "The bank is still preparing this account’s balance and activity. Update again shortly.",
  );
  await expect(
    dialog.getByRole("button", { name: "Retry bank update", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Add accounts", exact: true }),
  ).toBeDisabled();
  expect(fixture.unexpectedRequests).toEqual([]);
});

test("returning from bank OAuth offers account naming", async ({ page }) => {
  const fixture = await openFixture(page, { connected: false });
  await expect(setupDialog(page)).toBeHidden();
  await page
    .getByRole("button", { name: "Connect a bank", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-plaid-open", "true");
  await page.goto("/banks/oauth?oauth_state_id=account-setup-state");
  await expect(page.locator("html")).toHaveAttribute("data-plaid-open", "true");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("plaid-test-success")),
  );
  await expect(setupDialog(page)).toBeVisible();
  await expect(page).toHaveURL(/\/banks\/oauth\?/);
  await nameAccounts(page);
  await setupDialog(page)
    .getByRole("button", { name: "Add accounts", exact: true })
    .click();
  await expect(setupDialog(page)).toBeHidden();
  await page.getByRole("link", { name: "Back to your budget" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Budget navigation" })
      .getByRole("button", {
        name: "Travel card -$200.25",
        exact: true,
      }),
  ).toBeVisible();
  expect(fixture.requests).toEqual([
    "budget.plaidLinkToken",
    "budget.plaidExchange",
    "budget.sync",
    "budget.sync",
    "budget.setupBankAccounts",
  ]);
  expect(fixture.getAccounts()).toHaveLength(2);
  expect(fixture.unexpectedRequests).toEqual([]);
});
