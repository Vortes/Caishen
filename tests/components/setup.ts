import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type * as NextNavigation from "next/navigation";
import { takeOracleFailures } from "../change-set-oracle";

// Finding what a render shows waits longer than Testing Library's 1s
// default, which a loaded machine exceeds.
configure({ asyncUtilTimeout: 5_000 });

// The component boundary excludes Clerk and the browser layout engine.
// No browser process, application server, or database is started here.
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, userId: "owner" }),
  // A signed-in user with no profile photo; the sidebar shows an initial.
  useUser: () => ({ isLoaded: true, user: null }),
  useClerk: () => ({ signOut: () => Promise.resolve() }),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof NextNavigation>();
  const { useSyncExternalStore } = await import("react");
  const subscribe = (notify: () => void) => {
    window.addEventListener("popstate", notify);
    return () => window.removeEventListener("popstate", notify);
  };
  return {
    ...actual,
    usePathname: () =>
      useSyncExternalStore(subscribe, () => window.location.pathname),
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(subscribe, () => window.location.search),
      ),
  };
});

beforeEach(() => {
  window.history.replaceState(null, "", "/app");
  // Next's navigation hooks follow both native history methods.
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    vi.spyOn(window.history, method).mockImplementation((...args) => {
      original(...args);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  }
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T19:00:00Z"));
  localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: media === "(pointer: fine)",
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  // Interface code can catch a failed command, so the change-set oracle's
  // failures are checked after each test.
  expect(takeOracleFailures()).toEqual([]);
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
