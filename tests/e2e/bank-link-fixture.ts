import { createTRPCClient, httpLink } from "@trpc/client";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import superjson from "superjson";
import type { AppRouter } from "../../src/server/api/root";
import type { PlaidLinkMetadata } from "../../src/lib/plaid-link-metadata";
import {
  CLIENT_FORMAT,
  CLIENT_FORMAT_HEADER,
} from "../../src/domain/client-format";
import { expect } from "./shell-fixture";

export const checking = {
  id: "provider-checking",
  name: "Everyday Checking",
  mask: "1234",
  type: "depository",
  subtype: "checking",
};
const savings = {
  id: "provider-savings",
  name: "Savings",
  mask: "9876",
  type: "depository",
  subtype: "savings",
};
export type Verdict = "all" | "some" | "none" | "unknown";
const publicToken = (accounts: PlaidLinkMetadata["accounts"]) =>
  `caishen-e2e-plaid:${Buffer.from(JSON.stringify({ id: randomUUID(), accounts })).toString("base64url")}`;

export async function seedConnectedBank(page: Page, baseURL: string) {
  const api = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${baseURL}/api/trpc`,
        transformer: superjson,
        headers: { [CLIENT_FORMAT_HEADER]: String(CLIENT_FORMAT) },
        fetch: async (url, options) => {
          const address =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.href
                : url.url;
          const response = await page.context().request.fetch(address, {
            method: options?.method,
            headers: Object.fromEntries(new Headers(options?.headers)),
            data: typeof options?.body === "string" ? options.body : undefined,
          });
          return new Response(await response.text(), {
            status: response.status(),
            headers: response.headers(),
          });
        },
      }),
    ],
  });
  await api.budget.plaidExchange.mutate({
    publicToken: publicToken([checking]),
    metadata: {
      institution: { institution_id: "ins-e2e-chase" },
      accounts: [checking],
    },
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Plan", exact: true }),
  ).toBeVisible();
}

export async function completePlaidLink(page: Page, verdict: Verdict) {
  const accounts =
    verdict === "all"
      ? [checking]
      : verdict === "some"
        ? [checking, savings]
        : verdict === "none"
          ? [savings]
          : [{ ...checking, id: "new-checking", mask: null }];
  const metadata: PlaidLinkMetadata = {
    institution: { institution_id: "ins-e2e-chase" },
    accounts,
  };
  const token = publicToken(accounts);
  await page.route(
    "https://cdn.plaid.com/link/v2/stable/link-initialize.js",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.Plaid = { create(options) { let dialog; return { open() { if (options.token === 'e2e-update-link') { dialog = document.createElement('dialog'); dialog.setAttribute('aria-label', 'Plaid account selection'); dialog.textContent = 'Choose accounts to share with Caishen'; document.body.appendChild(dialog); dialog.showModal(); } else options.onSuccess(${JSON.stringify(token)}, ${JSON.stringify(metadata)}); }, destroy() { dialog?.remove(); } }; } };`,
      }),
  );
  const issues = page.getByRole("button", {
    name: "Collapse issues badge",
    exact: true,
  });
  if (await issues.isVisible()) await issues.click();
  const widths = page.getByRole("button", {
    name: "Panel widths",
    exact: true,
    expanded: true,
  });
  if (await widths.isVisible()) await widths.click();
  await page.getByRole("button", { name: "Banks", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect a bank", exact: true })
    .click();
  return page.getByRole("dialog", {
    name:
      verdict === "all"
        ? "These accounts are already connected"
        : "You already connected this bank",
    exact: true,
  });
}

export async function bankCount(page: Page, count: number) {
  const issues = page.getByRole("button", {
    name: "Collapse issues badge",
    exact: true,
  });
  if (await issues.isVisible()) await issues.click();
  const widths = page.getByRole("button", {
    name: "Panel widths",
    exact: true,
    expanded: true,
  });
  if (await widths.isVisible()) await widths.click();
  await page.getByRole("button", { name: "Banks", exact: true }).click();
  const banks = page.getByRole("dialog", {
    name: "Connected banks",
    exact: true,
  });
  await expect(banks.getByText("Chase", { exact: true })).toHaveCount(count);
  await page.keyboard.press("Escape");
}
