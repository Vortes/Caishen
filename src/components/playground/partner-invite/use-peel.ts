import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { config } from "./config";
import { CARD, type Point } from "./geometry";
import { clamp, spring } from "./motion";
import type { Sound } from "./sound";
import { timeline } from "./timeline";
import { fullReach, type Peel } from "./torn-card";

const hh = CARD.height / 2;
const { curl: CURL, flick: FLICK } = timeline;
// With a mouse over it, the curled corner lifts this much more.
const CURL_HOVER = 1.35;
// A peel let go short of taking it snaps back flat: the glue takes it from
// rest, so it starts slow and slaps down in under a tenth of a second,
// however it was let go. Then the whole half lies flat, corner and all,
// for a beat, before the corner springs back up, overshooting and
// wobbling once: paper, not a panel, so more give than an interface spring.
const SNAP = { seconds: 0.1, flat: 0.18, curl: 0.25, bounce: 0.45 };
// How far from the curled corner a grab still takes hold of the curl.
const CURL_GRIP = 60;
// However hard it was pulled, the follow-through stays a flick (px/s).
const THROW_LIMIT = 2000;
// Once started, a peel comes away more easily than it began: past the
// pull, the tip gains on the finger. Nothing lets go while it's held: all
// the way off, the half just hangs from the finger until it's let go.
const EASIER = 1.5;

// The corner curl: easing from one reach toward another, from a time,
// with the speed it had when it was retargeted; or picked up by a grab.
type Curl =
  | {
      from: number;
      to: number;
      velocity: number;
      at: number;
      flicks: boolean;
      bounce?: number;
    }
  | "held";

// The peel that freed your half, and how fast its tip was going (px/s).
export type Thrown = Peel & { velocity: number };

// A flick of the corner: up fast, then settling slowly, like paper let go.
const flicks = (t: number) => {
  let lift = 0;
  for (let i = 0; i < FLICK.count; i++) {
    const k = (t - i * FLICK.every) / FLICK.rise;
    if (k > 0) lift += k * Math.exp(1 - k);
  }
  return lift;
};

// How fast the tip was going over the last tenth of a second before
// `time`: held still before letting go, it wasn't going anywhere.
const speed = (samples: { at: number; reach: number }[], time: number) => {
  const recent = samples.filter((sample) => time - sample.at < 100);
  const [first] = recent;
  const last = recent[recent.length - 1];
  return first && last && last.at > first.at
    ? ((last.reach - first.reach) / (last.at - first.at)) * 1000
    : 0;
};

// Peeling your half. Take hold anywhere and pull any way: the peel starts
// from the edge or corner that leads that way, and its tip rushes to meet
// your finger, then stays under it. Pushing back meets resistance; let go
// far enough along, the half comes free.
export function usePeel({
  active,
  startedAt,
  reducedMotion,
  sound,
  toHalf,
  onTaken,
}: {
  // Whether your half can be peeled now.
  active: boolean;
  // When the peel step began (performance.now()).
  startedAt: number;
  reducedMotion: boolean;
  sound: Sound | null;
  // Where a pointer is, in your half's own coordinates.
  toHalf: (event: ReactPointerEvent) => Point;
  onTaken: () => void;
}) {
  // Where the pointer took hold of your half (half coordinates), the peel
  // it picked up there if any, how far the leading edge was behind it, and
  // recent tip positions for the speed at release.
  const grip = useRef<{
    start: Point;
    base: Peel | null;
    gap: number | null;
    samples: { at: number; reach: number }[];
  } | null>(null);
  const [holding, setHolding] = useState<Peel | null>(null);
  // A peel let go short of taking it, snapping back.
  const [settling, setSettling] = useState<(Peel & { at: number }) | null>(
    null,
  );
  const [thrown, setThrown] = useState<Thrown | null>(null);
  // When your half came free.
  const [takenAt, setTakenAt] = useState<number | null>(null);
  // Until anything happens, the corner curls in as the step begins.
  const [hint, setHint] = useState<Curl | null>(null);
  const hovering = useRef(false);

  const { pull: needed, curl } = config.part;
  const angle = (config.part.angle * Math.PI) / 180;
  // Kept as one object, so a peel can tell it started from the curl.
  const hintAlong = useMemo(
    () => ({ x: -Math.sin(angle), y: Math.cos(angle) }),
    [angle],
  );
  const corner = { x: CARD.width / 2, y: -hh };
  const give = (raw: number) =>
    raw < 0 ? raw * 0.1 : raw > needed ? needed + (raw - needed) * EASIER : raw;
  // How far the finger went for a reach `give` returned.
  const ungive = (reach: number) =>
    reach > needed ? needed + (reach - needed) / EASIER : reach;
  const lead = (along: Point) =>
    Math.min(
      ...[0, CARD.width / 2].flatMap((x) =>
        [-hh, hh].map((y) => x * along.x + y * along.y),
      ),
    );

  const curlAt = (state: Curl | null, time: number) => {
    const current = state ?? {
      from: 0,
      to: curl,
      velocity: 0,
      at: startedAt + CURL.delay * 1000,
      flicks: true,
    };
    if (current === "held") return 0;
    if (reducedMotion) return current.to;
    const t = (time - current.at) / 1000;
    const eased = spring(
      {
        from: current.from,
        to: current.to,
        velocity: current.velocity,
        duration:
          current.bounce !== undefined
            ? SNAP.curl
            : current.to > 0
              ? CURL.seconds
              : CURL.relax,
        bounce: current.bounce,
      },
      t,
    );
    const flicked = current.flicks
      ? curl * FLICK.lift * flicks(t - FLICK.after)
      : 0;
    return Math.max(0, eased + flicked);
  };
  const hintReach = (time: number) => (active ? curlAt(hint, time) : 0);
  // Sends the curl toward a new reach from wherever it is, as fast as it
  // was going, so a change of mind never jumps.
  const bend = (to: number, time: number) => {
    const from = curlAt(hint, time);
    const velocity = (from - curlAt(hint, time - 16)) / 0.016;
    setHint({ from, to, velocity, at: time, flicks: false });
  };
  const nearCurl = (at: Point, curled: number) =>
    curled > 0 &&
    Math.hypot(at.x - corner.x, at.y - corner.y) < curled + CURL_GRIP;
  const settlingReach = (time: number) =>
    !settling || reducedMotion
      ? 0
      : Math.max(
          0,
          spring(
            { from: settling.reach, to: 0, duration: SNAP.seconds },
            (time - settling.at) / 1000,
          ),
        );

  const take = (peel: Peel, velocity: number) => {
    grip.current = null;
    setHolding(null);
    setSettling(null);
    if (peel.along === hintAlong) setHint("held");
    setThrown({ ...peel, velocity: clamp(velocity, 0, THROW_LIMIT) });
    setTakenAt(performance.now());
    onTaken();
  };
  const grab = (event: ReactPointerEvent<SVGRectElement>) => {
    if (!active) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const time = performance.now();
    const start = toHalf(event);
    const curled = hintReach(time);
    const rolling = settlingReach(time);
    // A peel still rolling back is caught where it is; the curled corner
    // is picked up as it is; anywhere else starts a fresh peel.
    const base: Peel | null =
      settling && rolling > 2
        ? { along: settling.along, reach: rolling }
        : nearCurl(start, curled)
          ? { along: hintAlong, reach: curled }
          : null;
    hovering.current = false;
    sound?.curl(0.8);
    if (base?.along === hintAlong) setHint("held");
    else bend(0, time);
    grip.current = { start, base, gap: null, samples: [] };
    setSettling(null);
    setHolding(base);
  };
  // With a mouse, the corner lifts to meet the pointer as it comes near.
  const hover = (event: ReactPointerEvent<SVGRectElement>) => {
    if (!active || event.pointerType !== "mouse") return;
    const time = performance.now();
    const near = nearCurl(toHalf(event), curlAt(hint, time));
    if (near === hovering.current || hint === "held") return;
    hovering.current = near;
    if (near) sound?.curl(0.5);
    bend(near ? curl * CURL_HOVER : curl, time);
  };
  const leave = () => {
    if (!hovering.current || grip.current || hint === "held") return;
    hovering.current = false;
    bend(curl, performance.now());
  };
  const tug = (event: ReactPointerEvent<SVGRectElement>) => {
    const current = grip.current;
    if (!current) return hover(event);
    const at = toHalf(event);
    const from = current.base?.reach ?? 0;
    const way = {
      x: (current.base?.along.x ?? 0) * from + at.x - current.start.x,
      y: (current.base?.along.y ?? 0) * from + at.y - current.start.y,
    };
    const length = Math.hypot(way.x, way.y);
    // A fresh peel waits until the pointer has shown which way it's going.
    if (length < 4) return;
    const along = { x: way.x / length, y: way.y / length };
    current.gap ??= Math.max(
      0,
      current.start.x * along.x +
        current.start.y * along.y -
        lead(along) -
        from,
    );
    const moved = length - from;
    const catchUp =
      current.gap > 0 ? current.gap * clamp(moved / current.gap) : 0;
    const reach = Math.min(
      give(ungive(from) + moved + catchUp),
      fullReach(along),
    );
    const time = performance.now();
    const previous = current.samples[current.samples.length - 1];
    current.samples = [
      ...current.samples.filter((sample) => time - sample.at < 100),
      { at: time, reach },
    ];
    if (previous)
      sound?.peel(speed(current.samples, time), (time - previous.at) / 1000);
    setHolding({ along, reach });
  };
  const letGo = () => {
    const current = grip.current;
    if (!current) return;
    grip.current = null;
    const time = performance.now();
    const velocity = speed(current.samples, time);
    sound?.peelStop();
    if (holding && holding.reach >= needed) return take(holding, velocity);
    if (holding) {
      setSettling({ ...holding, at: time });
      sound?.slap(SNAP.seconds);
    }
    sound?.curl(0.6, SNAP.flat + 0.05);
    setHolding(null);
    // Flat for a beat, then the corner springs back up. You've found the
    // peel by now, so no more flicks.
    setHint({
      from: 0,
      to: curl,
      velocity: 0,
      at: time + SNAP.flat * 1000,
      flicks: false,
      bounce: SNAP.bounce,
    });
  };

  // The peels lifting your half at `time`: the curled corner, and the one
  // in hand or snapping back.
  const peels = (time: number) =>
    [
      { along: hintAlong, reach: hintReach(time) },
      holding ??
        (settling && { along: settling.along, reach: settlingReach(time) }),
    ].filter((peel): peel is Peel => !!peel);

  return {
    peels,
    // Whether the corner is still curling in on its own, with its sound.
    curling: hint === null,
    thrown,
    takenAt,
    handlers: {
      onPointerDown: grab,
      onPointerMove: tug,
      onPointerUp: letGo,
      onPointerCancel: letGo,
      onPointerLeave: leave,
    },
  };
}
