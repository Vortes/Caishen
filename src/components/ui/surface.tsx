"use client";

import { Tooltip } from "radix-ui";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Every surface sits this far from its trigger, and stops this far from the
// window edge. Radix positioning takes pixel numbers, not CSS lengths.
export const SURFACE_GAP = 6;
export const SURFACE_COLLISION_PADDING = 12;

// Surfaces render through a portal so panels that clip their overflow can't
// cut them off. The portal targets the themed root rather than <body>, so a
// data-theme set there still applies to what's portaled.
const PortalContainer = createContext<HTMLElement | null>(null);

type InputMethod = "keyboard" | "pointer";
const InputMethodContext = createContext<{ current: InputMethod } | null>(null);

// The one provider at a screen's root: where surfaces portal to, and the
// input method that decides whether they animate.
export function SurfaceProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  const input = useRef<InputMethod>("keyboard");
  useEffect(() => {
    const pointer = () => {
      input.current = "pointer";
    };
    const keyboard = () => {
      input.current = "keyboard";
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("pointermove", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("pointermove", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, []);
  return (
    <PortalContainer.Provider value={container}>
      <InputMethodContext.Provider value={input}>
        <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
          {children}
        </Tooltip.Provider>
      </InputMethodContext.Provider>
    </PortalContainer.Provider>
  );
}

export function usePortalContainer() {
  return useContext(PortalContainer);
}

export type SurfaceMotion = "frequent" | "occasional";

// Frequent surfaces open and close instantly. Occasional ones animate when
// the pointer opens them; a keyboard opening is always instant.
export function useSurfaceMotion(
  open: boolean,
  frequency: SurfaceMotion = "frequent",
) {
  const input = useContext(InputMethodContext);
  if (!input) throw new Error("Surfaces need a SurfaceProvider.");
  const [opening, setOpening] = useState(() => ({
    open,
    instant: input.current === "keyboard",
  }));
  // Capture the opening input, so typing inside a form does not cancel its
  // entrance or change its exit. A reopening during exit captures it again.
  if (opening.open !== open) {
    setOpening({
      open,
      instant: open ? input.current === "keyboard" : opening.instant,
    });
  }
  return {
    "data-motion": frequency,
    "data-instant": frequency === "frequent" || opening.instant || undefined,
  };
}

export type SurfaceSide = "top" | "right" | "bottom" | "left";
export type SurfaceAlign = "start" | "center" | "end";

// Clear of the window edge on every side but the one the surface aligns to:
// a trigger near the edge, like Banks in the sidebar, keeps its surface
// flush with it rather than pushed off it.
export function collisionPadding(side: SurfaceSide, align: SurfaceAlign) {
  const padding = {
    top: SURFACE_COLLISION_PADDING,
    right: SURFACE_COLLISION_PADDING,
    bottom: SURFACE_COLLISION_PADDING,
    left: SURFACE_COLLISION_PADDING,
  };
  if (align === "center") return padding;
  const vertical = side === "top" || side === "bottom";
  const edge = vertical
    ? align === "start"
      ? "left"
      : "right"
    : align === "start"
      ? "top"
      : "bottom";
  return { ...padding, [edge]: 0 };
}
