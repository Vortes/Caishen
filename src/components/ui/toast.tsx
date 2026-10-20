"use client";

import { CircleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./icon-button";
import styles from "./toast.module.css";

// The corner where toasts appear, mounted once per screen inside its themed
// root and kept mounted, so screen readers hear each toast as it arrives.
export function ToastRegion({ children }: { children?: ReactNode }) {
  return (
    <section
      className={styles.region}
      aria-label="Notifications"
      aria-live="polite"
    >
      {children}
    </section>
  );
}

// A short message about something that just happened, with at most one
// action. neutral confirms; attention says something failed and the user has
// to act, and stays until dismissed. Give each toast a new key to restart its
// timer.
export function Toast({
  tone = "neutral",
  action,
  duration = tone === "neutral" ? 5000 : null,
  onDismiss,
  children,
}: {
  tone?: "neutral" | "attention";
  // One Button size="sm", such as Undo or Try again.
  action?: ReactNode;
  // Milliseconds before onDismiss; null keeps the toast until dismissed.
  duration?: number | null;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useDismissTimer(duration, hovered || focused, onDismiss);
  return (
    <div
      className={styles.toast}
      data-tone={tone}
      role={tone === "attention" ? "alert" : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      {tone === "attention" && (
        <CircleAlertIcon size={13} className={styles.icon} aria-hidden />
      )}
      <span className={styles.message}>{children}</span>
      {action}
      {duration === null && onDismiss && (
        <IconButton label="Dismiss" size="sm" onClick={onDismiss}>
          <XIcon aria-hidden />
        </IconButton>
      )}
    </div>
  );
}

// Counts down while the toast isn't hovered or focused, so the pointer or
// keyboard reaching for its action never loses it.
function useDismissTimer(
  duration: number | null,
  paused: boolean,
  onDismiss: (() => void) | undefined,
) {
  const remaining = useRef(duration ?? 0);
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  useEffect(() => {
    if (duration === null || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(
      () => dismiss.current?.(),
      remaining.current,
    );
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [duration, paused]);
}
