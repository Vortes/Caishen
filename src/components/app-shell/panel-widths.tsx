"use client";

// Sidebar and details panel widths from 16" laptop down to tablet. Wider
// screens keep the widths saved on this device. In development, DialKit
// puts the 16" laptop widths on sliders; production builds hide the panel and
// use its defaults.

import { DialRoot, useDialKit } from "dialkit";
import "dialkit/styles.css";
import { useMediaQuery } from "~/components/shared/use-media-query";

const LARGE_LAPTOP = '16" laptop · 1600–1799';
const LAPTOP = { sidebar: 240, inspector: 340 };
const SMALL_LAPTOP = { sidebar: 216, inspector: 300 };
const TABLET_LANDSCAPE = { sidebar: 160, inspector: 220 };
const TABLET_PORTRAIT = { sidebar: 320, inspector: 520 };

// The widths for the current screen, or null where the saved widths apply.
export function usePanelWidths() {
  const dials = useDialKit(
    "Panel widths",
    {
      enabled: true,
      [LARGE_LAPTOP]: {
        sidebar: [292, 160, 400, 4],
        inspector: [376, 220, 560, 4],
      },
    },
    { id: "panel-widths", persist: true },
  );

  const largeLaptop = useMediaQuery(
    "(min-width: 1600px) and (max-width: 1799px)",
  );
  const laptop = useMediaQuery("(min-width: 1280px) and (max-width: 1599px)");
  const smallLaptop = useMediaQuery(
    "(min-width: 1024px) and (max-width: 1279px)",
  );
  const tabletLandscape = useMediaQuery(
    "(min-width: 861px) and (max-width: 1023px)",
  );
  const tabletPortrait = useMediaQuery(
    "(min-width: 561px) and (max-width: 860px)",
  );

  if (!dials.enabled) return null;
  if (largeLaptop) return dials[LARGE_LAPTOP];
  if (laptop) return LAPTOP;
  if (smallLaptop) return SMALL_LAPTOP;
  if (tabletLandscape) return TABLET_LANDSCAPE;
  if (tabletPortrait) return TABLET_PORTRAIT;
  return null;
}

export function PanelWidthDials() {
  return <DialRoot position="bottom-right" />;
}
