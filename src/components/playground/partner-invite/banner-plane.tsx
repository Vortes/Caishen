import { useId, useLayoutEffect, useRef } from "react";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { clamp, easeInOut } from "./motion";
import { useFrame } from "./use-frame";
import styles from "./lab.module.css";

// While the line waits in the sky, a little tow plane putters across
// below it, the way the clouds drift, trailing a cloth banner that says
// what to do. It passes, the sky stays empty a while, and it comes round
// again. Caught, it noses up and climbs away out of the paper plane's
// path. Like the flight, it's a pure function of time, drawn on the
// frame loop.

// It first comes in once the line has mostly formed, takes this long to
// cross, and comes round again this long after it last set out.
const PASS = { first: 2.4, crossing: 13, every: 15 };
// After this many passes it changes its tune, once.
const FED_UP = 2;
// Caught, it climbs out over this long.
const CLIMB = 1.3;
// The banner's lettering (px, against the stage's width), and how much
// the cloth flaps: the wave's height (× the banner's) at the free end, its
// length (× the banner's height), and how fast it runs back (waves/s).
const LETTERS = { min: 12, max: 17, ofWidth: 0.014 };
const FLAP = { height: 0.16, length: 3.4, speed: 1.6 };

// The banner's free end flaps; the end on the pole barely moves.
function clothShape(length: number, height: number, t: number) {
  const steps = 28;
  const top: string[] = [];
  const bottom: string[] = [];
  const middle: string[] = [];
  const wave = height * FLAP.length;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = u * length;
    const lift =
      height *
      FLAP.height *
      u ** 1.3 *
      Math.sin((x / wave) * Math.PI * 2 - t * FLAP.speed * Math.PI * 2);
    // Flapping, the cloth bunches a little where it turns.
    const squeeze =
      1 -
      0.08 *
        u *
        Math.abs(
          Math.cos((x / wave) * Math.PI * 2 - t * FLAP.speed * Math.PI * 2),
        );
    top.push(`${x.toFixed(1)},${(lift - (height / 2) * squeeze).toFixed(1)}`);
    bottom.unshift(
      `${x.toFixed(1)},${(lift + (height / 2) * squeeze).toFixed(1)}`,
    );
    middle.push(`${x.toFixed(1)},${lift.toFixed(1)}`);
  }
  return {
    outline: `M${top.join(" L")} L${bottom.join(" L")} Z`,
    middle: `M${middle.join(" L")}`,
  };
}

export function BannerPlane({
  width,
  height,
  times,
  still,
}: {
  // The stage (px).
  width: number;
  height: number;
  // At a moment: seconds since the line began to form, and since the tap
  // that threw the paper plane (or null).
  times: (now: number) => { elapsed: number; caught: number | null };
  still: boolean;
}) {
  const middleId = useId();
  const coarse = useMediaQuery("(pointer: coarse)");
  const svg = useRef<SVGSVGElement>(null);
  const flying = useRef<SVGGElement>(null);
  const prop = useRef<SVGEllipseElement>(null);
  const cloth = useRef<SVGPathElement>(null);
  const middle = useRef<SVGPathElement>(null);
  const lettering = useRef<SVGTextPathElement>(null);

  const size = clamp(width * LETTERS.ofWidth, LETTERS.min, LETTERS.max);
  const bannerHeight = size * 1.9;
  const scale = bannerHeight / 15;
  const planeLength = 52 * scale;
  const tow = 34 * scale;

  const draw = (now: number) => {
    const { elapsed, caught } = times(now);
    const element = svg.current!;
    // Twice round and still no tap: the pilot has had enough, for
    // one pass, then is back to business.
    const fed =
      !still && Math.floor((elapsed - PASS.first) / PASS.every) === FED_UP;
    const text = fed
      ? "stop playing with the clouds damn it!"
      : `${coarse ? "tap" : "click"} anywhere to start`;
    // Roughly how long the lettering runs, with room either end.
    const bannerLength = text.length * size * 0.62 + size * 2.2;
    const span = planeLength + tow + bannerLength;

    // Where it is on this pass: its nose, from off the right edge to off
    // the left, bobbing gently as it goes.
    const since = elapsed - PASS.first;
    const pass = still ? 0.42 : (since % PASS.every) / PASS.crossing;
    const t = still ? 0 : elapsed;
    let x = width + 24 - pass * (width + span + 48);
    let y = height * 0.76 + (still ? 0 : size * 0.4 * Math.sin(t * 0.9 + 1.2));
    let pitch = still ? 0 : 1.2 * Math.sin(t * 0.9 + 2.4);
    let opacity = 1;
    let shown = still || (since >= 0 && pass <= 1);
    if (caught !== null) {
      // Caught: it noses up and climbs away, faster and faster.
      const k = clamp(caught / CLIMB);
      const climb = easeInOut(k);
      x -= climb * width * 0.35;
      y -= climb * height * 0.5;
      pitch += 18 * easeInOut(clamp(k * 1.6));
      opacity = 1 - clamp((k - 0.55) / 0.45);
      if (k >= 1) shown = false;
    }
    element.style.display = shown ? "" : "none";
    if (!shown) return;
    element.style.opacity = String(opacity);
    flying.current!.setAttribute(
      "transform",
      `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${pitch.toFixed(2)})`,
    );
    prop.current!.setAttribute(
      "opacity",
      String(still ? 0.35 : 0.25 + 0.15 * Math.sin(t * 61)),
    );
    const shape = clothShape(bannerLength, bannerHeight, t);
    cloth.current!.setAttribute("d", shape.outline);
    middle.current!.setAttribute("d", shape.middle);
    if (lettering.current!.textContent !== text)
      lettering.current!.textContent = text;
  };
  useFrame(draw, !still);
  // Drawn before it's first seen, and whenever the stage changes size.
  useLayoutEffect(() => draw(performance.now()));

  return (
    <svg
      ref={svg}
      className={styles.banner}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      style={{ display: "none" }}
    >
      <defs>
        <path ref={middle} id={middleId} />
      </defs>
      <g ref={flying}>
        {/* The plane, nose to the left, high wing, tail up behind. */}
        <g transform={`scale(${scale.toFixed(3)})`}>
          <ellipse
            ref={prop}
            cx={-1}
            cy={-1}
            rx={1.4}
            ry={8}
            className={styles.bannerProp}
          />
          <path
            className={styles.bannerHull}
            d="M0,-1 C1,-5 6,-7 14,-7 L36,-4 L45,-12 L50,-12 L49,-2 L44,0 L14,4 C6,5 1,3 0,-1 Z"
          />
          <path
            className={styles.bannerStripe}
            d="M2,-0.5 L44,-2.6 L44,-1 L3,1.5 Z"
          />
          <path
            className={styles.bannerWing}
            d="M9,-9 L29,-9 L28,-6.8 L10,-6.8 Z"
          />
          <path
            className={styles.bannerWindow}
            d="M11,-6.4 L18,-6.4 L18,-2.6 L9.5,-2.2 Z"
          />
          <path
            className={styles.bannerLine}
            d="M13,3.6 L21,-6.8 M12,4 L10,9 M17,3.4 L18,9"
          />
          <circle cx={10} cy={9.6} r={1.7} className={styles.bannerWheel} />
          <circle cx={18} cy={9.6} r={1.7} className={styles.bannerWheel} />
          {/* The tow line, sagging a little, to the banner's pole. */}
          <path
            className={styles.bannerLine}
            d={`M49,-3 Q${49 + 34 / 2},2 ${49 + 34},0`}
            fill="none"
          />
        </g>
        <g
          transform={`translate(${(planeLength + tow - 3 * scale).toFixed(1)} 0)`}
        >
          <line
            className={styles.bannerLine}
            x1={0}
            x2={0}
            y1={-bannerHeight / 2 - scale}
            y2={bannerHeight / 2 + scale}
            strokeWidth={1.4}
          />
          <path ref={cloth} className={styles.bannerCloth} />
          <text className={styles.bannerText} fontSize={size} dy={size * 0.36}>
            <textPath
              ref={lettering}
              href={`#${middleId}`}
              startOffset="50%"
              textAnchor="middle"
            />
          </text>
        </g>
      </g>
    </svg>
  );
}
