import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import { z } from "zod";

import { currentMonth } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";
import {
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

// A month with cash overspending (Dining), credit overspending (Household) and an
// unfunded dated target (Phone), served through the real engine with no database.
async function openPlan(page: Page) {
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
  let book = createBook(user.id, "Plan fixture", month);
  const target = (amount: number, monthDay?: number) => ({
    cadence: "monthly" as const,
    behavior: "contribution" as const,
    amount,
    startMonth: month,
    monthDay,
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
      id: "seed-rent-target",
      categoryId: "rent",
      target: target(50_000, 1),
    },
    {
      type: "target.set",
      id: "seed-phone-target",
      categoryId: "phone",
      target: target(6_500, 24),
    },
    {
      type: "target.set",
      id: "seed-household-target",
      categoryId: "household",
      target: target(15_000),
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
  let revision = 0;
  const commands: Command[] = [];
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/budget.state")) {
      const state: State = {
        view: projectBook(book, user.id, month),
        revision,
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
      book = execute(book, user.id, input.command);
      commands.push(input.command);
      revision++;
      await respond(route, { revision });
      return;
    }
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
    commands,
    category: (id: string) =>
      projectBook(book, user.id, month).categories.find(
        (category) => category.id === id,
      )!,
  };
}

const pill = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name} available`) });

test("rows tell cash from credit overspending, and money moves from the Available pill", async ({
  page,
}) => {
  const plan = await openPlan(page);
  await expect(pill(page, "Dining")).toHaveClass(/overspent/);
  await expect(
    page.getByText("Overspent. $280.15 of $200.00", { exact: true }),
  ).toBeVisible();
  await expect(pill(page, "Household")).toHaveClass(/credit/);
  await expect(
    page.getByText("Overspent on credit. $150.00 of $137.01", { exact: true }),
  ).toBeVisible();

  // Moving more than Gifts holds is caught next to the amount.
  await pill(page, "Gifts").click();
  const popover = page.locator(".move-popover");
  await popover.getByLabel("Move", { exact: true }).fill("150");
  await popover.getByLabel("To", { exact: true }).fill("din");
  await popover.getByLabel("To", { exact: true }).press("Enter");
  await popover.getByRole("button", { name: "OK" }).click();
  await expect(popover.getByRole("alert")).toHaveText(
    "Gifts only has $100.00 available.",
  );

  await popover.getByLabel("Move", { exact: true }).fill("50");
  await popover.getByRole("button", { name: "OK" }).click();
  await expect(popover).not.toBeVisible();
  await expect(pill(page, "Dining")).toContainText("-$30.15");
  await expect
    .poll(() => plan.commands.at(-1))
    .toMatchObject({
      type: "cover",
      fromCategoryId: "gifts",
      toCategoryId: "dining",
      amount: 5_000,
    });

  // An overspent pill covers from a source instead.
  await pill(page, "Household").click();
  await expect(popover.getByLabel("Cover overspending")).toHaveValue("12.99");
  await popover.getByLabel("From", { exact: true }).click();
  await page.getByRole("option", { name: /^Ready to Assign/ }).click();
  await popover.getByRole("button", { name: "OK" }).click();
  await expect(pill(page, "Household")).toHaveClass(/funded/);
  await expect.poll(() => plan.category("household").available).toBe(0);
});

test("Underfunded previews YNAB's order, stops when Ready to Assign runs out, and applies at once", async ({
  page,
}) => {
  const plan = await openPlan(page);
  // Ready to Assign is $62.99. Both overspent categories come first, top to bottom:
  // Household (Bills) before Dining (Everyday).
  const auto = page.locator(".category-inspector");
  await auto.getByRole("button", { name: /^Underfunded/ }).click();
  const preview = page.getByRole("dialog", { name: "Underfunded" });
  await expect(preview.getByRole("listitem")).toHaveText([
    "Household+$12.99",
    "Dining+$50.00",
  ]);
  await expect(preview).toContainText(
    "more is needed, but Ready to Assign runs out first.",
  );
  await preview.getByRole("button", { name: "Assign money" }).click();
  await expect(preview).not.toBeVisible();
  await expect
    .poll(() => plan.commands.at(-1))
    .toMatchObject({
      type: "assign.batch",
      changes: [
        { categoryId: "household", amount: 1_299 },
        { categoryId: "dining", amount: 5_000 },
      ],
    });
  await expect(page.locator(".ready-to-assign")).toContainText("$0.00");
  await expect(
    auto.getByRole("button", { name: /^Underfunded/ }),
  ).toBeDisabled();
  await expect(auto).toContainText("Ready to Assign is empty.");

  // Free money from Gifts, then Underfunded finishes Dining's overspending before
  // Phone's dated target.
  await pill(page, "Gifts").click();
  const popover = page.locator(".move-popover");
  await popover.getByLabel("To", { exact: true }).fill("ready");
  await popover.getByLabel("To", { exact: true }).press("Enter");
  await popover.getByRole("button", { name: "OK" }).click();
  await expect(popover).not.toBeVisible();
  await page.getByRole("button", { name: "Clear category selection" }).click();
  await auto.getByRole("button", { name: /^Underfunded/ }).click();
  await expect(preview.getByRole("listitem")).toHaveText([
    "Dining+$30.15",
    "Phone+$65.00",
  ]);
  await preview.getByRole("button", { name: "Assign money" }).click();
  await expect(preview).not.toBeVisible();
  await expect.poll(() => plan.category("dining").available).toBe(0);
  await expect.poll(() => plan.category("phone").assigned).toBe(6_500);
  await expect(pill(page, "Dining")).toHaveClass(/empty/);
  await expect(pill(page, "Phone")).toHaveClass(/funded/);
});
