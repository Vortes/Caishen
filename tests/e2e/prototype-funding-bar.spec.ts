import { expect, test, type Page } from "@playwright/test";

import { moveSaved, openPrototype, pill } from "./prototype-fixture";

const bar = (page: Page, categoryId: string) =>
  page.locator(`button[data-row][data-id="${categoryId}"]`).getByRole("img");

for (const theme of ["Dark", "Light"] as const) {
  test(`overspending has no empty target track in the ${theme.toLowerCase()} theme`, async ({
    page,
  }) => {
    const plan = await openPrototype(page);
    plan.changeElsewhere({
      type: "target.set",
      id: "weekly-household-target",
      categoryId: "household",
      target: {
        cadence: "weekly",
        behavior: "refill",
        amount: 5_000,
        weekday: 6,
        startMonth: plan.month,
        snoozedMonths: [],
      },
    });
    plan.changeElsewhere({
      type: "target.set",
      id: "monthly-dining-target",
      categoryId: "dining",
      target: {
        cadence: "monthly",
        behavior: "contribution",
        amount: 40_000,
        startMonth: plan.month,
        snoozedMonths: [],
      },
    });
    await page.reload();
    await page
      .getByRole("radiogroup", { name: "Theme" })
      .getByRole("radio", { name: theme })
      .click();

    const household = bar(page, "household");
    const dining = bar(page, "dining");
    await expect(household).toHaveAccessibleName(/Overspent on credit/);
    await expect(dining).toHaveAccessibleName(/Overspent\./);
    for (const category of [household, dining]) {
      await expect(category.locator('[data-kind="needed"]')).toHaveCount(0);
      await expect(category.locator('[data-kind="over"]')).toHaveCount(1);
      await expect(category.locator('[data-kind="over"]')).toHaveAttribute(
        "data-tone",
        "overspent",
      );
      const gap = await category.evaluate((element) => {
        const over = element.querySelector('[data-kind="over"]')!;
        const spent = over.previousElementSibling!;
        return (
          over.getBoundingClientRect().left -
          spent.getBoundingClientRect().right
        );
      });
      expect(gap).toBeLessThanOrEqual(2.1);
    }
    await expect(household.locator('[data-kind="spent"]')).toHaveCount(3);
    await expect(household.locator('[data-kind="over"]')).toHaveCSS(
      "flex-grow",
      "1299",
    );
    await expect(dining.locator('[data-kind="over"]')).toHaveCSS(
      "flex-grow",
      "8015",
    );
    await expect(
      bar(page, "phone").locator('[data-kind="needed"]'),
    ).toHaveCount(1);

    await pill(page, "Dining").click();
    const cover = page.getByRole("dialog", { name: /Dining/ });
    await cover.getByRole("combobox").click();
    await cover.getByRole("option", { name: /^Rent/ }).click();
    await cover.getByRole("button", { name: "Cover", exact: true }).click();
    await moveSaved(page);
    await expect(dining.locator('[data-kind="over"]')).toHaveCount(0);
    await expect(dining.locator('[data-kind="needed"]')).toHaveCount(1);

    plan.changeElsewhere({
      type: "transaction.upsert",
      id: "unfunded-phone-purchase",
      transactionId: "phone-purchase",
      accountId: "card",
      date: `${plan.month}-01`,
      payee: "Phone shop",
      categoryId: "phone",
      amount: -15_000,
    });
    await page.reload();
    const phone = bar(page, "phone");
    await expect(phone.locator('[data-kind="spent"]')).toHaveCount(0);
    await expect(phone.locator('[data-kind="needed"]')).toHaveCount(0);
    await expect(phone.locator('[data-kind="over"]')).toHaveCount(1);
    await expect(phone.locator('[data-kind="over"]')).toHaveCSS(
      "flex-grow",
      "15000",
    );
  });
}
