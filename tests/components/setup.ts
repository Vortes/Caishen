import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// The component boundary excludes Clerk and the browser layout engine.
// No browser process, application server, or database is started here.
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, userId: "owner" }),
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
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
