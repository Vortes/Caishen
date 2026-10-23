import { expect, test, vi } from "vitest";
import Home from "~/app/page";
import PreviousAppShellPage from "~/app/prototype/app-shell/[[...section]]/page";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "owner" }),
}));

test("opening home while signed in opens the live app with the bookmarked month and transaction", async () => {
  await expect(
    Promise.resolve(
      Home({
        searchParams: Promise.resolve({
          month: "2026-09",
          account: "checking",
          transaction: "purchase",
        }),
      }),
    ),
  ).rejects.toMatchObject({
    digest:
      "NEXT_REDIRECT;replace;/app?month=2026-09&account=checking&transaction=purchase;307;",
  });
});

test("an old settings bookmark opens the live settings page and preserves its query", async () => {
  await expect(
    PreviousAppShellPage({
      params: Promise.resolve({ section: ["settings", "partner"] }),
      searchParams: Promise.resolve({ month: "2026-09", account: "checking" }),
    }),
  ).rejects.toMatchObject({
    digest:
      "NEXT_REDIRECT;replace;/app/settings/partner?month=2026-09&account=checking;307;",
  });
});
