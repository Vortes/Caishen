import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { z } from "zod";

test("mobile navigation can reopen after switching views", async ({ page }) => {
  await clerkSetup();
  const users = z
    .array(z.object({ email: z.string().email() }))
    .parse(
      JSON.parse(
        await readFile(
          process.env.E2E_USERS_FILE ?? "/tmp/caishen-e2e-users.json",
          "utf8",
        ),
      ),
    );
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: users[0]!.email });
  await page.goto("/");
  const createBudget = page.getByRole("button", {
    name: "Create my budget",
    exact: true,
  });
  if (await createBudget.isVisible()) await createBudget.click();
  await expect(
    page.getByRole("heading", { name: "Your budget", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const destination of ["Settings", "Plan"]) {
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    const nav = page.getByRole("dialog");
    await expect(nav).toBeVisible();
    await expect(nav).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: destination, exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: destination, exact: true }).click();
    await expect(nav).not.toBeVisible();
  }
});
