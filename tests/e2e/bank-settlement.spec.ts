import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";
import { connectSettlementBank } from "./bank-link-fixture";
import { connectPartner } from "./partner-household";
import { expect, shellPath, test } from "./shell-fixture";
import {
  accountBalance,
  openRegister,
  saved,
  transactionRow,
} from "./shell-controls";

async function openSettlement(page: Page, person: string, payee: string) {
  await openRegister(page, person);
  const ledger = page.getByRole("group", {
    name: `${person} ledger`,
    exact: true,
  });
  const row = ledger.locator("[data-entry-row]").filter({ hasText: payee });
  await expect(row).toHaveCount(1);
  const form = ledger.getByRole("form", { name: /^Settlement / });
  await row.locator('[data-column="amount"]').click();
  await expect(form).not.toBeVisible();
  await row.locator('[data-column="amount"]').click();
  await expect(form).toBeVisible();
  return form;
}

test("matched bank payments open on the second click and one confirmation persists in both people's ledgers", async ({
  page,
  browser,
  budget,
  budgets,
  baseURL,
}) => {
  test.setTimeout(180_000);
  void budget;
  const identity = await connectPartner({
    page,
    browser,
    baseURL,
    budgets,
    partnerName: "Alex",
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
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const sender = await connectSettlementBank(page, baseURL!, {
      date,
      amount: 50,
      name: "Venmo to Alex",
    });
    const recipient = await connectSettlementBank(partner, baseURL!, {
      date,
      amount: -50,
      name: "Venmo from Caishen E2E",
    });
    await sender.sync();
    await recipient.sync();
    await page.reload();
    await page.goto(shellPath);
    const form = await openSettlement(page, "Alex", "Venmo to Alex");
    await expect(form.getByRole("textbox")).toHaveCount(0);
    await expect(form.getByText(/Imported in both budgets/)).toBeVisible();
    await form
      .getByRole("button", { name: "Confirm settlement", exact: true })
      .click();
    await expect(form).not.toBeVisible();
    await saved(page);

    await page.reload();
    const confirmed = await openSettlement(page, "Alex", "Venmo to Alex");
    await expect(
      confirmed.getByText("Confirmed in both budgets.", { exact: true }),
    ).toBeVisible();
    await expect(
      confirmed.getByRole("button", { name: "Confirm settlement" }),
    ).toHaveCount(0);
    await confirmed.getByRole("button", { name: "Close", exact: true }).click();

    await partner.reload();
    const other = await openSettlement(
      partner,
      "Caishen E2E",
      "Venmo from Caishen E2E",
    );
    await expect(
      other.getByText("Confirmed in both budgets.", { exact: true }),
    ).toBeVisible();
    await expect(
      other.getByRole("button", { name: "Confirm settlement" }),
    ).toHaveCount(0);
    await other.getByRole("button", { name: "Close", exact: true }).click();

    // Another provider update and reload must not book either leg twice.
    await sender.sync();
    await recipient.sync();
    for (const [who, payee, balance] of [
      [page, "Venmo to Alex", "$950.00"],
      [partner, "Venmo from Caishen E2E", "$1,050.00"],
    ] as const) {
      await who.reload();
      await openRegister(who, "Settlement checking");
      await expect(transactionRow(who, payee)).toHaveCount(1);
      await expect(accountBalance(who)).toHaveText(balance);
    }
  } finally {
    await context.close();
  }
});
