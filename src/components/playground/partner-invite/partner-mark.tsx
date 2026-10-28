"use client";

import { useLayoutEffect, useRef } from "react";
import { CSS_EASE } from "./motion";
import { useFrame } from "./use-frame";
import { timeline } from "./timeline";
import styles from "./lab.module.css";

export type Rect = { left: number; top: number; width: number; height: number };

// The mark's box in the nav, as the icons beside it.
const MARK_SIZE = 14;

// The end of the invitation: Jordan's half, left on the table once you've
// taken yours, shrinks down into the Partner mark, the picture of their
// half the app will show beside Partner from now on.
export function Filed({
  src,
  from,
  fade,
  reducedMotion,
}: {
  src: string | null;
  from: () => Rect;
  // How far the plate has faded out at a moment.
  fade: (now: number) => number;
  reducedMotion: boolean;
}) {
  const picture = useRef<HTMLImageElement>(null);
  const mark = useRef<HTMLImageElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const filed = useRef<HTMLDivElement>(null);
  useFrame((now) => {
    filed.current!.style.opacity = String(1 - fade(now));
  });

  useLayoutEffect(() => {
    const element = picture.current;
    if (reducedMotion || !element || !mark.current) return;
    const start = from();
    const icon = mark.current.getBoundingClientRect();
    const scale = icon.height / start.height;
    // The half sits in the middle of the mark's square box.
    const left = icon.left + (icon.width - start.width * scale) / 2;
    Object.assign(element.style, {
      left: `${start.left}px`,
      top: `${start.top}px`,
      width: `${start.width}px`,
      height: `${start.height}px`,
    });
    const duration = timeline.filed.duration * 1000;
    const animations = [
      // The same picture lands exactly on the mark, so one hands over to
      // the other at the end with nothing to blend.
      element.animate(
        [
          { transform: "none" },
          {
            transform: `translate(${left - start.left}px, ${icon.top - start.top}px) scale(${scale})`,
          },
        ],
        // Already on screen and moving: accelerate, then brake.
        { duration, easing: CSS_EASE.inOut, fill: "both" },
      ),
      element.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 1,
        delay: duration,
        fill: "both",
      }),
      mark.current.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 1,
        delay: duration,
        fill: "both",
      }),
      ...[plate.current, label.current].map((target) =>
        target!.animate(
          [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }],
          {
            duration,
            easing: CSS_EASE.out,
            fill: "both",
          },
        ),
      ),
      hint.current!.animate(
        [
          { opacity: 0, transform: "translateY(3px)" },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: 300,
          delay: duration,
          easing: CSS_EASE.out,
          fill: "both",
        },
      ),
    ];
    return () => animations.forEach((animation) => animation.cancel());
    // Only the arrival flies; `from` changes with every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={filed}
      className={styles.filed}
      style={{ opacity: 1 - fade(performance.now()) }}
    >
      <div ref={plate} className={styles.filedPlate}>
        <span className={styles.filedRow}>
          <PartnerMark ref={mark} src={src} />
          <span ref={label}>Partner</span>
        </span>
        <span ref={hint} className={styles.filedHint}>
          You hold the other half.
        </span>
      </div>
      {src && !reducedMotion && (
        // A picture drawn on the page from the 3D half, not a file to
        // optimize.
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={picture} src={src} alt="" className={styles.filedPicture} />
      )}
    </div>
  );
}

// Jordan's half, pictured from the 3D card, at icon size. It keeps the
// half's shape, a little narrower than it is tall, in the middle of an
// icon's square box so labels line up.
function PartnerMark({
  src,
  className,
  ref,
}: {
  src: string | null;
  className?: string;
  ref?: React.Ref<HTMLImageElement>;
}) {
  return (
    // A picture drawn on the page from the 3D half, not a file to optimize.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src ?? undefined}
      alt=""
      width={MARK_SIZE}
      height={MARK_SIZE}
      className={`${styles.partnerMark} ${className ?? ""}`}
      style={{ visibility: src ? undefined : "hidden" }}
    />
  );
}
