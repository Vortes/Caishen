"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GuidedOnboarding } from "~/components/entry/guided-onboarding";
import { Button } from "~/components/ui/button";
import {
  clamp,
  colors,
  easeInOut,
  easeOut,
  span,
  spring,
  type Config,
} from "./config";
import {
  CAMERA_DISTANCE,
  CARD,
  LANDING,
  SCENE,
  deckleOutline,
  sceneFit,
  path,
  type Point,
} from "./geometry";
import { harrierCreases } from "./harrier";
import { signature, strokeSegments, wetness, type Stroke } from "./ink";
import { Plane3D, type Halves } from "./plane-3d";
import { arrivalFrame, arrivalProgress, arrivalSeconds } from "./plane-motion";
import {
  SHOWN,
  STAMP,
  fullReach,
  keptFrom,
  theirsBox,
  type CardFrame,
  type Kept,
  type Peel,
} from "./torn-card";
import { Filed, PartnerPage, type Rect } from "./partner-mark";
import { INVITE, PARTNER, PARTNER_SIGNATURE, nameSize } from "./print";
import {
  arrivalTrack,
  bondTrack,
  curlTrack,
  endingTrack,
  useScore,
} from "./score";
import { Sky, type SkyTime, type Veil } from "./sky";
import type { Sound } from "./sound";
import styles from "./lab.module.css";

// Holds a moment, for study: a fraction of the arrival, or of the tear
// that opens the bond; or, for the ending, a time in seconds since your
// half came free.
export type Scrub = { phase: "arrive" | "bond" | "ending"; at: number };

export type Phase =
  // Waiting in the sky, with the line written in cloud, for the tap that
  // throws the plane (and lets sound start).
  | "invite"
  | "arrive"
  | "sign"
  | "bond"
  | "take"
  | "taking"
  | "done"
  // Not a step: the app's Partner page, for a look at where the bond is
  // kept.
  | "partner";

const hh = CARD.height / 2;
// The line in the sky billows up over this long, and blows apart over
// this long once the plane is thrown.
const WRITE = { form: 2.2, scatter: 2.2 };
const FIRST_NAME = PARTNER.split(" ")[0]!;
// Once stamped, your half's corner curls back to show it peels, a beat
// after the seal lands: in quickly, settling with no bounce, and letting
// go faster than it came. Then it flicks up a few times, a few seconds
// apart, and waits. With a mouse over it, the corner lifts a little more.
const CURL = { delay: 0.25, seconds: 0.5, relax: 0.3, hover: 1.35 };
const FLICK = { after: 1.6, every: 3.5, count: 3, rise: 0.16, lift: 0.4 };
// A peel let go short of taking it snaps back flat: the glue takes it from
// rest, so it starts slow and slaps down in under a tenth of a second,
// however it was let go. Then the whole half lies flat, corner and all,
// for a beat, before the corner springs back up, overshooting and
// wobbling once: paper, not a panel, so more give than an interface spring.
const SNAP = { seconds: 0.1, flat: 0.18, curl: 0.25, bounce: 0.45 };
// How far from the curled corner a grab still takes hold of the curl.
const CURL_GRIP = 60;
// Taken with the button, the corner is flicked off this fast (px/s), as a
// let-go hand would.
const FLICK_OFF = 900;
// Once started, a peel comes away more easily than it began: past the
// pull, the tip gains on the finger. Nothing lets go while it's held: all
// the way off, the half just hangs from the finger until it's let go.
const EASIER = 1.5;
// Free, your half uncurls as it rises toward you, the peel rolling back out
// of it until it lies flat and face up. It's held a moment for a sheen of
// light to sweep across it once, then poured down into the bottom of the
// screen, the way a window goes into the Dock. Once it's gone, Jordan's,
// left on the table, shrinks down into the Partner mark, which holds a
// beat; the clouds close over it, hold, and part slowly to show the
// onboarding.
const KEEP_LIFT = 280;
const KEEP_SECONDS = 0.9;
const UNCURL_SECONDS = 0.8;
const SHIMMER = [0.8, 1.7] as const;
const GENIE = { at: 1.8, seconds: 0.55 };
const GONE = GENIE.at + GENIE.seconds;
// From your half coming free to the clouds having parted.
export const endingSeconds = (config: Config) =>
  GONE +
  config.filed.at +
  config.filed.duration +
  config.filed.hold +
  config.veil.partAt +
  config.veil.part;
const SIGN_ZONE = { x: 30, y: 6, width: 230, height: 88 };
// The pen takes the pointer over more of the card than the line itself, so
// a fingertip on a phone doesn't have to start inside a 55px strip.
const PEN_AREA = { x: 10, y: -20, width: 270, height: 150 };

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

// The peel that freed your half, and how fast it was going.
type Thrown = Peel & { velocity: number };

// A flick of the corner: up fast, then settling slowly, like paper let go.
const flicks = (t: number) => {
  let lift = 0;
  for (let i = 0; i < FLICK.count; i++) {
    const k = (t - i * FLICK.every) / FLICK.rise;
    if (k > 0) lift += k * Math.exp(1 - k);
  }
  return lift;
};

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      if (width && height) setSize({ width, height });
    });
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

// Re-renders every frame; the scene is a function of this clock.
function useNow() {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    let frame = 0;
    const tick = (time: number) => {
      setNow(time);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return now;
}

export function Scene({
  config,
  sky,
  startPhase,
  reducedMotion,
  scrub,
  sound,
  onRegenerate,
}: {
  config: Config;
  sky: SkyTime;
  startPhase: Phase;
  reducedMotion: boolean;
  scrub: Scrub | null;
  // Null while sound is off.
  sound: Sound | null;
  onRegenerate: () => void;
}) {
  const now = useNow();
  const svg = useRef<SVGSVGElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const stageSize = useSize(stage);
  const [phase, setPhase] = useState(() => ({
    name: reducedMotion && startPhase === "arrive" ? "sign" : startPhase,
    at: performance.now(),
  }));
  const [strokes, setStrokes] = useState<Stroke[]>(() =>
    startPhase === "invite" || startPhase === "arrive" || startPhase === "sign"
      ? []
      : autoSign(config, 0),
  );
  // When the pen went down, and where it was last, for how fast it moves.
  const drawing = useRef<{
    start: number;
    last: Point & { at: number };
  } | null>(null);
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
  // Starting at "taking" (to study the ending) acts out a flick of the
  // curled corner.
  const [thrown, setThrown] = useState<Thrown | null>(() => {
    if (startPhase !== "taking") return null;
    const angle = (config.part.angle * Math.PI) / 180;
    return {
      along: { x: -Math.sin(angle), y: Math.cos(angle) },
      reach: config.part.curl,
      velocity: FLICK_OFF,
    };
  });
  // Pictures of the halves, for the Partner mark and page.
  const [halves, setHalves] = useState<Halves | null>(null);
  // Until anything happens, the corner curls in as the step begins.
  const [hint, setHint] = useState<Curl | null>(null);
  const hovering = useRef(false);
  const [bondAt, setBondAt] = useState(() =>
    startPhase === "bond" ? performance.now() : null,
  );
  const filedAt = GONE + config.filed.at;
  const cloudsAt = filedAt + config.filed.duration + config.filed.hold;
  // When your half came free. Starting at "done" jumps to the clouds
  // already closed, just about to part.
  const [takenAt, setTakenAt] = useState<number | null>(() =>
    startPhase === "done"
      ? performance.now() - (cloudsAt + config.veil.partAt - 0.2) * 1000
      : startPhase === "taking"
        ? performance.now()
        : null,
  );

  const arriveTotal = arrivalSeconds(config);
  const held =
    scrub?.phase === phase.name
      ? scrub.at *
        (scrub.phase === "arrive"
          ? arriveTotal
          : config.tear.duration + config.bondDuration) *
        0.999
      : null;
  const elapsed = held ?? (now - phase.at) / 1000;
  const go = (name: Phase) => {
    const at = performance.now();
    if (name === "bond") setBondAt(at);
    setPhase({ name, at });
  };
  // Caught: the plane is thrown, and the line blows away as it comes.
  const [invited] = useState(startPhase === "invite");
  const caught = () => go(reducedMotion ? "sign" : "arrive");
  const words =
    phase.name === "invite"
      ? {
          form: reducedMotion ? 1 : easeOut(clamp(elapsed / WRITE.form)),
          scatter: 0,
        }
      : invited && phase.name === "arrive" && elapsed < WRITE.scatter
        ? { form: 1, scatter: elapsed / WRITE.scatter }
        : null;
  // Always two lines, so the letters can be big and fat.
  const lines =
    stageSize && stageSize.width < stageSize.height
      ? [`${FIRST_NAME} sent`, "you something"]
      : [`${FIRST_NAME} sent you`, "something"];

  // The bond phase tears the card in two, then seals the halves together.
  const tearSeconds = reducedMotion ? 0 : config.tear.duration;
  const tearProgress = reducedMotion ? 1 : clamp(elapsed / tearSeconds);
  const bondProgress = reducedMotion
    ? 1
    : clamp((elapsed - tearSeconds) / config.bondDuration);
  const ending = scrub?.phase === "ending" ? scrub.at : null;
  const sinceTaken = ending ?? (takenAt === null ? 0 : (now - takenAt) / 1000);
  const sinceClouds = sinceTaken - cloudsAt;
  const { gather, partAt, part: partSeconds } = config.veil;
  const veil: Veil =
    takenAt === null
      ? { cover: 0, open: 0 }
      : {
          cover: easeInOut(clamp(sinceClouds / gather)),
          open: easeOut(clamp((sinceClouds - partAt) / partSeconds)),
        };
  // The mark's plate is gone before the clouds have packed in around it.
  const plateFade = easeInOut(
    clamp((sinceClouds - config.veil.plateAt) / config.veil.plateFade),
  );
  const revealed = phase.name === "done" && (reducedMotion || veil.open > 0);
  // Your half gone, Jordan's hands over from 3D to its picture, which
  // shrinks into the mark.
  const filing =
    (phase.name === "taking" || phase.name === "done") && sinceTaken >= filedAt;

  useEffect(() => {
    if (phase.name === "arrive" && elapsed >= arriveTotal) go("sign");
    if (phase.name === "bond" && bondProgress >= 1) go("take");
    if (phase.name === "taking" && (reducedMotion || sinceClouds >= gather))
      go("done");
    // Scrubbed back before the clouds closed.
    if (phase.name === "done" && ending !== null && sinceClouds < gather)
      go("taking");
  }, [
    phase.name,
    elapsed,
    arriveTotal,
    bondProgress,
    reducedMotion,
    sinceClouds,
    gather,
    ending,
  ]);

  // Heard: each step's timeline, played against the time the scene is
  // drawn at.
  const arrival = useMemo(() => arrivalTrack(config), [config]);
  const bonding = useMemo(
    () => bondTrack(config, reducedMotion),
    [config, reducedMotion],
  );
  const curling = useMemo(() => curlTrack({ delay: CURL.delay, ...FLICK }), []);
  const flung = thrown?.velocity ?? FLICK_OFF;
  const parting = useMemo(
    () =>
      endingTrack(config, {
        speed: flung,
        rise: KEEP_SECONDS,
        shimmer: SHIMMER,
        genie: GENIE,
        filedAt: GONE + config.filed.at,
        cloudsAt:
          GONE + config.filed.at + config.filed.duration + config.filed.hold,
      }),
    [config, flung],
  );
  const [track, trackTime] =
    phase.name === "arrive"
      ? [arrival, elapsed]
      : phase.name === "bond"
        ? [bonding, elapsed]
        : phase.name === "take"
          ? [hint === null ? curling : null, elapsed]
          : (phase.name === "taking" || phase.name === "done") &&
              takenAt !== null
            ? [parting, sinceTaken]
            : [null, 0];
  useScore(sound, track, trackTime, scrub === null);
  useEffect(() => sound?.sky(sky === "night"), [sound, sky]);

  const toCard = (event: ReactPointerEvent): Point => {
    const matrix = svg.current!.getScreenCTM()!.inverse();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix,
    );
    return { x: point.x - LANDING.x, y: point.y - LANDING.y };
  };

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

  // Peeling your half. Take hold anywhere and pull any way: the peel starts
  // from the edge or corner that leads that way, and its tip rushes to meet
  // your finger, then stays under it. Pushing back meets resistance; let go
  // far enough along, the half comes free.
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
      at: phase.at + CURL.delay * 1000,
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
  const hintReach = (time: number) =>
    phase.name === "take" ? curlAt(hint, time) : 0;
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
  const toHalf = (event: ReactPointerEvent): Point => {
    const at = toCard(event);
    return { x: at.x + config.seal.overlap / 2, y: at.y };
  };

  const take = (peel: Peel, velocity: number) => {
    grip.current = null;
    setHolding(null);
    setSettling(null);
    if (peel.along === hintAlong) setHint("held");
    // However hard it was pulled, the follow-through stays a flick.
    setThrown({ ...peel, velocity: clamp(velocity, 0, FLICK_OFF * 1.5) });
    setTakenAt(performance.now());
    go("taking");
  };
  const speed = (samples: { at: number; reach: number }[]) => {
    const [first] = samples;
    const last = samples[samples.length - 1];
    return first && last && last.at > first.at
      ? ((last.reach - first.reach) / (last.at - first.at)) * 1000
      : 0;
  };
  const grab = (event: ReactPointerEvent<SVGRectElement>) => {
    if (phase.name !== "take") return;
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
    if (phase.name !== "take" || event.pointerType !== "mouse") return;
    const time = performance.now();
    const near = nearCurl(toHalf(event), curlAt(hint, time));
    if (near === hovering.current || hint === "held") return;
    hovering.current = near;
    if (near) sound?.curl(0.5);
    bend(near ? curl * CURL.hover : curl, time);
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
      sound?.peel(speed(current.samples), (time - previous.at) / 1000);
    setHolding({ along, reach });
  };
  const letGo = () => {
    const current = grip.current;
    if (!current) return;
    grip.current = null;
    const time = performance.now();
    const velocity = speed(current.samples);
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

  // Where Jordan's half lies on the table, on screen.
  const theirsRect = (): Rect => {
    const box = stage.current!.getBoundingClientRect();
    const { scale, viewBox } = sceneFit(box.width, box.height);
    const [viewX, viewY] = viewBox.split(" ").map(Number) as [number, number];
    const theirs = theirsBox(config);
    return {
      left: box.left + (LANDING.x + theirs.left - viewX) * scale,
      top: box.top + (LANDING.y + theirs.top - viewY) * scale,
      width: (theirs.right - theirs.left) * scale,
      height: (theirs.bottom - theirs.top) * scale,
    };
  };
  // The bottom middle of the screen, just past its edge, as a point in the
  // plane `z` above the table: where your half pours in.
  const intoBottom = (z: number): Point => {
    const [, viewY, , viewHeight] = (
      stageSize
        ? sceneFit(stageSize.width, stageSize.height).viewBox
        : `0 0 ${SCENE.width} ${SCENE.height}`
    )
      .split(" ")
      .map(Number) as [number, number, number, number];
    const middle = SCENE.height / 2;
    const bottom = viewY + viewHeight + 12;
    return {
      x: SCENE.width / 2 - LANDING.x,
      y:
        middle +
        ((bottom - middle) * (CAMERA_DISTANCE - z)) / CAMERA_DISTANCE -
        LANDING.y,
    };
  };
  // Your half, free: rising to you from where it lay.
  const keptPose = (): Kept => {
    const rest = keptFrom(config);
    const rise = (from: number, to: number) =>
      reducedMotion
        ? to
        : spring(
            { from, to, duration: KEEP_SECONDS, bounce: 0.12 },
            sinceTaken,
          );
    return {
      x: rise(rest.x, 0),
      y: rise(rest.y, 0),
      z: rise(rest.z, KEEP_LIFT),
    };
  };
  // And the peel rolling back out of it: carried on a little by the pull
  // that freed it, then settling without overshoot so it never curls the
  // other way.
  const uncurl = ({ along, reach, velocity }: Thrown): Peel => ({
    along,
    reach: reducedMotion
      ? 0
      : Math.max(
          0,
          spring(
            { from: reach, to: 0, velocity, duration: UNCURL_SECONDS },
            sinceTaken,
          ),
        ),
  });

  let body: React.ReactNode;
  let cardFrame: CardFrame | null = null;
  if (phase.name === "invite") {
    // Only the sky, and the line written in it.
  } else if (phase.name === "arrive") {
    body = (
      <Arrival config={config} elapsed={elapsed} strokes={strokes} now={now} />
    );
  } else if (phase.name === "sign") {
    const signed = strokes.length > 0;
    body = (
      <g transform={`translate(${LANDING.x} ${LANDING.y})`}>
        <CardFace config={config} strokes={strokes} now={now} hint={!signed} />
        <rect
          className={styles.signZone}
          x={PEN_AREA.x}
          y={PEN_AREA.y}
          width={PEN_AREA.width}
          height={PEN_AREA.height}
          fill="transparent"
          onPointerDown={penDown}
          onPointerMove={penMove}
          onPointerUp={penUp}
          onPointerCancel={penUp}
          onClick={(event) => event.stopPropagation()}
        />
      </g>
    );
  } else if (phase.name === "partner") {
    // Unseen, only so the halves get pictured for the page.
    cardFrame = {
      tear: 1,
      bond: 1,
      sealWet: 0,
      y: LANDING.y,
      size: 1,
      peels: [],
      keep: null,
      shown: { yours: 1, theirs: 1 },
      shimmer: -1,
      genie: null,
      opacity: 0,
      strokes,
      inkAt: 0,
    };
  } else if (!filing || !halves) {
    // Filing needs the halves pictured; a scrub straight into it draws the
    // card unseen for a frame to get them.
    // Taken, your half comes free and rises to you, then is gone.
    const free = phase.name === "taking" && thrown;
    const kept = free ? keptPose() : null;
    const genie = kept && sinceTaken >= GENIE.at;
    cardFrame = {
      tear: phase.name === "bond" ? tearProgress : 1,
      bond: phase.name === "bond" ? bondProgress : 1,
      sealWet:
        bondAt === null
          ? 0
          : 1 -
            clamp(
              (now -
                bondAt -
                (tearSeconds + STAMP * config.bondDuration) * 1000) /
                (config.ink.dry * 1000),
            ),
      y: LANDING.y,
      size: 1,
      peels:
        phase.name === "take"
          ? [
              { along: hintAlong, reach: hintReach(now) },
              holding ??
                (settling && {
                  along: settling.along,
                  reach: settlingReach(now),
                }),
            ].filter((peel): peel is Peel => !!peel)
          : free
            ? [uncurl(free)]
            : [],
      keep: kept,
      shown: {
        yours: kept && sinceTaken >= GONE ? 0 : 1,
        theirs: 1,
      },
      shimmer: kept ? easeInOut(span(sinceTaken, ...SHIMMER)) || -1 : -1,
      genie: genie
        ? {
            progress: span(sinceTaken, GENIE.at, GENIE.at + GENIE.seconds),
            to: intoBottom(kept.z),
          }
        : null,
      opacity: filing ? 0 : 1,
      strokes,
      inkAt: bondAt ?? 0,
    };
    body = (
      <>
        {phase.name === "taking" ? null : phase.name === "bond" &&
          tearProgress < SHOWN ? (
          // The printed card, until the 3D sheet has faded in over it.
          <g transform={`translate(${LANDING.x} ${LANDING.y})`}>
            <CardFace config={config} strokes={strokes} now={now} />
          </g>
        ) : (
          // The card itself is drawn in 3D; this is what the hand grabs.
          <rect
            // Only your half can be taken: from the seam to its outer edge.
            x={LANDING.x - config.seal.overlap / 2}
            y={LANDING.y - hh}
            width={CARD.width / 2}
            height={CARD.height}
            fill="transparent"
            className={phase.name === "take" ? styles.draggable : undefined}
            onPointerDown={grab}
            onPointerMove={tug}
            onPointerUp={letGo}
            onPointerCancel={letGo}
            onPointerLeave={leave}
            onClick={(event) => event.stopPropagation()}
          />
        )}
      </>
    );
  }

  return (
    <div
      ref={stage}
      className={styles.stage}
      data-night={sky === "night" || undefined}
    >
      {revealed && (
        <div
          className={styles.next}
          style={
            {
              "--arrive-delay": `${config.reveal.at * partSeconds}s`,
              "--arrive-duration": `${config.reveal.duration}s`,
              // Scrubbed, it holds at the moment the parting has reached.
              ...(ending !== null && {
                animationDelay: `${config.reveal.at * partSeconds - (sinceClouds - partAt)}s`,
                animationPlayState: "paused",
              }),
            } as CSSProperties
          }
        >
          <GuidedOnboarding
            onCreate={async () => undefined}
            onCategories={async () => undefined}
            accounts={null}
            readyToAssign={0}
            onComplete={() => undefined}
          />
        </div>
      )}
      {!(reducedMotion && revealed) && (
        <Sky
          still={reducedMotion}
          time={sky}
          haze={config.sky.haze}
          drift={config.sky.drift}
          clouds={config.sky.clouds}
          veil={veil}
          words={words && { lines, ...words }}
          onBreathe={(amount, dt) => {
            if (dt > 0) sound?.breathe(amount / dt);
          }}
        />
      )}
      <svg
        ref={svg}
        viewBox={
          stageSize
            ? sceneFit(stageSize.width, stageSize.height).viewBox
            : `0 0 ${SCENE.width} ${SCENE.height}`
        }
        className={styles.canvas}
        // Gone once the onboarding is up, so it takes the pointer.
        style={phase.name === "done" ? { display: "none" } : undefined}
        role="img"
        aria-label={
          phase.name === "invite"
            ? `${FIRST_NAME} sent you something`
            : `${PARTNER} ${INVITE.sentence.lines.join(" ")} Partner invite, ${phase.name} step`
        }
      >
        <rect
          width={SCENE.width}
          height={SCENE.height}
          fill="transparent"
          onClick={phase.name === "invite" ? caught : onRegenerate}
          className={styles.regenerate}
        />
        {body}
      </svg>
      <Plane3D
        config={config}
        night={sky === "night"}
        frame={phase.name === "arrive" ? arrivalFrame(config, elapsed) : null}
        card={cardFrame}
        onKeepsake={setHalves}
      />
      {phase.name === "taking" && filing && halves && (
        <Filed
          // The shrink is set up once, so a new duration starts it afresh.
          key={config.filed.duration}
          config={config}
          src={halves.mark}
          from={theirsRect}
          fade={plateFade}
          at={ending === null ? null : sinceTaken - filedAt}
          reducedMotion={reducedMotion}
        />
      )}
      {phase.name === "partner" && (
        <PartnerPage config={config} halves={halves} />
      )}
      <div className={styles.stageActions}>
        {phase.name === "invite" && (
          <Button variant="primary" onClick={caught}>
            Catch it
          </Button>
        )}
        {phase.name === "sign" && (
          <>
            <Button
              variant="quiet"
              disabled={strokes.length === 0}
              onClick={() => setStrokes([])}
            >
              Clear
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                sound?.scribble();
                setStrokes(autoSign(config, performance.now()));
              }}
            >
              Sign for me
            </Button>
            <Button
              variant="primary"
              disabled={strokes.length === 0}
              onClick={() => go("bond")}
            >
              Sign
            </Button>
          </>
        )}
        {phase.name === "take" && (
          <>
            <span className={styles.stageHint}>Peel off your half</span>
            <Button
              onClick={() =>
                take(
                  { along: hintAlong, reach: hintReach(performance.now()) },
                  FLICK_OFF,
                )
              }
            >
              Take your half
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function autoSign(config: Config, dried: number): Stroke[] {
  return signature(config.seed, "you", {
    x: SIGN_ZONE.x + 20,
    y: 34,
    width: 180,
    height: 46,
  }).map((stroke) => ({ ...stroke, dried }));
}

function Arrival({
  config,
  elapsed,
  strokes,
  now,
}: {
  config: Config;
  elapsed: number;
  strokes: Stroke[];
  now: number;
}) {
  const { open } = arrivalProgress(config, elapsed);
  // The 3D sheet unfolds over this; the printed card takes over once the
  // sheet lies flat in exactly the same place. The card is solid underneath
  // while the sheet fades off it, so the sky never shows through.
  return span(open, 0.94, 1) > 0 ? (
    <g transform={`translate(${LANDING.x} ${LANDING.y})`}>
      <CardFace config={config} strokes={strokes} now={now} hint />
    </g>
  ) : null;
}

function CardFace({
  config,
  strokes,
  now,
  hint = false,
}: {
  config: Config;
  strokes: Stroke[];
  now: number;
  hint?: boolean;
}) {
  const id = useId();
  const palette = colors(config);
  const outline = path(deckleOutline(config), true);
  const partner = signature(config.seed, "partner", PARTNER_SIGNATURE);
  return (
    <g>
      <defs>
        <clipPath id={`${id}-paper`}>
          <path d={outline} />
        </clipPath>
      </defs>
      <path d={outline} fill={palette.paper()} />
      <g clipPath={`url(#${id}-paper)`}>
        {harrierCreases.map(([from, to], index) => (
          <g key={index} opacity={config.paper.crease}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={palette.crease}
              strokeWidth={0.7}
            />
            <line
              x1={from.x + 0.8}
              y1={from.y + 0.6}
              x2={to.x + 0.8}
              y2={to.y + 0.6}
              stroke={palette.paper(0.04)}
              strokeWidth={0.7}
            />
          </g>
        ))}
      </g>

      <Printed
        config={config}
        x={INVITE.left}
        y={INVITE.name.y}
        anchor="start"
        className={styles.cardSentence}
        style={{ fontSize: nameSize(PARTNER) }}
      >
        {PARTNER}
      </Printed>
      {INVITE.sentence.lines.map((line, index) => (
        <Printed
          key={line}
          config={config}
          x={INVITE.left}
          y={INVITE.sentence.y + index * INVITE.sentence.leading}
          anchor="start"
          className={styles.cardSentence}
        >
          {line}
        </Printed>
      ))}

      {[INVITE.rule.partner, INVITE.rule.you].map(({ x1, x2 }) => (
        <line
          key={x1}
          x1={x1}
          x2={x2}
          y1={INVITE.rule.y}
          y2={INVITE.rule.y}
          stroke={palette.printed}
          strokeWidth={0.6}
          opacity={0.35}
        />
      ))}
      <Printed
        config={config}
        x={INVITE.left}
        y={INVITE.labels.y}
        anchor="start"
        className={styles.cardMeta}
      >
        {PARTNER.split(" ")[0]}
      </Printed>
      <Printed
        config={config}
        x={INVITE.rule.you.x1}
        y={INVITE.labels.y}
        anchor="start"
        className={styles.cardMeta}
      >
        You
      </Printed>
      {hint && (
        <text
          x={(INVITE.rule.you.x1 + INVITE.rule.you.x2) / 2}
          y={78}
          textAnchor="middle"
          className={styles.cardHint}
          fill={palette.printed}
          opacity={0.7}
        >
          sign here
        </text>
      )}

      {partner.map((stroke, index) => (
        <Ink key={`p${index}`} stroke={stroke} config={config} now={now} />
      ))}
      {strokes.map((stroke, index) => (
        <Ink key={index} stroke={stroke} config={config} now={now} />
      ))}
    </g>
  );
}

// Letterpress: ink sits in a shallow bite, so the paper under each letter
// catches a sliver of light along its lower edge.
function Printed({
  config,
  x,
  y,
  anchor = "middle",
  className,
  style,
  transform,
  children,
}: {
  config: Config;
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
  className?: string;
  style?: React.CSSProperties;
  transform?: string;
  children: React.ReactNode;
}) {
  const palette = colors(config);
  return (
    <g transform={transform}>
      <text
        x={x}
        y={y + 0.8}
        aria-hidden
        textAnchor={anchor}
        className={className}
        style={style}
        fill={palette.paper(0.05)}
      >
        {children}
      </text>
      <text
        x={x}
        y={y}
        textAnchor={anchor}
        className={className}
        style={style}
        fill={palette.printed}
      >
        {children}
      </text>
    </g>
  );
}

function Ink({
  stroke,
  config,
  now,
}: {
  stroke: Stroke;
  config: Config;
  now: number;
}) {
  const wet = wetness(stroke, now, config);
  const color = colors(config).ink(wet);
  const segments = strokeSegments(stroke, config);
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const pool = config.ink.thick * 0.42 * config.ink.pool;
  return (
    <g>
      {segments.map((segment, index) => (
        <line
          key={index}
          {...segment}
          stroke={color}
          strokeWidth={segment.width}
          strokeLinecap="round"
        />
      ))}
      {pool > 0 &&
        first &&
        last &&
        [first, last].map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={pool + 0.4}
            fill={color}
          />
        ))}
      {/* Wet ink is glossy: a thin highlight that fades as it dries. */}
      {wet > 0 &&
        segments.map((segment, index) => (
          <line
            key={`h${index}`}
            x1={segment.x1 - 0.4}
            y1={segment.y1 - 0.5}
            x2={segment.x2 - 0.4}
            y2={segment.y2 - 0.5}
            stroke="white"
            strokeOpacity={0.35 * wet}
            strokeWidth={segment.width * 0.28}
            strokeLinecap="round"
          />
        ))}
    </g>
  );
}
