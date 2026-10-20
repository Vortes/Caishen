"use client";

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

export type PanelState = { width: number; collapsed: boolean };

type Options = {
  side: "left" | "right";
  defaultWidth: number;
  min: number;
  max: number;
  state: PanelState;
  onChange: (state: PanelState) => void;
};

// Below this fraction of `min`, releasing a drag closes the panel instead of
// snapping it back to its minimum width.
const COLLAPSE_RATIO = 0.6;
const KEYBOARD_STEP = 16;

export function usePanel({
  side,
  defaultWidth,
  min,
  max,
  state,
  onChange,
}: Options) {
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(
    null,
  );
  const direction = side === "left" ? 1 : -1;
  const clamp = useCallback(
    (value: number) => Math.min(max, Math.max(min, value)),
    [min, max],
  );

  const toggle = useCallback(
    () => onChange({ ...state, collapsed: !state.collapsed }),
    [state, onChange],
  );

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      width: state.collapsed ? 0 : state.width,
      moved: false,
    };
    document.documentElement.dataset.resizing = "";
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (!start) return;
    const delta = (event.clientX - start.x) * direction;
    if (!start.moved && Math.abs(delta) < 3) return;
    start.moved = true;
    setDragWidth(Math.min(max, Math.max(0, start.width + delta)));
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    drag.current = null;
    delete document.documentElement.dataset.resizing;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!start?.moved || dragWidth === null) return;
    setDragWidth(null);
    if (dragWidth < min * COLLAPSE_RATIO) {
      onChange({ width: state.width, collapsed: true });
    } else {
      onChange({ width: clamp(dragWidth), collapsed: false });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const grow = event.key === (side === "left" ? "ArrowRight" : "ArrowLeft");
    const shrink = event.key === (side === "left" ? "ArrowLeft" : "ArrowRight");
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    } else if (grow || shrink) {
      event.preventDefault();
      if (state.collapsed) {
        if (grow) onChange({ ...state, collapsed: false });
        return;
      }
      const next = state.width + (grow ? KEYBOARD_STEP : -KEYBOARD_STEP);
      if (next < min) onChange({ ...state, collapsed: true });
      else onChange({ width: clamp(next), collapsed: false });
    }
  };

  const dragging = dragWidth !== null;
  const width = dragging ? dragWidth : state.collapsed ? 0 : state.width;
  return {
    // Width of the visible slot. The panel's content keeps at least `min`
    // width and is clipped by the slot, so it slides instead of squishing.
    width,
    contentWidth: Math.max(min, dragging ? dragWidth : state.width),
    dragging,
    toggle,
    handleProps: {
      role: "separator",
      tabIndex: 0,
      "aria-orientation": "vertical" as const,
      "aria-valuemin": 0,
      "aria-valuemax": max,
      "aria-valuenow": Math.round(width),
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
      onDoubleClick: () => onChange({ width: defaultWidth, collapsed: false }),
    },
  };
}
