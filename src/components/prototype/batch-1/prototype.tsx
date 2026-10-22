"use client";

import { ChevronDownIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Toast, ToastRegion } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import styles from "./batch.module.css";

// Everything the Batch 1 prototypes remember lives under one prefix, so the
// Reset control can clear all of it at once.
const PREFIX = "caishen.prototype.batch-1.";
export const INDEX_PATH = "/prototype/batch-1";

// Prototype state kept on this device: the variant and state picked on each
// screen, and the mock data edited there. Starts from `initial` on the server
// and on the first client render, then switches to the saved value.
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PREFIX + key);
      if (saved !== null) setValue(JSON.parse(saved) as T);
    } catch {
      // A blocked or corrupt store starts the prototype fresh.
    }
    loaded.current = true;
  }, [key]);
  const set = useCallback(
    (next: T | ((current: T) => T)) =>
      setValue((current) => {
        const resolved =
          typeof next === "function"
            ? (next as (current: T) => T)(current)
            : next;
        try {
          localStorage.setItem(PREFIX + key, JSON.stringify(resolved));
        } catch {
          // Prototype state still works for this page view.
        }
        return resolved;
      }),
    [key],
  );
  return [value, set] as const;
}

export function resetPrototype() {
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // Nothing saved to clear.
  }
  window.location.reload();
}

export type Theme = "dark" | "light";

export function useTheme() {
  return useStored<Theme>("theme", "dark");
}

// A standalone screen outside the app shell: the themed page, its tooltip
// portal, and the prototype controls on top.
export function PrototypePage({
  theme,
  children,
  controls,
  fixed = false,
}: {
  theme: Theme;
  children: ReactNode;
  controls: ReactNode;
  // Fills the window without scrolling, like the app shell.
  fixed?: boolean;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setRoot}
      className={styles.page}
      data-theme={theme}
      data-fixed={fixed || undefined}
    >
      <TooltipProvider container={root}>
        {children}
        {controls}
      </TooltipProvider>
    </div>
  );
}

// The floating prototype panel: which screen this is, the variant and state
// pickers, the theme, and Reset. Collapses to its tag so screenshots and
// demos can hide it.
export function PrototypeBar({
  title,
  theme,
  onTheme,
  children,
}: {
  title: string;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useStored("bar-open", true);
  return (
    <div
      className={styles.bar}
      data-open={open || undefined}
      role="region"
      aria-label="Prototype controls"
    >
      <div className={styles.barHead}>
        <button
          type="button"
          className={styles.barTag}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Prototype
          <ChevronDownIcon size={12} aria-hidden />
        </button>
        {open && (
          <>
            <Link className={styles.barLink} href={INDEX_PATH}>
              Batch 1
            </Link>
            <span className={styles.barTitle}>{title}</span>
            <button
              type="button"
              className={styles.barReset}
              onClick={resetPrototype}
            >
              <RotateCcwIcon size={12} aria-hidden />
              Reset
            </button>
          </>
        )}
      </div>
      {open && (
        <div className={styles.barBody}>
          {children}
          <Choice
            label="Theme"
            value={theme}
            options={[
              ["dark", "Dark"],
              ["light", "Light"],
            ]}
            onChange={onTheme}
          />
        </div>
      )}
    </div>
  );
}

type Notice = { id: number; message: string; action?: ReactNode };

// Links that would leave the prototype (Clerk, app.curate.is, Plaid) show a
// toast naming where they go instead, with an optional jump to the next
// prototype screen.
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const show = useCallback(
    (message: string, action?: ReactNode) =>
      setNotice({ id: Date.now(), message, action }),
    [],
  );
  const region = (
    <ToastRegion>
      {notice && (
        <Toast
          key={notice.id}
          action={notice.action}
          onDismiss={() => setNotice(null)}
        >
          {notice.message}
        </Toast>
      )}
    </ToastRegion>
  );
  return { show, region };
}

// One picker in the prototype panel. A variant picker names the variable it
// moves in `label`, like "Variant: what the page sells".
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.choice} role="radiogroup" aria-label={label}>
      <span className={styles.choiceLabel}>{label}</span>
      <span className={styles.choiceOptions}>
        {options.map(([option, text]) => (
          <button
            type="button"
            role="radio"
            key={option}
            aria-checked={value === option}
            onClick={() => onChange(option)}
          >
            {text}
          </button>
        ))}
      </span>
    </div>
  );
}
