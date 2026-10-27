"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "~/components/ui/button";
import {
  clamp,
  colors,
  easeInOut,
  easeOut,
  lerp,
  random,
  span,
  type Config,
} from "./config";
import {
  CARD,
  LANDING,
  SCENE,
  SLOT,
  deckleOutline,
  path,
  type Point,
} from "./geometry";
import { harrierCreases } from "./harrier";
import { signature, strokeSegments, wetness, type Stroke } from "./ink";
import { Plane3D } from "./plane-3d";
import { arrivalFrame, arrivalProgress, arrivalSeconds } from "./plane-motion";
import { PARTNER, PARTNER_SIGNATURE } from "./print";
import styles from "./lab.module.css";

export type Phase =
  "arrive" | "sign" | "bond" | "insert" | "reading" | "inserting" | "done";

const hw = CARD.width / 2;
const hh = CARD.height / 2;
// Moving from the bond into place above the slot, settling into the
// caught depth, and fading in the next screen.
const PRESENT_SECONDS = 0.5;
const SETTLE_SECONDS = 0.35;
const NEXT_SECONDS = 0.5;
// How much of the card has to be in the slot before letting go keeps it in.
const COMMIT = 0.18;
const SIGN_ZONE = { x: 30, y: 6, width: 230, height: 88 };

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
  startPhase,
  reducedMotion,
  scrub,
  onRegenerate,
}: {
  config: Config;
  startPhase: Phase;
  reducedMotion: boolean;
  // Holds the arrival at this fraction of its length, for study.
  scrub: number | null;
  onRegenerate: () => void;
}) {
  const now = useNow();
  const svg = useRef<SVGSVGElement>(null);
  const [phase, setPhase] = useState(() => ({
    name: reducedMotion && startPhase === "arrive" ? "sign" : startPhase,
    at: performance.now(),
  }));
  const [strokes, setStrokes] = useState<Stroke[]>(() =>
    startPhase === "arrive" || startPhase === "sign" ? [] : autoSign(config, 0),
  );
  const drawing = useRef<{ start: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; y: number } | null>(null);
  const [release, setRelease] = useState<{ y: number; at: number } | null>(
    null,
  );
  // Where the card was when the slot took it.
  const [caughtFrom, setCaughtFrom] = useState<number | null>(null);
  const [bondAt, setBondAt] = useState(() =>
    startPhase === "bond" ? performance.now() : null,
  );

  const arriveTotal = arrivalSeconds(config);
  const elapsed =
    scrub === null ? (now - phase.at) / 1000 : scrub * arriveTotal * 0.999;
  const go = (name: Phase) => {
    const at = performance.now();
    if (name === "bond") setBondAt(at);
    setPhase({ name, at });
  };

  const bondProgress = reducedMotion ? 1 : clamp(elapsed / config.bondDuration);
  const readingTotal = reducedMotion ? 0 : SETTLE_SECONDS + config.slot.hold;
  const pullProgress = reducedMotion ? 1 : clamp(elapsed / config.slot.pull);

  useEffect(() => {
    if (phase.name === "arrive" && elapsed >= arriveTotal) go("sign");
    if (phase.name === "bond" && bondProgress >= 1) go("insert");
    if (phase.name === "reading" && elapsed >= readingTotal) go("inserting");
    if (phase.name === "inserting" && pullProgress >= 1) go("done");
  }, [
    phase.name,
    elapsed,
    arriveTotal,
    bondProgress,
    readingTotal,
    pullProgress,
  ]);

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
    drawing.current = { start: performance.now() };
    setStrokes((all) => [
      ...all,
      { points: [{ ...toCard(event), t: 0 }], dried: -1 },
    ]);
  };
  const penMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const pen = drawing.current;
    if (!pen) return;
    const point = {
      ...toCard(event),
      t: performance.now() - pen.start,
    };
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
    const lifted = performance.now();
    setStrokes((all) =>
      all.map((stroke) =>
        stroke.dried < 0 ? { ...stroke, dried: lifted } : stroke,
      ),
    );
  };

  // The card keeps its size and slides straight down; the slot hides
  // whatever has gone in. Past the caught depth only the slot can pull it.
  const scale = config.slot.scale;
  const height = (CARD.height + 6) * scale;
  const rest = SLOT.y - SLOT.gap - height / 2;
  const caught = SLOT.y + height * config.slot.catch - height / 2;
  const gone = SLOT.y + height / 2 + 6;
  const inserted = (y: number) => (y + height / 2 - SLOT.y) / height;
  const springBack = release
    ? lerp(release.y, rest, easeOut(clamp((now - release.at) / 300)))
    : rest;
  const handY = drag ? drag.y : springBack;

  const take = (from: number) => {
    setDrag(null);
    setRelease(null);
    setCaughtFrom(from);
    go("reading");
  };
  const grab = (event: ReactPointerEvent<SVGGElement>) => {
    if (phase.name !== "insert") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setRelease(null);
    setDrag({ from: toCard(event).y - (handY - rest), y: handY });
  };
  const pull = (event: ReactPointerEvent<SVGGElement>) => {
    if (!drag) return;
    const moved = toCard(event).y - drag.from;
    // Pushing up meets resistance; pushing down stops at the caught depth.
    const y =
      rest + (moved < 0 ? moved * 0.25 : Math.min(moved, caught - rest));
    setDrag({ ...drag, y });
  };
  const letGo = () => {
    if (!drag) return;
    if (inserted(drag.y) >= COMMIT) take(drag.y);
    else {
      setRelease({ y: drag.y, at: performance.now() });
      setDrag(null);
    }
  };

  let body: React.ReactNode;
  if (phase.name === "arrive") {
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
          x={SIGN_ZONE.x}
          y={SIGN_ZONE.y}
          width={SIGN_ZONE.width}
          height={SIGN_ZONE.height}
          fill="transparent"
          onPointerDown={penDown}
          onPointerMove={penMove}
          onPointerUp={penUp}
          onPointerCancel={penUp}
          onClick={(event) => event.stopPropagation()}
        />
      </g>
    );
  } else if (phase.name === "done") {
    const shown = reducedMotion ? 1 : easeOut(clamp(elapsed / NEXT_SECONDS));
    body = (
      <g opacity={shown} transform={`translate(0 ${8 * (1 - shown)})`}>
        <text
          x={LANDING.x}
          y={LANDING.y - 10}
          textAnchor="middle"
          className={styles.doneTitle}
        >
          Your budgets are joined.
          <tspan x={LANDING.x} dy={28} className={styles.doneHint}>
            Next, set up your own budget.
          </tspan>
        </text>
      </g>
    );
  } else {
    let y = LANDING.y;
    let size = 1;
    if (phase.name === "insert") {
      const present = reducedMotion
        ? 1
        : easeInOut(clamp(elapsed / PRESENT_SECONDS));
      y = lerp(LANDING.y, handY, present);
      size = lerp(1, scale, present);
    } else if (phase.name === "reading") {
      const settle = reducedMotion
        ? 1
        : easeOut(clamp(elapsed / SETTLE_SECONDS));
      y = lerp(caughtFrom ?? rest, caught, settle);
      size = scale;
    } else if (phase.name === "inserting") {
      // The reader takes it: slow to start, then gone.
      y = lerp(caught, gone, pullProgress ** 2.4);
      size = scale;
    }
    const slotted = phase.name !== "bond";
    const width = (CARD.width - config.seal.overlap) * scale;
    const chevron =
      phase.name === "insert"
        ? clamp(1 - inserted(handY) / COMMIT) *
          (reducedMotion ? 1 : clamp(elapsed / PRESENT_SECONDS))
        : 0;
    body = (
      <>
        {slotted && <SlotBack width={width} />}
        {chevron > 0 && (
          <path
            d={`M${LANDING.x - 7} ${SLOT.y - SLOT.gap / 2 - 3} l7 6 l7 -6`}
            fill="none"
            stroke="var(--text-tertiary)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={chevron}
          />
        )}
        <g clipPath={slotted ? "url(#above-slot)" : undefined}>
          <g
            transform={`translate(${LANDING.x} ${y}) scale(${size})`}
            className={phase.name === "insert" ? styles.draggable : undefined}
            onPointerDown={grab}
            onPointerMove={pull}
            onPointerUp={letGo}
            onPointerCancel={letGo}
            onClick={(event) => event.stopPropagation()}
          >
            <TallySeal
              config={config}
              strokes={strokes}
              now={now}
              progress={phase.name === "bond" ? bondProgress : 1}
              stampedAt={
                bondAt === null
                  ? null
                  : bondAt + 0.62 * config.bondDuration * 1000
              }
            />
          </g>
        </g>
        {slotted && <SlotLip width={width} />}
      </>
    );
  }

  return (
    <div className={styles.stage}>
      <svg
        ref={svg}
        viewBox={`0 0 ${SCENE.width} ${SCENE.height}`}
        className={styles.canvas}
        role="img"
        aria-label={`Partner invite, ${phase.name} step`}
      >
        <defs>
          <clipPath id="above-slot">
            <rect x={0} y={-400} width={SCENE.width} height={SLOT.y + 400} />
          </clipPath>
        </defs>
        <rect
          width={SCENE.width}
          height={SCENE.height}
          fill="transparent"
          onClick={onRegenerate}
          className={styles.regenerate}
        />
        {body}
      </svg>
      <Plane3D
        config={config}
        frame={phase.name === "arrive" ? arrivalFrame(config, elapsed) : null}
      />
      <div className={styles.stageActions}>
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
              onClick={() => setStrokes(autoSign(config, performance.now()))}
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
        {phase.name === "insert" && (
          <>
            <span className={styles.stageHint}>
              Drag the card into the slot
            </span>
            <Button onClick={() => take(handY)}>Insert card</Button>
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
  // sheet lies flat in exactly the same place.
  const reveal = span(open, 0.94, 1);
  return reveal > 0 ? (
    <g transform={`translate(${LANDING.x} ${LANDING.y})`} opacity={reveal}>
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
        <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves={2}
            seed={config.seed % 997}
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
      <path d={outline} fill={palette.paper()} />
      <g clipPath={`url(#${id}-paper)`}>
        <rect
          x={-hw}
          y={-hh}
          width={CARD.width}
          height={CARD.height}
          filter={`url(#${id}-grain)`}
          opacity={config.paper.grain}
          style={{ mixBlendMode: "multiply" }}
        />
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

      <Printed config={config} x={0} y={-112} className={styles.cardTitle}>
        Jordan &amp; you
      </Printed>
      <Printed config={config} x={0} y={-84} className={styles.cardLine}>
        ARE INVITED TO SHARE COSTS ON CAISHEN
      </Printed>
      <Printed config={config} x={0} y={-62} className={styles.cardSmall}>
        October 26, 2026
      </Printed>
      <Printed
        config={config}
        x={0}
        y={0}
        className={styles.cardSeam}
        transform="translate(0 46) rotate(-90)"
      >
        CAISHEN · CAISHEN
      </Printed>

      {[-1, 1].map((side) => (
        <line
          key={side}
          x1={side * 40}
          x2={side * 240}
          y1={92}
          y2={92}
          stroke={palette.printed}
          strokeWidth={0.6}
          opacity={0.5}
        />
      ))}
      <Printed config={config} x={-140} y={110} className={styles.cardSmall}>
        {PARTNER.toUpperCase()}
      </Printed>
      <Printed config={config} x={140} y={110} className={styles.cardSmall}>
        YOU
      </Printed>
      {hint && (
        <text
          x={140}
          y={78}
          textAnchor="middle"
          className={styles.cardHint}
          fill={palette.faint}
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
  className,
  transform,
  children,
}: {
  config: Config;
  x: number;
  y: number;
  className?: string;
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
        textAnchor="middle"
        className={className}
        fill={palette.paper(0.05)}
      >
        {children}
      </text>
      <text
        x={x}
        y={y}
        textAnchor="middle"
        className={className}
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

function TallySeal({
  config,
  strokes,
  now,
  progress,
  stampedAt,
}: {
  config: Config;
  strokes: Stroke[];
  now: number;
  progress: number;
  // When the seal touched paper, or null if its ink was dry before we came.
  stampedAt: number | null;
}) {
  const id = useId();
  const face = <CardFace config={config} strokes={strokes} now={now} />;
  const palette = colors(config);
  const far = hw + 40;

  const halves = (
    <defs>
      <clipPath id={`${id}-l`}>
        <rect x={-far} y={-hh - 20} width={far} height={CARD.height + 40} />
      </clipPath>
      <clipPath id={`${id}-r`}>
        <rect x={0} y={-hh - 20} width={far} height={CARD.height + 40} />
      </clipPath>
    </defs>
  );

  const { overlap, size, wear } = config.seal;
  const rng = random(config.seed, "seal");
  const tilt = (rng() - 0.5) * 8;
  const drop = (rng() < 0.5 ? -1 : 1) * 4;
  const split = easeInOut(span(progress, 0, 0.15));
  const slide = easeInOut(span(progress, 0.15, 0.4));
  const leftX = lerp(-12 * split, overlap / 2, slide);
  const rightX = lerp(12 * split, -overlap / 2, slide);
  const rightY = drop * slide;
  const descend = easeOut(span(progress, 0.4, 0.62));
  const stamped = progress >= 0.62;
  const lift = span(progress, 0.62, 0.85);
  const press = 1 - 0.012 * Math.sin(Math.PI * span(progress, 0.62, 0.7));
  const sealY = 34;
  // Seal ink dries on the same clock as the pen's.
  const wet =
    stampedAt === null
      ? 0
      : 1 - clamp((now - stampedAt) / (config.ink.dry * 1000));
  const impression = (x: number, y: number) =>
    stamped && (
      <SealMark
        config={config}
        x={x}
        y={y}
        tilt={tilt}
        size={size}
        wear={wear}
        wet={wet}
        id={`${id}-wear`}
      />
    );
  return (
    <g transform={`scale(${press})`}>
      {halves}
      <g transform={`translate(${leftX} 0)`}>
        <g clipPath={`url(#${id}-l)`}>
          {face}
          {impression(-leftX, sealY)}
        </g>
      </g>
      <g transform={`translate(${rightX} ${rightY})`}>
        <line
          x1={-1.5}
          x2={-1.5}
          y1={-hh + 2}
          y2={hh - 2}
          stroke="black"
          strokeOpacity={0.22 * slide}
          strokeWidth={3}
        />
        <g clipPath={`url(#${id}-r)`}>
          {face}
          {impression(-rightX, sealY - rightY)}
        </g>
      </g>
      {progress < 0.85 && descend > 0 && (
        <g
          opacity={stamped ? 1 - lift : descend}
          transform={`translate(0 ${sealY - 70 * (1 - descend) - 50 * lift}) scale(${lerp(1.5, 1, descend)}) rotate(${tilt})`}
        >
          <rect
            x={-size / 2 - 4}
            y={-size / 2 - 4}
            width={size + 8}
            height={size + 8}
            rx={size * 0.16}
            fill={palette.accentDeep}
            stroke={palette.accent}
            strokeWidth={2}
          />
        </g>
      )}
    </g>
  );
}

// A hanko-style seal impression: the mark is cut into the stone, so the
// characters print as bare paper inside a field of seal ink.
function SealMark({
  config,
  x,
  y,
  tilt,
  size,
  wear,
  wet,
  id,
}: {
  config: Config;
  x: number;
  y: number;
  tilt: number;
  size: number;
  wear: number;
  wet: number;
  id: string;
}) {
  const palette = colors(config);
  const threshold = 0.74 - wear * 0.22;
  const { pool } = config.ink;
  const half = size / 2;
  // Ink pools where the stone's edge meets the paper, and in a corner or
  // two where the hand pressed hardest.
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  const rng = random(config.seed, "seal-pool");
  const pooled = corners.filter(() => rng() < 0.5);
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <defs>
        <filter id={`${id}-noise`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.55"
            numOctaves={2}
            seed={(config.seed * 7) % 997}
          />
          <feColorMatrix
            type="matrix"
            values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  14 0 0 0 ${-14 * threshold}`}
          />
        </filter>
        <mask
          id={`${id}-mask`}
          maskUnits="userSpaceOnUse"
          x={-size}
          y={-size}
          width={size * 2}
          height={size * 2}
        >
          <rect
            x={-size}
            y={-size}
            width={size * 2}
            height={size * 2}
            fill="white"
          />
          <rect
            x={-size}
            y={-size}
            width={size * 2}
            height={size * 2}
            filter={`url(#${id}-noise)`}
          />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`} opacity={0.92}>
        <rect
          x={-half}
          y={-half}
          width={size}
          height={size}
          rx={size * 0.14}
          fill={palette.seal(wet)}
        />
        {pool > 0 && (
          <rect
            x={-half + 0.8}
            y={-half + 0.8}
            width={size - 1.6}
            height={size - 1.6}
            rx={size * 0.14 - 0.8}
            fill="none"
            stroke={palette.sealPool(wet)}
            strokeWidth={0.6 + pool * 2.6}
          />
        )}
        {pooled.map(([cx, cy]) => (
          <circle
            key={`${cx}${cy}`}
            cx={cx * (half - size * 0.09)}
            cy={cy * (half - size * 0.09)}
            r={pool * size * 0.07}
            fill={palette.sealPool(wet)}
          />
        ))}
        <text
          x={0}
          y={size * 0.05}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size * 0.36}
          fontWeight={700}
          fill={palette.paper()}
          className={styles.sealText}
        >
          財神
        </text>
        {/* Wet ink is glossy: a thin highlight along the lit edges. */}
        {wet > 0 && (
          <path
            d={`M${-half + 3} ${half - size * 0.2} V${-half + size * 0.14 + 3} Q${-half + 3} ${-half + 3} ${-half + size * 0.14 + 3} ${-half + 3} H${half - size * 0.2}`}
            fill="none"
            stroke="white"
            strokeOpacity={0.4 * wet}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        )}
      </g>
    </g>
  );
}

// A slot seen nearly edge-on: a dark mouth with a lit front lip. The card
// is drawn between the two, clipped at the mouth.
function SlotBack({ width }: { width: number }) {
  const rx = width / 2 + 24;
  return (
    <ellipse
      cx={LANDING.x}
      cy={SLOT.y}
      rx={rx}
      ry={4}
      fill="var(--surface-panel)"
      stroke="var(--border-strong)"
      strokeWidth={0.8}
    />
  );
}

function SlotLip({ width }: { width: number }) {
  const rx = width / 2 + 24;
  return (
    <path
      d={`M${LANDING.x - rx} ${SLOT.y} A${rx} 4 0 0 0 ${LANDING.x + rx} ${SLOT.y}`}
      fill="none"
      stroke="var(--border-edge-lit)"
      strokeWidth={1}
    />
  );
}
