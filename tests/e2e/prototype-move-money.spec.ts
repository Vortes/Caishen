import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import { z } from "zod";

import { currentMonth } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";
import {
  createBook,
  execute,
  projectBook,
  type Command,
} from "../../src/domain/engine";

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

// A month with cash overspending (Dining), credit overspending (Household),
// money to spare (Gifts), and an unfunded target (Phone), served through the
// real engine with no database. The prototype only reads it: any write fails
// the test.
async function openPrototype(page: Page) {
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
  let book = createBook(user.id, "Prototype fixture", month);
  const target = (amount: number) => ({
    cadence: "monthly" as const,
    behavior: "contribution" as const,
    amount,
    startMonth: month,
    snoozedMonths: [],
  });
  const initial: Command[] = [
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
      type: "account.add",
      id: "seed-card",
      accountId: "card",
      name: "Visa",
      kind: "credit",
      date,
      openingBalance: 0,
    },
    ...(
      [
        ["rent", "Rent", "Bills"],
        ["phone", "Phone", "Bills"],
        ["household", "Household", "Bills"],
        ["dining", "Dining", "Everyday"],
        ["gifts", "Gifts", "Everyday"],
      ] as const
    ).map(([categoryId, name, group]): Command => ({
      type: "category.add",
      id: `seed-${categoryId}`,
      categoryId,
      name,
      group,
    })),
    {
      type: "target.set",
      id: "seed-phone-target",
      categoryId: "phone",
      target: target(6_500),
    },
    ...(
      [
        ["rent", 50_000],
        ["household", 13_701],
        ["dining", 20_000],
        ["gifts", 10_000],
      ] as const
    ).map(([categoryId, amount]): Command => ({
      type: "assign",
      id: `seed-assign-${categoryId}`,
      categoryId,
      month,
      amount,
    })),
    {
      type: "transaction.upsert",
      id: "seed-dinner",
      transactionId: "dinner",
      accountId: "checking",
      date,
      payee: "Bistro",
      amount: -28_015,
      categoryId: "dining",
    },
    {
      type: "transaction.upsert",
      id: "seed-lamp",
      transactionId: "lamp",
      accountId: "card",
      date,
      payee: "Lamp store",
      amount: -15_000,
      categoryId: "household",
    },
  ];
  for (const command of initial) book = execute(book, user.id, command);
  const writes: string[] = [];
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/budget.state")) {
      const state: State = {
        view: projectBook(book, user.id, month),
        revision: 0,
        services: [],
        connections: [],
        evidence: [],
        imports: [],
      };
      await respond(route, state);
      return;
    }
    writes.push(url.pathname);
    await route.abort("blockedbyclient");
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  await page.goto("/prototype/app-shell");
  await expect(
    page.getByRole("heading", { name: "Plan", exact: true }),
  ).toBeVisible();
  return {
    writes,
    // What the engine would show after these commands, to check the
    // simulation against.
    expected: (commands: Command[]) => {
      let next = book;
      for (const command of commands) next = execute(next, user.id, command);
      const view = projectBook(next, user.id, month);
      return {
        readyToAssign: view.readyToAssign,
        category: (id: string) =>
          view.categories.find((category) => category.id === id)!,
      };
    },
    month,
  };
}

const pill = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`available in ${name}\\.`) });
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

test("the prototype moves money from the Available pill without saving it", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  const popover = page.getByRole("dialog", { name: /Gifts/ });

  // Moving more than Gifts holds is caught next to the amount.
  await pill(page, "Gifts").click();
  await expect(popover.getByLabel("Amount")).toHaveValue("100.00");
  await popover.getByLabel("Amount").fill("150");
  await popover.getByRole("combobox", { name: "To" }).click();
  await popover.getByRole("combobox", { name: "To" }).fill("din");
  await popover.getByRole("combobox", { name: "To" }).press("Enter");
  await popover.getByRole("button", { name: "Move", exact: true }).click();
  await expect(popover.getByRole("alert")).toHaveText(
    "Gifts only has $100.00 available.",
  );

  await popover.getByLabel("Amount").fill("50");
  await popover.getByRole("button", { name: "Move", exact: true }).click();
  await expect(popover).not.toBeVisible();
  const covered = plan.expected([
    {
      type: "cover",
      id: "check-cover",
      fromCategoryId: "gifts",
      toCategoryId: "dining",
      month: plan.month,
      amount: 5_000,
    },
  ]);
  await expect(pill(page, "Dining")).toHaveText(
    money(covered.category("dining").available),
  );
  await expect(pill(page, "Gifts")).toHaveText(
    money(covered.category("gifts").available),
  );
  const toast = page.getByRole("status").filter({ hasText: "Moved" });
  await expect(toast).toHaveText(/Moved \$50\.00 from Gifts to Dining/);

  // Undo puts it back.
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(pill(page, "Dining")).toHaveText("-$80.15");
  await expect(pill(page, "Gifts")).toHaveText("$100.00");

  // An overspent pill covers from a source, listing only places with money.
  await pill(page, "Household").click();
  const cover = page.getByRole("dialog", { name: /Household/ });
  await expect(cover.getByLabel("Overspending to cover")).toHaveValue("12.99");
  await cover.getByRole("combobox", { name: "From" }).click();
  await expect(cover.getByRole("option", { name: /Dining/ })).toHaveCount(0);
  await cover.getByRole("option", { name: /^Ready to Assign/ }).click();
  await cover.getByRole("button", { name: "Cover", exact: true }).click();
  const assigned = plan.expected([
    {
      type: "assign",
      id: "check-assign",
      categoryId: "household",
      month: plan.month,
      amount: 1_299,
    },
  ]);
  await expect(pill(page, "Household")).toHaveText("$0.00");
  await expect(
    page.locator("section").filter({ hasText: "Ready to Assign" }).first(),
  ).toContainText(money(assigned.readyToAssign));

  // A second move, so Reset has more than one to drop.
  await pill(page, "Gifts").click();
  await popover.getByRole("combobox", { name: "To" }).click();
  await popover.getByRole("option", { name: /^Phone/ }).click();
  await popover.getByRole("button", { name: "Move", exact: true }).click();
  await expect(pill(page, "Phone")).toHaveText("$100.00");

  // Reset drops every simulated move, and nothing was ever written.
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(pill(page, "Household")).toHaveText("-$12.99");
  await expect(pill(page, "Phone")).toHaveText("$0.00");
  expect(plan.writes).toEqual([]);
});

test("the category inspector opens the same move", async ({ page }) => {
  await openPrototype(page);
  await page.getByRole("button", { name: /^Gifts/ }).click();
  await page.getByRole("button", { name: "Move money", exact: true }).click();
  const popover = page.getByRole("dialog", { name: /Gifts/ });
  await popover.getByRole("combobox", { name: "To" }).click();
  await popover.getByRole("option", { name: /^Rent/ }).click();
  await popover.getByRole("button", { name: "Move", exact: true }).click();
  await expect(pill(page, "Rent")).toHaveText("$600.00");
  await expect(pill(page, "Gifts")).toHaveText("$0.00");
});

test("a popover opened near the bottom of the window opens upward", async ({
  page,
}) => {
  await openPrototype(page);
  await page.setViewportSize({ width: 1440, height: 820 });
  const trigger = await pill(page, "Gifts").boundingBox();
  await pill(page, "Gifts").click();
  const popover = page.getByRole("dialog", { name: /Gifts/ });
  await popover.getByRole("combobox", { name: "To" }).click();
  // Above the pill, inside the window, with the list clear of the footer,
  // once Radix has placed it.
  await expect(async () => {
    const box = (await popover.boundingBox())!;
    const list = (await popover.getByRole("listbox").boundingBox())!;
    const cancel = (await popover
      .getByRole("button", { name: "Cancel" })
      .boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(trigger!.y);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(list.y + list.height).toBeLessThanOrEqual(cancel.y);
  }).toPass();
});
