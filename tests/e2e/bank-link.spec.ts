import { test, expect } from "./shell-fixture";
import {
  bankCount,
  completePlaidLink,
  seedConnectedBank,
} from "./bank-link-fixture";

test.beforeEach(async ({ page, budget, baseURL }) => {
  void budget;
  await seedConnectedBank(page, baseURL!);
});

test("all connected accounts show masks and Close only, preserving the existing bank", async ({
  page,
}) => {
  const dialog = await completePlaidLink(page, "all");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Everyday Checking", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("•••• 1234", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await bankCount(page, 1);
});

for (const verdict of ["some", "none"] as const) {
  test(`${verdict} connected accounts allow a second login only after Connect anyway`, async ({
    page,
  }) => {
    const dialog = await completePlaidLink(page, verdict);
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Choose shared accounts",
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog.getByText(/second login.*stop updates/)).toBeVisible();
    if (verdict === "none")
      await expect(
        dialog.getByText(/selected accounts look different/),
      ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Connect anyway", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("dialog", {
        name: "Add Chase to your budget",
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await bankCount(page, 2);
  });
}

test("unknown identity explains missing details and keyboard dismissal keeps only the existing bank", async ({
  page,
}) => {
  const dialog = await completePlaidLink(page, "unknown");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/names or last digits are missing/),
  ).toBeVisible();
  for (let step = 0; step < 6; step++) {
    await page.keyboard.press("Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await bankCount(page, 1);
});

test("keyboard opens account selection for the existing connection", async ({
  page,
}) => {
  const dialog = await completePlaidLink(page, "some");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Choose shared accounts", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Plaid account selection", exact: true }),
  ).toBeVisible();
});

test.describe("mobile warning", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("touch can read and close the all-connected warning", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Show sidebar", exact: true }).tap();
    const dialog = await completePlaidLink(page, "all");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("•••• 1234", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).tap();
    await expect(dialog).not.toBeVisible();
  });
});
