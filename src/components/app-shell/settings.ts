"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { PlanView } from "./plan-views";
import type { PanelState } from "./use-panel";

// Keep the existing key so upgrading the shell preserves device preferences.
export const STORAGE_KEY = "caishen.prototype.app-shell.v2";

export const SIDEBAR = { defaultWidth: 320, min: 200, max: 360 };
export const INSPECTOR = { defaultWidth: 520, min: 288, max: 520 };

export type Theme = "dark" | "light";
export type Settings = {
  sidebar: PanelState;
  inspector: PanelState;
  theme: Theme;
  // A Monkeytype palette name, applied over the dark theme; null keeps the
  // shell's own colors.
  palette: string | null;
  // The plan's focused view; like YNAB, remembered on this device.
  planView: PlanView | null;
};

export const defaults: Settings = {
  sidebar: { width: SIDEBAR.defaultWidth, collapsed: false },
  inspector: { width: INSPECTOR.defaultWidth, collapsed: false },
  theme: "dark",
  palette: null,
  planView: null,
};

function parse(saved: string | null): Settings {
  return saved
    ? { ...defaults, ...(JSON.parse(saved) as Partial<Settings>) }
    : defaults;
}

// The settings saved on this device, read once.
export function readSettings() {
  if (typeof window === "undefined") return defaults;
  return parse(localStorage.getItem(STORAGE_KEY));
}

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

// The saved settings for a server-rendered screen: the defaults on the
// server, then this device's settings from the first client render.
export function useSavedSettings() {
  const saved = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(STORAGE_KEY),
    () => null,
  );
  return useMemo(() => parse(saved), [saved]);
}
