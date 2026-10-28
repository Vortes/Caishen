"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GuidedOnboarding } from "~/components/entry/guided-onboarding";
import { Button } from "~/components/ui/button";
import { BannerPlane } from "./banner-plane";
import { CardFace } from "./card-face";
import { config } from "./config";
import {
  CARD,
  LANDING,
  SCENE,
  sceneFit,
  type Point,
  type View,
} from "./geometry";
import { freed, intoBottom } from "./keep";
import { clamp, easeInOut, easeOut, span } from "./motion";
import { Filed, type Rect } from "./partner-mark";
import { perf } from "./perf";
import { Plane3D } from "./plane-3d";
import { arrivalFrame, arrivalProgress, arrivalSeconds } from "./plane-motion";
import { INVITE, PARTNER, PARTNER_FIRST_NAME } from "./print";
import {
  arrivalTrack,
  bondTrack,
  curlTrack,
  endingTrack,
  useScore,
} from "./score";
import { Sky, type SkyTime, type Veil, type Words } from "./sky";
import type { Sound } from "./sound";
import { ending, timeline } from "./timeline";
import { THEIRS_BOX, type CardFrame } from "./torn-card";
import { useFrame } from "./use-frame";
import { usePeel } from "./use-peel";
import { usePen } from "./use-pen";
import { useSize } from "./use-size";
import styles from "./lab.module.css";

export type Phase =
  // Waiting in the sky, with the line written in cloud, for the tap that
  // throws the plane (and lets sound start).
  "invite" | "arrive" | "sign" | "bond" | "take" | "taking" | "done";

const hh = CARD.height / 2;
// The pen takes the pointer over more of the card than the line itself, so
// a fingertip on a phone doesn't have to start inside a 55px strip.
const PEN_AREA = { x: 10, y: -20, width: 270, height: 150 };
// What's in view before the stage has a size.
const WHOLE_SCENE: View = { x: 0, y: 0, ...SCENE };

// The scene renders when what's on the page changes: a step, a stroke of
// the pen, a pull on the peel, or one of the moments in `stageAt`. All that
// moves in between is drawn on the frame loop from the `...At(now)`
// functions below, by the sky, the 3D card, and the banner plane.
export function Scene({
  sky,
  reducedMotion,
  sound,
  onSettled,
}: {
  sky: SkyTime;
  reducedMotion: boolean;
  // Null while sound is off.
  sound: Sound | null;
  // The clouds have parted all the way onto the onboarding: the invite is
  // over.
  onSettled?: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const stageSize = useSize(stage);
  const fit = stageSize ? sceneFit(stageSize.width, stageSize.height) : null;
  const view = fit?.view ?? WHOLE_SCENE;
  // The card's bottom right corner on the stage, in px from the stage's
  // top and right, where the signing buttons hang.
  const cardCorner =
    stageSize && fit
      ? {
          top: (LANDING.y + hh - view.y) * fit.scale,
          right:
            stageSize.width - (LANDING.x + CARD.width / 2 - view.x) * fit.scale,
        }
      : null;
  const [phase, setPhase] = useState<{ name: Phase; at: number }>(() => ({
    name: "invite",
    at: performance.now(),
  }));
  // The step as last set, ahead of the page catching up with it.
  const latestPhase = useRef(phase);
  const [bondAt, setBondAt] = useState<number | null>(null);
  // A picture of Jordan's half, for the Partner mark.
  const [mark, setMark] = useState<string | null>(null);
  useEffect(() => {
    if (mark) return () => URL.revokeObjectURL(mark);
  }, [mark]);

  const go = (name: Phase) => {
    const at = performance.now();
    if (name === "bond") setBondAt(at);
    latestPhase.current = { name, at };
    setPhase(latestPhase.current);
  };

  const toCard = (event: ReactPointerEvent): Point => {
    const matrix = svg.current!.getScreenCTM()!.inverse();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix,
    );
    return { x: point.x - LANDING.x, y: point.y - LANDING.y };
  };
  const toHalf = (event: ReactPointerEvent): Point => {
    const at = toCard(event);
    return { x: at.x + config.seal.overlap / 2, y: at.y };
  };
  const pen = usePen({ toCard, sound });
  const { strokes } = pen;
  const peel = usePeel({
    active: phase.name === "take",
    startedAt: phase.at,
    reducedMotion,
    sound,
    toHalf,
    onTaken: () => go("taking"),
  });
  const { thrown, takenAt } = peel;

  // How long the line had been up when the plane was caught, so the
  // banner plane climbs away from where it was.
  const [caughtAfter, setCaughtAfter] = useState(0);
  // Caught: the plane is thrown, and the line blows away as it comes.
  const caught = () => {
    setCaughtAfter((performance.now() - phase.at) / 1000);
    go(reducedMotion ? "sign" : "arrive");
  };
  // Always two lines, so the letters can be big and fat; broken where they
  // fit the stage, so not until it has a size.
  const lines =
    stageSize && stageSize.width < stageSize.height
      ? [`${PARTNER_FIRST_NAME} sent`, "you something"]
      : [`${PARTNER_FIRST_NAME} sent you`, "something"];

  // Seconds into this step, since your half came free, and since the
  // clouds started closing.
  const timesAt = (now: number) => {
    const sinceTaken = takenAt === null ? 0 : (now - takenAt) / 1000;
    return {
      elapsed: (now - phase.at) / 1000,
      sinceTaken,
      sinceClouds: sinceTaken - ending.cloudsAt,
    };
  };
  // The bond step tears the card in two, then seals the halves together.
  const tearSeconds = reducedMotion ? 0 : timeline.tear.duration;
  const progressAt = (elapsed: number) => ({
    tear: reducedMotion ? 1 : clamp(elapsed / tearSeconds),
    bond: reducedMotion
      ? 1
      : clamp((elapsed - tearSeconds) / timeline.bond.duration),
  });
  const { gather, partAt, part: partSeconds } = timeline.veil;
  const veilAt = (now: number): Veil => {
    if (takenAt === null) return { cover: 0, open: 0 };
    const { sinceClouds } = timesAt(now);
    return {
      cover: easeInOut(clamp(sinceClouds / gather)),
      open: easeOut(clamp((sinceClouds - partAt) / partSeconds)),
    };
  };
  const wordsAt = (now: number): Words | null => {
    const { elapsed } = timesAt(now);
    const { write } = timeline;
    if (!stageSize) return null;
    if (phase.name === "invite")
      return {
        lines,
        form: reducedMotion ? 1 : easeOut(clamp(elapsed / write.form)),
        scatter: 0,
      };
    if (phase.name === "arrive" && elapsed < write.scatter)
      return { lines, form: 1, scatter: elapsed / write.scatter };
    return null;
  };
  // The mark's plate is gone before the clouds have packed in around it.
  const plateFadeAt = (now: number) =>
    easeInOut(
      clamp(
        (timesAt(now).sinceClouds - timeline.veil.plateAt) /
          timeline.veil.plateFade,
      ),
    );
  // The moments that change what's on the page.
  const stageAt = (now: number) => {
    const { elapsed, sinceTaken } = timesAt(now);
    const ended = phase.name === "taking" || phase.name === "done";
    const { open } = veilAt(now);
    return {
      banner:
        phase.name === "invite" || (phase.name === "arrive" && elapsed < 2),
      // The 3D sheet unfolds over the printed card, which takes over once
      // the sheet lies flat in exactly the same place.
      landed:
        phase.name === "arrive" &&
        span(arrivalProgress(elapsed).open, 0.94, 1) > 0,
      // The 3D sheet has faded in over the printed card.
      sheetUp:
        phase.name === "bond" &&
        progressAt(elapsed).tear >= timeline.tear.shown,
      // Your half gone, Jordan's hands over from 3D to its picture, which
      // shrinks into the mark.
      filing: ended && sinceTaken >= ending.filedAt,
      revealed: phase.name === "done" && (reducedMotion || open > 0),
      // The clouds have parted all the way: nothing moves any more.
      settled: phase.name === "done" && (reducedMotion || open >= 1),
    };
  };
  const moment = stageAt(performance.now());
  const [, setMomentKey] = useState("");
  const momentKey = useRef("");

  // The torn card at a moment, from the tear until Jordan's half has been
  // pictured for the mark. Taken, your half comes free and rises to you,
  // then is gone.
  const cardAt = (now: number): CardFrame | null => {
    if (
      phase.name === "invite" ||
      phase.name === "arrive" ||
      phase.name === "sign"
    )
      return null;
    const { elapsed, sinceTaken } = timesAt(now);
    const { filing } = stageAt(now);
    if (filing && mark) return null;
    const progress = progressAt(elapsed);
    const { shimmer, genie } = timeline.keep;
    const free =
      phase.name === "taking" && thrown
        ? freed(thrown, sinceTaken, view, reducedMotion)
        : null;
    const kept = free?.keep ?? null;
    const pouring = kept && sinceTaken >= genie.at;
    const stampedAt =
      tearSeconds + timeline.bond.stamp * timeline.bond.duration;
    return {
      tear: phase.name === "bond" ? progress.tear : 1,
      bond: phase.name === "bond" ? progress.bond : 1,
      sealWet:
        bondAt === null
          ? 0
          : 1 -
            clamp((now - bondAt - stampedAt * 1000) / (config.ink.dry * 1000)),
      peels: phase.name === "take" ? peel.peels(now) : free ? [free.peel] : [],
      keep: kept,
      shown: kept && sinceTaken >= ending.gone ? 0 : 1,
      shimmer: kept ? easeInOut(span(sinceTaken, ...shimmer)) || -1 : -1,
      genie: pouring
        ? {
            progress: span(sinceTaken, genie.at, genie.at + genie.seconds),
            to: intoBottom(kept.z, view),
          }
        : null,
      opacity: filing ? 0 : 1,
    };
  };

  // Heard: each step's timeline, played against the time the scene is
  // drawn at.
  const arrival = useMemo(() => arrivalTrack(), []);
  const bonding = useMemo(() => bondTrack(reducedMotion), [reducedMotion]);
  const curling = useMemo(() => curlTrack(), []);
  const flung = thrown?.velocity ?? 0;
  const parting = useMemo(() => endingTrack(flung), [flung]);
  const play = useScore(sound);
  useEffect(() => sound?.sky(sky === "night"), [sound, sky]);
  useEffect(() => perf?.phase(phase.name), [phase.name]);
  useEffect(() => {
    if (moment.settled) onSettled?.();
  }, [moment.settled, onSettled]);

  useFrame((now) => {
    // A new step is on its way to the page; wait for it.
    if (latestPhase.current !== phase) return;
    const { elapsed, sinceTaken, sinceClouds } = timesAt(now);
    if (phase.name === "arrive" && elapsed >= arrivalSeconds()) go("sign");
    if (phase.name === "bond" && progressAt(elapsed).bond >= 1) go("take");
    if (phase.name === "taking" && (reducedMotion || sinceClouds >= gather))
      go("done");
    if (phase.name === "arrive") play(arrival, elapsed);
    else if (phase.name === "bond") play(bonding, elapsed);
    else if (phase.name === "take")
      play(peel.curling ? curling : null, elapsed);
    else if (takenAt !== null) play(parting, sinceTaken);
    else play(null, 0);
    const key = JSON.stringify(stageAt(now));
    if (key !== momentKey.current) {
      momentKey.current = key;
      setMomentKey(key);
    }
  }, !moment.settled);

  // Where Jordan's half lies on the table, on screen.
  const theirsRect = (): Rect => {
    const box = stage.current!.getBoundingClientRect();
    const { scale, view } = sceneFit(box.width, box.height);
    return {
      left: box.left + (LANDING.x + THEIRS_BOX.left - view.x) * scale,
      top: box.top + (LANDING.y + THEIRS_BOX.top - view.y) * scale,
      width: (THEIRS_BOX.right - THEIRS_BOX.left) * scale,
      height: (THEIRS_BOX.bottom - THEIRS_BOX.top) * scale,
    };
  };

  let body: React.ReactNode;
  if (phase.name === "arrive") {
    body = moment.landed && (
      <g transform={`translate(${LANDING.x} ${LANDING.y})`}>
        <CardFace strokes={strokes} hint />
      </g>
    );
  } else if (phase.name === "sign") {
    body = (
      <g transform={`translate(${LANDING.x} ${LANDING.y})`}>
        <CardFace strokes={strokes} hint={strokes.length === 0} />
        <rect
          className={styles.signZone}
          x={PEN_AREA.x}
          y={PEN_AREA.y}
          width={PEN_AREA.width}
          height={PEN_AREA.height}
          fill="transparent"
          {...pen.handlers}
        />
      </g>
    );
  } else if (
    phase.name !== "invite" &&
    phase.name !== "taking" &&
    (!moment.filing || !mark)
  ) {
    body =
      phase.name === "bond" && !moment.sheetUp ? (
        // The printed card, until the 3D sheet has faded in over it.
        <g transform={`translate(${LANDING.x} ${LANDING.y})`}>
          <CardFace strokes={strokes} />
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
          {...peel.handlers}
        />
      );
  }

  return (
    <div
      ref={stage}
      className={styles.stage}
      data-night={sky === "night" || undefined}
    >
      {moment.revealed && (
        <div
          className={styles.next}
          style={
            {
              "--arrive-delay": `${timeline.reveal.at * partSeconds}s`,
              "--arrive-duration": `${timeline.reveal.duration}s`,
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
      {!(reducedMotion && moment.revealed) && !moment.settled && (
        <Sky
          still={reducedMotion}
          time={sky}
          read={(now) => ({ veil: veilAt(now), words: wordsAt(now) })}
          onBreathe={(amount, dt) => {
            if (dt > 0) sound?.breathe(amount / dt);
          }}
        />
      )}
      {stageSize && moment.banner && (
        <BannerPlane
          width={stageSize.width}
          height={stageSize.height}
          times={(now) => {
            const { elapsed } = timesAt(now);
            return phase.name === "invite"
              ? { elapsed, caught: null }
              : { elapsed: caughtAfter, caught: elapsed };
          }}
          still={reducedMotion}
        />
      )}
      <svg
        ref={svg}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        className={styles.canvas}
        // Gone once the onboarding is up, so it takes the pointer.
        style={phase.name === "done" ? { display: "none" } : undefined}
        role="img"
        aria-label={
          phase.name === "invite"
            ? `${PARTNER_FIRST_NAME} sent you something`
            : `${PARTNER} ${INVITE.sentence.lines.join(" ")} Partner invite, ${phase.name} step`
        }
      >
        {phase.name === "invite" && (
          // Waiting in the sky: a tap anywhere catches the plane.
          <rect
            width={SCENE.width}
            height={SCENE.height}
            fill="transparent"
            onClick={caught}
            className={styles.catch}
          />
        )}
        {body}
      </svg>
      {!moment.settled && (
        <Plane3D
          night={sky === "night"}
          plane={(now) =>
            phase.name === "arrive" ? arrivalFrame(timesAt(now).elapsed) : null
          }
          card={cardAt}
          strokes={strokes}
          inkAt={bondAt}
          onKeepsake={setMark}
        />
      )}
      {phase.name === "taking" && moment.filing && mark && (
        <Filed
          src={mark}
          from={theirsRect}
          fade={plateFadeAt}
          reducedMotion={reducedMotion}
        />
      )}
      {/* Nothing to undo, clear, or sign until there's ink; the card's own
          "sign here" asks for it first. */}
      {phase.name === "sign" && strokes.length > 0 && cardCorner && (
        <div
          className={styles.signActions}
          style={
            {
              "--card-bottom": `${cardCorner.top}px`,
              "--card-right": `${cardCorner.right}px`,
            } as CSSProperties
          }
        >
          <div className={styles.signEdits}>
            <Button onClick={pen.undo}>Undo</Button>
            <Button onClick={pen.clear}>Clear</Button>
          </div>
          <Button variant="primary" onClick={() => go("bond")}>
            Sign
          </Button>
        </div>
      )}
    </div>
  );
}
