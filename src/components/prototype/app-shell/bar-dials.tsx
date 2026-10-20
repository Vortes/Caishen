"use client";

import { DialRoot, useDialKitController } from "dialkit";
import "dialkit/styles.css";
import { useEffect, useRef, type RefObject } from "react";

// Writes to a CSS variable on the shell root so dragging the slider
// restyles the bars without re-rendering the category list. Stays mounted
// in ring mode so the prototype's Reset can always reach the dial.
export function BarDials({
  target,
  visible,
  resetKey,
}: {
  target: RefObject<HTMLElement | null>;
  visible: boolean;
  resetKey: number;
}) {
  const dial = useDialKitController(
    "Funding bar",
    { width: [704, 80, 960, 8] },
    { persist: true },
  );
  const { width } = dial.values;
  const lastReset = useRef(resetKey);

  useEffect(() => {
    target.current?.style.setProperty("--bar-width", `${width}px`);
  }, [target, width]);

  useEffect(() => {
    if (resetKey === lastReset.current) return;
    lastReset.current = resetKey;
    dial.resetValues();
  }, [resetKey, dial]);

  return visible ? (
    <DialRoot position="bottom-right" theme="dark" defaultOpen />
  ) : null;
}
