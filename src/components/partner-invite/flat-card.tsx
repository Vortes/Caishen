"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useBrowserValue } from "~/components/shared/use-browser-value";
import { CardFace } from "./card-face";
import { LANDING, sceneFit, type Point } from "./geometry";
import { INVITE, type Invitation } from "./print";
import { SignActions } from "./sign-actions";
import type { SkyTime } from "./sky";
import type { Sound } from "./sound";
import { timeline } from "./timeline";
import { usePen } from "./use-pen";
import { useSize } from "./use-size";
import styles from "./lab.module.css";

const PEN_AREA = INVITE.pen.to;

// Whether this browser can draw WebGL, once it can say: undefined on the
// server and while hydrating. Asked once; the test context is let go.
let webgl: boolean | undefined;
const canDrawWebGL = () => {
  if (webgl === undefined) {
    const context =
      document.createElement("canvas").getContext("webgl2") ??
      document.createElement("canvas").getContext("webgl");
    webgl = context !== null;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return webgl;
};
export const useWebGL = () => useBrowserValue(canDrawWebGL);

// Without WebGL there's no sky to fly through and no sheet to tear: the
// card lies flat on a painted sky, ready for the pen, and signing it goes
// straight on to what the clouds would have parted onto.
export function FlatCard({
  invitation,
  sky,
  sound,
  onSign,
  next,
  onSettled,
}: {
  invitation: Invitation;
  sky: SkyTime;
  sound: Sound | null;
  onSign?: () => Promise<boolean>;
  next?: ReactNode;
  onSettled?: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const stageSize = useSize(stage);
  const fit = stageSize ? sceneFit(stageSize.width, stageSize.height) : null;
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const toCard = (event: ReactPointerEvent): Point => {
    const matrix = svg.current!.getScreenCTM()!.inverse();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix,
    );
    return { x: point.x - LANDING.x, y: point.y - LANDING.y };
  };
  const pen = usePen({ toCard, sound });
  const { strokes } = pen;
  const sign = async () => {
    setSigning(true);
    if (onSign && !(await onSign())) return setSigning(false);
    setSigned(true);
    onSettled?.();
  };

  if (signed)
    return (
      <div className={styles.stage}>
        <div
          className={styles.next}
          style={
            {
              "--arrive-delay": "0s",
              "--arrive-duration": `${timeline.reveal.duration}s`,
            } as CSSProperties
          }
        >
          {next}
        </div>
      </div>
    );

  return (
    <div
      ref={stage}
      className={`${styles.stage} ${styles.flat}`}
      data-night={sky === "night" || undefined}
    >
      {fit && (
        <svg
          ref={svg}
          viewBox={`${fit.view.x} ${fit.view.y} ${fit.view.width} ${fit.view.height}`}
          className={styles.canvas}
          role="img"
          aria-label={`${invitation.from} ${INVITE.sentence.lines.join(" ")}`}
        >
          <g transform={`translate(${LANDING.x} ${LANDING.y})`}>
            <CardFace
              invitation={invitation}
              strokes={strokes}
              hint={strokes.length === 0}
            />
            <rect
              className={styles.signZone}
              x={PEN_AREA.x}
              y={PEN_AREA.y}
              width={PEN_AREA.width}
              height={PEN_AREA.height}
              fill="transparent"
              {...(signing ? {} : pen.handlers)}
            />
          </g>
        </svg>
      )}
      {stageSize && fit && strokes.length > 0 && (
        <SignActions
          stage={stageSize}
          fit={fit}
          signing={signing}
          onUndo={pen.undo}
          onClear={pen.clear}
          onSign={() => void sign()}
        />
      )}
    </div>
  );
}
