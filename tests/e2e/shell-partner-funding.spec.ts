import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";
import { connectPartner } from "./partner-household";
import { expect, shellPath, test } from "./shell-fixture";
import { editAssigned, openRegister, saved } from "./shell-controls";

// Your partner pays for something that's all yours and shares it with you,
// so none of it needs a category in their budget.
async function sharePurchase(
  partner: Page,
  date: string,
  payee: string,
  outflow: string,
) {
  await partner
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const form = partner.getByRole("form", {
    name: "New transaction",
    exact: true,
  });
  await partner
    .getByRole("dialog", { name: "Date calendar", exact: true })
    .press("Escape");
  await form.getByRole("combobox", { name: "Date", exact: true }).fill(date);
  await form.getByLabel("Payee", { exact: true }).fill(payee);
  await form.getByLabel("Outflow", { exact: true }).fill(outflow);
  await form.getByRole("button", { name: /^Share/ }).click();
  await partner
    .getByRole("dialog", { name: "Who this is for", exact: true })
    .getByRole("group", { name: "How much is for Caishen E2E", exact: true })
    .getByRole("button", { name: /^All of it/ })
    .click();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await saved(partner);
}

test("what's still to fund for your partner is set aside by categorizing their purchases and assigning the rest", async ({
  page,
  browser,
  budgets,
  baseURL,
}) => {
  test.setTimeout(180_000);
  // $1,000.00 in checking, $200.00 in Groceries, and Parking to fill.
  const budget = await budgets.create({ categories: ["Parking"] });
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  const identity = await connectPartner({
    page,
    browser,
    baseURL,
    budgets,
    partnerName: "Jordan",
  });

  const context = await browser.newContext({
    baseURL,
    reducedMotion: "reduce",
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
  });
  try {
    const partner = await context.newPage();
    await setupClerkTestingToken({ page: partner });
    await partner.goto(shellPath);
    await clerk.signIn({ page: partner, emailAddress: identity.email });
    await expect(
      partner.getByRole("heading", { name: "Plan", exact: true }),
    ).toBeVisible();
    await partner
      .getByRole("button", { name: "Add account", exact: true })
      .click();
    const account = partner.getByRole("form", { name: "Add account" });
    await account.getByLabel("Account name").fill("Jordan checking");
    await account.getByLabel("Opening balance").fill("500");
    await account
      .getByRole("button", { name: "Add account", exact: true })
      .click();
    await openRegister(partner, "Jordan checking");
    await sharePurchase(partner, budget.date, "Platinum Parking", "71");
    await sharePurchase(partner, budget.date, "Trader Joe’s", "33.42");
  } finally {
    await context.close();
  }

  await page.goto(shellPath);
  await expect(
    page.getByRole("heading", { name: "Plan", exact: true }),
  ).toBeVisible();
  const parking = await editAssigned(page, "Parking");
  await parking.fill("51");
  await parking.press("Enter");
  await saved(page);

  await page.getByRole("checkbox", { name: "Select Jordan" }).click();
  const details = page.getByRole("complementary", {
    name: "Details",
    exact: true,
  });
  const purchase = (payee: string) =>
    details
      .getByRole("list", { name: "Your part of Jordan’s purchases" })
      .getByRole("listitem")
      .filter({ hasText: payee });
  const choose = async (payee: string, category: string) => {
    await purchase(payee)
      .getByRole("combobox", { name: `Category for ${payee}` })
      .click();
    await page
      .getByRole("option", { name: new RegExp(`^${category}`) })
      .click();
    await saved(page);
  };
  const row = page.getByRole("button", { name: /^Jordan/ }).first();

  // Parking holds $51.00 of your $71.00, so $20.00 of it is short.
  await choose("Platinum Parking", "Parking");
  await expect(purchase("Platinum Parking")).toContainText("$20.00 short");
  await expect(
    details.getByText("$53.42 more needed to pay Jordan"),
  ).toBeVisible();
  await expect(row).toContainText("$53.42 more needed");

  await choose("Trader Joe’s", "Groceries");
  await expect(purchase("Trader Joe’s")).toContainText("Set aside");
  await expect(
    details.getByText("$20.00 more needed to pay Jordan"),
  ).toBeVisible();

  await details.getByRole("button", { name: "Assign $20.00" }).click();
  await saved(page);
  await expect(
    details.getByText("Everything you owe Jordan is set aside"),
  ).toBeVisible();
  await expect(details.getByText("$104.42 of $104.42 set aside")).toBeVisible();
  await expect(row.getByRole("img", { name: "Funded" })).toBeVisible();
});
