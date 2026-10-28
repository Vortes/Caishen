import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Point } from "./geometry";
import type { Stroke } from "./ink";
import type { Sound } from "./sound";

// Signing: each press of the pen lays a stroke, timed so its width follows
// the pen's speed, and dries once the pen lifts.
export function usePen({
  toCard,
  sound,
}: {
  // Where a pointer is, in card coordinates.
  toCard: (event: ReactPointerEvent) => Point;
  sound: Sound | null;
}) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  // When the pen went down, and where it was last, for how fast it moves.
  const drawing = useRef<{
    start: number;
    last: Point & { at: number };
  } | null>(null);

  const penDown = (event: ReactPointerEvent<SVGRectElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = performance.now();
    drawing.current = { start: at, last: { ...toCard(event), at } };
    sound?.nibDown();
    setStrokes((all) => [
      ...all,
      { points: [{ ...toCard(event), t: 0 }], dried: -1 },
    ]);
  };
  const penMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const pen = drawing.current;
    if (!pen) return;
    const time = performance.now();
    const point = { ...toCard(event), t: time - pen.start };
    const dt = time - pen.last.at;
    if (dt > 0)
      sound?.nib(
        Math.hypot(point.x - pen.last.x, point.y - pen.last.y) / dt,
        dt / 1000,
      );
    pen.last = { x: point.x, y: point.y, at: time };
    setStrokes((all) => {
      const last = all[all.length - 1]!;
      return [
        ...all.slice(0, -1),
        { ...last, points: [...last.points, point] },
      ];
    });
  };
  const penUp = () => {
    if (!drawing.current) return;
    drawing.current = null;
    sound?.nibUp();
    const lifted = performance.now();
    setStrokes((all) =>
      all.map((stroke) =>
        stroke.dried < 0 ? { ...stroke, dried: lifted } : stroke,
      ),
    );
  };

  return {
    strokes,
    undo: () => setStrokes((all) => all.slice(0, -1)),
    clear: () => setStrokes([]),
    handlers: {
      onPointerDown: penDown,
      onPointerMove: penMove,
      onPointerUp: penUp,
      onPointerCancel: penUp,
    },
  };
}
