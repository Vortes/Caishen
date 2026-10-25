import { expect, test, vi } from "vitest";
import Home from "~/app/page";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "owner" }),
}));

test("opening home while signed in opens the live app with the requested month", async () => {
  await expect(
    Promise.resolve(
      Home({
        searchParams: Promise.resolve({
          month: "2026-09",
        }),
      }),
    ),
  ).rejects.toMatchObject({
    digest: "NEXT_REDIRECT;replace;/app?month=2026-09;307;",
  });
});
