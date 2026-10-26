"use client";

// Linear-style limits for the sidebar and details panel. Each breakpoint sets
// how wide a panel can be when the window reaches it; between breakpoints
// the limit follows the window width, so shrinking the window narrows the
// panels smoothly instead of snapping. A saved width above the limit shows at
// the limit without being forgotten. Below a set width the sidebar can't be
// pinned and opens only as the peek.

import { useSyncExternalStore } from "react";
import { INSPECTOR, SIDEBAR } from "./settings";

// From here up the panels keep their own maximums.
const UNLIMITED_FROM = 1800;
// At and below this width both panels are drawers.
const DRAWERS_BELOW = 861;
const PHONE_BELOW = 561;

const PEEK_ONLY_BELOW = 1024;

// Each panel's widest at a window width.
const LARGE_LAPTOP = { sidebar: 360, inspector: 480 }; // 16" MacBook Pro
const LAPTOP = { sidebar: 240, inspector: 400 };
const SMALL_LAPTOP = { sidebar: 240, inspector: 340 };
const TABLET_LANDSCAPE = { sidebar: 160, inspector: 340 };
const DRAWERS = { sidebar: 320, inspector: 520 };

export type PanelLimits = {
  // Widest each panel can be at this width; null leaves the panel's own max.
  sidebarMax: number | null;
  inspectorMax: number | null;
  // The sidebar opens only as the peek.
  peekOnly: boolean;
};

export function usePanelLimits(): PanelLimits {
  const width = useViewportWidth();

  if (width >= UNLIMITED_FROM || width < PHONE_BELOW)
    return { sidebarMax: null, inspectorMax: null, peekOnly: false };
  if (width < DRAWERS_BELOW)
    return {
      sidebarMax: DRAWERS.sidebar,
      inspectorMax: DRAWERS.inspector,
      peekOnly: false,
    };

  const points = [
    { at: DRAWERS_BELOW, ...TABLET_LANDSCAPE },
    { at: 1024, ...SMALL_LAPTOP },
    { at: 1280, ...LAPTOP },
    { at: 1728, ...LARGE_LAPTOP },
    // Meets the default widths, so an un-resized panel doesn't jump here.
    {
      at: UNLIMITED_FROM,
      sidebar: SIDEBAR.defaultWidth,
      inspector: INSPECTOR.defaultWidth,
    },
  ];
  const upper = points.findIndex((point) => point.at > width);
  const low = points[upper - 1]!;
  const high = points[upper]!;
  const progress = (width - low.at) / (high.at - low.at);
  const between = (from: number, to: number) =>
    Math.round(from + (to - from) * progress);
  const peekOnly = width < PEEK_ONLY_BELOW;
  return {
    sidebarMax: between(low.sidebar, high.sidebar),
    // With the sidebar hidden, the details panel holds the tablet width and
    // takes the sidebar's space; it narrows only when the sidebar returns.
    inspectorMax: peekOnly
      ? TABLET_LANDSCAPE.inspector
      : between(low.inspector, high.inspector),
    peekOnly,
  };
}

// The window width, updated once a frame while it's resized. While the
// window is resizing the panels follow it directly instead of easing.
function useViewportWidth() {
  return useSyncExternalStore(
    subscribeToResize,
    () => window.innerWidth,
    () => UNLIMITED_FROM,
  );
}

function subscribeToResize(onChange: () => void) {
  let frame = 0;
  let settle: number | undefined;
  const onResize = () => {
    document.documentElement.dataset.windowResizing = "";
    window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      delete document.documentElement.dataset.windowResizing;
    }, 150);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(onChange);
  };
  window.addEventListener("resize", onResize);
  return () => {
    window.removeEventListener("resize", onResize);
    cancelAnimationFrame(frame);
    window.clearTimeout(settle);
  };
}
