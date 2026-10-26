import { loadFont } from "@remotion/google-fonts/Geist";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  BRAND_BLADES,
  BRAND_BLADE_STOPS,
  BRAND_EDGE_OPACITY,
  BRAND_SHEEN_OPACITY,
  BRAND_SMALL_MARK_SCALE,
  BRAND_TILE_RADIUS,
  BRAND_TILE_SLANT,
  BRAND_TILE_STOPS,
} from "~/components/shared/brand-geometry";

// The Open Graph video: ledger cards drift on a tilted plane, a band of light
// passes and everything it touches settles (rows clear, bars fill, figures
// stop rolling), then the plane folds away into the pinwheel and wordmark.
// It starts and ends on the bare ground, so it loops cleanly.

export const OG_VIDEO = { width: 1200, height: 630, fps: 30, frames: 240 };

const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
});

// The Welcome page's brand surfaces, which may go past the app's tokens.
const brand = {
  ground: "oklch(0.14 0.028 var(--hue))",
  text: "oklch(0.96 0.012 var(--hue))",
  muted: "oklch(0.78 0.03 var(--hue))",
  accent: "oklch(0.8 0.1 var(--hue))",
  glow: "oklch(0.66 0.2 283)",
};

const SWEEP = { start: 44, end: 124 };
const FOLD = { start: 134, end: 174 };
const MARK_AT = 158;
const WORD_AT = 178;
const OUT = { start: 222, end: 240 };

const CARD = { width: 250, height: 148, gap: 22 };
const COLS = 3;
const ROWS = 3;
const PLANE = {
  width: COLS * CARD.width + (COLS - 1) * CARD.gap,
  height: ROWS * CARD.height + (ROWS - 1) * CARD.gap,
};
const BAND = 220;

type Kind = "rows" | "funding" | "balance";
const KINDS: Kind[] = [
  "rows",
  "funding",
  "rows",
  "balance",
  "rows",
  "funding",
  "funding",
  "rows",
  "balance",
];

const ease = Easing.bezier(0.32, 0.72, 0, 1);
const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

export function OgVideo() {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [OUT.start, OUT.end], [1, 0], {
    ...clamp,
    easing: easeInOut,
  });

  return (
    <AbsoluteFill
      style={{
        background: brand.ground,
        color: brand.text,
        fontFamily,
        overflow: "hidden",
      }}
    >
      <AbsoluteFill style={{ opacity: out }}>
        <Plane frame={frame} />
        <Lockup frame={frame} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 90% at 50% 50%, transparent 55%, oklch(0.1 0.02 var(--hue) / 0.7))`,
        }}
      />
    </AbsoluteFill>
  );
}

function Plane({ frame }: { frame: number }) {
  const fold = interpolate(frame, [FOLD.start, FOLD.end], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const fade = interpolate(frame, [FOLD.start + 4, FOLD.end - 14], [1, 0], {
    ...clamp,
  });
  const bandX = interpolate(
    frame,
    [SWEEP.start, SWEEP.end],
    [-BAND, PLANE.width + BAND],
    { ...clamp, easing: Easing.bezier(0.45, 0, 0.55, 1) },
  );
  const bandOpacity = interpolate(
    frame,
    [SWEEP.start, SWEEP.start + 10, SWEEP.end - 10, SWEEP.end],
    [0, 1, 1, 0],
    clamp,
  );
  // A slow push-in over the whole first half keeps the plane alive.
  const push = interpolate(frame, [0, FOLD.start], [1.2, 1.32], clamp);

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity: fade,
        filter: `blur(${(1 - fade) * 8}px)`,
      }}
    >
      <div
        style={{
          position: "relative",
          width: PLANE.width,
          height: PLANE.height,
          transformStyle: "preserve-3d",
          transform: `perspective(1800px) translate(${-30 * (1 - fold)}px, ${-50 * (1 - fold)}px) rotateX(${44 * (1 - fold)}deg) rotateZ(${-24 * (1 - fold)}deg) scale(${push * (1 - fold * 0.55)})`,
        }}
      >
        {KINDS.map((kind, i) => (
          <Card key={i} index={i} kind={kind} frame={frame} bandX={bandX} />
        ))}
        <div
          style={{
            position: "absolute",
            top: -160,
            bottom: -160,
            left: bandX - BAND / 2,
            width: BAND,
            opacity: bandOpacity,
            background: `linear-gradient(90deg, transparent, oklch(from ${brand.glow} l c h / 0.32) 50%, transparent)`,
            mixBlendMode: "plus-lighter",
            transform: "translateZ(60px)",
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

// When the band reaches a card's center, the card settles.
function settleFrame(index: number) {
  const cx = (index % COLS) * (CARD.width + CARD.gap) + CARD.width / 2;
  const t = (cx + BAND) / (PLANE.width + 2 * BAND);
  return SWEEP.start + t * (SWEEP.end - SWEEP.start);
}

function Card({
  index,
  kind,
  frame,
  bandX,
}: {
  index: number;
  kind: Kind;
  frame: number;
  bandX: number;
}) {
  const { fps } = useVideoConfig();
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const x = col * (CARD.width + CARD.gap);
  const y = row * (CARD.height + CARD.gap);
  const settleAt = settleFrame(index) + row * 4;

  const seed = `card-${index}`;
  const enter = spring({
    frame: frame - index * 3,
    fps,
    config: { damping: 200 },
    durationInFrames: 30,
  });
  const settle = spring({
    frame: frame - settleAt,
    fps,
    config: { damping: 16, stiffness: 150, mass: 0.7 },
  });
  const loose = 1 - settle;
  const drift = Math.sin(frame / 22 + random(seed) * 6.28);
  const dx = (random(`${seed}-x`) - 0.5) * 90 * loose + drift * 4 * loose;
  const dy = (random(`${seed}-y`) - 0.5) * 70 * loose;
  const dz = (40 + random(`${seed}-z`) * 90) * loose + (1 - enter) * 160;
  const rot = (random(`${seed}-r`) - 0.5) * 16 * loose;

  const near = Math.max(0, 1 - Math.abs(bandX - (x + CARD.width / 2)) / 200);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: CARD.width,
        height: CARD.height,
        boxSizing: "border-box",
        padding: 14,
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: `1px solid color-mix(in oklab, var(--border-card), ${brand.glow} ${near * 70}%)`,
        boxShadow: `var(--shadow-card), 0 0 ${near * 36}px oklch(from ${brand.glow} l c h / ${near * 0.45})`,
        opacity: enter,
        transform: `translate3d(${dx}px, ${dy}px, ${dz}px) rotateZ(${rot}deg)`,
      }}
    >
      {kind === "rows" && (
        <Rows seed={seed} frame={frame} settleAt={settleAt} />
      )}
      {kind === "funding" && (
        <Funding seed={seed} frame={frame} settleAt={settleAt} />
      )}
      {kind === "balance" && (
        <Balance seed={seed} frame={frame} settleAt={settleAt} />
      )}
    </div>
  );
}

function Rows({
  seed,
  frame,
  settleAt,
}: {
  seed: string;
  frame: number;
  settleAt: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        height: "100%",
      }}
    >
      {[0, 1, 2, 3].map((i) => {
        const at = settleAt + i * 3;
        const amount = 4 + random(`${seed}-a${i}`) * 180;
        return (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <ClearedDot frame={frame} at={at} />
            <Bone width={`${38 + random(`${seed}-b${i}`) * 32}%`} />
            <Figure
              value={amount}
              seed={`${seed}-${i}`}
              frame={frame}
              at={at}
              size={13}
              sign
            />
          </div>
        );
      })}
    </div>
  );
}

function Funding({
  seed,
  frame,
  settleAt,
}: {
  seed: string;
  frame: number;
  settleAt: number;
}) {
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        height: "100%",
      }}
    >
      {[0, 1, 2].map((i) => {
        const at = settleAt + i * 4;
        const fill = spring({
          frame: frame - at,
          fps,
          config: { damping: 22, stiffness: 120 },
        });
        const from = 0.12 + random(`${seed}-f${i}`) * 0.3;
        const to = 0.72 + random(`${seed}-t${i}`) * 0.28;
        const funded = frame >= at + 4;
        return (
          <div
            key={i}
            style={{ display: "flex", flexDirection: "column", gap: 7 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Bone width={`${34 + random(`${seed}-l${i}`) * 26}%`} />
              <Figure
                value={120 + random(`${seed}-v${i}`) * 900}
                seed={`${seed}-v${i}`}
                frame={frame}
                at={at}
                size={12}
              />
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: "var(--surface-selected)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  borderRadius: 3,
                  transformOrigin: "left",
                  transform: `scaleX(${from + (to - from) * fill})`,
                  background: funded
                    ? "var(--status-funded)"
                    : "var(--status-underfunded)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// A recorded balance and the bank's, closing on each other until they agree.
function Balance({
  seed,
  frame,
  settleAt,
}: {
  seed: string;
  frame: number;
  settleAt: number;
}) {
  const { fps } = useVideoConfig();
  const meet = spring({
    frame: frame - settleAt,
    fps,
    config: { damping: 20, stiffness: 110 },
  });
  const gap = 46 * (1 - meet);
  const matched = frame >= settleAt + 8;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Bone width="42%" />
        <ClearedDot frame={frame} at={settleAt + 8} />
      </div>
      <Figure
        value={1800 + random(`${seed}-bal`) * 6400}
        seed={`${seed}-bal`}
        frame={frame}
        at={settleAt}
        size={30}
      />
      <div style={{ position: "relative", height: 10 }}>
        <div
          style={{
            position: "absolute",
            top: 4,
            left: 0,
            right: 0,
            height: 2,
            borderRadius: 1,
            background: "var(--surface-selected)",
          }}
        />
        {[-1, 1].map((side) => (
          <div
            key={side}
            style={{
              position: "absolute",
              top: 0,
              left: "62%",
              width: 10,
              height: 10,
              marginLeft: -5,
              borderRadius: 5,
              transform: `translateX(${side * gap}px)`,
              background: matched
                ? "var(--status-funded)"
                : side < 0
                  ? "var(--text-tertiary)"
                  : brand.accent,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ClearedDot({ frame, at }: { frame: number; at: number }) {
  const { fps } = useVideoConfig();
  const on = spring({
    frame: frame - at,
    fps,
    config: { damping: 14, stiffness: 220, mass: 0.6 },
  });
  return (
    <div
      style={{
        position: "relative",
        flexShrink: 0,
        width: 14,
        height: 14,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 7,
          border: "1.5px solid var(--text-tertiary)",
          opacity: 1 - on,
        }}
      />
      <svg
        viewBox="0 0 14 14"
        style={{
          position: "absolute",
          inset: 0,
          opacity: on,
          transform: `scale(${0.6 + 0.4 * on})`,
        }}
      >
        <circle cx="7" cy="7" r="7" fill="var(--status-funded)" />
        <path
          d="M4.2 7.3 6.1 9.1 9.9 5.1"
          fill="none"
          stroke="var(--surface-app)"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function Bone({ width }: { width: string }) {
  return (
    <div
      style={{
        flexShrink: 0,
        width,
        height: 8,
        borderRadius: 4,
        background: "var(--skeleton-bone)",
      }}
    />
  );
}

// A money figure whose digits roll until `at`, then hold their value.
function Figure({
  value,
  seed,
  frame,
  at,
  size,
  sign = false,
}: {
  value: number;
  seed: string;
  frame: number;
  at: number;
  size: number;
  sign?: boolean;
}) {
  const settled = frame >= at;
  const text = (sign ? "−" : "") + money(value);
  const shown = settled
    ? text
    : text.replace(/\d/g, (_, i: number) =>
        String(
          Math.floor(random(`${seed}-${i}-${Math.floor(frame / 2)}`) * 10),
        ),
      );
  return (
    <span
      style={{
        marginLeft: "auto",
        fontSize: size,
        fontWeight: size > 20 ? 500 : 400,
        letterSpacing: size > 20 ? "-0.02em" : 0,
        fontVariantNumeric: "tabular-nums",
        color: settled ? "var(--text-primary)" : "var(--text-tertiary)",
        whiteSpace: "nowrap",
      }}
    >
      {shown}
    </span>
  );
}

const money = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// The pinwheel assembles blade by blade on its tile, clicks a quarter turn,
// and the wordmark and line arrive beside it.
function Lockup({ frame }: { frame: number }) {
  const { fps } = useVideoConfig();
  const tile = spring({
    frame: frame - MARK_AT,
    fps,
    config: { damping: 200 },
    durationInFrames: 24,
  });
  const click = spring({
    frame: frame - (WORD_AT - 6),
    fps,
    config: { damping: 15, stiffness: 120, mass: 0.9 },
  });
  const word = interpolate(frame, [WORD_AT, WORD_AT + 18], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const line = interpolate(frame, [WORD_AT + 10, WORD_AT + 30], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const glow = interpolate(
    frame,
    [MARK_AT + 10, WORD_AT - 4, WORD_AT + 30],
    [0, 1, 0.55],
    clamp,
  );
  const offset = (100 - 100 * BRAND_SMALL_MARK_SCALE) / 2;
  const shift = 180 * (1 - word);
  const directions = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: "50%",
          background: `radial-gradient(closest-side, oklch(from ${brand.glow} l c h / 0.38), transparent)`,
          opacity: glow,
          transform: `scale(${0.8 + glow * 0.2})`,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 26,
          transform: `translateX(${shift}px)`,
        }}
      >
        <svg
          viewBox="0 0 100 100"
          style={{
            width: 112,
            height: 112,
            flexShrink: 0,
            opacity: tile,
            transform: `scale(${0.88 + 0.12 * tile})`,
            overflow: "visible",
          }}
        >
          <defs>
            <linearGradient
              id="og-tile"
              x1="0"
              y1="0"
              x2={BRAND_TILE_SLANT}
              y2="1"
            >
              {BRAND_TILE_STOPS.map(([stop, color]) => (
                <stop key={stop} offset={stop} stopColor={color} />
              ))}
            </linearGradient>
            <linearGradient id="og-sheen" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0"
                stopColor="#fff"
                stopOpacity={BRAND_SHEEN_OPACITY}
              />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="og-blade" x1="0" y1="0" x2="0" y2="1">
              {BRAND_BLADE_STOPS.map(([stop, color]) => (
                <stop key={stop} offset={stop} stopColor={color} />
              ))}
            </linearGradient>
          </defs>
          <rect
            width="100"
            height="100"
            rx={BRAND_TILE_RADIUS}
            fill="url(#og-tile)"
          />
          <rect
            width="100"
            height="100"
            rx={BRAND_TILE_RADIUS}
            fill="url(#og-sheen)"
          />
          <rect
            x="0.75"
            y="0.75"
            width="98.5"
            height="98.5"
            rx={BRAND_TILE_RADIUS - 0.75}
            fill="none"
            stroke="#fff"
            strokeOpacity={BRAND_EDGE_OPACITY}
            strokeWidth="1.5"
          />
          <g
            transform={`translate(${offset} ${offset}) scale(${BRAND_SMALL_MARK_SCALE})`}
          >
            <g
              style={{
                transformOrigin: "50px 50px",
                transform: `rotate(${click * 90}deg)`,
              }}
            >
              {BRAND_BLADES.map((d, i) => {
                const blade = spring({
                  frame: frame - (MARK_AT + 6 + i * 3),
                  fps,
                  config: { damping: 17, stiffness: 140, mass: 0.7 },
                });
                const [bx, by] = directions[i]!;
                const away = 34 * (1 - blade);
                return (
                  <path
                    key={d}
                    d={d}
                    fill="url(#og-blade)"
                    opacity={Math.min(1, blade * 1.4)}
                    style={{
                      transformOrigin: "50px 50px",
                      transform: `translate(${bx * away}px, ${by * away}px) rotate(${-60 * (1 - blade)}deg)`,
                    }}
                  />
                );
              })}
            </g>
          </g>
        </svg>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            opacity: word,
            transform: `translateX(${-14 * (1 - word)}px)`,
            clipPath: `inset(-20% ${100 - word * 100}% -20% 0)`,
          }}
        >
          <span
            style={{
              fontSize: 84,
              lineHeight: 1,
              fontWeight: 600,
              letterSpacing: "-0.045em",
            }}
          >
            caishen<span style={{ color: brand.accent }}>.</span>
          </span>
          <span
            style={{
              fontSize: 22,
              color: brand.muted,
              letterSpacing: "-0.01em",
              opacity: line,
              transform: `translateY(${8 * (1 - line)}px)`,
            }}
          >
            A little clarity, every day.
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
}
