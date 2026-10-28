import { useLayoutEffect, useRef } from "react";

type Tick = (now: number) => void;

// One requestAnimationFrame loop for everything in the invite that moves.
// Each part draws itself on it, outside React's render, and the loop stops
// once nothing is listening.
const ticks = new Set<{ current: Tick }>();
let frame = 0;
const run = (now: number) => {
  for (const tick of [...ticks]) tick.current(now);
  frame = ticks.size ? requestAnimationFrame(run) : 0;
};

// Calls `tick` with the frame's time on every frame while `active`. It
// subscribes in a layout effect so it's gone the moment its elements are.
export function useFrame(tick: Tick, active = true) {
  const latest = useRef(tick);
  latest.current = tick;
  useLayoutEffect(() => {
    if (!active) return;
    ticks.add(latest);
    frame ||= requestAnimationFrame(run);
    return () => {
      ticks.delete(latest);
      if (!ticks.size) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
  }, [active]);
}
