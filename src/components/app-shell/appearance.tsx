"use client";

import { CheckIcon, HeartIcon } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { SearchField } from "./account";
import {
  DEFAULT_PALETTE,
  findPalette,
  PALETTES,
  type Palette,
} from "./palettes";
import type { Settings, Theme } from "./settings";
import styles from "./shell.module.css";

// Saved themes live under their own key, so Reset (which restores the
// layout and colors) keeps the shortlist.
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

// Like Linear's preferences: every change applies the moment it's made.
export function AppearanceSettings({
  settings,
  onChange,
  onReset,
}: {
  settings: Settings;
  onChange: (change: Partial<Settings>) => void;
  onReset: () => void;
}) {
  return (
    <div className={styles.settingsPage}>
      <section className={styles.settingsSection}>
        <h2 className={styles.settingsHeading}>Mode</h2>
        <Card>
          <div className={styles.settingRow}>
            <div className={styles.settingText}>
              <span className={styles.settingLabel}>Interface mode</span>
              <span className={styles.settingHint}>
                Themes recolor dark mode. Light mode uses Caishen’s own colors.
              </span>
            </div>
            <SegmentedControl
              aria-label="Interface mode"
              value={settings.theme}
              onValueChange={(theme) => onChange({ theme: theme as Theme })}
            >
              <SegmentedControlItem value="dark">Dark</SegmentedControlItem>
              <SegmentedControlItem value="light">Light</SegmentedControlItem>
            </SegmentedControl>
          </div>
        </Card>
      </section>

      <ThemePicker
        value={settings.palette}
        // Every theme is dark, so choosing one leaves light mode.
        onChange={(palette) => onChange({ palette, theme: "dark" })}
      />

      <section className={styles.settingsSection}>
        <h2 className={styles.settingsHeading}>Layout</h2>
        <Card>
          <div className={styles.settingRow}>
            <div className={styles.settingText}>
              <span className={styles.settingLabel}>Reset appearance</span>
              <span className={styles.settingHint}>
                Restores the mode, theme, panel widths, and plan view. Saved
                themes stay.
              </span>
            </div>
            <Button onClick={onReset}>Reset</Button>
          </div>
        </Card>
      </section>
    </div>
  );
}

// Each tile is drawn in its own colors, like Monkeytype's theme list.
// Choosing applies at once; arrow keys walk the grid and apply as they go.
function ThemePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (name: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const { saved, toggle } = useSavedPalettes();
  const all = [DEFAULT_PALETTE, ...PALETTES];
  const matches = (palette: Palette) =>
    palette.name.toLowerCase().includes(query.trim().toLowerCase());
  const shown = all.filter(matches);
  // In the order they were saved, so the shortlist reads as a ranking.
  const shownSaved = saved.map((name) => findPalette(name)!).filter(matches);
  const current = value ?? DEFAULT_PALETTE.name;
  // One tile takes Tab: the current theme, in the first list showing it.
  const tabStop = shownSaved.some((palette) => palette.name === current)
    ? `saved:${current}`
    : shown.some((palette) => palette.name === current)
      ? `all:${current}`
      : `all:${shown[0]?.name}`;

  const apply = (palette: Palette) =>
    onChange(palette === DEFAULT_PALETTE ? null : palette.name);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'),
    ];
    const from = options.indexOf(document.activeElement as HTMLElement);
    if (from === -1) return;
    const next = neighbor(options, from, event.key);
    if (next === undefined) return;
    event.preventDefault();
    options[next]!.focus();
    options[next]!.click();
  };

  const tile = (palette: Palette, section: "saved" | "all") => {
    const selected = palette.name === current;
    const isSaved = saved.includes(palette.name);
    const stop = tabStop === `${section}:${palette.name}`;
    return (
      <div
        key={palette.name}
        className={styles.themeTile}
        style={{ background: palette.bg, color: palette.text }}
        data-selected={selected || undefined}
        data-saved={isSaved || undefined}
      >
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          tabIndex={stop ? 0 : -1}
          className={styles.themeOption}
          onClick={() => apply(palette)}
        >
          <span className={styles.themeName}>
            {palette.name}
            {selected && <CheckIcon size={13} aria-hidden />}
          </span>
          <span className={styles.themeDots} aria-hidden>
            <i style={{ background: palette.main }} />
            <i style={{ background: palette.sub }} />
            <i style={{ background: palette.text }} />
          </span>
        </button>
        {palette !== DEFAULT_PALETTE && (
          <button
            type="button"
            className={styles.themeHeart}
            aria-pressed={isSaved}
            aria-label={`Save ${palette.name}`}
            tabIndex={stop ? 0 : -1}
            onClick={(event) => {
              // Saving adds the tile to the Saved group above, which would
              // push the grid down under the pointer; scroll by the same
              // amount so the tile stays put.
              const tile = event.currentTarget;
              const before = tile.getBoundingClientRect().top;
              toggle(palette.name);
              requestAnimationFrame(() => {
                if (!tile.isConnected) return;
                tile
                  .closest("main")
                  ?.scrollBy(0, tile.getBoundingClientRect().top - before);
              });
            }}
          >
            <HeartIcon
              size={13}
              fill={isSaved ? "currentColor" : "none"}
              aria-hidden
            />
          </button>
        )}
      </div>
    );
  };

  return (
    <section className={styles.settingsSection}>
      <div className={styles.settingsHeadingRow}>
        <h2 className={styles.settingsHeading} id="theme-heading">
          Theme
        </h2>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={`Filter ${all.length} themes`}
        />
      </div>
      <p className={styles.settingsIntro}>
        Monkeytype’s dark palettes. Funded and underfunded keep their green and
        amber; overspent follows the theme’s red. Heart a theme to keep it at
        the top.
      </p>
      <div
        role="radiogroup"
        aria-labelledby="theme-heading"
        className={styles.themeGroups}
        onKeyDown={onKeyDown}
      >
        {shownSaved.length > 0 && (
          <div role="group" aria-label="Saved">
            <h3 className={styles.themeGroupLabel}>Saved</h3>
            <div className={styles.themeGrid}>
              {shownSaved.map((palette) => tile(palette, "saved"))}
            </div>
          </div>
        )}
        {shown.length > 0 && (
          <div role="group" aria-label="All themes">
            {shownSaved.length > 0 && (
              <h3 className={styles.themeGroupLabel}>All themes</h3>
            )}
            <div className={styles.themeGrid}>
              {shown.map((palette) => tile(palette, "all"))}
            </div>
          </div>
        )}
        {shown.length === 0 && (
          <p className={styles.settingsIntro}>No theme matches “{query}”.</p>
        )}
      </div>
    </section>
  );
}

// The tile an arrow key moves to: left and right step through the list; up
// and down pick the nearest tile in the row above or below, across groups.
function neighbor(options: HTMLElement[], from: number, key: string) {
  if (key === "ArrowLeft") return Math.max(from - 1, 0);
  if (key === "ArrowRight") return Math.min(from + 1, options.length - 1);
  if (key === "Home") return 0;
  if (key === "End") return options.length - 1;
  if (key !== "ArrowUp" && key !== "ArrowDown") return undefined;
  const rects = options.map((option) => option.getBoundingClientRect());
  const origin = rects[from]!;
  const down = key === "ArrowDown";
  const rows = rects.filter((rect) =>
    down ? rect.top > origin.bottom - 1 : rect.bottom < origin.top + 1,
  );
  if (!rows.length) return from;
  const rowTop = down
    ? Math.min(...rows.map((rect) => rect.top))
    : Math.max(...rows.map((rect) => rect.top));
  const centre = origin.left + origin.width / 2;
  let best = from;
  let distance = Infinity;
  rects.forEach((rect, index) => {
    if (rect.top !== rowTop) return;
    const gap = Math.abs(rect.left + rect.width / 2 - centre);
    if (gap < distance) {
      best = index;
      distance = gap;
    }
  });
  return best;
}
