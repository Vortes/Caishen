import { expect, test, type Page, type Route } from "@playwright/test";

import { moveSaved, notifications, openPrototype } from "./prototype-fixture";

const amount = (page: Page, name: string) =>
  page.getByRole("button", {
    name: new RegExp(`assigned to ${name}\\. Edit assigned amount$`),
  });
const field = (page: Page, name: string) =>
  page.getByRole("textbox", {
    name: `Assigned amount for ${name}`,
    exact: true,
  });
const row = (page: Page, id: string) =>
  page.locator(`[data-row][data-id="${id}"]`);

for (const theme of ["Dark", "Light"] as const) {
  test(`Assigned keeps editing keys and commits on blur in the ${theme.toLowerCase()} theme`, async ({
    page,
  }, testInfo) => {
    const plan = await openPrototype(page);
    await page
      .getByRole("radiogroup", { name: "Theme" })
      .getByRole("radio", { name: theme, exact: true })
      .click();
    await expect(
      page
        .locator("[data-theme]")
        .filter({ has: page.locator("#prototype-content") }),
    ).toHaveAttribute("data-theme", theme.toLowerCase());
    await row(page, "gifts").click();
    await amount(page, "Rent").click();
    const input = field(page, "Rent");
    await expect(input).toBeFocused();
    await input.press("ArrowDown");
    await input.press("ArrowUp");
    await expect(input).toBeFocused();
    await expect(row(page, "gifts")).toHaveAttribute("aria-current", "true");
    await input.fill("500-50");
    const screenshot = testInfo.outputPath(
      `assigned-${theme.toLowerCase()}.png`,
    );
    await page.screenshot({ path: screenshot });
    await testInfo.attach(`assigned-${theme.toLowerCase()}`, {
      path: screenshot,
      contentType: "image/png",
    });
    await row(page, "gifts").click();
    await moveSaved(page);
    await expect(amount(page, "Rent")).toHaveText("$450.00");
    await expect(row(page, "gifts")).toBeFocused();
    expect(plan.commands).toEqual([
      expect.objectContaining({
        type: "assign",
        categoryId: "rent",
        month: plan.month,
        amount: -5_000,
      }),
    ]);
    expect(plan.executions).toHaveLength(1);
  });
}

test("retrying an earlier failed total reuses its operation after another failed total", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await amount(page, "Gifts").click();
  const input = field(page, "Gifts");
  for (const [total, error] of [
    ["150", "First attempt failed."],
    ["160", "Second attempt failed."],
  ] as const) {
    plan.rejectNextExecute(error);
    await input.fill(total);
    await input.press("Enter");
    await expect(notifications(page).getByRole("alert")).toContainText(error);
    await expect(amount(page, "Rent")).not.toHaveAttribute("aria-disabled");
    await expect(input).toHaveValue(total);
  }
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(amount(page, "Gifts")).toBeFocused();
  // Collapsing the group unmounts the Gifts row; its attempts outlive it.
  const everyday = page.getByRole("button", { name: /^Everyday\b/ });
  await everyday.click();
  await expect(everyday).toHaveAttribute("aria-expanded", "false");
  await expect(amount(page, "Gifts")).toHaveCount(0);
  await everyday.click();
  await expect(everyday).toHaveAttribute("aria-expanded", "true");
  await amount(page, "Gifts").click();
  await expect(input).toBeFocused();
  await input.fill("150");
  await input.press("Enter");
  await moveSaved(page);
  expect(plan.executions).toHaveLength(3);
  expect(plan.executions[0]!.command.id).not.toBe(
    plan.executions[1]!.command.id,
  );
  expect(plan.executions[2]).toEqual(plan.executions[0]);
  expect(plan.commands).toHaveLength(1);
});

test("Assigned cannot open while a different month is a placeholder", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holdMonth = async (route: Route) => {
    if (new URL(route.request().url()).pathname.endsWith("budget.state"))
      await held;
    await route.fallback();
  };
  await page.route("**/api/trpc/**", holdMonth);
  try {
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await expect(amount(page, "Rent")).toHaveAttribute("aria-disabled", "true");
    await amount(page, "Rent").click({ force: true });
    await expect(field(page, "Rent")).toHaveCount(0);
    expect(plan.writes).toEqual([]);
  } finally {
    release();
  }
  await expect(amount(page, "Rent")).not.toHaveAttribute("aria-disabled");
});

test("Assigned stays blocked after a failed refresh and recovers with Try again", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  const refuseRefresh = async (route: Route) => {
    if (new URL(route.request().url()).pathname.endsWith("budget.state"))
      await route.abort("failed");
    else await route.fallback();
  };
  await amount(page, "Gifts").click();
  await field(page, "Gifts").fill("150");
  await page.route("**/api/trpc/**", refuseRefresh);
  await field(page, "Gifts").press("Enter");
  await expect(notifications(page)).toContainText(
    "Your budget couldn’t refresh.",
    { timeout: 20_000 },
  );
  await expect(amount(page, "Rent")).toHaveAttribute("aria-disabled", "true");
  await amount(page, "Rent").click({ force: true });
  await expect(field(page, "Rent")).toHaveCount(0);
  expect(plan.executions).toHaveLength(1);
  await page.unroute("**/api/trpc/**", refuseRefresh);
  await notifications(page)
    .getByRole("button", { name: "Try again", exact: true })
    .click();
  await expect(amount(page, "Rent")).not.toHaveAttribute("aria-disabled");
  await expect(notifications(page)).not.toContainText(
    "Your budget couldn’t refresh.",
  );
  await amount(page, "Rent").click();
  await expect(field(page, "Rent")).toBeFocused();
});
