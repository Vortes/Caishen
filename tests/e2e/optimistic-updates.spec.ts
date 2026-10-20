import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import { z } from "zod";

import { currentMonth } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";
import {
  addMember,
  commandSchema,
  createBook,
  execute,
  projectBook,
  type Command,
} from "../../src/domain/engine";

const mutationSchema = z.object({
  command: commandSchema,
  expectedRevision: z.number().int().nonnegative(),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

async function rejectRequest(
  route: Route,
  path = "budget.execute",
  conflict = false,
) {
  const error = {
    message: conflict
      ? "Your partner changed the budget. Refresh and try again."
      : "The update could not be saved. Try again.",
    code: conflict ? -32009 : -32603,
    data: {
      code: conflict ? "CONFLICT" : "INTERNAL_SERVER_ERROR",
      httpStatus: conflict ? 409 : 500,
      path,
    },
  };
  await route.fulfill({
    status: error.data.httpStatus,
    json: { error: superjson.serialize(error) },
  });
}

async function openFixture(page: Page, connected = false) {
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
  const month = currentMonth();
  const date = `${month}-01`;
  const partnerId = "optimistic-fixture-partner";
  let book = createBook(user.id, "Optimistic update fixture", month);
  const seed: Command[] = [
    {
      type: "account.add",
      id: "seed-checking",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      date,
      openingBalance: 100_000,
    },
    {
      type: "category.add",
      id: "seed-groceries",
      categoryId: "groceries",
      name: "Groceries",
      group: "Everyday",
    },
    {
      type: "assign",
      id: "seed-assignment",
      categoryId: "groceries",
      month,
      amount: 20_000,
    },
  ];
  for (const command of seed) book = execute(book, user.id, command);
  if (connected) {
    book = addMember(book, partnerId, "Partner", month);
    const sharedSeed: { actor: string; command: Command }[] = [
      {
        actor: user.id,
        command: {
          type: "category.add",
          id: "seed-dining",
          categoryId: "dining",
          name: "Dining",
          group: "Everyday",
        },
      },
      {
        actor: user.id,
        command: {
          type: "assign",
          id: "seed-dining-assignment",
          categoryId: "dining",
          month,
          amount: 10_000,
        },
      },
      {
        actor: partnerId,
        command: {
          type: "account.add",
          id: "seed-partner-account",
          accountId: "private-partner-account",
          name: "Private partner bank marker",
          kind: "cash",
          date,
          openingBalance: 87_654_321,
        },
      },
      {
        actor: partnerId,
        command: {
          type: "category.add",
          id: "seed-partner-private-category",
          categoryId: "private-partner-category",
          name: "Private partner category marker",
        },
      },
      {
        actor: partnerId,
        command: {
          type: "transaction.upsert",
          id: "seed-partner-private-purchase",
          transactionId: "private-partner-transaction",
          accountId: "private-partner-account",
          date,
          payee: "Private partner payee marker",
          categoryId: "private-partner-category",
          amount: -12_345,
        },
      },
      {
        actor: user.id,
        command: {
          type: "shared.create",
          id: "seed-shared-groceries",
          sharedCategoryId: "shared-groceries",
          participants: [user.id, partnerId],
          weights: { [user.id]: 1, [partnerId]: 1 },
          categoryIds: {
            [user.id]: "groceries",
            [partnerId]: "partner-groceries",
          },
        },
      },
      {
        actor: partnerId,
        command: {
          type: "transaction.upsert",
          id: "seed-partner-shared-purchase",
          transactionId: "partner-shared-purchase",
          accountId: "private-partner-account",
          date,
          payee: "Partner shared market",
          categoryId: "partner-groceries",
          sharedCategoryId: "shared-groceries",
          amount: -10_000,
        },
      },
      {
        actor: user.id,
        command: {
          type: "transaction.upsert",
          id: "seed-own-shared-purchase",
          transactionId: "own-shared-purchase",
          accountId: "checking",
          date,
          payee: "Own shared market",
          categoryId: "groceries",
          sharedCategoryId: "shared-groceries",
          amount: -4_000,
        },
      },
    ];
    for (const { actor, command } of sharedSeed)
      book = execute(book, actor, command);
  }
  let revision = 0;
  let refreshUnavailable = false;
  const calls: z.infer<typeof mutationSchema>[] = [];
  const historyCalls: string[] = [];
  let executionGate: {
    requested: ReturnType<typeof deferred<void>>;
    outcome: ReturnType<typeof deferred<"success" | "failure" | "conflict">>;
  } | null = null;
  let refreshGate: {
    requested: ReturnType<typeof deferred<void>>;
    resumed: ReturnType<typeof deferred<void>>;
  } | null = null;

  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/budget.state")) {
      const gate = refreshGate;
      if (gate) {
        gate.requested.resolve();
        await gate.resumed.promise;
      }
      if (refreshUnavailable) {
        await rejectRequest(route, "budget.state");
        return;
      }
      const state: State = {
        view: projectBook(book, user.id, month),
        revision,
        history: { undo: "Assign money", redo: null },
        services: [],
        connections: [],
        evidence: [],
        imports: [],
      };
      await respond(route, state);
      return;
    }
    if (url.pathname.endsWith("/budget.execute")) {
      const payload: unknown = route.request().postDataJSON();
      const serialized = (
        url.searchParams.has("batch")
          ? z.record(z.unknown()).parse(payload)["0"]
          : payload
      ) as ReturnType<typeof superjson.serialize>;
      const input = mutationSchema.parse(superjson.deserialize(serialized));
      calls.push(input);
      expect(input.expectedRevision).toBe(revision);
      const gate = executionGate;
      executionGate = null;
      if (gate) {
        gate.requested.resolve();
        const outcome = await gate.outcome.promise;
        if (outcome !== "success") {
          await rejectRequest(route, "budget.execute", outcome === "conflict");
          return;
        }
      }
      book = execute(book, user.id, input.command);
      revision++;
      await respond(route, { revision });
      return;
    }
    if (url.pathname.endsWith("/budget.changeHistory"))
      historyCalls.push(url.pathname);
    await route.abort("blockedbyclient");
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your budget", exact: true }),
  ).toBeVisible();

  return {
    date,
    calls,
    historyCalls,
    responseBody: connected
      ? await page.evaluate(async (requestedMonth) => {
          const input = encodeURIComponent(
            JSON.stringify({ json: { month: requestedMonth } }),
          );
          const response = await fetch(`/api/trpc/budget.state?input=${input}`);
          return response.text();
        }, month)
      : "",
    projection: () => projectBook(book, user.id, month),
    partnerChange: (command: Command) => {
      book = execute(book, partnerId, command);
      revision++;
    },
    setRefreshUnavailable: (value: boolean) => {
      refreshUnavailable = value;
    },
    holdExecution: () => {
      const gate = {
        requested: deferred<void>(),
        outcome: deferred<"success" | "failure" | "conflict">(),
      };
      executionGate = gate;
      return {
        requested: gate.requested.promise,
        succeed: () => gate.outcome.resolve("success"),
        reject: () => gate.outcome.resolve("failure"),
        conflict: () => gate.outcome.resolve("conflict"),
      };
    },
    holdRefresh: () => {
      const gate = {
        requested: deferred<void>(),
        resumed: deferred<void>(),
      };
      refreshGate = gate;
      return {
        requested: gate.requested.promise,
        release: () => {
          refreshGate = null;
          gate.resumed.resolve();
        },
      };
    },
  };
}

const assigned = (page: Page) =>
  page.getByTitle("Assign money to Groceries", { exact: true });
const assignmentEditor = (page: Page) =>
  page.getByLabel("Assigned amount for Groceries", { exact: true });

async function assign(page: Page, amount: string) {
  await assigned(page).click();
  await assignmentEditor(page).fill(amount);
  await assignmentEditor(page).press("Enter");
}

test("assignment previews all balances immediately and waits for the saved revision before another command", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  await expect(assigned(page)).toHaveText("$200.00");
  await expect(
    page.getByRole("button", { name: /^(Undo|Redo)$/, includeHidden: true }),
  ).toHaveCount(0);
  const execution = fixture.holdExecution();
  let refresh: ReturnType<typeof fixture.holdRefresh> | undefined;
  try {
    await assign(page, "250.00");
    await execution.requested;
    await expect(assigned(page)).toHaveText("$250.00");
    await expect(page.locator(".ready-to-assign")).toContainText("$750.00");
    await expect(
      page.getByRole("button", { name: /^Groceries available/ }),
    ).toContainText("$250.00");
    expect(fixture.projection().categories[0]!.assigned).toBe(20_000);
    await expect(assigned(page)).toBeDisabled();

    await assigned(page).click({ force: true });
    await expect(assignmentEditor(page)).not.toBeVisible();
    await page.keyboard.press("Meta+z");
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.historyCalls).toHaveLength(0);

    refresh = fixture.holdRefresh();
    execution.succeed();
    await refresh.requested;
    await expect(assigned(page)).toHaveText("$250.00");
    await expect(assigned(page)).toBeDisabled();
    await page.keyboard.press("Meta+z");
    expect(fixture.historyCalls).toHaveLength(0);
  } finally {
    execution.succeed();
    refresh?.release();
  }
  await expect(assigned(page)).toBeEnabled();
  await assign(page, "300.00");
  await expect(assigned(page)).toHaveText("$300.00");
  await expect(assigned(page)).toBeEnabled();
  expect(fixture.calls.map((call) => call.expectedRevision)).toEqual([0, 1]);
  expect(fixture.projection().readyToAssign).toBe(70_000);
});

test("a failed assignment rolls back before refresh and survives a refresh outage", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  const execution = fixture.holdExecution();
  let refresh: ReturnType<typeof fixture.holdRefresh> | undefined;
  try {
    await assign(page, "250.00");
    await execution.requested;
    await expect(assigned(page)).toHaveText("$250.00");
    await expect(page.locator(".ready-to-assign")).toContainText("$750.00");

    refresh = fixture.holdRefresh();
    execution.reject();
    await refresh.requested;
    await expect(assigned(page)).toHaveText("$200.00");
    await expect(page.locator(".ready-to-assign")).toContainText("$800.00");
    await expect(
      page.getByRole("button", { name: /^Groceries available/ }),
    ).toContainText("$200.00");
    await expect(page.locator('.workspace-notice[role="alert"]')).toContainText(
      "The update could not be saved. Try again.",
    );
    await page.keyboard.press("Meta+z");
    expect(fixture.historyCalls).toHaveLength(0);
    expect(fixture.projection().readyToAssign).toBe(80_000);
    fixture.setRefreshUnavailable(true);
  } finally {
    execution.reject();
    refresh?.release();
  }
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeVisible({ timeout: 15_000 });
  await expect(assigned(page)).toHaveText("$200.00");
  await expect(page.locator(".ready-to-assign")).toContainText("$800.00");
  await expect(assigned(page)).toBeDisabled();
  await page.keyboard.press("Meta+z");
  expect(fixture.historyCalls).toHaveLength(0);
  fixture.setRefreshUnavailable(false);
  await retry.click();
  await expect(retry).not.toBeVisible();
  await expect(assigned(page)).toBeEnabled();
  await assign(page, "225.00");
  await expect(assigned(page)).toHaveText("$225.00");
  await expect(assigned(page)).toBeEnabled();
  expect(fixture.calls.map((call) => call.expectedRevision)).toEqual([0, 0]);
});

test("a transaction previews its row and account balance, then rolls back without losing the draft", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  await page.locator(".register-add-transaction").click();
  const editor = page.locator(".transaction-editor-body");
  await editor.getByLabel("Date", { exact: true }).fill(fixture.date);
  await editor.getByLabel("Payee", { exact: true }).fill("Neighborhood market");
  await editor.getByRole("combobox", { name: "Category", exact: true }).click();
  const search = page.getByRole("textbox", {
    name: "Search categories",
    exact: true,
  });
  await search.fill("Groceries");
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  await editor.getByLabel("Outflow", { exact: true }).fill("30.00");
  const execution = fixture.holdExecution();
  let refresh: ReturnType<typeof fixture.holdRefresh> | undefined;
  const row = page.locator("tr[data-transaction-id]").filter({
    hasText: "Neighborhood market",
  });
  const checking = page
    .locator(".sidebar-account")
    .filter({ hasText: "Checking" });
  const workingBalance = page.locator(".register-balance-item").filter({
    hasText: "Working balance",
  });
  try {
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await execution.requested;
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("$30.00");
    await expect(checking).toContainText("$970.00");
    await expect(workingBalance).toContainText("$970.00");
    await expect(
      editor.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    await editor.getByLabel("Outflow", { exact: true }).press("Enter");
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.projection().cash).toBe(100_000);

    refresh = fixture.holdRefresh();
    execution.reject();
    await refresh.requested;
    await expect(row).toHaveCount(0);
    await expect(checking).toContainText("$1,000.00");
    await expect(workingBalance).toContainText("$1,000.00");
    await expect(editor.getByLabel("Payee", { exact: true })).toHaveValue(
      "Neighborhood market",
    );
    await expect(editor.getByLabel("Outflow", { exact: true })).toHaveValue(
      "30.00",
    );
  } finally {
    execution.reject();
    refresh?.release();
  }
  await expect(editor.getByRole("alert")).toContainText(
    "The update could not be saved. Try again.",
  );
  await expect(editor.getByLabel("Outflow", { exact: true })).toBeEnabled();
  await editor.getByLabel("Outflow", { exact: true }).fill("35.00");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("$35.00");
  await expect(workingBalance).toContainText("$965.00");
  expect(fixture.calls.map((call) => call.expectedRevision)).toEqual([0, 0]);
  expect(fixture.projection().cash).toBe(96_500);
});

test("rejected preferences keep the entered values available for retry", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Budget name", exact: true });
  const email = page.getByRole("checkbox", {
    name: /Send my daily review email/,
  });
  const emailEnabled = !(await email.isChecked());
  await name.fill("Household budget");
  await email.setChecked(emailEnabled);
  const execution = fixture.holdExecution();
  try {
    await page
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await execution.requested;
    await expect(name).toHaveValue("Household budget");
    await expect(email).toBeChecked({ checked: emailEnabled });
    await expect(page.locator(".budget-menu-name strong")).toHaveText(
      "Optimistic update fixture",
    );
  } finally {
    execution.reject();
  }
  await expect(page.locator('.workspace-notice[role="alert"]')).toContainText(
    "The update could not be saved. Try again.",
  );
  const save = page.getByRole("button", {
    name: "Save preferences",
    exact: true,
  });
  await expect(save).toBeEnabled();
  await expect(name).toHaveValue("Household budget");
  await expect(email).toBeChecked({ checked: emailEnabled });
  await save.click();
  await expect(save).toBeEnabled();
  await expect(page.locator(".budget-menu-name strong")).toHaveText(
    "Household budget",
  );
  await expect(name).toHaveValue("Household budget");
  await expect(email).toBeChecked({ checked: emailEnabled });
  expect(fixture.calls.map((call) => call.expectedRevision)).toEqual([0, 0]);
});

const partnerVerdict = (page: Page) => page.locator(".shared-verdict");
const accountBalance = (page: Page) =>
  page.locator(".sidebar-account").filter({ hasText: "Checking" });

test("connected budgets preview assignments and money moves without exposing the partner's private ledger", async ({
  page,
}) => {
  const fixture = await openFixture(page, true);
  for (const marker of [
    "Private partner bank marker",
    "private-partner-account",
    "Private partner category marker",
    "private-partner-category",
    "Private partner payee marker",
    "private-partner-transaction",
    "87654321",
  ])
    expect(fixture.responseBody).not.toContain(marker);
  expect(fixture.responseBody).toContain("Partner shared market");
  expect(fixture.responseBody).toContain("sharedLedger");
  await expect(partnerVerdict(page)).toContainText("$30.00");
  const assignment = fixture.holdExecution();
  try {
    await assign(page, "250.00");
    await assignment.requested;
    await expect(assigned(page)).toHaveText("$250.00");
    await expect(page.locator(".ready-to-assign")).toContainText("$650.00");
    await expect(
      page.getByRole("button", { name: /^Groceries available/ }),
    ).toContainText("$210.00");
    await expect(partnerVerdict(page)).toContainText("$30.00");
    expect(fixture.projection().readyToAssign).toBe(70_000);
    await page.keyboard.press("Meta+z");
    expect(fixture.historyCalls).toHaveLength(0);
  } finally {
    assignment.succeed();
  }
  await expect(assigned(page)).toBeEnabled();

  await page.getByRole("button", { name: /^Dining available/ }).click();
  const popover = page.locator(".move-popover");
  await popover.getByLabel("Move", { exact: true }).fill("25.00");
  await popover.getByLabel("To", { exact: true }).fill("Groceries");
  await popover.getByLabel("To", { exact: true }).press("Enter");
  const move = fixture.holdExecution();
  try {
    await popover.getByRole("button", { name: "OK", exact: true }).click();
    await move.requested;
    await expect(assigned(page)).toHaveText("$275.00");
    await expect(
      page.getByTitle("Assign money to Dining", { exact: true }),
    ).toHaveText("$75.00");
    await expect(page.locator(".ready-to-assign")).toContainText("$650.00");
    await page
      .getByRole("button", { name: "Clear category selection", exact: true })
      .click();
    await expect(partnerVerdict(page)).toContainText("$30.00");
    expect(fixture.projection().categories[0]!.assigned).toBe(25_000);
  } finally {
    move.succeed();
  }
  await expect(assigned(page)).toBeEnabled();
  expect(fixture.calls.map((call) => call.expectedRevision)).toEqual([0, 1]);
});

test("new and edited shared purchases preview cash and the partner balance before saving", async ({
  page,
}) => {
  const fixture = await openFixture(page, true);
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  await page.locator(".register-add-transaction").click();
  const editor = page.locator(".transaction-editor-body");
  await editor.getByLabel("Date", { exact: true }).fill(fixture.date);
  await editor.getByLabel("Payee", { exact: true }).fill("New shared market");
  await editor.getByText("Transaction details", { exact: true }).click();
  await editor
    .getByLabel("Shared category (optional)", { exact: true })
    .selectOption({ label: "Groceries" });
  await editor.getByLabel("Outflow", { exact: true }).fill("100.00");
  const purchase = fixture.holdExecution();
  try {
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await purchase.requested;
    await expect(
      page
        .locator("tr[data-transaction-id]")
        .filter({ hasText: "New shared market" }),
    ).toContainText("$100.00");
    await expect(accountBalance(page)).toContainText("$860.00");
    expect(fixture.projection().cash).toBe(96_000);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(partnerVerdict(page)).toContainText("Your partner owes you");
    await expect(partnerVerdict(page)).toContainText("$20.00");
    await expect(
      page.getByRole("button", { name: /^Groceries available/ }),
    ).toContainText("$60.00");
  } finally {
    purchase.succeed();
  }
  await expect(assigned(page)).toBeEnabled();
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  await page
    .getByTitle("Edit category for Own shared market", { exact: true })
    .click();
  await editor.getByLabel("Outflow", { exact: true }).fill("80.00");
  const edit = fixture.holdExecution();
  try {
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await edit.requested;
    await expect(
      page.locator('[data-transaction-id="own-shared-purchase"]'),
    ).toContainText("$80.00");
    await expect(accountBalance(page)).toContainText("$820.00");
    expect(fixture.projection().cash).toBe(86_000);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(partnerVerdict(page)).toContainText("Your partner owes you");
    await expect(partnerVerdict(page)).toContainText("$40.00");
    await expect(
      page.getByRole("button", { name: /^Groceries available/ }),
    ).toContainText("$20.00");
  } finally {
    edit.succeed();
  }
  await expect(assigned(page)).toBeEnabled();
  expect(fixture.calls.map((call) => call.expectedRevision)).toEqual([0, 1]);
  expect(fixture.projection().settlement.net).toBe(-4_000);
});

test("a partner revision conflict rolls back the preview before fetching the partner's new shared expense", async ({
  page,
}) => {
  const fixture = await openFixture(page, true);
  const assignment = fixture.holdExecution();
  let refresh: ReturnType<typeof fixture.holdRefresh> | undefined;
  try {
    await assign(page, "250.00");
    await assignment.requested;
    await expect(assigned(page)).toHaveText("$250.00");
    await expect(page.locator(".ready-to-assign")).toContainText("$650.00");
    fixture.partnerChange({
      type: "transaction.upsert",
      id: "partner-updated-shared-purchase",
      transactionId: "partner-shared-purchase",
      accountId: "private-partner-account",
      date: fixture.date,
      payee: "Partner shared market",
      categoryId: "partner-groceries",
      sharedCategoryId: "shared-groceries",
      amount: -16_000,
    });
    refresh = fixture.holdRefresh();
    assignment.conflict();
    await refresh.requested;
    await expect(assigned(page)).toHaveText("$200.00");
    await expect(page.locator(".ready-to-assign")).toContainText("$700.00");
    await expect(partnerVerdict(page)).toContainText("$30.00");
    await expect(assigned(page)).toBeDisabled();
    await expect(page.locator('.workspace-notice[role="alert"]')).toContainText(
      "Your partner changed the budget. Refresh and try again.",
    );
  } finally {
    assignment.conflict();
    refresh?.release();
  }
  await expect(assigned(page)).toBeEnabled();
  await expect(partnerVerdict(page)).toContainText("You owe your partner");
  await expect(partnerVerdict(page)).toContainText("$60.00");
  await expect(accountBalance(page)).toContainText("$960.00");
  await assign(page, "225.00");
  await expect(assigned(page)).toHaveText("$225.00");
  await expect(assigned(page)).toBeEnabled();
  expect(fixture.calls.map((call) => call.expectedRevision)).toEqual([0, 1]);
});

test("sharing a category previews its split and rolls back a rejected save without losing the form", async ({
  page,
}) => {
  const fixture = await openFixture(page, true);
  const dining = page.locator("tr").filter({
    has: page.getByRole("button", {
      name: "Dining",
      exact: true,
      includeHidden: true,
    }),
  });
  const badge = dining.getByTitle("Shared with your partner", { exact: true });
  await expect(badge).toHaveCount(0);
  await dining.getByRole("button", { name: "Dining", exact: true }).click();
  await page
    .getByRole("button", { name: "Share category", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Share with your partner",
    exact: true,
  });
  const percent = dialog.getByLabel("Your share (%)", { exact: true });
  await percent.fill("35");
  const execution = fixture.holdExecution();
  const split = page.getByRole("button", {
    name: "Edit Dining split",
    exact: true,
    includeHidden: true,
  });
  try {
    await dialog
      .getByRole("button", { name: "Save shared category", exact: true })
      .click();
    await execution.requested;
    await expect(badge).toContainText("35/65");
    await expect(split).toContainText("Shared · you 35%");
    expect(
      fixture
        .projection()
        .sharedCategories.some((category) => category.name === "Dining"),
    ).toBe(false);
    expect(fixture.calls[0]!.command.type).toBe("shared.create");
  } finally {
    execution.reject();
  }
  await expect(dialog.getByRole("alert")).toContainText(
    "The update could not be saved. Try again.",
  );
  await expect(badge).toHaveCount(0);
  await expect(split).toHaveCount(0);
  await expect(percent).toHaveValue("35");
  const save = dialog.getByRole("button", {
    name: "Save shared category",
    exact: true,
  });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog).not.toBeVisible();
  await expect(badge).toContainText("35/65");
  await expect(split).toContainText("Shared · you 35%");
  await expect(assigned(page)).toBeEnabled();
  expect(
    fixture
      .projection()
      .sharedCategories.some((category) => category.name === "Dining"),
  ).toBe(true);
  expect(fixture.calls.map((call) => call.expectedRevision)).toEqual([0, 0]);
});
