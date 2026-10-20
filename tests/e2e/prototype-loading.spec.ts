import { expect, test, type Page } from "@playwright/test";

import { monthName } from "../../src/components/budget/format";
import { openPrototype } from "./prototype-fixture";

const sidebarWidth = (page: Page) =>
  page
    .locator("aside")
    .first()
    .evaluate((aside) => aside.clientWidth);

test("the loading skeleton keeps the saved layout until the budget arrives", async ({
  page,
}) => {
  const { month } = await openPrototype(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "caishen.prototype.app-shell.v2",
      JSON.stringify({
        theme: "light",
        sidebar: { width: 260, collapsed: true },
      }),
    ),
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/trpc/**", async (route) => {
    if (route.request().url().includes("budget.state")) await held;
    await route.fallback();
  });
  await page.reload();

  const skeleton = page.locator("[aria-busy]");
  await expect(skeleton.getByRole("status")).toHaveText("Opening your budget…");
  await expect(skeleton).toHaveAttribute("data-theme", "light");
  // The page is prerendered at build, so the month comes from the client's
  // clock, not the build's.
  await expect(skeleton.getByText(monthName(month))).toBeVisible();
  expect(await sidebarWidth(page)).toBe(0);
  // The skeleton only stands in for the shell: nothing in it can be reached.
  await expect(skeleton.getByRole("button")).toHaveCount(0);

  release();
  await expect(
    page.getByRole("heading", { name: "Plan", exact: true }),
  ).toBeVisible();
  await expect(skeleton).toHaveCount(0);
  await expect(page.locator('[data-theme="light"]').first()).toBeVisible();
  expect(await sidebarWidth(page)).toBe(0);
});
