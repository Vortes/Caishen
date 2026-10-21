import { expect, test, vi } from "vitest";
import {
  RevisionSignal,
  watchFocusAndOnline,
} from "~/components/sync/revision-signal";

test("focus, coming online, and becoming visible each hint, but not while hidden", () => {
  const signal = new RevisionSignal();
  const hints = vi.fn();
  signal.subscribe(hints);
  const stop = watchFocusAndOnline(signal);
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("online"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(hints).toHaveBeenCalledTimes(3);
  expect(hints).toHaveBeenCalledWith({});

  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(hints).toHaveBeenCalledTimes(3);

  stop();
  vi.restoreAllMocks();
  window.dispatchEvent(new Event("focus"));
  expect(hints).toHaveBeenCalledTimes(3);
});
