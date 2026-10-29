import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { outboxPath } from "./environment";
import { expect, test, shellPath } from "./shell-fixture";

// The link in the newest email to `to` that the test server sent.
async function invitationLink(to: string) {
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
async function stroke(page: Page, target: Locator, to = { x: 0.8, y: 0.6 }) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, {
    steps: 12,
  });
  await page.mouse.up();
}

test("an invitation sent from Settings becomes a shared budget for someone new", async ({
  page,
  budgets,
  browser,
  baseURL,
}) => {
  await rm(outboxPath, { recursive: true, force: true });
  const sender = await budgets.create({ name: "Sender budget" });
  const email = await budgets.newcomer();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(shellPath);
  await budgets.signIn(page, sender);
  await page.goto(`${shellPath}/settings/partner`);
  await page.getByLabel("Partner’s email").fill(email);
  await page.getByRole("button", { name: "Write invitation" }).click();
  await page.getByRole("button", { name: "Turn over to sign" }).click();
  await page.getByRole("button", { name: "Sign with my name instead" }).click();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invited ${email}`)).toBeVisible();
  const path = await invitationLink(email);

  // The partner opens the link in a browser of their own, signed out.
  const context = await browser.newContext({
    baseURL,
    reducedMotion: "reduce",
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
  });
  const partner = await context.newPage();
  await setupClerkTestingToken({ page: partner });
  await partner.goto(path);
  await expect(
    partner.getByRole("heading", {
      name: "Caishen E2E invited you to share a budget",
    }),
  ).toBeVisible();
  await expect(partner.getByLabel("Email address")).toHaveValue(email);
  await expect(partner.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    new RegExp(`${path}\\?sign-in$`),
  );
  await partner.getByLabel("Password").fill(`Caishen!${randomUUID()}`);
  await partner.getByRole("button", { name: "Continue", exact: true }).click();
  // Clerk's test addresses take a fixed code.
  await partner.getByLabel("Enter verification code").fill("424242");

  // Back on the link, signed in: the card waits for a tap, then for ink.
  await expect(partner).toHaveURL(new RegExp(`${path}$`));
  await budgets.claim(email);
  await partner
    .getByRole("img", { name: "Caishen sent you a paper plane" })
    .click();
  const pen = partner.locator("rect[class*='signZone']");
  await expect(pen).toBeVisible();
  await stroke(partner, pen);
  await partner.getByRole("button", { name: "Sign", exact: true }).click();
  // Signed, the partner takes their half of the card.
  const half = partner.locator("rect[class*='draggable']");
  await expect(half).toBeVisible();
  await stroke(partner, half, { x: -1.5, y: -1.5 });

  // The clouds part onto setting up a budget, which accepts the invitation.
  await expect(
    partner.getByRole("heading", {
      name: "Caishen invited you. Let’s set up your budget.",
    }),
  ).toBeVisible({ timeout: 30_000 });
  // Reopening the link carries on with the setup.
  await partner.reload();
  await expect(
    partner.getByRole("heading", {
      name: "Caishen invited you. Let’s set up your budget.",
    }),
  ).toBeVisible();
  await partner.getByLabel("Your name").fill("Alex Newcomer");
  await partner.getByLabel("Budget name").fill("Newcomer budget");
  await partner.getByRole("button", { name: "Create my budget" }).click();
  await expect(
    partner.getByRole("heading", { name: "A few questions about you" }),
  ).toBeVisible();
  await expect(partner).toHaveURL(/\/welcome$/);
  await partner.getByRole("button", { name: "Skip for now" }).click();
  await partner.getByRole("button", { name: "Skip for now" }).click();
  await expect(partner.getByText(/^Connected with Caishen/)).toBeVisible();
  await partner.getByRole("button", { name: "Open my budget" }).click();
  await expect(
    partner.getByRole("heading", { name: "Plan", exact: true }),
  ).toBeVisible();

  // The link is spent, and the sender sees their partner.
  const visitor = await browser.newPage({ baseURL });
  await visitor.goto(path);
  await expect(
    visitor.getByRole("heading", {
      name: "This invitation was already accepted",
    }),
  ).toBeVisible();
  await visitor.close();
  await page.reload();
  await expect(page.getByText(/^Connected with /)).toBeVisible();
  await context.close();
});
