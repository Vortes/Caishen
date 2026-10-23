"use client";

import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import { forwardRef, useEffect, useState, type ReactNode } from "react";
import styles from "./popover-steps.module.css";

const ENTER_EASE = [0.32, 0.72, 0, 1] as const;

// Reconciliation and sharing use the same measured resize and step cross-fade.
export function PopoverSteps({
  step,
  children,
}: {
  step: string;
  children: ReactNode;
}) {
  const reduced = Boolean(useReducedMotion());
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useEffect(() => {
    if (!content) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry!.borderBoxSize[0]!.blockSize),
    );
    observer.observe(content);
    return () => observer.disconnect();
  }, [content]);
  return (
    <motion.div
      className={styles.frame}
      initial={false}
      animate={{ height }}
      transition={
        reduced ? { duration: 0 } : { duration: 0.2, ease: ENTER_EASE }
      }
    >
      <div ref={setContent} className={styles.steps}>
        <AnimatePresence mode="popLayout" initial={false}>
          <Step key={step} reduced={reduced}>
            {children}
          </Step>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

const Step = forwardRef<
  HTMLDivElement,
  { reduced: boolean; children: ReactNode }
>(function Step({ reduced, children }, ref) {
  const present = useIsPresent();
  return (
    <motion.div
      ref={ref}
      inert={!present || undefined}
      aria-hidden={!present || undefined}
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: reduced
          ? { duration: 0 }
          : { duration: 0.18, ease: ENTER_EASE },
      }}
      exit={{
        opacity: 0,
        pointerEvents: "none",
        transition: reduced
          ? { duration: 0 }
          : { duration: 0.12, ease: "easeIn" },
      }}
    >
      {children}
    </motion.div>
  );
});
