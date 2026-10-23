import { screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderShell } from "./shell-harness";

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () =>
      useSyncExternalStore(
        (notify) => {
          window.addEventListener("popstate", notify);
          return () => window.removeEventListener("popstate", notify);
        },
        () => window.location.pathname,
      ),
  };
});

beforeEach(() => {
  const pushState = window.history.pushState.bind(window.history);
  pushState(null, "", "/app");
  // Next makes its pathname hook follow native history changes.
  vi.spyOn(window.history, "pushState").mockImplementation((...args) => {
    pushState(...args);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
});

afterEach(() => vi.restoreAllMocks());

test("settings opens Profile and Partner at their app addresses and returns to the same budget", async () => {
  const { user } = await renderShell();
  await user.click(screen.getByRole("button", { name: "Component budget" }));
  await user.click(screen.getByRole("menuitem", { name: "Settings" }));
  expect(window.location.pathname).toBe("/app/settings");
  await screen.findByRole("heading", { name: "Profile" });
  expect(screen.getByLabelText("Budget name")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Partner" }));
  expect(window.location.pathname).toBe("/app/settings/partner");
  await screen.findByRole("heading", { name: "Partner" });
  expect(screen.getByRole("button", { name: "Create code" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Back to app" }));
  expect(window.location.pathname).toBe("/app");
  await screen.findByRole("heading", { name: "Plan" });
});
