"use client";

// Linear-style limits for the sidebar and details panel. Each breakpoint sets
// how wide a panel can be when the window reaches it; between breakpoints
// the limit follows the window width, so shrinking the window narrows the
// panels smoothly instead of snapping. A saved width above the limit shows at
// the limit without being forgotten. Below a set width the sidebar can't be
// pinned and opens only as the peek. In development DialKit puts every limit
// on a slider; production builds hide the panel and use its defaults.

import { DialRoot, useDialKit } from "dialkit";
import "dialkit/styles.css";
import { useSyncExternalStore } from "react";
import { INSPECTOR, SIDEBAR } from "./settings";

type Slider = [number, number, number, number];
const sidebar = (max: number): Slider => [max, 160, SIDEBAR.max, 4];
const inspector = (max: number): Slider => [max, 220, INSPECTOR.max, 4];

// From here up the panels keep their own maximums.
const UNLIMITED_FROM = 1800;
// At and below this width both panels are drawers.
const DRAWERS_BELOW = 861;
const PHONE_BELOW = 561;

const LARGE_LAPTOP = 'At 1728px · 16" MacBook Pro';
const LAPTOP = "At 1280px · laptop";
const SMALL_LAPTOP = "At 1024px · small laptop";
const TABLET_LANDSCAPE = "At 861px · tablet landscape";
const DRAWERS = "Drawers · 561–860";

export type PanelLimits = {
  // Widest each panel can be at this width; null leaves the panel's own max.
  sidebarMax: number | null;
  inspectorMax: number | null;
  // The sidebar opens only as the peek.
  peekOnly: boolean;
};

export function usePanelLimits(): PanelLimits {
  const dials = useDialKit(
    "Panel max widths",
    {
      "Peek-only sidebar below": [1024, DRAWERS_BELOW, UNLIMITED_FROM, 1],
      [LARGE_LAPTOP]: { sidebar: sidebar(360), inspector: inspector(480) },
      [LAPTOP]: { sidebar: sidebar(240), inspector: inspector(400) },
      [SMALL_LAPTOP]: { sidebar: sidebar(240), inspector: inspector(340) },
      [TABLET_LANDSCAPE]: { sidebar: sidebar(160), inspector: inspector(340) },
      [DRAWERS]: { sidebar: sidebar(320), inspector: inspector(520) },
    },
    { id: "panel-max-widths-v4", persist: true },
  );
  const width = useViewportWidth();

  if (width >= UNLIMITED_FROM || width < PHONE_BELOW)
    return { sidebarMax: null, inspectorMax: null, peekOnly: false };
  if (width < DRAWERS_BELOW)
    return {
      sidebarMax: dials[DRAWERS].sidebar,
      inspectorMax: dials[DRAWERS].inspector,
      peekOnly: false,
    };

  const points = [
    { at: DRAWERS_BELOW, ...dials[TABLET_LANDSCAPE] },
    { at: 1024, ...dials[SMALL_LAPTOP] },
    { at: 1280, ...dials[LAPTOP] },
    { at: 1728, ...dials[LARGE_LAPTOP] },
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
  const peekOnly = width < dials["Peek-only sidebar below"];
  return {
    sidebarMax: between(low.sidebar, high.sidebar),
    // With the sidebar hidden, the details panel holds the tablet width and
    // takes the sidebar's space; it narrows only when the sidebar returns.
    inspectorMax: peekOnly
      ? dials[TABLET_LANDSCAPE].inspector
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

export function PanelWidthDials() {
  return <DialRoot position="bottom-right" />;
}
