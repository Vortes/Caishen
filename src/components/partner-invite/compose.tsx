"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/dialog";
import shell from "~/components/app-shell/shell.module.css";
import { CardFace } from "./card-face";
import { WASHI, washiById, type WashiId } from "~/domain/invitation";
import { config, palette } from "./config";
import { CARD, LANDING, type Point, type View } from "./geometry";
import { signature } from "./ink";
import { clamp, easeInOut, lerp } from "./motion";
import { INVITE, type Invitation } from "./print";
import { Sheet3D } from "./sheet-3d";
import { usePen } from "./use-pen";
import lab from "./lab.module.css";
import styles from "./compose.module.css";

// How long turning the sheet over takes, in ms.
const TURN = 700;
// The card and a margin around it, in scene units: room for the sheet to
// lift as it turns over.
const MARGIN = 24;
const VIEW: View = {
  x: LANDING.x - CARD.width / 2 - MARGIN,
  y: LANDING.y - CARD.height / 2 - MARGIN,
  width: CARD.width + MARGIN * 2,
  height: CARD.height + MARGIN * 2,
};
// Where the pen works, as percentages of the preview, so the signing pad
// (an element of its own, the one place that keeps a finger from
// scrolling the page) lies exactly over the sender's line.
const PAD = INVITE.pen.from;
const PAD_STYLE: CSSProperties = {
  left: `${((LANDING.x + PAD.x - VIEW.x) / VIEW.width) * 100}%`,
  top: `${((LANDING.y + PAD.y - VIEW.y) / VIEW.height) * 100}%`,
  width: `${(PAD.width / VIEW.width) * 100}%`,
  height: `${(PAD.height / VIEW.height) * 100}%`,
};

// The sender writes the invitation, on the card their partner receives:
// picks the washi it's folded from, turns the sheet over, and signs their
// half, by hand or with a signature made from their name.
export function ComposeInvitation({
  from,
  onCancel,
  onSend,
}: {
  // The sender's name, as printed on the card.
  from: string;
  onCancel: () => void;
  onSend: (invitation: Invitation) => Promise<void>;
}) {
  const titleId = useId();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [washi, setWashi] = useState<WashiId>(WASHI[0].id);
  const [step, setStep] = useState<"paper" | "sign">("paper");
  // The turn in progress: from washi up (1) toward printed side up (0), or
  // back, starting wherever the sheet was.
  const [turn, setTurn] = useState({ from: 1, to: 1, at: 0 });
  const [turning, setTurning] = useState(false);
  const turnEnds = useRef(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const section = useRef<HTMLElement>(null);
  const pad = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const toCard = (event: ReactPointerEvent): Point => {
    const matrix = svg.current!.getScreenCTM()!.inverse();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix,
    );
    return { x: point.x - LANDING.x, y: point.y - LANDING.y };
  };
  const pen = usePen({ toCard, sound: null });
  const invitation = useMemo<Invitation>(
    () => ({ from, signature: [], washi }),
    [from, washi],
  );
  const signed = pen.strokes.length > 0;

  const turned = (now: number) =>
    reducedMotion
      ? turn.to
      : lerp(turn.from, turn.to, easeInOut(clamp((now - turn.at) / TURN)));
  const turnTo = (next: "paper" | "sign") => {
    setStep(next);
    const now = performance.now();
    setTurn({ from: turned(now), to: next === "paper" ? 1 : 0, at: now });
    window.clearTimeout(turnEnds.current);
    if (reducedMotion) return;
    setTurning(true);
    turnEnds.current = window.setTimeout(() => setTurning(false), TURN);
  };
  useEffect(() => () => window.clearTimeout(turnEnds.current), []);

  // Focus follows the step once the sheet has settled: the chosen paper,
  // or the signing pad.
  useEffect(() => {
    if (turning) return;
    if (step === "sign") pad.current?.focus();
    else
      section.current
        ?.querySelector<HTMLInputElement>('input[name="washi"]:checked')
        ?.focus();
  }, [step, turning]);

  const signWithName = () => {
    const strokes = signature(config.seed, from, INVITE.signed);
    const now = performance.now();
    pen.replace(strokes.map((stroke) => ({ ...stroke, dried: now })));
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await onSend({
        ...invitation,
        // Signed before it's folded, so it's dry by the time it arrives.
        signature: pen.strokes.map((stroke) => ({ ...stroke, dried: 0 })),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The invitation didn’t send.",
      );
    } finally {
      setSending(false);
    }
  };

  const signing = step === "sign" && !turning;

  return (
    <section
      ref={section}
      className={styles.composer}
      aria-labelledby={titleId}
    >
      <div className={shell.settingText}>
        <h3 id={titleId} className={`${shell.settingLabel} ${styles.title}`}>
          The card your partner receives
        </h3>
        {/* Both steps' hints hold the space of the longer one, so the card
            doesn't jump as it turns over. */}
        <span className={`${shell.settingHint} ${styles.hints}`}>
          <span data-shown={step === "paper" || undefined}>
            Your partner will see this card as a folded paper plane, personalize
            it!
          </span>
          <span data-shown={step === "sign" || undefined}>
            Sign above “You”. Your partner signs their side when it arrives.
          </span>
        </span>
      </div>

      <div
        className={styles.preview}
        style={{ "--aspect": VIEW.width / VIEW.height } as CSSProperties}
      >
        <Sheet3D
          invitation={invitation}
          strokes={pen.strokes}
          turned={turned}
          moving={turning}
          view={VIEW}
        />
        <svg
          ref={svg}
          viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
          className={styles.canvas}
          role="img"
          aria-label={
            step === "paper"
              ? `${washiById(washi).name} washi`
              : `${from} ${INVITE.sentence.lines.join(" ")}`
          }
        >
          {/* Printed side up, the flat card takes over from the 3D sheet,
              lying exactly where it does. */}
          {signing && (
            <g transform={`translate(${LANDING.x} ${LANDING.y})`}>
              <CardFace
                invitation={invitation}
                strokes={pen.strokes}
                hint={!signed}
                viewer="sender"
              />
            </g>
          )}
        </svg>
        {signing && (
          <div
            ref={pad}
            className={`${styles.pad} ${lab.signZone}`}
            style={PAD_STYLE}
            role="button"
            tabIndex={0}
            aria-label="Your signature. Draw it here, or press Enter to sign with your name."
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              signWithName();
            }}
            {...pen.handlers}
          />
        )}
      </div>

      {/* Both steps' controls share one cell, which keeps the height of the
          taller, so the actions below don't move when the sheet turns over
          or the signature goes on. Hidden, they can't be reached either. */}
      <div className={styles.tools}>
        <fieldset
          className={styles.papers}
          data-shown={step === "paper" || undefined}
        >
          <legend className={styles.paperLegend}>Paper</legend>
          <div className={styles.swatches}>
            {WASHI.map((paper) => (
              <label key={paper.id} className={styles.swatch}>
                <input
                  type="radio"
                  name="washi"
                  value={paper.id}
                  checked={washi === paper.id}
                  onChange={() => setWashi(paper.id)}
                  aria-label={paper.name}
                />
                <span
                  className={styles.dye}
                  style={{ background: palette.dye(paper) }}
                />
              </label>
            ))}
          </div>
          <span className={styles.paperName}>{washiById(washi).name}</span>
        </fieldset>
        <div
          className={styles.signTools}
          data-shown={step === "sign" || undefined}
        >
          {signed ? (
            <>
              <Button variant="quiet" disabled={sending} onClick={pen.undo}>
                Undo
              </Button>
              <Button variant="quiet" disabled={sending} onClick={pen.clear}>
                Clear
              </Button>
            </>
          ) : (
            <Button variant="quiet" disabled={!signing} onClick={signWithName}>
              Sign with my name instead
            </Button>
          )}
        </div>
      </div>

      {error && (
        <span className={shell.settingError} role="alert">
          {error}
        </span>
      )}

      <div className={styles.divider} />
      {step === "paper" ? (
        <div className={styles.actions}>
          <Button onClick={() => (signed ? setDiscarding(true) : onCancel())}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => turnTo("sign")}>
            Turn over to sign
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button disabled={sending} onClick={() => turnTo("paper")}>
            Change paper
          </Button>
          <Button
            variant="primary"
            disabled={!signed || sending}
            onClick={() => void send()}
          >
            {sending ? "Sending…" : "Send invitation"}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard this invitation?"
        description="Your signature and the paper you chose won’t be kept."
        cancel="Keep writing"
        confirm="Discard"
        tone="danger"
        onConfirm={onCancel}
      />
    </section>
  );
}
