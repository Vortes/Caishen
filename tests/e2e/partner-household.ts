import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Locator, Page } from "@playwright/test";
import { outboxPath } from "./environment";
import { expect, shellPath } from "./shell-fixture";

// The link in the newest email to `to` that the test server sent.
export async function invitationLink(to: string) {
  let link: string | undefined;
  await expect(async () => {
    for (const file of (await readdir(outboxPath)).sort().reverse()) {
      const email = JSON.parse(
        await readFile(join(outboxPath, file), "utf8"),
      ) as { to: string[]; text: string };
      if (!email.to.includes(to)) continue;
      link = /https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/.exec(email.text)?.[0];
      if (link) return;
    }
    throw new Error(`No invitation email to ${to} yet.`);
  }).toPass({ timeout: 15_000 });
  return new URL(link!).pathname;
}

// A short stroke across an element, as a finger or mouse would draw it.
export async function stroke(
  page: Page,
  target: Locator,
  to = { x: 0.8, y: 0.6 },
) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, {
    steps: 12,
  });
  await page.mouse.up();
}

// Makes the signed-in sender's budget a shared one: invites a newcomer, who
// signs up in a browser of their own and accepts. The sender's page is left
// on Settings, reloaded. The invitation spec walks the same path step by
// step; this is for specs that only need a partner to exist.
export async function connectPartner({
  page,
  browser,
  baseURL,
  budgets,
  partnerName,
}: {
  page: Page;
  browser: Browser;
  baseURL: string | undefined;
  budgets: {
    newcomer: () => Promise<string>;
    claim: (email: string) => Promise<string>;
  };
  partnerName: string;
}) {
  await rm(outboxPath, { recursive: true, force: true });
  const email = await budgets.newcomer();
  await page.goto(`${shellPath}/settings/partner`);
  await page.getByLabel("Partner’s email").fill(email);
  await page.getByRole("button", { name: "Write invitation" }).click();
  await page.getByRole("button", { name: "Turn over to sign" }).click();
  await page.getByRole("button", { name: "Sign with my name instead" }).click();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invited ${email}`)).toBeVisible();
  const path = await invitationLink(email);

  const context = await browser.newContext({
    baseURL,
    reducedMotion: "reduce",
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
  });
  const partner = await context.newPage();
  await setupClerkTestingToken({ page: partner });
  await partner.goto(path);
  await partner
    .getByLabel("Password", { exact: true })
    .fill(`Caishen!${randomUUID()}`);
  await partner.getByRole("button", { name: "Continue", exact: true }).click();
  // Clerk's test addresses take a fixed code.
  await partner.getByLabel("Enter verification code").fill("424242");
  await expect(partner).toHaveURL(new RegExp(`${path}$`));
  await budgets.claim(email);
  await partner
    .getByRole("img", { name: "Caishen sent you something" })
    .click();
  const pen = partner.locator("rect[class*='signZone']");
  await expect(pen).toBeVisible();
  await stroke(partner, pen);
  await partner.getByRole("button", { name: "Sign", exact: true }).click();
  const half = partner.locator("rect[class*='draggable']");
  await expect(half).toBeVisible();
  await stroke(partner, half, { x: -1.5, y: -1.5 });
  const setup = partner.getByRole("heading", {
    name: /Let’s set up your budget\.$/,
  });
  await expect(setup).toBeVisible({ timeout: 30_000 });
  // Reopened, the setup is settled, so what's typed stays typed.
  await partner.reload();
  await expect(setup).toBeVisible();
  await partner.getByLabel("Your name").fill(partnerName);
  await partner.getByLabel("Budget name").fill(`${partnerName} budget`);
  await partner.getByRole("button", { name: "Create my budget" }).click();
  // Creating the budget takes a moment.
  await expect(
    partner.getByRole("heading", { name: "A few questions about you" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(partner).toHaveURL(/\/welcome$/);
  await partner.getByRole("button", { name: "Skip for now" }).click();
  await partner.getByRole("button", { name: "Skip for now" }).click();
  await expect(partner.getByText(/^Connected with /)).toBeVisible();
  await context.close();

  await page.reload();
  await expect(page.getByText(/^Connected with /)).toBeVisible();
}
