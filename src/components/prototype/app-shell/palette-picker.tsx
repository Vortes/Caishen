"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  HeartIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { PALETTES, type Palette } from "./palettes";
import styles from "./shell.module.css";

// The shell's own dark theme, listed first so it is one hover away.
const DEFAULT: Palette = {
  name: "Caishen",
  bg: "oklch(0.178 0.004 282)",
  main: "oklch(0.6 0.17 282)",
  sub: "oklch(0.64 0.004 282)",
  text: "oklch(0.95 0.002 282)",
  error: "oklch(0.74 0.15 22)",
};

export function paletteVars(palette: Palette) {
  return {
    "--mt-bg": palette.bg,
    "--mt-main": palette.main,
    "--mt-sub": palette.sub,
    "--mt-text": palette.text,
    "--mt-error": palette.error,
  } as CSSProperties;
}

// Saved palettes live under their own key, so the prototype's Reset (which
// restores layout) keeps your shortlist.
const SAVED_KEY = "caishen.prototype.app-shell.saved-palettes";

function useSavedPalettes() {
  const [saved, setSaved] = useState<string[]>([]);
  useEffect(() => {
    const stored = localStorage.getItem(SAVED_KEY);
    if (stored)
      setSaved(
        (JSON.parse(stored) as string[]).filter((name) => findPalette(name)),
      );
  }, []);
  const toggle = (name: string) =>
    setSaved((current) => {
      const next = current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name];
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      return next;
    });
  return { saved, toggle };
}

export function findPalette(name: string | null) {
  return PALETTES.find((palette) => palette.name === name) ?? null;
}

// Pointing at a palette applies it; there is nothing to click. Keyboard focus
// applies it the same way, so arrow keys walk the list.
export function PalettePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (name: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const { saved, toggle } = useSavedPalettes();
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const matches = (palette: Palette) =>
    palette.name.includes(query.trim().toLowerCase());
  const shown = [DEFAULT, ...PALETTES].filter(matches);
  // In the order you saved them, so the shortlist reads as a ranking.
  const shownSaved = saved.map((name) => findPalette(name)!).filter(matches);
  const current = value ?? DEFAULT.name;

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-section="all"] [aria-selected="true"]')
      ?.scrollIntoView({ block: "center" });
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const apply = (palette: Palette) =>
    onChange(palette === DEFAULT ? null : palette.name);

  const copySaved = () => {
    void navigator.clipboard.writeText(saved.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const row = (palette: Palette, section: "saved" | "all") => {
    const isSaved = saved.includes(palette.name);
    return (
      <div
        key={palette.name}
        className={styles.paletteRow}
        style={{ background: palette.bg, color: palette.text }}
        data-saved={isSaved || undefined}
        onPointerEnter={() => apply(palette)}
      >
        <button
          type="button"
          role="option"
          aria-selected={palette.name === current}
          className={styles.paletteOption}
          onFocus={() => apply(palette)}
        >
          {palette.name}
          <span className={styles.paletteDots} aria-hidden>
            <i style={{ background: palette.main }} />
            <i style={{ background: palette.sub }} />
            <i style={{ background: palette.text }} />
          </span>
        </button>
        {palette !== DEFAULT && (
          <button
            type="button"
            className={styles.paletteHeart}
            aria-pressed={isSaved}
            aria-label={`Save ${palette.name}`}
            tabIndex={section === "saved" ? -1 : 0}
            onClick={() => toggle(palette.name)}
          >
            <HeartIcon
              size={14}
              fill={isSaved ? "currentColor" : "none"}
              aria-hidden
            />
          </button>
        )}
      </div>
    );
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ??
        []),
    ];
    const index = options.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? Math.min(index + 1, options.length - 1)
        : index <= 0
          ? 0
          : index - 1;
    options[next]?.focus();
  };

  return (
    <div ref={wrapRef} className={styles.paletteWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.paletteTrigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.segmentedLabel}>Palette</span>
        {current}
        {open ? (
          <ChevronDownIcon size={12} aria-hidden />
        ) : (
          <ChevronUpIcon size={12} aria-hidden />
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Palettes"
          className={styles.palettePanel}
          onKeyDown={onKeyDown}
        >
          <input
            autoFocus
            className={styles.paletteSearch}
            placeholder={`Filter ${PALETTES.length} Monkeytype palettes`}
            aria-label="Filter palettes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div
            ref={listRef}
            role="listbox"
            aria-label="Palettes"
            className={styles.paletteList}
          >
            {shownSaved.length > 0 && (
              <div role="group" aria-label="Saved" data-section="saved">
                <div className={styles.paletteSection}>
                  Saved {saved.length}
                  <button
                    type="button"
                    className={styles.paletteCopy}
                    onClick={copySaved}
                  >
                    {copied ? (
                      <CheckIcon size={12} aria-hidden />
                    ) : (
                      <CopyIcon size={12} aria-hidden />
                    )}
                    {copied ? "Copied" : "Copy names"}
                  </button>
                </div>
                {shownSaved.map((palette) => row(palette, "saved"))}
              </div>
            )}
            <div role="group" aria-label="All palettes" data-section="all">
              {shownSaved.length > 0 && (
                <div className={styles.paletteSection}>All</div>
              )}
              {shown.map((palette) => row(palette, "all"))}
            </div>
            {shown.length === 0 && (
              <p className={styles.paletteEmpty}>No palette matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
