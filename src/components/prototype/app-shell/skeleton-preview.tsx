"use client";

import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { currentMonth, monthName } from "~/components/budget/format";
import { defaults, type Settings, type Theme } from "./settings";
import { ShellSkeleton } from "./shell-skeleton";
import styles from "./shell.module.css";

// Starts with the details closed, the layout the skeleton was reviewed in.
const initial: Settings = {
  ...defaults,
  inspector: { ...defaults.inspector, collapsed: true },
};

// The loading skeleton on its own, so it can be judged without a slow
// network. Theme and panels check it follows each saved layout.
export function SkeletonPreview() {
  const [settings, setSettings] = useState<Settings>(initial);
  const panel = (side: "sidebar" | "inspector", open: "open" | "closed") =>
    setSettings((value) => ({
      ...value,
      [side]: { ...value[side], collapsed: open === "closed" },
    }));

  return (
    <ShellSkeleton settings={settings} month={monthName(currentMonth())}>
      <div className={styles.controls} data-open>
        <span className={styles.controlsTag}>Prototype</span>
        <Segmented
          label="Theme"
          value={settings.theme}
          options={[
            ["dark", "Dark"],
            ["light", "Light"],
          ]}
          onChange={(theme: Theme) =>
            setSettings((value) => ({ ...value, theme }))
          }
        />
        <Segmented
          label="Sidebar"
          value={settings.sidebar.collapsed ? "closed" : "open"}
          options={[
            ["open", "Open"],
            ["closed", "Closed"],
          ]}
          onChange={(open) => panel("sidebar", open)}
        />
        <Segmented
          label="Details"
          value={settings.inspector.collapsed ? "closed" : "open"}
          options={[
            ["open", "Open"],
            ["closed", "Closed"],
          ]}
          onChange={(open) => panel("inspector", open)}
        />
        <button
          type="button"
          className={styles.resetButton}
          onClick={() => setSettings(initial)}
        >
          <RotateCcwIcon size={12} aria-hidden />
          Reset
        </button>
      </div>
    </ShellSkeleton>
  );
}

function Segmented<T extends string>({
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
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      <span className={styles.segmentedLabel}>{label}</span>
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
    </div>
  );
}
