import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";
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

beforeEach(() => {
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
