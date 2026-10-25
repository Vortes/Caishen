import { screen } from "@testing-library/react";
import { TRPCError } from "@trpc/server";
import { expect, test, vi } from "vitest";
import type * as NextNavigation from "next/navigation";
import { SyncError } from "~/components/sync/transport";
import { readyOverview, refocus, renderShell } from "./shell-harness";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof NextNavigation>()),
  useRouter: () => router,
  usePathname: () => "/app",
  useSearchParams: () => new URLSearchParams(),
}));

test("a budget the server can't read shows maintenance in place of the plan, then the plan once it reads again", async () => {
  let readable = false;
  await renderShell({
    overview: () =>
      readable
        ? readyOverview()
        : { status: "maintenance", services: [], connections: [], imports: [] },
    pull: (input, server) => {
      if (!readable)
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Your plan is under maintenance.",
        });
      return server.pull("owner", input);
    },
    plan: false,
  });

  const title = await screen.findByText("We’re doing some maintenance.");
  expect(title.closest("[role=status]")?.textContent).toBe(
    "We’re doing some maintenance.Your plan will be back in a couple of minutes. Check back later.",
  );
  expect(screen.queryByRole("heading", { name: "Plan" })).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();

  readable = true;
  await refocus();
  await screen.findByRole("heading", { name: "Plan" });
});

test("someone without a budget starts guided onboarding, without the budget being polled", async () => {
  let pulls = 0;
  await renderShell({
    overview: () => ({
      status: "new",
      services: [],
      connections: [],
      imports: [],
    }),
    pull: () => {
      pulls++;
      throw new SyncError("noBudget", "Create your personal budget first.");
    },
    plan: false,
  });
  await vi.waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith("/welcome"),
  );
  expect(screen.queryByRole("heading", { name: "Plan" })).toBeNull();
  // A failed pull would be retried after a second.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  expect(pulls).toBe(1);
});
