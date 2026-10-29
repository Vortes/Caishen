import { useId, useRef, useState } from "react";
import { config, palette } from "./config";
import { DECKLE_PATH } from "./geometry";
import { harrierCreases } from "./harrier";
import { strokeSegments, wetness, type Stroke } from "./ink";
import {
  INVITE,
  lineLabels,
  nameSize,
  type Invitation,
  type Viewer,
} from "./print";
import { useFrame } from "./use-frame";
import styles from "./lab.module.css";

// The invitation as printed on the flat card, in card coordinates: what
// the 3D sheet hands over to once it lies flat, and what you sign.
export function CardFace({
  invitation,
  strokes,
  hint = false,
  viewer = "partner",
}: {
  invitation: Invitation;
  // The signature being drawn now.
  strokes: Stroke[];
  // Whether to ask for that signature.
  hint?: boolean;
  // Who's signing: the sender on their line before the card is sent, or
  // the partner on theirs once it arrives.
  viewer?: Viewer;
}) {
  const line = INVITE.rule[viewer === "sender" ? "from" : "to"];
  const [fromLabel, toLabel] = lineLabels(invitation, viewer);
  const id = useId();
  return (
    <g>
      <defs>
        <clipPath id={`${id}-paper`}>
          <path d={DECKLE_PATH} />
        </clipPath>
      </defs>
      <path d={DECKLE_PATH} fill={palette.paper()} />
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
        x={INVITE.left}
        y={INVITE.name.y}
        className={styles.cardSentence}
        style={{ fontSize: nameSize(invitation.from) }}
      >
        {invitation.from}
      </Printed>
      {INVITE.sentence.lines.map((line, index) => (
        <Printed
          key={line}
          x={INVITE.left}
          y={INVITE.sentence.y + index * INVITE.sentence.leading}
          className={styles.cardSentence}
        >
          {line}
        </Printed>
      ))}

      {[INVITE.rule.from, INVITE.rule.to].map(({ x1, x2 }) => (
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
      <Printed x={INVITE.left} y={INVITE.labels.y} className={styles.cardMeta}>
        {fromLabel}
      </Printed>
      <Printed
        x={INVITE.rule.to.x1}
        y={INVITE.labels.y}
        className={styles.cardMeta}
      >
        {toLabel}
      </Printed>
      {hint && (
        <text
          x={(line.x1 + line.x2) / 2}
          y={78}
          textAnchor="middle"
          className={styles.cardHint}
          fill={palette.printed}
          opacity={0.7}
        >
          sign here
        </text>
      )}

      {invitation.signature.map((stroke, index) => (
        <Ink key={`p${index}`} stroke={stroke} />
      ))}
      {strokes.map((stroke, index) => (
        <Ink key={index} stroke={stroke} />
      ))}
    </g>
  );
}

// Letterpress, set flush left: ink sits in a shallow bite, so the paper
// under each letter catches a sliver of light along its lower edge.
function Printed({
  x,
  y,
  className,
  style,
  children,
}: {
  x: number;
  y: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <g>
      <text
        x={x}
        y={y + 0.8}
        aria-hidden
        textAnchor="start"
        className={className}
        style={style}
        fill={palette.paper(0.05)}
      >
        {children}
      </text>
      <text
        x={x}
        y={y}
        textAnchor="start"
        className={className}
        style={style}
        fill={palette.printed}
      >
        {children}
      </text>
    </g>
  );
}

// A stroke of ink. While it dries it fades from glossy to matte on the
// frame loop, then settles.
function Ink({ stroke }: { stroke: Stroke }) {
  const group = useRef<SVGGElement>(null);
  const [dried, setDried] = useState<Stroke | null>(null);
  const wet = dried === stroke ? 0 : wetness(stroke, performance.now());
  useFrame((now) => {
    const wetNow = wetness(stroke, now);
    const color = palette.ink(wetNow);
    for (const mark of group.current!.querySelectorAll("[data-ink]"))
      mark.setAttribute(mark.tagName === "circle" ? "fill" : "stroke", color);
    for (const gloss of group.current!.querySelectorAll("[data-gloss]"))
      gloss.setAttribute("stroke-opacity", String(0.35 * wetNow));
    if (wetNow === 0) setDried(stroke);
  }, wet > 0);
  const color = palette.ink(wet);
  const segments = strokeSegments(stroke);
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const pool = config.ink.thick * 0.42 * config.ink.pool;
  return (
    <g ref={group}>
      {segments.map((segment, index) => (
        <line
          key={index}
          data-ink
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
            data-ink
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
            data-gloss
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
